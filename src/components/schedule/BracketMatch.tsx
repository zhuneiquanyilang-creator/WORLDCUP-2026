import { useNavigate } from "react-router-dom";
import type { KeyboardEvent } from "react";
import type { Match } from "@/types/match";
import type { Team } from "@/types/team";
import { matchNumber } from "@/utils/matchNumber";
import { formatDateJa } from "@/utils/date";
import { TeamLink } from "@/components/common/TeamLink";
import styles from "./BracketMatch.module.css";

type Props = {
  match: Match;
  teamMap: Map<string, Team>;
};

export function BracketMatch({ match, teamMap }: Props) {
  const home = teamMap.get(match.homeTeamId);
  const away = teamMap.get(match.awayTeamId);
  const num = matchNumber(match.id);
  // スコアが入っていれば status に依らず表示する (MatchCard と同じ理由)。
  const score = match.score ?? null;
  const navigate = useNavigate();

  const goToMatch = () => navigate(`/matches/${match.id}`);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      goToMatch();
    }
  };

  return (
    <div
      className={styles.card}
      onClick={goToMatch}
      onKeyDown={onKey}
      role="link"
      tabIndex={0}
    >
      <div className={styles.head}>
        {num !== null && <span className={styles.number}>#{num}</span>}
        <span className={styles.date}>{formatDateJa(match.date)}</span>
      </div>
      <div className={styles.row}>
        <TeamLink
          team={home}
          label={match.homeTeamLabel}
          fallbackId={match.homeTeamId}
          className={styles.team}
        />
        <span className={styles.score}>
          {score ? score.home : ""}
          {match.penaltyScore && (
            <span className={styles.pk}> ({match.penaltyScore.home})</span>
          )}
        </span>
      </div>
      <div className={styles.row}>
        <TeamLink
          team={away}
          label={match.awayTeamLabel}
          fallbackId={match.awayTeamId}
          className={styles.team}
        />
        <span className={styles.score}>
          {score ? score.away : ""}
          {match.penaltyScore && (
            <span className={styles.pk}> ({match.penaltyScore.away})</span>
          )}
        </span>
      </div>
    </div>
  );
}
