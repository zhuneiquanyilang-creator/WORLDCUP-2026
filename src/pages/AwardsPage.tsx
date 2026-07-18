import { useJsonResource } from "@/hooks/useJsonResource";
import { useMatches } from "@/hooks/useMatches";
import { useTeamMap } from "@/hooks/useTeams";
import { Loading, ErrorMessage } from "@/components/common/AsyncState";
import { TeamLink } from "@/components/common/TeamLink";
import type { WorldCupResult, Award } from "@/types/worldCupResult";
import type { Team } from "@/types/team";
import { computeFinalRanking } from "@/utils/finalRanking";
import { dataUrl } from "@/utils/dataUrl";
import styles from "./AwardsPage.module.css";

const BLANK = "—";

function text(v: string | undefined): string {
  return v && v.trim() !== "" ? v : BLANK;
}

function AwardRow({ label, award }: { label: string; award: Award | undefined }) {
  const player = text(award?.player);
  const nat = award?.nationality?.trim();
  return (
    <div className={styles.awardRow}>
      <span className={styles.awardLabel}>{label}</span>
      <span className={styles.awardPlayer}>
        {player}
        {nat && <span className={styles.awardNat}>（{nat}）</span>}
      </span>
    </div>
  );
}

type RankCardProps = {
  rank: 1 | 2 | 3 | 4;
  /** 試合結果から導出したチーム ID (未確定なら undefined) */
  teamId: string | undefined;
  /** awards_2026.json の手入力値 (導出できない場合のフォールバック) */
  fallback: string;
  teams: Map<string, Team>;
};

function RankCard({ rank, teamId, fallback, teams }: RankCardProps) {
  const team = teamId ? teams.get(teamId) : undefined;
  return (
    <div className={`${styles.rankCard} ${styles[`rank${rank}`]}`}>
      <span className={styles.rankLabel}>{rank}位</span>
      {team ? (
        <TeamLink
          team={team}
          fallbackId={team.id}
          className={styles.rankTeam}
          flagSize={22}
        />
      ) : (
        <span className={styles.rankTeam}>{text(fallback)}</span>
      )}
    </div>
  );
}

export function AwardsPage() {
  const awardsRes = useJsonResource<WorldCupResult>(dataUrl("awards_2026.json"));
  const matchesRes = useMatches();
  const teamsRes = useTeamMap();

  if (
    awardsRes.status === "loading" ||
    matchesRes.status === "loading" ||
    teamsRes.status === "loading"
  ) {
    return <Loading />;
  }
  if (awardsRes.status === "error")
    return <ErrorMessage message={awardsRes.error} />;
  if (matchesRes.status === "error")
    return <ErrorMessage message={matchesRes.error} />;
  if (teamsRes.status === "error")
    return <ErrorMessage message={teamsRes.error} />;

  const result = awardsRes.data;
  const ranking = computeFinalRanking(matchesRes.data);
  const decided = ranking.first || ranking.third;

  return (
    <div>
      <header className={styles.head}>
        <h1 className={styles.title}>表彰</h1>
        <p className={styles.sub}>2026 FIFAワールドカップの最終順位と各賞</p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>最終順位</h2>
        <div className={styles.rankGrid}>
          <RankCard rank={1} teamId={ranking.first} fallback={result.first} teams={teamsRes.map} />
          <RankCard rank={2} teamId={ranking.second} fallback={result.second} teams={teamsRes.map} />
          <RankCard rank={3} teamId={ranking.third} fallback={result.third} teams={teamsRes.map} />
          <RankCard rank={4} teamId={ranking.fourth} fallback={result.fourth} teams={teamsRes.map} />
        </div>
        {!decided && (
          <p className={styles.pending}>
            3位決定戦・決勝が終了すると自動で反映されます。
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>個人賞</h2>
        <div className={styles.awardList}>
          <AwardRow label="最優秀選手（MVP・ゴールデンボール）" award={result.goldenBall} />
          <AwardRow label="シルバーボール" award={result.silverBall} />
          <AwardRow label="ブロンズボール" award={result.bronzeBall} />
          <AwardRow label="得点王（ゴールデンブーツ）" award={result.goldenBoot} />
          <AwardRow label="最優秀GK（ゴールデングローブ）" award={result.goldenGlove} />
          <AwardRow label="最優秀若手選手（ベストヤングプレーヤー）" award={result.bestYoungPlayer} />
          <AwardRow label="ベストゴール" award={result.bestGoal} />
        </div>
      </section>
    </div>
  );
}
