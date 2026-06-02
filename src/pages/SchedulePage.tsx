import { useEffect, useMemo, useState } from "react";
import { useMatches } from "@/hooks/useMatches";
import { useTeamMap } from "@/hooks/useTeams";
import { ScheduleList } from "@/components/schedule/ScheduleList";
import { StageFilter } from "@/components/schedule/StageFilter";
import { StatusFilter } from "@/components/schedule/StatusFilter";
import { GroupFilter } from "@/components/schedule/GroupFilter";
import { BracketView } from "@/components/schedule/BracketView";
import { Loading, ErrorMessage } from "@/components/common/AsyncState";
import {
  BroadcasterBadge,
  BROADCASTER_LEGEND,
} from "@/components/common/BroadcasterBadge";
import type { MatchStage, MatchStatus } from "@/types/match";
import styles from "./SchedulePage.module.css";

type ViewMode = "list" | "bracket";

export function SchedulePage() {
  const matchesRes = useMatches();
  const teamsRes = useTeamMap();
  const [view, setView] = useState<ViewMode>("list");
  const [stage, setStage] = useState<MatchStage | "all">("all");
  const [status, setStatus] = useState<MatchStatus | "all">("all");
  const [group, setGroup] = useState<string | "all">("all");

  const stages = useMemo<MatchStage[]>(() => {
    if (matchesRes.status !== "ready") return [];
    return Array.from(new Set(matchesRes.data.map((m) => m.stage))) as MatchStage[];
  }, [matchesRes]);

  const groupIds = useMemo<string[]>(() => {
    if (matchesRes.status !== "ready") return [];
    return Array.from(
      new Set(
        matchesRes.data
          .filter((m) => m.stage === "group" && m.groupId)
          .map((m) => m.groupId as string)
      )
    ).sort();
  }, [matchesRes]);

  // ステージが group 以外になったらグループ絞り込みをリセット
  useEffect(() => {
    if (stage !== "group" && group !== "all") {
      setGroup("all");
    }
  }, [stage, group]);

  if (matchesRes.status === "loading" || teamsRes.status === "loading") {
    return <Loading />;
  }
  if (matchesRes.status === "error") return <ErrorMessage message={matchesRes.error} />;
  if (teamsRes.status === "error") return <ErrorMessage message={teamsRes.error} />;

  const filtered = matchesRes.data.filter(
    (m) =>
      (stage === "all" || m.stage === stage) &&
      (status === "all" || m.status === status) &&
      (group === "all" || m.groupId === group)
  );

  return (
    <div>
      <h1>日程・結果</h1>

      <details className={styles.broadcasterLegend}>
        <summary className={styles.broadcasterSummary}>
          放送局バッジの凡例（日本国内）
        </summary>
        <ul className={styles.broadcasterList}>
          {BROADCASTER_LEGEND.map((b) => (
            <li key={b.code} className={styles.broadcasterItem}>
              <BroadcasterBadge code={b.code} />
              <span className={styles.broadcasterName}>{b.name}</span>
              <span className={styles.broadcasterNote}>— {b.note}</span>
            </li>
          ))}
        </ul>
      </details>

      <div className={styles.viewTabs}>
        <button
          type="button"
          onClick={() => setView("list")}
          className={view === "list" ? `${styles.viewTab} ${styles.viewTabActive}` : styles.viewTab}
        >
          一覧
        </button>
        <button
          type="button"
          onClick={() => setView("bracket")}
          className={view === "bracket" ? `${styles.viewTab} ${styles.viewTabActive}` : styles.viewTab}
        >
          トーナメント表
        </button>
      </div>

      {view === "list" && (
        <>
          <div className={styles.filters}>
            <div>
              <div className={styles.filterLabel}>ステージ</div>
              <StageFilter stages={stages} current={stage} onChange={setStage} />
            </div>
            <div>
              <div className={styles.filterLabel}>ステータス</div>
              <StatusFilter current={status} onChange={setStatus} />
            </div>
            {stage === "group" && (
              <div>
                <div className={styles.filterLabel}>グループ</div>
                <GroupFilter groupIds={groupIds} current={group} onChange={setGroup} />
              </div>
            )}
          </div>
          {filtered.length === 0 ? (
            <p className={styles.empty}>該当する試合がありません。</p>
          ) : (
            <ScheduleList matches={filtered} teamMap={teamsRes.map} />
          )}
        </>
      )}

      {view === "bracket" && (
        <BracketView matches={matchesRes.data} teamMap={teamsRes.map} />
      )}
    </div>
  );
}
