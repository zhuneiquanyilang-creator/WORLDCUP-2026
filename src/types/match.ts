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

export type FormationSpot = {
  /** ピッチ縦軸 (0-100): 0=自陣GK側, 100=攻撃方向 */
  x: number;
  /** ピッチ横軸 (0-100): 0=左, 100=右 */
  y: number;
  number?: number;
  name: string;
  /** 役割表記 (例: "GK", "CB", "CM") */
  role?: string;
};

export type FormationData = {
  /** "4-3-3" 等 */
  shape: string;
  starting: FormationSpot[];
  bench?: { number?: number; name: string }[];
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
  /** 現在の period (1st half / 2nd half / ET 等) が始まった瞬間の UTC ms タイムスタンプ。
   *  Sofascore の `event.time.currentPeriodStartTimestamp` * 1000。
   *  アディショナルタイム込みのライブ経過分計算に使う (`liveMinuteLabel`)。 */
  currentPeriodStart?: number;
  score?: { home: number; away: number };
  /** PK決着のスコア (KO戦のみ)。`score` は90分+延長の最終、`penaltyScore` は PK の最終本数。 */
  penaltyScore?: { home: number; away: number };
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
};
