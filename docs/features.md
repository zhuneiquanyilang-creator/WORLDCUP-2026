# 機能実装メモ

このファイルは [CLAUDE.md](../CLAUDE.md) から読み込まれる詳細ドキュメント。

## /schedule の初期日フィルタ

`SchedulePage` は URL クエリ `day` が無いとき初期表示日を次の順で決める:

1. 今日その日 (`dayKey(new Date())`) に試合があればそのまま「今日」を選択
2. 今日に試合が無ければ、`status="finished"` の試合を持つ**今日以前で最も新しい日**にフォールバック (= 直近で終了した試合があった日)
3. それも無ければ (大会前など) `"all"` に落として全試合を表示

これで rest day (試合間の休息日) や大会後にアクセスしても、直近試合の結果一覧が自然に開く。ユーザが `day=YYYY-MM-DD` をクエリで指定した場合はその選択を尊重して触らない。実装は `src/pages/SchedulePage.tsx` の `dayInitRef` 付き useEffect。

## ライブ更新の枠組み

試合開始時刻〜終了枠 (グループ135分 / KO180分) の試合を「ライブ中」と判定し、外部ソースから 1 分毎にデータを取得して localStorage に上書き保存する仕組み。サイト未決定のため現在は Mock 実装。

| 役割 | ファイル |
|------|---------|
| 試合タイミング判定 | `utils/matchTiming.ts` (`isLive`) |
| 部分更新型 | `types/live.ts` (`LiveUpdate`) |
| 永続化 | `utils/matchOverrides.ts` (localStorage) |
| ソース抽象化 | `services/liveSource.ts` (`LiveSource` interface + `MockLiveSource`) |
| ポーリング | `hooks/useLivePolling.ts` (1分毎、`shouldPoll()` = KO-30分 〜 KO+135/180分 の試合をフェッチ) |
| データ統合 | `hooks/useMatches.ts` が file + localStorage をマージ |
| 表示 | `components/common/LiveBadge.tsx` (赤いパルスバッジ) |

ポーリングは `<Layout>` 配下にマウント。アプリ全体で1インスタンス。対象試合が 0 件 (ライブ枠外 & プリマッチ枠外) ならネットワーク呼び出しゼロ。

**プリマッチ枠 (フォーメーション・ベンチメンバー)**: `utils/matchTiming.ts` の `PREMATCH_POLL_MINUTES = 30` で定義。KO 30 分前から polling が起動するので、試合開始前にフォーメーションとベンチメンバーがサイトに反映される（Sofascore の `/event/{id}/lineups` は試合前から予想スタメンを返す）。incidents (goals/cards/subs) と statistics は試合が進行中・終了状態に入ってから取得される（Sofascore 側がプリマッチでは提供しないため）。

## ライブ情報源: Football-Data.org v4

ライブ情報源は **Football-Data.org v4** (`api.football-data.org`) を本採用。実装は `services/footballDataSource.ts` の `FootballDataLiveSource` (`main.tsx` で `setLiveSource` 経由で注入)。

### 採用理由 (経緯)

1. **Sofascore**: Cloudflare bot 対策で 2026 年 6 月時点 API が 403。実装は `services/sofascoreSource.ts` に保持
2. **API-Football (api-sports.io)**: Free プランは 2022-2024 シーズンのみ。W 杯 2026 は Pro プラン (有料、約 $19/月) 必須。実装は `services/apiFootballSource.ts` に保持 (将来課金時に切替え可)
3. **Football-Data.org**: 無料 (Tier One) で W 杯 2026 のスコア・順位・得点者が取れる ★現用

### 認証とプロキシ

| 設定 | 場所 |
|---|---|
| API キー保管 | `.env.local` の `VITE_FOOTBALL_DATA_KEY=...` (gitignore `*.local` で除外) |
| プロキシ | `vite.config.ts` の `/football-data-api/*` → `https://api.football-data.org/v4/*` (`X-Auth-Token` ヘッダを dev サーバーが差し込む) |
| サンプル | `.env.example` (`VITE_FOOTBALL_DATA_KEY=your-football-data-key-here`) |
| キー取得 | https://www.football-data.org/client/register (無料、10 req/分) |

### 試合 ID マッピング

`public/data/footballdata_mapping.json` に m??? → Football-Data の match ID の対応を保存。生成は `scripts/build-footballdata-mapping.mjs` (dev サーバー起動状態で `node scripts/build-footballdata-mapping.mjs`)。`/competitions/WC/matches` の全試合を取得して、日付 ± 12h + チーム ID (英語名 → teams.json の nameEn or TLA) で照合する。

### 無料枠 (10 req/分) を守るキャッシュ戦略

