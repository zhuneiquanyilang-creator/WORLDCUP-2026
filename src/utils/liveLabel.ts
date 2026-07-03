/**
 * Football-Data.org の liveLabel (英語) を LiveBadge 用の日本語ラベルに変換する。
 * 未対応のラベルは "LIVE" を返す。
 *
 * 既知の入力例 (services/footballDataSource.ts の statusLabel):
 *   "Halftime" / "1st half" / "2nd half" / "Extra time" /
 *   "Penalty" / "Full time" / "" (空 = 前半以前 or 判別不能)
 */
export function liveBadgeLabel(liveLabel?: string): string {
  // 表示遷移: 前半 → HT → 後半 → HT → 延長前半 → HT → 延長後半 → 延長終了 → PK戦
  // ハーフタイム系の内部ラベルは 3 種 (Halftime / Pre extra time / Extra time break)
  // だが表示は全部 HT に統一。90 分終了・延長 1st 終了・延長 2nd 終了は
  // それぞれ内部で別ラベルを持つことで、次の IN_PLAY で正しく状態遷移できる。
  if (liveLabel === "1st half") return "前半";
  if (liveLabel === "Halftime") return "HT";
  if (liveLabel === "2nd half") return "後半";
  if (liveLabel === "Pre extra time") return "HT";
  if (liveLabel === "Extra time 1st") return "延長前半";
  if (liveLabel === "Extra time break") return "HT";
  if (liveLabel === "Extra time 2nd") return "延長後半";
  if (liveLabel === "End of extra time") return "延長終了";
  if (liveLabel === "Penalty") return "PK戦";
  // 旧ラベル互換
  if (liveLabel === "Extra time") return "延長";
  if (liveLabel === "End of 2nd half") return "HT";
  return "LIVE";
}
