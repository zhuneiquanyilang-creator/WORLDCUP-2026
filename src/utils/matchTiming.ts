import type { Match } from "@/types/match";

/** 試合がライブ進行中かを判定するための上限 (KOから何分後までライブ扱いするか)。
 *  90分 + ハーフタイム15分 + 延長/ロスタイム余裕30分 ≒ 135分。
 *  ノックアウトステージは延長戦/PK でさらに長引くので 180 分にしておく。
 */
function liveWindowMinutes(match: Match): number {
  return match.stage === "group" ? 135 : 180;
}

/** UTC ミリ秒で KO 時刻を返す */
export function kickoffEpoch(match: Match): number {
  return new Date(match.date).getTime();
}

/** いま (now) がこの試合のライブ枠内かどうか。
 *  status が "finished" のときは false (既に終了)。
 *  status が明示的に "live" のときは KO 前後でも true。
 *  それ以外は KO ≤ now ≤ KO + liveWindow を満たす場合 true。
 */
export function isLive(match: Match, now: number = Date.now()): boolean {
  if (match.status === "finished") return false;
  if (match.status === "live") return true;
  const ko = kickoffEpoch(match);
  return now >= ko && now <= ko + liveWindowMinutes(match) * 60_000;
}

/** 試合開始の何分前から polling を始めるか (フォーメーション・ベンチメンバー取得用)。 */
export const PREMATCH_POLL_MINUTES = 30;

/** Sofascore polling を発火させるべきウィンドウかどうか。
 *  ライブ枠より早めにスタートし、KO-30分 から最終枠 (KO + liveWindow) まで true。
 *  これにより試合開始前にフォーメーション/ラインアップが取得できる。
 *  (SofascoreLiveSource.fetchUpdate は status="notstarted" でもラインアップを返す。
 *   incidents/stats は試合が進行・終了状態になってから取得される。)
 */
export function shouldPoll(
  match: Match,
  now: number = Date.now(),
  prematchMinutes: number = PREMATCH_POLL_MINUTES
): boolean {
  if (match.status === "finished") return false;
  if (match.status === "live") return true;
  const ko = kickoffEpoch(match);
  const prematchStart = ko - prematchMinutes * 60_000;
  const liveEnd = ko + liveWindowMinutes(match) * 60_000;
  return now >= prematchStart && now <= liveEnd;
}

/** いま試合中ではないが、まだ未開催 (KO 前) か */
export function isUpcoming(match: Match, now: number = Date.now()): boolean {
  if (match.status === "finished") return false;
  return now < kickoffEpoch(match);
}

/** KO からの経過分（live 中の表示用） */
export function elapsedMinutes(match: Match, now: number = Date.now()): number {
  const ms = now - kickoffEpoch(match);
  return Math.max(0, Math.floor(ms / 60_000));
}

/**
 * ライブバッジ用の進行ラベルを返す。
 * - 試合が live で無いとき: "" (空)
 * - 外部ソースが Halftime / Full time を示しているとき: "HT" / "FT"
 * - それ以外: KO からの経過分から推定。
 *   - 0-45分: そのまま (1'～45')
 *   - 45-60分: "HT" 扱い (簡易15分ハーフタイム)
 *   - 60分以降: 2nd half として 15分引いて表示 (46'～)
 *
 * 例: 23' / 45' / HT / 67' / 91'
 */
export function liveMinuteLabel(match: Match, now: number = Date.now()): string {
  if (match.status !== "live") return "";

  const ll = match.liveLabel?.toLowerCase();
  if (ll) {
    if (ll.includes("halftime") || ll.includes("half time") || ll === "ht") return "HT";
    if (ll === "full time" || ll === "ft" || ll === "finished") return "FT";
  }

  const elapsed = elapsedMinutes(match, now);
  const FIRST_HALF_END = 45;
  const HALFTIME_END = 60; // KO + 60分 ≒ 2nd half 開始
  if (elapsed <= FIRST_HALF_END) {
    return `${Math.max(1, elapsed)}'`;
  }
  if (elapsed < HALFTIME_END) {
    return "HT";
  }
  return `${elapsed - 15}'`;
}
