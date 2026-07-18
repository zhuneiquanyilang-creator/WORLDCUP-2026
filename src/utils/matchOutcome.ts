/** 勝敗判定に必要な最小フィールド (Match のサブセット)。 */
type Scored = {
  score?: { home: number; away: number };
  penaltyScore?: { home: number; away: number };
};

/**
 * 90分+延長のスコア (同点なら PK スコア) から勝者サイドを返す。
 * スコアが無い / 同点で PK も無い場合は null (未確定)。
 */
export function winnerSide(m: Scored): "home" | "away" | null {
  if (!m.score) return null;
  const { home, away } = m.score;
  if (home > away) return "home";
  if (home < away) return "away";
  const pk = m.penaltyScore;
  if (!pk) return null;
  if (pk.home > pk.away) return "home";
  if (pk.home < pk.away) return "away";
  return null;
}
