import { Link } from "react-router-dom";
import type { Player } from "@/types/player";
import type { Team } from "@/types/team";
import { Flag } from "@/components/common/Flag";
import { shortCode } from "@/utils/countryCode";
import styles from "./PlayerStatRow.module.css";

type Props = {
  rank: number;
  player: Player;
  team: Team | undefined;
  value: number;
  metric: string;
};

export function PlayerStatRow({ rank, player, team, value, metric }: Props) {
  return (
    <tr>
      <td className={styles.rank}>{rank}</td>
      <td className={styles.player}>
        <Link to={`/players/${player.id}`} className={styles.name}>
          {player.name}
        </Link>
        <span className={styles.position}>{player.position}</span>
      </td>
      <td className={styles.team}>
        {team ? (
          <span className={styles.teamCode}>
            <Flag isoCode={team.isoCode} size={14} alt={team.name} />
            <span>{shortCode(team)}</span>
          </span>
        ) : (
          <span>{player.teamId.slice(0, 2)}</span>
        )}
      </td>
      <td className={styles.value}>
        {value}
        <span className={styles.metric}>{metric}</span>
      </td>
    </tr>
  );
}
