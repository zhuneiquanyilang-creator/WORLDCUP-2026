import { useEffect, useRef } from "react";
import type { Match } from "@/types/match";
import { PREMATCH_POLL_MINUTES, shouldPoll } from "@/utils/matchTiming";
import { setMatchOverride } from "@/utils/matchOverrides";
import { getLiveSource } from "@/services/liveSource";

const POLL_INTERVAL_MS = 60_000; // 1分

/**
 * 1分毎に「polling 対象の試合」を検出し、最新情報を外部ソースから取得して
 * localStorage にオーバーレイ保存する。
 *
 * - 取得対象: `shouldPoll(match)` が true のもの
 *   → ライブ枠 (KO 〜 KO+135/180分) に加え、**KO 30 分前から**もカバーする。
 *      これによりフォーメーション・ベンチメンバーが試合開始前に取得される
 *      (Sofascore の lineups は試合前に予想スタメンとして公開される)。
 * - 対象が無いときは何もしない
 * - 取得結果が null の場合はスキップ (上書きしない)
 * - 初回 fetch は matches が読み込まれた直後にも発火する (60秒待たない)
 *
 * 想定マウント箇所: `<Layout>` 直下 (アプリ全体で1インスタンス)。
 */
export function useLivePolling(matches: Match[] | undefined) {
  const matchesRef = useRef<Match[] | undefined>(matches);
  matchesRef.current = matches;
  const initialFiredRef = useRef(false);

  const tick = async () => {
    const list = matchesRef.current;
    if (!list || list.length === 0) return;
    const now = Date.now();
    const targets = list.filter((m) => shouldPoll(m, now));
    if (targets.length === 0) return;
    const source = getLiveSource();
    // eslint-disable-next-line no-console
    console.info(
      `[live] polling ${targets.length} match(es) (incl. pre-match -${PREMATCH_POLL_MINUTES}min)`,
      targets.map((m) => m.id)
    );
    for (const m of targets) {
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
