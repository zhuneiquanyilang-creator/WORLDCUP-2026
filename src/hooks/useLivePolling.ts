import { useEffect, useRef } from "react";
import type { Match } from "@/types/match";
import { PREMATCH_POLL_MINUTES, shouldPoll } from "@/utils/matchTiming";
import { setMatchOverride } from "@/utils/matchOverrides";
import { getLiveSource } from "@/services/liveSource";

// ポーリング間隔。短すぎると Football-Data の無料枠 (10 req/分) を超えるが、
// 30 秒ならライブ中 5 試合まで余裕で収まる。試合分数の表示遅延を最小化する目的で短縮。
const POLL_INTERVAL_MS = 30_000;

// FD の Free Tier は 10 req/分。tick 内で過去未 finished のキャッチアップ
// (= サイト起動直後の一括取得) を含めるため、7 秒スロットルで順次発火する。
// 7s × 8 req = 56s なので 1 分あたり 8〜9 req に収まり、cushion を持って枠内。
const FETCH_THROTTLE_MS = 7_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 「polling 対象の試合」を検出して FD から取得し、`matchOverrides`
 * (localStorage) に上書き保存する。
 *
 * - 取得対象: `shouldPoll(match)` が true のもの
 *   → ライブ枠 (KO-30min 〜 KO+135/180min) **に加えて**、KO+上限 を過ぎても
 *      status≠finished のもの (= ライブ中に取り逃した試合) も含む
 *      (`shouldPoll` を「上限なし」に変更済み)。これにより
 *      **サイトを開いた瞬間に過去の未 finished 試合を順に拾って結果反映**する。
 * - 取得は **7 秒スロットル** で順次。tick の最中に次の interval が来ても
 *   `tickRunningRef` で重複実行を防止 (長い catchup 中に多重発火させない)。
 * - matchOverrides の自動 TTL 掃除は撤廃済み。ライブ取得結果は明示的に
 *   クリアされない限り localStorage に残り続ける。
 * - 初回 fetch は matches が読み込まれた直後に発火する (interval 待たない)。
 *
 * 想定マウント箇所: `<Layout>` 直下 (アプリ全体で1インスタンス)。
 */
export function useLivePolling(matches: Match[] | undefined) {
  const matchesRef = useRef<Match[] | undefined>(matches);
  matchesRef.current = matches;
  const initialFiredRef = useRef(false);
  const tickRunningRef = useRef(false);

  const tick = async () => {
    if (tickRunningRef.current) return; // 多重発火防止
    const list = matchesRef.current;
    if (!list || list.length === 0) return;
    const now = Date.now();

    // manualLock=true の試合は手動値を保護するため polling 自体をスキップ。
    // (useMatches 側でも live レイヤーをスキップするが、ここで弾けば API 呼び出し節約。)
    const targets = list.filter((m) => shouldPoll(m, now) && !m.manualLock);
    if (targets.length === 0) return;

    tickRunningRef.current = true;
    try {
      const source = getLiveSource();
      // eslint-disable-next-line no-console
      console.info(
        `[live] polling ${targets.length} match(es) (incl. pre-match -${PREMATCH_POLL_MINUTES}min & past unfinished catchup)`,
        targets.map((m) => m.id)
      );
      for (let i = 0; i < targets.length; i++) {
        const m = targets[i];
        if (i > 0) await sleep(FETCH_THROTTLE_MS); // FD 10 req/分 を尊重
        try {
          const update = await source.fetchUpdate(m);
          if (update) {
            setMatchOverride(m.id, {
              ...update,
              matchId: m.id,
              fetchedAt: new Date().toISOString(),
            });
            // eslint-disable-next-line no-console
            console.info(`[live] ${m.id} updated:`, {
              status: update.status,
              score: update.score,
              goals: update.goals?.length,
              bookings: update.bookings?.length,
              subs: update.substitutions?.length,
              hasFormation: Boolean(update.homeFormation || update.awayFormation),
              hasStats: Boolean(update.stats),
            });
          } else {
            // eslint-disable-next-line no-console
            console.info(`[live] ${m.id} update was null (not in mapping or fetch failed)`);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[live] failed to fetch update for ${m.id}:`, err);
        }
      }
    } finally {
      tickRunningRef.current = false;
    }
  };

  // matches が初めて利用可能になった瞬間に即時 fetch
  useEffect(() => {
    if (initialFiredRef.current) return;
    if (!matches || matches.length === 0) return;
    initialFiredRef.current = true;
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  // 1分毎の定期ポーリング (アンマウント時にクリーンアップ)
  useEffect(() => {
    const id = window.setInterval(() => {
      tick();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
