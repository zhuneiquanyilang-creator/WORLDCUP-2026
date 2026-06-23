import { useEffect, useMemo, useState } from "react";
import { usePlayers } from "@/hooks/usePlayers";
import { useMatches } from "@/hooks/useMatches";
import { useTeamMap } from "@/hooks/useTeams";
import { TopScorers } from "@/components/stats/TopScorers";
import { TopAssists } from "@/components/stats/TopAssists";
import { Loading, ErrorMessage } from "@/components/common/AsyncState";
import { computePlayerStats } from "@/utils/computePlayerStats";
import styles from "./StatsPage.module.css";

type StatsTab = "scorers" | "assists";

/** ≤ 640px のスマホ幅かを監視。CombinedFormation.tsx と同様のローカル実装。 */
function useIsNarrow(maxWidth = 640): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    setNarrow(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, [maxWidth]);
  return narrow;
}

export function StatsPage() {
  const playersRes = usePlayers();
  const teamsRes = useTeamMap();
  const matchesRes = useMatches();
  const isNarrow = useIsNarrow();
  const [tab, setTab] = useState<StatsTab>("scorers");

  const playersWithStats = useMemo(() => {
    if (playersRes.status !== "ready" || matchesRes.status !== "ready") return [];
    const stats = computePlayerStats(playersRes.data, matchesRes.data);
    return playersRes.data.map((p) => {
      const s = stats.get(p.id);
      return {
        ...p,
        goals: s?.goals ?? 0,
        assists: s?.assists ?? 0,
      };
    });
  }, [playersRes, matchesRes]);

  if (
    playersRes.status === "loading" ||
    teamsRes.status === "loading" ||
    matchesRes.status === "loading"
  ) {
    return <Loading />;
  }
  if (playersRes.status === "error") return <ErrorMessage message={playersRes.error} />;
  if (teamsRes.status === "error") return <ErrorMessage message={teamsRes.error} />;
  if (matchesRes.status === "error") return <ErrorMessage message={matchesRes.error} />;

  return (
    <div>
      <h1>スタッツ</h1>
      {isNarrow ? (
        <>
          <div className={styles.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "scorers"}
              className={tab === "scorers" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => setTab("scorers")}
            >
              得点
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "assists"}
              className={tab === "assists" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => setTab("assists")}
            >
              アシスト
            </button>
          </div>
          {tab === "scorers" ? (
            <TopScorers players={playersWithStats} teamMap={teamsRes.map} />
          ) : (
            <TopAssists players={playersWithStats} teamMap={teamsRes.map} />
          )}
        </>
      ) : (
        <div className={styles.grid}>
          <TopScorers players={playersWithStats} teamMap={teamsRes.map} />
          <TopAssists players={playersWithStats} teamMap={teamsRes.map} />
        </div>
      )}
    </div>
  );
}