`FootballDataLiveSource` はモジュールスコープに以下のキャッシュを持ち、`useLivePolling` の 1 分毎ティックが全試合を順に叩いても無駄なリクエストが発生しない。

| エンドポイント | キャッシュ | TTL | 想定リクエスト数/日 |
|---|---|---|---|
| `/competitions/WC/matches` | `matchesCache` (W 杯全 104 試合をまとめ取得) | 60 秒 | active polling 中のみ約 60/h |

W 杯全 104 試合の最新スコア・ステータスが 1 リクエストで取れるので、複数試合がライブ中でも追加コストはゼロ。1 分あたり 1 req に余裕で収まる。

### 取れるデータと取れないデータ

| 機能 | Football-Data.org Free | 備考 |
|---|---|---|
| 試合スコア (HT / FT / ET / PK) | ✅ | `score.fullTime` / `score.penalties` |
| 試合ステータス (LIVE / FT 等) | ✅ | TIMED / SCHEDULED / LIVE / IN_PLAY / PAUSED / FINISHED にマップ |
| ライブ経過分 (minute) | — | UI からは廃止。試合一覧・試合詳細とも分数を表示せず、ライブ中は固定で「LIVE」バッジを表示する方針 (FD と表示のずれが避けられないため) |
| 順位表 | ✅ | `/competitions/WC/standings` 取得可 (現在は `utils/computeStandings.ts` で自動計算しているので未使用) |
| 得点者ランキング | ✅ | `/competitions/WC/scorers` (現在は `utils/computePlayerStats.ts` で自動集計、Football-Data 値は未使用) |
| **フォーメーション** | ❌ | 無料枠不可。`/edit/matches` または手動 script で個別入力 |
| **ゴール時系列** (誰が何分に得点) | ❌ | 同上 |
| **カード** | ❌ | 同上 |
| **交代** | ❌ | 同上 |
| **スタッツ** (xG/支配率/シュート) | ❌ | 無料枠は提供なし |

### ステータスコード変換

Football-Data.org の `status` → 本サイトの `MatchStatus`:

| Football-Data.org | 本サイト |
|---|---|
| TIMED / SCHEDULED / POSTPONED | scheduled |
| LIVE / IN_PLAY / PAUSED | live |
| FINISHED / AWARDED | finished |
| SUSPENDED / CANCELLED | (undefined、base 値維持) |

### 起動時キャッチアップ同期 (startup-catchup)

dev サーバーが落ちている間に終わった試合は polling 経由では拾えないため、`vite.config.ts` の `startupCatchup` プラグインがサーバー起動直後に 1 回だけ Football-Data.org を叩き、`match_results.json` を更新する。

- **対象**: KO 時刻が現在より 30 分以上前 (= 開始済み) で、`match_results.json` の status が "finished" になっていない試合
- **取得値**: status / score / penaltyScore のみ (フォーメーション・goals・カードは Football-Data 無料枠では取れないので別途 `/edit/matches` で手入力)
- **API 呼び出し**: 同じ (fdTeamId, 日付) はキャッシュ。7 秒スロットルで無料枠 10 req/分を守る。429 で 60 秒待機 + 1 回リトライ
- **書き込み後**: 既存 schedulePush() が起動して、30 秒デバウンスで `git add / commit / push` まで自動実行 → GitHub Pages に反映
- **opt-out**: 環境変数 `STARTUP_CATCHUP_RESULTS=0` で無効化
- **API キー**: `.env.local` の `VITE_FOOTBALL_DATA_KEY` を loadEnv 経由でプラグインに直接渡す (proxy 経由ではなく Node 側で `https://api.football-data.org/v4/...` を直接叩く)
- **対象ゼロのとき**: `[startup-catchup] キャッチアップ対象なし` とだけログ出力して終了 (= API 呼び出しゼロ)

### フォーメーション・イベント補完の運用

Football-Data.org では取れないデータは、以下のいずれかで補完する。

1. **`/edit/matches`** で UI 上から入力 → localStorage matchEdits → auto-sync が match_results.json に書き出し
2. **手動 script**: 例 [`scripts/write-m001-formations.mjs`](../scripts/write-m001-formations.mjs) のように、Sofascore スクショからスタメンを抽出して直接 match_results.json に書き込み

`/edit/matches` の編集 UI が扱える項目（試合行を「▼ 編集」で展開）:

