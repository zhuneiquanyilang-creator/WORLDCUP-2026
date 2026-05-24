import type {
  Booking,
  FormationData,
  Goal,
  MatchStats,
  MatchStatus,
  Substitution,
} from "./match";

/**
 * 外部ソースから取得する1試合分のライブ更新。
 * 受け取った時点で確認できているフィールドのみ含む。
 * 適用時は既存値に対して部分上書き（マージ）する。
 */
export type LiveUpdate = {
  matchId: string;
  status?: MatchStatus;
  score?: { home: number; away: number };
  /** PK 決着の本数 (KO 戦のみ)。`score` は90分+延長の最終スコア。 */
  penaltyScore?: { home: number; away: number };
  /** 表示用の現在進行情報（例: "45+2'" / "HT" / "FT" / "ライブ"） */
  liveLabel?: string;
  /** 現在の period が始まった瞬間の UTC ms タイムスタンプ (Sofascore 由来)。 */
  currentPeriodStart?: number;
  goals?: Goal[];
  bookings?: Booking[];
  substitutions?: Substitution[];
  homeFormation?: FormationData;
  awayFormation?: FormationData;
  stats?: MatchStats;
  /** ISO 8601 取得時刻（最終更新時刻表示用） */
  fetchedAt?: string;
};
