import { useNavigate } from "react-router-dom";
import type { KeyboardEvent } from "react";
import type { Match } from "@/types/match";
import type { Team } from "@/types/team";
import { matchNumber } from "@/utils/matchNumber";
import { formatDateJa } from "@/utils/date";
import { isLive } from "@/utils/matchTiming";
import { TeamLink } from "@/components/common/TeamLink";
import { LiveBadge } from "@/components/common/LiveBadge";
import { liveBadgeLabel } from "@/utils/liveLabel";
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
  const live = isLive(match);
  const navigate = useNavigate();

  // 敗者側を薄く表示するための判定。
  // 条件: status === "finished" **かつ** live 枠外 (二重チェック)。
  // → ライブ中 (KO 〜 KO+135/180 分) は絶対に薄くしない。試合終了後のみ薄化。
  // 90 分同点で PK 決着した場合は penaltyScore の勝者を敗者判定に使う。
  let homeLost = false;
  let awayLost = false;
  if (match.status === "finished" && !live && score) {
    if (score.home > score.away) awayLost = true;
    else if (score.away > score.home) homeLost = true;
    else if (match.penaltyScore) {
      if (match.penaltyScore.home > match.penaltyScore.away) awayLost = true;
      else if (match.penaltyScore.away > match.penaltyScore.home) homeLost = true;
    }
  }

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
        {live &&
          (match.note ? (
            <LiveBadge
              label={match.note}
              variant="suspended"
              className={styles.liveBadge}
            />
          ) : (
            <LiveBadge label={liveBadgeLabel(match.liveLabel)} className={styles.liveBadge} />
          ))}
        <span className={styles.date}>{formatDateJa(match.date)}</span>
      </div>
      <div className={`${styles.row} ${homeLost ? styles.loser : ""}`}>
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
      <div className={`${styles.row} ${awayLost ? styles.loser : ""}`}>
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