- **status / スコア / PK**: 行内インライン
- **得点者** (goals): GoalEditor。分・チーム・種別 (通常/PK/オウン)・得点者・アシスト
- **ホーム / アウェイ フォーメーション** (homeFormation / awayFormation): FormationEditor。`shape` (例 "4-3-3") を入力するとスタメン枠が自動展開し、GK→DF→MF→FW の順に players.json のチーム所属選手から `<select>` で 11 名を選ぶ。**各レイヤーは右サイド → 左サイドの順**（`scripts/write-m00X-formations.mjs` と同じ規約。`src/utils/formation.ts` の `generateFormation` を再利用）。`ベンチ` は「そのチームの全選手 − スタメン11名」を背番号順で自動算出して保存時に書き込む（手動で選ぶ必要はない）。
- **カード** (bookings): BookingEditor。分・チーム・選手・種別 (Y/Y2R/R/YR)
- **交代** (substitutions): SubEditor。分・チーム・IN / OUT 選手

保存ボタンで `matchEdits` (localStorage) に書き込まれ、dev サーバー実行中なら auto-sync が `match_results.json` に出して GitHub Pages に反映される流れは従来通り。手動 script (`write-m00X-formations.mjs`) は今後も「画面非表示の特殊な編集」用に残しているが、通常のスタメン入力は `/edit/matches` 1 つで完結する。

## ライブ情報源の代替実装 (現在未使用、保持中)

### Sofascore (`services/sofascoreSource.ts`)

Sofascore は元々の本採用ソースだったが 2026 年 6 月時点で Cloudflare bot 対策により API がプロキシ越しでも 403 を返す。Cloudflare の制限が緩和された場合に再有効化できるよう、コードはそのまま保持。

| エンドポイント | 用途 |
|---|---|
| `/event/{id}` | ステータス・スコア・isLive |
| `/event/{id}/incidents` | ゴール・カード・交代 |
| `/event/{id}/lineups` | フォーメーション・スタメン・ベンチ |
| `/event/{id}/statistics` | スタッツ |

**CORS 対策**: `vite.config.ts` で `/sofascore-api/*` → `https://api.sofascore.com/api/v1/*` のリバースプロキシを設定（dev server のみ有効）。**試合ID マッピング**: `public/data/sofascore_mapping.json` (トーナメントID: 16、シーズン: 58210)。

### API-Football (`services/apiFootballSource.ts`)

Free プラン (100 req/日) は 2022-2024 シーズン限定。W 杯 2026 を取るには Pro プラン以上 (約 $19/月) が必要。将来課金してフォーメーション・イベントを自動取得したくなった時にすぐ切替えられるよう実装は保持。

| 設定 | 場所 |
|---|---|
| API キー保管 | `.env.local` の `VITE_API_FOOTBALL_KEY=...` |
| プロキシ | `vite.config.ts` の `/api-football/*` → `https://v3.football.api-sports.io/*` (`x-apisports-key` ヘッダ自動付与) |
| 試合 ID マッピング | `public/data/apifootball_mapping.json` (生成スクリプト: `scripts/build-apifootball-mapping.mjs`) |
| キャッシュ | `batchCache` (15 分 TTL) / `lineupsCache` (永続) / `eventsCache` (15 分) / `statsCache` (永続) / `singleFixtureCache` (5 分) |

実装の詳細 (選手解決、自殺点の扱い、ステータスコード変換) は `apiFootballSource.ts` の冒頭コメントとコード参照。

**インシデント変換**:
- `incidentType="goal"` → `Goal` (`incidentClass`: regular/penalty/ownGoal → normal/penalty/own)
- `incidentType="card"` → `Booking` (`incidentClass`: yellow/red/yellowRed → Y/R/Y2R)
- `incidentType="substitution"` → `Substitution`
- `isHome` フラグで teamId 判定

**選手マッチング戦略**: 名前 (英語) ↔ players.json (日本語) の翻訳問題を避けるため、**背番号 (`Player.number`) で突合**する方針。`Player` 型に `number?: number` を追加済み。実装は背番号データが入った段階で:
1. SofascoreLiveSource で /lineups から `shirtNumber` を取得
2. インシデントの player.name を lineup でマップ → shirtNumber
3. `players.json` を `(teamId + number)` でルックアップ → `playerId`
4. `computePlayerStats` の集計ロジックは playerId ベースのまま動く

**マッピングの生成・更新**: `scripts/build-mapping.mjs` が Sofascore の大会日程（`/unique-tournament/16/season/58210/events/next/{0..}`）を取得し、グループ戦は出場2チームの組、決勝トーナメントは進出条件ラベル（「73試合勝者」「A組2位」等）で `matches.json` と照合して `sofascore_mapping.json` を再生成する。dev サーバー起動中に `node scripts/build-mapping.mjs` で実行（取得は dev プロキシ経由。Node から直接 api.sofascore.com を叩くと 403 になるため）。Sofascore 側の event ID が変わった場合も再実行で更新できる。

