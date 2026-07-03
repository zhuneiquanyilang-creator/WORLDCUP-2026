import type { Player } from "@/types/player";
import type { Team } from "@/types/team";
import { PlayerStatRow } from "./PlayerStatRow";
import styles from "./StatsTable.module.css";

type Props = {
  players: Player[];
  teamMap: Map<string, Team>;
  /** 表示上限。未指定なら得点 > 0 の選手は全員表示。 */
  limit?: number;
};

export function TopScorers({ players, teamMap, limit }: Props) {
  const filtered = [...players]
    .filter((p) => p.goals > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists);
  const sorted = limit ? filtered.slice(0, limit) : filtered;

  // 同得点 (同値) のときは同順位、次の異なる値は飛び順位 (1, 1, 3 形式)。
  // 表示順は assists の降順で保たれるので、順位だけ揃える。
  let prevGoals = -1;
  let prevRank = 0;
  const ranked = sorted.map((p, i) => {
    const rank = p.goals === prevGoals ? prevRank : i + 1;
    prevGoals = p.goals;
    prevRank = rank;
    return { player: p, rank };
  });

  return (
    <section className={styles.card}>
      <h2 className={styles.heading}>
        <span className={styles.icon}>⚽</span> 得点ランキング
      </h2>
      <p className={styles.note}>※ 括弧内は PK による得点数</p>
      {sorted.length === 0 ? (
        <p className={styles.empty}>まだ得点はありません</p>
      ) : (
      <table className={styles.table}>
        <thead>
          <tr>
            <th>順位</th>
            <th>選手</th>
            <th>所属</th>
            <th className={styles.right}>得点</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map(({ player: p, rank }) => (
            <PlayerStatRow
              key={p.id}
              rank={rank}
              player={p}
              team={teamMap.get(p.teamId)}
              value={p.goals}
              metric="G"
              subValue={p.penaltyGoals}
            />
          ))}
        </tbody>
      </table>
      )}
    </section>
  );
}
