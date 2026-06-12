import type { Player } from "@/types/player";
import type { Team } from "@/types/team";
import { PlayerStatRow } from "./PlayerStatRow";
import styles from "./StatsTable.module.css";

type Props = {
  players: Player[];
  teamMap: Map<string, Team>;
  limit?: number;
};

export function TopAssists({ players, teamMap, limit = 10 }: Props) {
  const sorted = [...players]
    .filter((p) => p.assists > 0)
    .sort((a, b) => b.assists - a.assists || b.goals - a.goals)
    .slice(0, limit);

  // 同アシスト数のときは同順位、次の異なる値は飛び順位 (1, 1, 3 形式)。
  let prevAssists = -1;
  let prevRank = 0;
  const ranked = sorted.map((p, i) => {
    const rank = p.assists === prevAssists ? prevRank : i + 1;
    prevAssists = p.assists;
    prevRank = rank;
    return { player: p, rank };
  });

  return (
    <section className={styles.card}>
      <h2 className={styles.heading}>
        <span className={styles.icon}>🎯</span> アシストランキング
      </h2>
      {sorted.length === 0 ? (
        <p className={styles.empty}>まだアシストはありません</p>
      ) : (
      <table className={styles.table}>
        <thead>
          <tr>
            <th>順位</th>
            <th>選手</th>
            <th>所属</th>
            <th className={styles.right}>アシスト</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map(({ player: p, rank }) => (
            <PlayerStatRow
              key={p.id}
              rank={rank}
              player={p}
              team={teamMap.get(p.teamId)}
              value={p.assists}
              metric="A"
            />
          ))}
        </tbody>
      </table>
      )}
    </section>
  );
}