## 選手名の自動伝播 (players ↔ match_results)

`public/data/players/*.json` (選手マスタ) と `public/data/match_results.json` の選手名を自動で同期する仕組み。ユーザーがマスタ側で "佐野 海舟" → "佐野海舟" のように名前を書き換えると、過去試合の goals / bookings / substitutions / formation.starting / formation.bench に含まれる同名エントリが自動で追随更新される。

- **実装**: [`scripts/sync-player-names.mjs`](../scripts/sync-player-names.mjs) の `syncPlayerNames()` を `vite.config.ts` の `syncPlayerNamesWatcher` プラグインが呼び出す。dev サーバー起動時に 1 回 + `public/data/players/*.json` の変更を 500ms デバウンスで検知して再実行。
- **同期ルール**:
  - `goals[].playerName` / `assistPlayerName`: `playerId` / `assistPlayerId` からマスタの現在名を引いて置換
  - `homeFormation` / `awayFormation` の `starting[]` / `bench[]`: `(teamId, number)` でマスタ選手を特定して `name` を置換
  - `bookings[].playerName` / `substitutions[].inName` / `.outName`: 上記 goal/formation 更新で組み立てた team-scoped rename map (旧名 → 新名) に一致するもののみ置換 (勝手な推測はしない)
- **書き込みトリガー**: 同期結果 changed > 0 の場合のみ `match_results.json` を上書き。書き込み後は `schedulePush()` が 30 秒デバウンスで git commit / push を自動実行。
- **CLI**: `node scripts/sync-player-names.mjs` で手動実行可能。dev サーバーを介さず一括同期したい場合に使う。

## 順位表・スタッツの自動導出

| 表示 | 計算ロジック | 入力データ |
|------|-------------|-----------|
| 順位表 (`/standings`) | `utils/computeStandings.ts` | `teams.json` + `matches.json` の `stage="group" && status="finished"` |
| スタッツ得点・アシスト (`/stats`) | `utils/computePlayerStats.ts` | `players.json` + `matches.json` の `status="finished"` |

得点者・アシストの紐付けルール: `Goal.playerId` (players.json 参照) があればそれを使い、なければ `Goal.playerName` を `players.json` の `name` と完全一致で検索。どちらも該当しなければチーム側の集計のみで個人は計上されない。自殺点 (`type="own"`) は得点者にカウントしない。
- `team_details.json`: 48カ国分のチーム史データ（大陸・**世界ランク**・監督（氏名・国籍）・出場回数・初出場・前回出場・最高成績）。出典 Wikipedia（各国代表記事のインフォボックス、2026-05-18 取得、世界ランクは 2026/4/1 時点）。FIFA公式と worldcdb.com には監督・ランキング情報がないため Wikipedia から取得。

## 表彰ページ

`/awards`（`AwardsPage`）が 2026 大会の最終順位（1〜4位）と個人賞 7 つを表示。データは `public/data/awards_2026.json`（1 大会分 = 単一オブジェクト）。型は過去大会と共通の `types/worldCupResult.ts` の `WorldCupResult` を再利用しており、フィールド構成・表示順も `PastTournamentDetailPage` と揃えている（大会終了後に過去大会データへ移植しやすくするため）。

**最終順位 (1〜4位) は自動反映**: `utils/finalRanking.ts` の `computeFinalRanking(matches)` が `useMatches`（live > manual > file > base のマージ済み）から決勝 (`stage: "final"`) と 3位決定戦 (`stage: "third"`) を拾い、`status === "finished"` になった時点で勝者→1位/3位、敗者→2位/4位に割り当てる。同点の場合は PK スコアで判定（`utils/matchOutcome.ts` の `winnerSide`。`resolveMatchTeams` の KO 勝者判定と共通ロジック）。

- 2試合は独立に判定するので、3位決定戦だけ終わっていれば 3位・4位だけが先に埋まる。
- 確定した枠は `TeamLink` で国旗付き・チーム詳細へのリンク付きで表示。
- 未確定の枠は `awards_2026.json` の `first`〜`fourth`（手入力）にフォールバックし、それも空なら `—`。通常は空のままでよく、試合データが誤っている等の緊急時の上書き手段として残している。

個人賞は自動化できないため `awards_2026.json` を直接編集する運用（編集 UI は無し）。未入力（空文字）のフィールドは `—` で表示する。

## 年齢計算

`utils/age.ts` の `calculateAge(birthDate)` が「2026-06-11 開幕日時点」での満年齢を返す。観覧時刻に依存しない安定値。`PlayerRoster` 表示用。

## TBD 試合の表示

