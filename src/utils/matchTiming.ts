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

/** 現在の period 開始からの経過分 (1 から始まる) を計算。 */
function periodElapsedMinutes(periodStartMs: number, now: number): number {
  const sec = Math.floor((now - periodStartMs) / 1000);
  if (sec < 0) return 1;
  return Math.floor(sec / 60) + 1;
}

/** "1st half" → 1, "2nd half" → 2, "Extra time 1st" → 3, "Extra time 2nd" → 4, それ以外 null */
function detectPeriod(label: string): 1 | 2 | 3 | 4 | null {
  const ll = label.toLowerCase();
  const isFirst = ll.includes("1st") || ll.includes("first half");
  const isSecond = ll.includes("2nd") || ll.includes("second half");
  const isExtra = ll.includes("extra") || ll.includes("et");
  if (isExtra && isFirst) return 3;
  if (isExtra && isSecond) return 4;
  if (isFirst) return 1;
  if (isSecond) return 2;
  return null;
}

/**
 * ライブバッジ用の進行ラベルを返す。
 *
 * 優先順位:
 *   1. Sofascore の `liveLabel` が Halftime / Full time / Penalty を示せばそれ
 *   2. `currentPeriodStart` (Sofascore の `time.currentPeriodStartTimestamp`) と
 *      `liveLabel` の period 情報から、アディショナルタイム込みで実際の分を計算
 *      - 1st half: 経過 45 分以内なら `N'`、45 分超なら `45+N'`
 *      - 2nd half: 同様、90 分超なら `90+N'`
 *      - ET 1st: 105 分超なら `105+N'`、ET 2nd: 120 分超なら `120+N'`
 *   3. どちらも欠けていれば KO からの経過分の簡易ロジック (旧動作)
 *
 * これで「45 分ちょうどで HT」と誤って固定表示する問題が解消され、
 * Sofascore が報告するロスタイム延長中も「45+3'」のように現実的に出る。
 */
export function liveMinuteLabel(match: Match, now: number = Date.now()): string {
  if (match.status !== "live") return "";

  const ll = match.liveLabel?.toLowerCase() ?? "";

  // 1) 静止状態
  if (ll.includes("halftime") || ll === "ht") return "HT";
  if (ll === "full time" || ll === "ft" || ll === "finished" || ll === "ended")
    return "FT";
  if (ll.includes("penalty") || ll === "pen" || ll === "pk") return "PK";
  if (ll.includes("awaiting") || ll.includes("extra time halftime"))
    return "HT";

  // 2) period + 開始時刻から実分を計算 (Sofascore の正確なタイマー)
  if (match.currentPeriodStart && match.liveLabel) {
    const period = detectPeriod(match.liveLabel);
    if (period !== null) {
      const inPeriod = periodElapsedMinutes(match.currentPeriodStart, now);
      const regulationCap = [45, 45, 15, 15][period - 1];
      const baseBefore = [0, 45, 90, 105][period - 1];
      if (inPeriod <= regulationCap) {
        return `${baseBefore + inPeriod}'`;
      }
      // アディショナルタイム
      return `${baseBefore + regulationCap}+${inPeriod - regulationCap}'`;
    }
  }

  // 3) フォールバック: KO からの単純経過 (currentPeriodStart が無いとき)
  const elapsed = elapsedMinutes(match, now);
  if (elapsed < 45) return `${Math.max(1, elapsed)}'`;
  if (elapsed < 47) return `45+${elapsed - 45}'`; // 軽くアディショナルを示唆
  if (elapsed < 60) return "HT";
  return `${elapsed - 15}'`;
}
