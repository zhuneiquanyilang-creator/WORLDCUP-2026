import type { Match } from "@/types/match";
import type { Team } from "@/types/team";
import { Link } from "react-router-dom";
import { formatDateJa, formatTime } from "@/utils/date";
import { stageLabel } from "@/utils/stage";
import { matchNumber } from "@/utils/matchNumber";
import { isLive } from "@/utils/matchTiming";
import { Flag } from "@/components/common/Flag";
import { LiveBadge } from "@/components/common/LiveBadge";
import styles from "./ScoreBoard.module.css";

type Props = {
  match: Match;
  homeTeam: Team | undefined;
  awayTeam: Team | undefined;
};

export function ScoreBoard({ match, homeTeam, awayTeam }: Props) {
  const score = match.score;
  const num = matchNumber(match.id);
  const live = isLive(match);
  return (
    <div className={styles.board}>
      <div className={styles.meta}>
        {num !== null && <span className={styles.number}>第{num}試合</span>}
        <span
          className={
            match.stage === "test"
              ? `${styles.stage} ${styles.stageTest}`
              : styles.stage
          }
        >
          {stageLabel(match.stage, match.groupId)}
        </span>
        {live &&
          (match.note ? (
            <LiveBadge label={match.note} variant="suspended" />
          ) : (
            <LiveBadge label="LIVE" />
          ))}
        <span>{formatDateJa(match.date)} {formatTime(match.date)} KO</span>
        <span>{match.venue}</span>
      </div>
      <div className={styles.matchup}>
        <div className={styles.side}>
          {homeTeam ? (
            <Link to={`/teams/${homeTeam.id}`} className={styles.teamLink}>
              <Flag isoCode={homeTeam.isoCode} size={56} alt={homeTeam.name} className={styles.flag} />
              <div className={styles.teamName}>{homeTeam.name}</div>
            </Link>
          ) : (
            <div className={styles.teamName}>{match.homeTeamLabel ?? match.homeTeamId}</div>
          )}
        </div>
        <div className={styles.score}>
          {score ? (
            <>
              <div className={styles.scoreLine}>
                {score.home} <span className={styles.dash}>-</span> {score.away}
              </div>
              {match.penaltyScore && (
                <div className={styles.pk}>
                  PK {match.penaltyScore.home}-{match.penaltyScore.away}
                </div>
              )}
            </>
          ) : (
            <span className={styles.vs}>VS</span>
          )}
        </div>
        <div className={styles.side}>
          {awayTeam ? (
            <Link to={`/teams/${awayTeam.id}`} className={styles.teamLink}>
              <Flag isoCode={awayTeam.isoCode} size={56} alt={awayTeam.name} className={styles.flag} />
              <div className={styles.teamName}>{awayTeam.name}</div>
            </Link>
          ) : (
            <div className={styles.teamName}>{match.awayTeamLabel ?? match.awayTeamId}</div>
          )}
        </div>
      </div>
    </div>
  );
}