`Match` 型に `homeTeamLabel` / `awayTeamLabel`（optional）を追加。`homeTeamId` が `teams.json` に存在しない場合は label を表示する。`MatchCard` / `MatchResultCard` / `ScoreBoard` がこのフォールバックを実装。`utils/team.ts` の `teamDisplay()` がヘルパ。

## チーム詳細ページ

`/teams/:id`（`TeamDetailPage`）。順位表のチーム名、試合カードのチーム名、試合詳細のチーム名すべてからリンク。ヘッダ（国旗・国名）の下に**タブ切替**（「チーム詳細」/「選手一覧」、`useState` でローカル管理）を置き、内容を出し分ける:

- **チーム詳細タブ**: `TeamProfile`（大陸 / 最高成績 / 出場回数 / 初出場 / 前回出場）＋ `TeamHistory`（過去の年別成績）
- **選手一覧タブ**: `PlayerRoster`（選手一覧）

データソース: `public/data/team_details.json`（48チーム分）。出典は Wikipedia 英語版「National team appearances in the FIFA World Cup」（2026-05-18 取得）。

## 国名検索（ヘッダー）

ヘッダー (`components/common/Header.tsx`) に国名検索ボックス `components/common/TeamSearch.tsx` を配置。`<Layout>` 経由で全ページ共通に表示される。

- 入力をチーム名（日本語）・英語名 (`nameEn`)・FIFAコード (`id`) に部分一致でフィルタ（`teams.json` を `useTeams` で取得）。
- 候補は最大8件。各候補に国旗・国名・英語名・所属グループを表示。
- 候補をクリック／Enter で `/teams/:id`（`TeamDetailPage`）へ遷移。
- キーボード操作: ↑↓ で候補移動、Enter で決定、Esc で閉じる。ボックス外クリックでも閉じる。

## 国旗の表示

Windows 等で Unicode 国旗絵文字が正しく描画されないため、`components/common/Flag.tsx` が flagcdn.com の SVG を `<img>` で表示する。`Team.isoCode` (ISO 3166-1 alpha-2、英国構成国は `gb-eng` / `gb-sct`) を URL に使用。表示箇所:

- 順位表 (`StandingsRow`)
- 日程・結果カード (`TeamLink` 経由で MatchCard / BracketMatch)
- 試合詳細スコアボード (`ScoreBoard`)
- チーム詳細ヘッダ (`TeamDetailPage`)

外部ホスト依存だが、研究用途ではなくランタイム画像として `<img>` で取得するため許可リスト管理対象外。

## チーム名のクリック対応

`components/common/TeamLink.tsx` がチームが `teams.json` に存在すれば `/teams/:id` へのリンクを返し、TBD ラベル（例「A組1位」）の場合はリンクなし span を返す。

試合カード（MatchCard / BracketMatch）は外側を `<Link>` から `<div role="link" onClick + onKeyDown>` に変更。内側のチーム名は `TeamLink` で個別リンク、`stopPropagation` で親の navigate を抑止。

## トーナメント表ビュー

`components/schedule/BracketView.tsx` が**左右対称ブラケット**を表示:

```
[左R32]→[左R16]→[左QF]→[左SF]  [決勝+3位決定戦]  [右SF]←[右QF]←[右R16]←[右R32]
```

- 左半分は SF 101 に集約する側、右半分は SF 102 に集約する側
- ブラケット配列 (`LEFT_R32` / `RIGHT_R32` など) はハードコード。並び順は次ラウンドのペアリング順
- 中央列は決勝カード + 3位決定戦（下に小さく）
- 各セルは `BracketMatch.tsx` のコンパクトカード
- 横スクロール対応

## 試合データの 4 層上書き構成 (ライブと手動編集の分離)

`useMatches` は 4 つのデータソースを順に重ねて Match を返す。**ライブ (live) が最優先**で、手動編集 (manual) は localhost の表示には現れない (= localhost の見た目はライブ取得のまま) 。これで「localhost はライブ / 公開サイトは編集」の使い分けが成立する:

| # | 層 | ソース | 書き込み主体 | 用途 |
|---|---|---|---|---|
| 1 | base | `public/data/matches.json` | git | 大会日程 |
| 2 | file | `public/data/match_results.json` | git (auto-sync 経由 / 手動編集) | 公式結果。公開サイトはこれだけ見る |
| 3 | manual | `localStorage["wc2026:matchEdits"]` | `/edit/matches` のみ | 手動確定。auto-sync で file に流れる |
| 4 | **live** | `localStorage["wc2026:matchOverrides"]` | Sofascore polling のみ | **localhost 表示の最優先** |

**重要な分離**:

