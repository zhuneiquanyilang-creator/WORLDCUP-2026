import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useJsonResource } from "@/hooks/useJsonResource";
import { useMatches } from "@/hooks/useMatches";
import { usePlayers } from "@/hooks/usePlayers";
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

function AwardRow({
  label,
  award,
  playerId,
}: {
  label: string;
  award: Award | undefined;
  /** 選手マスタで特定できた場合の id。あれば選手詳細へのリンクにする。 */
  playerId?: string;
}) {
  const player = text(award?.player);
  const nat = award?.nationality?.trim();
  return (
    <div className={styles.awardRow}>
      <span className={styles.awardLabel}>{label}</span>
      <span className={styles.awardPlayer}>
        {playerId ? (
          <Link to={`/players/${playerId}`} className={styles.awardPlayerLink}>
            {player}
          </Link>
        ) : (
          player
        )}
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

/**
 * `awards_2026.json` の形。過去大会の `WorldCupResult` から、2026 大会では
 * 扱わないシルバーボール / ブロンズボールを除いたもの。
 * (過去大会ページ `PastTournamentDetailPage` は両賞をそのまま表示する)
 */
type Awards2026 = Omit<WorldCupResult, "silverBall" | "bronzeBall">;

export function AwardsPage() {
  const awardsRes = useJsonResource<Awards2026>(dataUrl("awards_2026.json"));
  const matchesRes = useMatches();
  const teamsRes = useTeamMap();
  const playersRes = usePlayers();

  /**
   * 受賞者名 → 選手 id の逆引き。`awards_2026.json` は選手名を手入力で持つので、
   * 選手マスタの `name` と完全一致で突き合わせる。同名選手がいる場合は
   * `nationality` (= teams.json のチーム名) で絞り込み、それでも 1 人に
   * 定まらなければリンクにしない (誤リンクを作らない)。
   */
  const playerIdByName = useMemo(() => {
    const m = new Map<string, string | null>();
    if (playersRes.status !== "ready" || teamsRes.status !== "ready") return m;
    const teamIdByName = new Map(teamsRes.data.map((t) => [t.name, t.id]));
    const byName = new Map<string, typeof playersRes.data>();
    for (const p of playersRes.data) {
      const arr = byName.get(p.name) ?? [];
      arr.push(p);
      byName.set(p.name, arr);
    }
    for (const [name, players] of byName) {
      m.set(name, players.length === 1 ? players[0].id : null);
      if (players.length > 1) {
        // 同名が複数 → 国籍で一意に決まるものだけ "名前|国名" キーで持つ
        for (const [teamName, teamId] of teamIdByName) {
          const hit = players.filter((p) => p.teamId === teamId);
          if (hit.length === 1) m.set(`${name}|${teamName}`, hit[0].id);
        }
      }
    }
    return m;
  }, [playersRes, teamsRes]);

  const awardPlayerId = (award: Award | undefined): string | undefined => {
    const name = award?.player?.trim();
    if (!name) return undefined;
    const nat = award?.nationality?.trim();
    return (
      playerIdByName.get(`${name}|${nat}`) ?? playerIdByName.get(name) ?? undefined
    );
  };

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
          <AwardRow
            label="最優秀選手（MVP・ゴールデンボール）"
            award={result.goldenBall}
            playerId={awardPlayerId(result.goldenBall)}
          />
          <AwardRow
            label="得点王（ゴールデンブーツ）"
            award={result.goldenBoot}
            playerId={awardPlayerId(result.goldenBoot)}
          />
          <AwardRow
            label="最優秀GK（ゴールデングローブ）"
            award={result.goldenGlove}
            playerId={awardPlayerId(result.goldenGlove)}
          />
          <AwardRow
            label="最優秀若手選手（ベストヤングプレーヤー）"
            award={result.bestYoungPlayer}
            playerId={awardPlayerId(result.bestYoungPlayer)}
          />
          <AwardRow
            label="ベストゴール"
            award={result.bestGoal}
            playerId={awardPlayerId(result.bestGoal)}
          />
        </div>
      </section>
    </div>
  );
}
