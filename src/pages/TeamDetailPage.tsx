import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTeams } from "@/hooks/useTeams";
import { useTeamDetailMap } from "@/hooks/useTeamDetails";
import { TeamProfile } from "@/components/teams/TeamProfile";
import { TeamHistory } from "@/components/teams/TeamHistory";
import { PlayerRoster } from "@/components/teams/PlayerRoster";
import { Flag } from "@/components/common/Flag";
import { Loading, ErrorMessage } from "@/components/common/AsyncState";
import styles from "./TeamDetailPage.module.css";

type Tab = "detail" | "roster";

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const teamsRes = useTeams();
  const detailsRes = useTeamDetailMap();
  const [tab, setTab] = useState<Tab>("detail");

  if (teamsRes.status === "loading" || detailsRes.status === "loading") {
    return <Loading />;
  }
  if (teamsRes.status === "error") return <ErrorMessage message={teamsRes.error} />;
  if (detailsRes.status === "error") return <ErrorMessage message={detailsRes.error} />;

  const team = teamsRes.data.find((t) => t.id === id);
  if (!team) {
    return (
      <div>
        <Link to="/standings" className={styles.back}>← 順位表へ</Link>
        <ErrorMessage message="該当するチームが見つかりませんでした。" />
      </div>
    );
  }

  const detail = detailsRes.map.get(team.id);

  return (
    <div className={styles.page}>
      <Link to="/standings" className={styles.back}>← 戻る</Link>

      <header className={styles.header}>
        <Flag isoCode={team.isoCode} size={72} alt={team.name} className={styles.flag} />
        <div>
          <h1 className={styles.name}>{team.name}</h1>
          <p className={styles.sub}>
            <span className={styles.nameEn}>{team.nameEn}</span>
            <span className={styles.groupBadge}>グループ {team.groupId}</span>
          </p>
        </div>
      </header>

      <div className={styles.tabs}>
        <button
          type="button"
          onClick={() => setTab("detail")}
          className={tab === "detail" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
        >
          チーム詳細
        </button>
        <button
          type="button"
          onClick={() => setTab("roster")}
          className={tab === "roster" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
        >
          選手一覧
        </button>
      </div>

      {tab === "detail" ? (
        <div className={styles.grid}>
          <TeamProfile detail={detail} />
          {/* 初出場の国 (過去成績データ無し) は「過去の成績」欄を出さない */}
          {detail && detail.pastResults.length > 0 && (
            <TeamHistory results={detail.pastResults} />
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          <PlayerRoster teamId={team.id} />
        </div>
      )}
    </div>
  );
}