- ライブ (`matchOverrides`) と手動編集 (`matchEdits`) は **完全に別の localStorage キー** を使用。互いに上書きしない。
- **auto-sync は matchEdits だけ** を `match_results.json` に書き出す。Sofascore ライブ結果が誤って公式記録に流れ込むことはない。
- **localhost 表示**: live > manual > file > base。Sofascore polling が走っている限りライブが見え、手動編集を保存しても localhost の表示は変わらない (= 公式記録の編集に影響されずに「ライブ視聴用ツール」として使える)。
- **公開サイト表示**: 訪問者は live / manual の localStorage を持たないため、file (= auto-sync で manual から書き出された公式結果) が見える。

**運用フロー (使い分け)**:

- **localhost で見る現在のスコア**: live > manual > file。Sofascore のライブ更新がそのまま見える。手動編集を保存しても localhost の表示には現れないので、編集作業がライブ視聴を邪魔しない。
- **localhost で公式結果を確定**: `/edit/matches` を開く → 各行で「↓ ライブ」ボタンを押すとその試合のライブ値が編集フォームにコピーされる (保存はまだ) → 必要なら修正 → 「手動編集として保存」→ matchEdits に書き込まれる → dev サーバー実行中なら auto-sync が match_results.json を自動更新 (1.5s デバウンス)。**auto-sync の対象**: (a) status === "finished" かつ score がある「確定済み」エントリ、または (b) homeFormation / awayFormation / bookings / substitutions / goals のいずれかが入っている「補助データ付き」エントリ。後者によって試合前のフォーメーション入力やカード・交代だけの追記も公開サイトに反映される。サーバ側は field-level merge なので既存の他フィールドは壊さない。
- **編集結果の確認**: `/edit/matches` の入力欄が現在の matchEdits 内容を表示するのでそこで確認する。実際の公開サイト見た目は push 後に GitHub Pages URL で確認。
- **公開サイトに反映**: 自動更新された `match_results.json` を `git commit && git push`。
- **公開サイト訪問者**: localStorage 空 → file (`match_results.json`) がそのまま見える。
- **公開サイト訪問者が `/edit/matches` を開いた場合**: 公開サイトの localStorage (localhost とは別オリジン) に書かれるだけで file は書き換わらない (dev エンドポイントが本番にはない)。ローカル表示の変更にのみ留まる。
- 本番ビルドでは書き込みエンドポイントが存在しないので、`useAutoSyncResults` の fetch は警告だけ出して何もしない。

**KO 戦 PK 突入時の運用 (2026-06-30 確立)**: Football-Data の `score.fullTime` は PK 進行中に不安定値 (4-4 / 5-6 等) を返すため、`score` (regular FT) を ET 終了値で固定し PK は手動入力する。手順:

1. 該当試合の `match_results.json` に `score` を ET 終了時の値で直接書き込む (通常は同点、例: 1-1)
2. 同エントリに `manualLock: true` を設定 (live polling / periodic-catchup / GH Actions すべてが該当試合を skip するようになる)
3. `/edit/matches` の対象行で `manualLock` チェック + `状態` ドロップダウン (scheduled/live/finished) + `PK` 欄を更新 → 「手動編集として保存」で matchEdits に永続化 → auto-sync が file に伝播
4. PK が進むごとに `/edit/matches` の PK 欄を更新 → 保存。試合終了時は `状態` を `finished` に変更 → 保存 (試合経過の末尾に自動で「試合終了」divider が表示される)

`manualLock=true` は該当試合のみに作用し、他試合のライブ反映には影響しない (useLivePolling / useMatches で per-match に判定)。`/edit/matches` には score 入力欄が無いため、regular score の修正は match_results.json を直接編集する運用。

書き込みエンドポイントは `vite.config.ts` の `matchResultsWriter` プラグイン (`apply: "serve"`) で実装。merge モード書き込みなので、複数試合を同時並行で確定しても既存の他試合データを消さない。

**自動 git push**: dev サーバーが `match_results.json` を書き換えると、30 秒デバウンスで `git add public/data/match_results.json && git commit -m "auto: ..." && git push origin HEAD` を自動実行する。`git commit -- public/data/match_results.json` のようにパスを明示するため、他のファイルの未 commit 変更は巻き込まない。GitHub Desktop バンドル版 git を絶対パスでフォールバック検出するので、git CLI が PATH に無い環境でも動く。`AUTO_PUSH_RESULTS=0` 環境変数で無効化可。git push が失敗 (認証エラー等) した場合は `[auto-push] git push failed: ...` がサーバーログに出るだけで他の動作には影響しない。

