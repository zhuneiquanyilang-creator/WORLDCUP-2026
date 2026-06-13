# データモデル

このファイルは [CLAUDE.md](../CLAUDE.md) から読み込まれる詳細ドキュメント。

## データモデル（型定義の概略）

### Team
```ts
type Team = {
  id: string;          // "JPN" (FIFA 3文字コード)
  name: string;        // "日本"
  nameEn: string;      // "Japan"
  flag: string;        // Unicode 国旗絵文字 (フォールバック)
  isoCode: string;     // "jp" (ISO 3166-1 alpha-2 / 英国構成国は "gb-eng" 等)
  groupId: string;     // "A".."L"（12グループ × 4チーム = 48）
};
```

### Standing
```ts
type Standing = {
  teamId: string;
  played: number;      // 試合数
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
};
```

### Match
```ts
type Match = {
  id: string;
  stage: "group" | "round32" | "round16" | "quarter" | "semi" | "third" | "final";
  groupId?: string;
  date: string;          // ISO 8601
  venue: string;         // 会場名
  homeTeamId: string;
  awayTeamId: string;
  homeTeamLabel?: string;  // TBD カード用
  awayTeamLabel?: string;
  status: "scheduled" | "live" | "finished";
  score?: { home: number; away: number };
  goals?: Goal[];
  bookings?: Booking[];          // カード
  substitutions?: Substitution[]; // 交代
  homeFormation?: FormationData;  // フォーメーション
  awayFormation?: FormationData;
  lineup?: { home: string[]; away: string[] }; // 旧フォーマット (未使用)
};

type Goal = {
  minute: number;
  addedTime?: number;    // アディショナルタイム (例: 90+3 なら minute=90, addedTime=3)
  teamId: string;
  playerId?: string;     // players.json 参照
  playerName?: string;   // playerId が無い場合のフォールバック
  assistPlayerId?: string;
  assistPlayerName?: string;
  type: "normal" | "penalty" | "own";
};

type Booking = {
  minute: number;
  addedTime?: number;    // 同上 (例: 45+2 なら minute=45, addedTime=2)
  teamId: string;
  playerName: string;
  type: "Y" | "Y2R" | "R" | "YR";  // イエロー / 2枚目イエロー / 一発レッド / イエロー後の一発レッド
};

type Substitution = {
  minute: number;
  addedTime?: number;    // 同上
  teamId: string;
  inName: string;
  outName: string;
};

type FormationSpot = {
  x: number;   // 0-100 守備→攻撃方向
  y: number;   // 0-100 左→右
  number?: number;
  name: string;
  role?: string;
};

type FormationData = {
  shape: string;          // "4-3-3" 等
  starting: FormationSpot[];  // 11人
  bench?: { number?: number; name: string }[];
};
```

### 試合詳細ページ (`/matches/:id`)

`MatchDetail` 配下で以下のレイアウト:
- **上部**: `ScoreBoard` (常時表示) — 試合番号 / ステージ / 日時 / 会場 / スコア / 国旗
- **タブ切替**:
  - **試合経過** (default): `MatchEvents` — 得点・カード・交代を分単位で時系列表示。home は右側、away は左側（中央に分単位）
  - **フォーメーション**: `CombinedFormation` — 1枚の SVG ピッチに両チーム11人を配置。**PC は横向き**（ホーム左／アウェイ右）、**スマホ (≤640px) は縦向き**（ホーム上／アウェイ下）に自動切替（`useIsNarrow` が `matchMedia` を監視）。ベンチは下部に常時全表示。
- フォーメーションデータがない試合はタブが disabled

`MatchEvents` は `Goal` / `Booking` / `Substitution` を統合してソート表示。アイコン: ⚽ / 🟨 / 🟥 / 🔁。分の表示は `addedTime` が入っていれば `90+3` 形式 (`utils/eventMinute.ts` の `formatMinute`)。ソートも `eventSortKey` (100 進数キー) で 45+1 < 45+2 < 46 / 90+1 < 90+2 < 91 を保証する。`/edit/matches` の編集 UI では分の入力欄が text 形式で「90+3」をそのまま受け付けて `parseMinuteText` でデコードする。

### Player
```ts
type Player = {
  id: string;
  name: string;
  teamId: string;
  position: "GK" | "DF" | "MF" | "FW";
  goals: number;
  assists: number;
  birthDate?: string;  // ISO 8601 (YYYY-MM-DD)
  club?: string;       // 所属クラブ
};
```
