/**
 * Football-Data.org の liveLabel (英語) を LiveBadge 用の日本語ラベルに変換する。
 * 未対応のラベルは "LIVE" を返す。
 *
 * 既知の入力例 (services/footballDataSource.ts の statusLabel):
 *   "Halftime" / "1st half" / "2nd half" / "Extra time" /
 *   "Penalty" / "Full time" / "" (空 = 前半以前 or 判別不能)
 */
export function liveBadgeLabel(liveLabel?: string): string {
  if (liveLabel === "Halftime") return "HT";
  if (liveLabel === "1st half") return "前半";
  if (liveLabel === "2nd half") return "後半";
  if (liveLabel === "Extra time") return "延長";
  if (liveLabel === "Penalty") return "PK";
  return "LIVE";
}