**push reject 時の自動回復**: GitHub Actions の `fetch-scores.yml` (10 分間隔) が先に push して origin が進んでいると、dev サーバーの auto-push は non-fast-forward で reject される。これを自動回復するため、`auto-push` は reject を検知したら `git fetch origin main` → `git merge --no-edit FETCH_HEAD` → 競合が `match_results.json` のみなら `--ours` で resolve → 再 push、というリカバリを 1 回試みる。他ファイルにも競合がある場合は `merge --abort` して安全側に倒し、`[auto-push] recovery aborted — conflicts in other files: ...` をログに出して諦める。成功時は `[auto-push] match_results.json pushed after merge-recovery (...)` がログに出る。これがないと「ローカルでスコアが進んだのに公開サイトに反映されない (auto-push が無言で失敗し続ける)」現象が起きるため必須。

## トーナメント表への自動反映（グループ確定 / KO 勝者）

`matches.json` の R32 以降は `homeTeamId: "GA1"` (= `homeTeamLabel: "A組1位"`) のような**プレースホルダ ID** を持つ。`utils/resolveMatchTeams.ts` が試合データを描画前に変換し、確定した位置だけ実チーム ID に差し替える（差し替えた場合は `homeTeamLabel` を落とすので、`TeamLink` / `MatchCard` / `BracketMatch` が普通のチームカードとして国旗付きで描画する）。`hooks/useMatches.ts` が `teams.json` 読み込み後に自動で適用するので、トーナメント表ビュー (`BracketView`) もスケジュール一覧も追加コード不要で反映される。

差し替え対象:

| プレースホルダ | 例 | 確定条件 |
|---|---|---|
| `G<X><N>` | `GA1` (A組1位) | `utils/groupClinch.ts` がそのグループの順位 N が数学的にロック済みと判定 |
| `W<num>` | `W73` (73試合勝者) | m073 が `status="finished"` で勝者が確定（90分+延長で home≠away、または同点なら `penaltyScore.home`≠`penaltyScore.away`）かつ両チーム ID も解決済み |
| `L<num>` | `L101` (101試合敗者) | 同上、敗者側 |
| `G3_<groups>` | `G3_ABCDF` | **グループ戦 72 試合全部が `finished`** になった時点で、3位チームの横断順位 (簡易タイブレーカー) から進出 8 グループを決め、`public/data/third_place_assignment.json` で実チームへ解決。途中段階ではラベル表示のまま |

**グループ確定 (`clinchedRanks`)** は最終節を待たずに反映できるよう次の戦略:

- 残り 0 試合: そのまま順位確定（簡易タイブレーカー: 勝ち点→GD→得点）。
- 残り 1〜2 試合: 各試合 0–5 点 × 0–5 点（36 通り）の全スコア組合せを総当たりし、全シナリオで同じチームが入る順位だけを「確定」とする。GD / 得点での確定もこのループで拾える。
- 残り 3 試合以上: 勝ち点だけの保守的判定（i_min_points > j_max_points なら確定）。タイブレーカーで決まる可能性のあるケースは無視するため、早期段階で誤って確定扱いしない。

KO カスケード（R32→R16→QF→SF→決勝）は試合番号順 1 ループで処理: ある試合の winner/loser を `winnerOf` / `loserOf` Map に積みながら、後続試合の `W##` / `L##` を順次解決する。`live` 状態の試合は順位確定の計算では「未消化」として扱う（スコアが変わり得るため）。順位表ページ (`StandingsTable`) はライブ中スコアも反映する従来動作のまま。

**PK 決着**: KO 戦が 90 分+延長で同点に終わって PK 決着した場合に備え、`Match.penaltyScore?: { home; away }` を持つ。Sofascore からは `event.homeScore.penalties` / `event.awayScore.penalties` を取得して保存。resolver は同点なら `penaltyScore` で勝者を決める。`ScoreBoard` は「1-1 (PK 4-2)」のように補足表示する。

ライブ中の試合（`status === "live"`）はクリンチ計算では「未消化」扱い。ライブの暫定スコアで bracket を勝手に書き換えないようにしている（`StandingsTable` のほうはライブ反映ありの従来動作のまま）。

**確定後の matches.json 反映 (KO ラウンドごとの手作業)**: `resolveMatchTeams` は**表示レイヤーのみ**の解決なので、対戦カードが確定したら `public/data/matches.json` のプレースホルダ (`W101` / `L102` 等) を実チーム ID に置き換え、`homeTeamLabel` / `awayTeamLabel` を削除する。理由は 2 つ:

