export type MatchStage =
  | "test"
  | "group"
  | "round32"
  | "round16"
  | "quarter"
  | "semi"
  | "third"
  | "final";

export type MatchStatus = "scheduled" | "live" | "finished";

export type GoalType = "normal" | "penalty" | "own";

export type Goal = {
  minute: number;
  /** アディショナルタイムの追加分 (例: 90+3 なら minute=90, addedTime=3)。
   *  表示・ソートでは `minute` と合わせて扱う。 */
  addedTime?: number;
  teamId: string;
  /** players.json の選手 ID */
  playerId?: string;
  /** 表示名（playerId が無い場合のフォールバック） */
  playerName?: string;
  assistPlayerId?: string;
  assistPlayerName?: string;
  type: GoalType;
};

/** Y=イエロー / Y2R=2枚目イエロー退場 / R=一発レッド / YR=イエロー後の一発レッド */
export type BookingType = "Y" | "Y2R" | "R" | "YR";

export type Booking = {
  minute: number;
  /** アディショナルタイムの追加分 (例: 45+2 なら minute=45, addedTime=2)。 */
  addedTime?: number;
  teamId: string;
  playerName: string;
  type: BookingType;
};

export type Substitution = {
  minute: number;
  /** アディショナルタイムの追加分 (例: 90+1 なら minute=90, addedTime=1)。 */
  addedTime?: number;
  teamId: string;
  inName: string;
  outName: string;
};

/** scored = 成功 (ネットを揺らした) / missed = 失敗 (GK セーブ or 枠外)
 *  "" = 未確定 (キッカー登録済みだが結果未入力 = 進行中の 1 本の仮置き) */
export type PkResult = "" | "scored" | "missed";

/** PK 戦の 1 本分。配列の並び順 = 蹴った順序。 */
export type PkAttempt = {
  teamId: string;
  /** players.json の選手 ID */
  playerId?: string;
  /** 表示名 (playerId が無い場合のフォールバック) */
  playerName?: string;
  result: PkResult;
};

export type FormationSpot = {
  /** ピッチ縦軸 (0-100): 0=自陣GK側, 100=攻撃方向 */
  x: number;
  /** ピッチ横軸 (0-100): 0=左, 100=右 */
  y: number;
  number?: number;
  name: string;
  /** 役割表記 (例: "GK", "CB", "CM") */
  role?: string;
  /** キャプテン。フォーメーション画面で名前の横に (C) を付ける。
   *  starting / bench 含めチーム 1 試合あたり 1 人。 */
  isCaptain?: boolean;
  /** MVP (Man of the Match)。フォーメーション画面で背番号の右上に星 (★) を付ける。
   *  試合 1 人 (両チーム合わせて 1 人) を想定。 */
  isMvp?: boolean;
};

export type FormationData = {
  /** "4-3-3" 等 */
  shape: string;
  starting: FormationSpot[];
  bench?: {
    number?: number;
    name: string;
    isCaptain?: boolean;
    isMvp?: boolean;
  }[];
};

export type MatchStats = {
  /** ボール支配率 (0-100, %) */
  possession?: { home: number; away: number };
  /** ゴール期待値 (xG) */
  xG?: { home: number; away: number };
  /** シュート総数 */
  shots?: { home: number; away: number };
  /** 枠内シュート数 */
  shotsOnTarget?: { home: number; away: number };
};

export type Match = {
  id: string;
  stage: MatchStage;
  groupId?: string;
  date: string;
  venue: string;
  homeTeamId: string;
  awayTeamId: string;
  /** Used when the team has not been determined yet (e.g. knockout stage). */
  homeTeamLabel?: string;
  awayTeamLabel?: string;
  status: MatchStatus;
  /** Sofascore など外部ソース由来の進行ラベル (例: "1st half" / "Halftime" / "Full time") */
  liveLabel?: string;
  score?: { home: number; away: number };
  /** PK決着のスコア (KO戦のみ)。`score` は90分+延長の最終、`penaltyScore` は PK の最終本数。 */
  penaltyScore?: { home: number; away: number };
  /** PK 戦の蹴った順番。FD 無料枠では取得できないため `/edit/matches` で
   *  手入力する。配列の並び順 = ホーム/アウェイ交互の実際の蹴順。 */
  penaltyShootout?: PkAttempt[];
  goals?: Goal[];
  bookings?: Booking[];
  substitutions?: Substitution[];
  homeFormation?: FormationData;
  awayFormation?: FormationData;
  stats?: MatchStats;
  lineup?: { home: string[]; away: string[] };
  /** 日本国内での放送局コード。FIFA 公式 (canadamexicousa2026/scores-fixtures?country=JP) 由来。
   *  値: "nhk-g" | "nhk-bs1" | "nhk-bs4k" | "ntv" | "fuji" */
  broadcasters?: string[];
  /** 試合の特記事項テロップ (例: "中断中")。試合経過のハーフタイム表示直下に
   *  小さな赤バッジで描画される。値があるあいだだけ表示。 */
  note?: string;
  /** true なら FD/live polling の自動更新を抑止し、手動編集値を優先表示する。
   *  `/edit/matches` で設定し、match_results.json と localStorage の両方に伝播する。 */
  manualLock?: boolean;
};
