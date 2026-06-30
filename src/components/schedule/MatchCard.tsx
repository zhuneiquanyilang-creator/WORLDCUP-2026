import { useNavigate } from "react-router-dom";
import type { KeyboardEvent } from "react";
import type { Match } from "@/types/match";
import type { Team } from "@/types/team";
import { formatTime } from "@/utils/date";
import { stageLabel } from "@/utils/stage";
import { matchNumber } from "@/utils/matchNumber";
import { isLive } from "@/utils/matchTiming";
import { TeamLink } from "@/components/common/TeamLink";
import { LiveBadge } from "@/components/common/LiveBadge";
import { liveBadgeLabel } from "@/utils/liveLabel";
import { BroadcasterList } from "@/components/common/BroadcasterBadge";
import styles from "./MatchCard.module.css";

type Props = {
  match: Match;
  teamMap: Map<string, Team>;
};

export function MatchCard({ match, teamMap }: Props) {
  const home = teamMap.get(match.homeTeamId);
  const away = teamMap.get(match.awayTeamId);
  // スコアが入っていれば status に関係なく表示する。
  // 理由: file (match_results.json) に finished + score が入っていても、
  // 古い live override (localStorage) が status="live" だけ上書きして残っていると、
  // status==="finished" 条件で false になり "VS" 表示に逆戻りしてしまう。
  // 試合詳細ページ (ScoreBoard) は status を見ずに match.score だけで描画するため、
  // ここで status を要求する必要はない。
  const hasScore = !!match.score;
  const live = isLive(match);
  const num = matchNumber(match.id);
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
      <div className={styles.meta}>
        <span className={styles.metaLeft}>
          {num !== null && <span className={styles.number}>#{num}</span>}
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
              <LiveBadge label={liveBadgeLabel(match.liveLabel)} />
            ))}
        </span>
        <span className={styles.time}>{formatTime(match.date)} KO</span>
      </div>

      <div className={styles.body}>
        <div className={`${styles.team} ${styles.home}`}>
          <TeamLink team={home} label={match.homeTeamLabel} fallbackId={match.homeTeamId} />
        </div>

        <div className={styles.score}>
          {hasScore ? (
            <>
              <span className={styles.scoreValue}>
                {match.score!.home} - {match.score!.away}
              </span>
              {match.penaltyScore && (
                <span className={styles.pk}>
                  PK {match.penaltyScore.home}-{match.penaltyScore.away}
                </span>
              )}
            </>
          ) : (
            <span className={styles.vs}>VS</span>
          )}
        </div>

        <div className={`${styles.team} ${styles.away}`}>
          <TeamLink team={away} label={match.awayTeamLabel} fallbackId={match.awayTeamId} />
        </div>
      </div>

      <div className={styles.venue}>{match.venue}</div>

      {match.broadcasters && match.broadcasters.length > 0 && (
        <div className={styles.broadcasters}>
          <BroadcasterList codes={match.broadcasters} />
        </div>
      )}
    </div>
  );
}
