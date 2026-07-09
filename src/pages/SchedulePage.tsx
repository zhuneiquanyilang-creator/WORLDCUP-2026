import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useMatches } from "@/hooks/useMatches";
import { useTeamMap } from "@/hooks/useTeams";
import { ScheduleList } from "@/components/schedule/ScheduleList";
import { StageFilter } from "@/components/schedule/StageFilter";
import { StatusFilter } from "@/components/schedule/StatusFilter";
import { GroupFilter } from "@/components/schedule/GroupFilter";
import { DateFilter } from "@/components/schedule/DateFilter";
import { Loading, ErrorMessage } from "@/components/common/AsyncState";
import {
  BroadcasterBadge,
  BROADCASTER_LEGEND,
} from "@/components/common/BroadcasterBadge";
import type { MatchStage, MatchStatus } from "@/types/match";
import { dayKey } from "@/utils/date";
import styles from "./SchedulePage.module.css";

export function SchedulePage() {
  const matchesRes = useMatches();
  const teamsRes = useTeamMap();
  // 絞り込み状態を URL クエリに保存。チーム詳細・試合詳細などへ遷移 → 戻る で復帰。
  // 「試合日」のみ初回マウント時に「今日」をクエリ未指定なら使う特別扱い。
  const [params, setParams] = useSearchParams();
  const stage = (params.get("stage") as MatchStage | "all") ?? "all";
  const status = (params.get("status") as MatchStatus | "all") ?? "all";
  const group = params.get("group") ?? "all";
  const day = params.get("day") ?? dayKey(new Date().toISOString());

  const updateParam = (key: string, value: string, defaultValue: string) => {
    const next = new URLSearchParams(params);
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const setStage = (s: MatchStage | "all") => updateParam("stage", s, "all");
  const setStatus = (s: MatchStatus | "all") => updateParam("status", s, "all");
  const setGroup = (g: string | "all") => updateParam("group", g, "all");
  const setDay = (d: string | "all") => {
    const next = new URLSearchParams(params);
    next.set("day", d);
    setParams(next, { replace: true });
  };
  const dayInitRef = useRef(false);

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

  const allDates = useMemo<string[]>(() => {
    if (matchesRes.status !== "ready") return [];
    return matchesRes.data.map((m) => m.date);
  }, [matchesRes]);

  // ステージが group 以外になったらグループ絞り込みをリセット
  useEffect(() => {
    if (stage !== "group" && group !== "all") {
      setGroup("all");
    }
  }, [stage, group]);

  // 現在の day (URL クエリ or default=今日) に該当試合が無ければ、直近で
  // 終了した試合があった日 (= 今日以前で status="finished" の試合を持つ最大日) に
  // 落とす。それも無ければ (大会前など) "all" にフォールバック。
  // rest day (試合と試合の間の休息日) に空欄で何も見えない事故を防ぎつつ、
  // 直近試合日の結果一覧が自然に開く挙動にする。
  // day === "all" のときはユーザが明示的に全試合表示を選んでいるので触らない。
  useEffect(() => {
    if (dayInitRef.current) return;
    if (matchesRes.status !== "ready") return;
    dayInitRef.current = true;
    if (day === "all") return;
    const hasMatchOnDay = matchesRes.data.some((m) => dayKey(m.date) === day);
    if (hasMatchOnDay) return;
    const today = dayKey(new Date().toISOString());
    const latestFinishedDay = matchesRes.data
      .filter((m) => m.status === "finished")
      .map((m) => dayKey(m.date))
      .filter((d) => d <= today)
      .sort()
      .pop();
    setDay(latestFinishedDay ?? "all");
  }, [matchesRes]);

  if (matchesRes.status === "loading" || teamsRes.status === "loading") {
    return <Loading />;
  }
  if (matchesRes.status === "error") return <ErrorMessage message={matchesRes.error} />;
  if (teamsRes.status === "error") return <ErrorMessage message={teamsRes.error} />;

  const filtered = matchesRes.data.filter(
    (m) =>
      (stage === "all" || m.stage === stage) &&
      (status === "all" || m.status === status) &&
      (group === "all" || m.groupId === group) &&
      (day === "all" || dayKey(m.date) === day)
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

      <div className={styles.filters}>
        <div>
          <div className={styles.filterLabel}>ステージ</div>
          <StageFilter stages={stages} current={stage} onChange={setStage} />
        </div>
        <div>
          <div className={styles.filterLabel}>ステータス</div>
          <StatusFilter current={status} onChange={setStatus} />
        </div>
        <div>
          <div className={styles.filterLabel}>試合日</div>
          <DateFilter dates={allDates} current={day} onChange={setDay} />
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
    </div>
  );
}
