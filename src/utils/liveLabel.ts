/**
 * Football-Data.org の liveLabel (英語) を LiveBadge 用の日本語ラベルに変換する。
 * 未対応のラベルは "LIVE" を返す。
 *
 * 既知の入力例 (services/footballDataSource.ts の statusLabel):
 *   "Halftime" / "1st half" / "2nd half" / "Extra time 1st" /
 *   "Extra time 2nd" / "Penalty" / "Live" / "Full time" / "Scheduled"
 */
export function liveBadgeLabel(liveLabel?: string): string {
  if (liveLabel === "Halftime") return "HT";
  return "LIVE";
}