- `/edit/matches` (`EditMatchesPage`) は `useMatches` ではなく `useJsonResource(matches.json)` を直接読むため、プレースホルダのままだと選手ドロップダウン (`playersByTeam.get("W101")`) が空になり、ゴール・カード・交代・フォーメーションを入力できない。
- `public/data/footballdata_mapping.json` の `fdHomeTeamId` / `fdAwayTeamId` は TBD 時 `null` で、`FootballDataLiveSource` / `sync-footballdata-results.mjs` は「両方 null なら諦め」の分岐に入る。ライブ取得・startup-catchup を効かせるには確定チームの Football-Data team ID を埋める必要がある (前ラウンドの mapping エントリから引き継げる。例: m101 = FRA(773) vs ESP(760) → 勝者 ESP の m104 は `fdHomeTeamId: 760`)。

2026-07-19 時点で 104 試合すべて実チーム ID に解決済み (m103 = FRA vs ENG、m104 = ESP vs ARG)。

**3位ワイルドカード組合せ表 (`public/data/third_place_assignment.json`)**: 出典は Wikipedia「[Template:2026 FIFAワールドカップ・3位組み合わせ表](https://ja.wikipedia.org/wiki/Template:2026_FIFAワールドカップ・3位組み合わせ表)」（2026-05-23 取得）。元データは FIFA の大会規則 付属書C。C(12,8)=495 通りの組合せが収録されている。再生成は `node scripts/parse-third-place-table.mjs`（事前に Wikipedia API で wikitext を `scripts/wikitext_3rd_place.txt` にダウンロードしておく）。3 位ワイルドカードは 1 位 / 2 位とは違い、グループ間の横断順位を必要とするため、最終グループ戦が終わるまで FIFA 表のキーが確定しない → ラベル表示のまま据え置く設計。

## 試合番号の表示

R32 以降の TBD ラベル（例「73試合勝者」）が指す試合を見分けられるよう、各試合カード／詳細に FIFA の試合番号（1〜104）を表示する。`utils/matchNumber.ts` の `matchNumber()` が `m073` → 73 のように ID からパース。表示位置:

- `MatchCard`（日程）: 左上にバッジ「#73」
- `MatchResultCard`（試合結果一覧）: 左上にバッジ「#73」
- `ScoreBoard`（試合詳細）: メタ行に金バッジ「第73試合」
- `players.json`: 既存の主要選手リスト（イタリア除く）。全選手 `goals: 0, assists: 0`。

UI 側の対応:
- 順位表: `played=0` のときは「上位2チーム進出」マーカーを非表示にし、凡例を「未開催（順位は仮表示）」に切替。
- スタッツ: 得点・アシストとも 0 の場合は「まだ得点はありません / まだアシストはありません」を表示。

## 過去の大会ページ

`/past`（`PastTournamentsPage`）が 1930〜2022 年の歴代W杯を**新しい順**に一覧表示。出典は `public/data/world_cup_hosts.json`（year ≤ 2022 でフィルタ）。各行クリックで `/past/:year`（`PastTournamentDetailPage`）へ。

詳細ページの表示項目（`public/data/world_cup_results.json`、1大会1エントリ）:

- **結果**: 1位／2位／3位／4位（国名）
- **個人賞**: ゴールデンボール（最優秀選手）／シルバーボール／ブロンズボール／ゴールデンブーツ（得点王）／ゴールデングローブ（最優秀GK）／ベストヤングプレーヤー（最優秀若手選手）／ベストゴール

各賞は `{ player, nationality }`（選手名＋国籍、いずれも手入力テキスト）。`world_cup_results.json` は 1930〜2022 の22大会分。結果（1〜4位）と一部の賞は worldcdb.com の各大会ページ（2026-05-20 取得）から入力済み。古い大会はゴールデンボール・GK賞・ベストゴール等が未制定/未掲載のため空欄。1930年の3・4位も出典に記載がなく空欄。データ追記はファイルを直接編集する運用。型は `src/types/worldCupResult.ts`。

詳細ページ下部には**トーナメント表**も表示。データは `public/data/world_cup_knockouts.json`（`{ year, matches: KnockoutMatch[] }`）。`KnockoutMatch` は `round`(round16/quarter/semi/third/final) / `team1` / `score1` / `team2` / `score2` / `winner`(1|2) / `note`(延長・PK・再試合)。出典は worldcdb.com の各大会決勝トーナメントページ（`{NN}{country}final.htm`、2026-05-20 取得）。ノックアウト方式のある19大会を収録（決勝リーグ総当たり方式の 1950・1974・1978 は対象外）。表示は `components/past/PastBracket.tsx` がラウンドごとの列でブラケット風に描画、3位決定戦は決勝列の下に表示。勝者を太字＋濃色で強調。**縦並びは決勝から再帰的に辿って `team1`/`team2` の系譜順に整列する**ため、`world_cup_knockouts.json` の配列順がそのままで列同士が視覚的に揃う（年ごとにデータを並び替える必要はない）。
