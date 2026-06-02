# 機能実装メモ

このファイルは [CLAUDE.md](../CLAUDE.md) から読み込まれる詳細ドキュメント。

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

## Sofascore 連携

ライブ情報源として **Sofascore** を採用。`services/sofascoreSource.ts` の `SofascoreLiveSource` が以下を実装:

| エンドポイント | 用途 |
|---|---|
| `/event/{id}` | ステータス・スコア・isLive |
| `/event/{id}/incidents` | ゴール・カード・交代 |

**CORS 対策**: `vite.config.ts` で `/sofascore-api/*` → `https://api.sofascore.com/api/v1/*` のリバースプロキシを設定（dev server のみ有効）。本番デプロイ時は別途リバースプロキシが必要。

**試合ID マッピング**: `public/data/sofascore_mapping.json` にローカル試合ID (`m001` 等) と Sofascore event ID (`15186710` 等) の対応を保存。トーナメントID: `16`、シーズン: `58210` (2026)。全104試合を登録済み（`scripts/build-mapping.mjs` で生成）。未登録試合があればライブ更新はスキップ (graceful)。

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

## 順位表・スタッツの自動導出

| 表示 | 計算ロジック | 入力データ |
|------|-------------|-----------|
| 順位表 (`/standings`) | `utils/computeStandings.ts` | `teams.json` + `matches.json` の `stage="group" && status="finished"` |
| スタッツ得点・アシスト (`/stats`) | `utils/computePlayerStats.ts` | `players.json` + `matches.json` の `status="finished"` |

得点者・アシストの紐付けルール: `Goal.playerId` (players.json 参照) があればそれを使い、なければ `Goal.playerName` を `players.json` の `name` と完全一致で検索。どちらも該当しなければチーム側の集計のみで個人は計上されない。自殺点 (`type="own"`) は得点者にカウントしない。
- `team_details.json`: 48カ国分のチーム史データ（大陸・**世界ランク**・監督（氏名・国籍）・出場回数・初出場・前回出場・最高成績）。出典 Wikipedia（各国代表記事のインフォボックス、2026-05-18 取得、世界ランクは 2026/4/1 時点）。FIFA公式と worldcdb.com には監督・ランキング情報がないため Wikipedia から取得。

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
- **localhost で公式結果を確定**: `/edit/matches` を開く → 各行で「↓ ライブ」ボタンを押すとその試合のライブ値が編集フォームにコピーされる (保存はまだ) → 必要なら修正 → 「手動編集として保存」→ matchEdits に書き込まれる → dev サーバー実行中なら auto-sync が match_results.json を自動更新 (finished + score を持つもののみ、1.5s デバウンス)。
- **編集結果の確認**: `/edit/matches` の入力欄が現在の matchEdits 内容を表示するのでそこで確認する。実際の公開サイト見た目は push 後に GitHub Pages URL で確認。
- **公開サイトに反映**: 自動更新された `match_results.json` を `git commit && git push`。
- **公開サイト訪問者**: localStorage 空 → file (`match_results.json`) がそのまま見える。
- **公開サイト訪問者が `/edit/matches` を開いた場合**: 公開サイトの localStorage (localhost とは別オリジン) に書かれるだけで file は書き換わらない (dev エンドポイントが本番にはない)。ローカル表示の変更にのみ留まる。
- 本番ビルドでは書き込みエンドポイントが存在しないので、`useAutoSyncResults` の fetch は警告だけ出して何もしない。

書き込みエンドポイントは `vite.config.ts` の `matchResultsWriter` プラグイン (`apply: "serve"`) で実装。merge モード書き込みなので、複数試合を同時並行で確定しても既存の他試合データを消さない。

**自動 git push**: dev サーバーが `match_results.json` を書き換えると、30 秒デバウンスで `git add public/data/match_results.json && git commit -m "auto: ..." && git push origin HEAD` を自動実行する。`git commit -- public/data/match_results.json` のようにパスを明示するため、他のファイルの未 commit 変更は巻き込まない。GitHub Desktop バンドル版 git を絶対パスでフォールバック検出するので、git CLI が PATH に無い環境でも動く。`AUTO_PUSH_RESULTS=0` 環境変数で無効化可。git push が失敗 (認証エラー等) した場合は `[auto-push] git push failed: ...` がサーバーログに出るだけで他の動作には影響しない。

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
