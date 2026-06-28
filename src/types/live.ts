import type {
  Booking,
  FormationData,
  Goal,
  MatchStats,
  MatchStatus,
  PkAttempt,
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
  /** PK 戦の蹴った順番。`/edit/matches` の PkShootoutEditor で手入力。
   *  Football-Data / Sofascore の無料枠では取得できないため自動更新の
   *  対象外 (= GitHub Actions の sync-results-ci がこのフィールドを触らない)。 */
  penaltyShootout?: PkAttempt[];
  /** 表示用の現在進行情報（例: "45+2'" / "HT" / "FT" / "ライブ"） */
  liveLabel?: string;
  goals?: Goal[];
  bookings?: Booking[];
  substitutions?: Substitution[];
  homeFormation?: FormationData;
  awayFormation?: FormationData;
  stats?: MatchStats;
  /** 試合の特記事項テロップ (例: "中断中")。 */
  note?: string;
  /** ISO 8601 取得時刻（最終更新時刻表示用） */
  fetchedAt?: string;
  /**
   * 手動ロックフラグ。`true` のとき periodic-catchup / GitHub Actions の
   * `sync-results-ci.mjs` はこの試合の status / score / penaltyScore を
   * 自動更新しない (Football-Data の値で上書きしない)。
   * 公式発表と外部 API が食い違ったケース等で手動値を保護する。
   * `/edit/matches` で status / score / PK のいずれかが入っているエントリを
   * 保存すると自動的に true がセットされる。
   */
  manualLock?: boolean;
};
