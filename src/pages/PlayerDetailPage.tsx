import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { usePlayers } from "@/hooks/usePlayers";
import { useMatches } from "@/hooks/useMatches";
import { useTeamMap } from "@/hooks/useTeams";
import { Flag } from "@/components/common/Flag";
import { Loading, ErrorMessage } from "@/components/common/AsyncState";
import { calculateAge } from "@/utils/age";
import {
  computePlayerMatches,
  summarizePlayerMatches,
  type PlayerAppearanceStatus,
} from "@/utils/computePlayerMatches";
import { formatDateJa } from "@/utils/date";
import { stageLabel } from "@/utils/stage";
import type { BookingType } from "@/types/match";
import styles from "./PlayerDetailPage.module.css";

const POSITION_LABEL: Record<string, string> = {
  GK: "ゴールキーパー",
  DF: "ディフェンダー",
  MF: "ミッドフィルダー",
  FW: "フォワード",
};

const STATUS_LABEL: Record<PlayerAppearanceStatus, string> = {
  starter: "先発",
  "sub-on": "途中出場",
  bench: "ベンチ",
  "not-selected": "メンバー外",
  unknown: "—",
};

const BOOKING_LABEL: Record<BookingType, string> = {
  Y: "🟨",
  Y2R: "🟨🟥",
  R: "🟥",
  YR: "🟨🟥",
};

function formatBirthDate(iso: string | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[1]}年${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`;
}

// 「アル・カディシーヤ（サウジアラビア）」のようにクラブ名と国名の 2 パーツで
// 構成される所属クラブ文字列を、国名部分だけ折り返せるように分割して描画する。
// パーツ内 (クラブ名 / 国名) は改行禁止、間の <wbr> で改行許可。
function renderClub(club: string | undefined) {
  if (!club) return "—";
  const m = /^(.+?)\s*[（(](.+?)[）)]\s*$/.exec(club);
  if (!m) return club;
  const [, name, country] = m;
  return (
    <>
      <span className={styles.clubName}>{name}</span>
      <wbr />
      <span className={styles.clubCountry}>（{country}）</span>
    </>
  );
}

export function PlayerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const playersRes = usePlayers();
  const matchesRes = useMatches();
  const teamsRes = useTeamMap();

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  const player = useMemo(() => {
    if (playersRes.status !== "ready") return null;
    return playersRes.data.find((p) => p.id === id) ?? null;
  }, [playersRes, id]);

  const appearances = useMemo(() => {
    if (!player || matchesRes.status !== "ready") return [];
    return computePlayerMatches(player, matchesRes.data);
  }, [player, matchesRes]);

  const summary = useMemo(() => summarizePlayerMatches(appearances), [appearances]);

  if (
    playersRes.status === "loading" ||
    matchesRes.status === "loading" ||
    teamsRes.status === "loading"
  ) {
    return <Loading />;
  }
  if (playersRes.status === "error") return <ErrorMessage message={playersRes.error} />;
  if (matchesRes.status === "error") return <ErrorMessage message={matchesRes.error} />;
  if (teamsRes.status === "error") return <ErrorMessage message={teamsRes.error} />;

  if (!player) {
    return (
      <div className={styles.page}>
        <button type="button" onClick={goBack} className={styles.back}>← 戻る</button>
        <ErrorMessage message="該当する選手が見つかりませんでした。" />
      </div>
    );
  }

  const team = teamsRes.map.get(player.teamId);
  const age = calculateAge(player.birthDate);

  return (
    <div className={styles.page}>
      <button type="button" onClick={goBack} className={styles.back}>← 戻る</button>

      <header className={styles.header}>
        {team && (
          <Flag
            isoCode={team.isoCode}
            size={56}
            alt={team.name}
            className={styles.flag}
          />
        )}
        <div className={styles.headerText}>
          <h1 className={styles.name}>
            {player.number != null && (
              <span className={styles.number}>#{player.number}</span>
            )}
            {player.name}
          </h1>
          <div className={styles.subRow}>
            <span className={styles.posBadge}>{player.position}</span>
            <span>{POSITION_LABEL[player.position] ?? player.position}</span>
            {team && (
              <Link to={`/teams/${team.id}`} className={styles.teamLink}>
                {team.name}
              </Link>
            )}
            {age !== null && <span>{age} 歳</span>}
          </div>
        </div>
      </header>

      <section className={styles.profileCard}>
        <dl className={styles.profileGrid}>
          <div>
            <dt>所属クラブ</dt>
            <dd>{renderClub(player.club)}</dd>
          </div>
          <div>
            <dt>生年月日</dt>
            <dd>{formatBirthDate(player.birthDate)}</dd>
          </div>
          <div>
            <dt>ポジション</dt>
            <dd>{POSITION_LABEL[player.position] ?? player.position}</dd>
          </div>
          <div>
            <dt>背番号</dt>
            <dd>{player.number != null ? `#${player.number}` : "—"}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.summaryCard}>
        <h2 className={styles.heading}>大会成績</h2>
        <div className={styles.statRow}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{summary.matchesPlayed}</span>
            <span className={styles.statLabel}>出場</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{summary.totalMinutes}</span>
            <span className={styles.statLabel}>出場時間 (分)</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValueGold}>{summary.goals}</span>
            <span className={styles.statLabel}>⚽ ゴール</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValueGold}>{summary.assists}</span>
            <span className={styles.statLabel}>🅰 アシスト</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{summary.yellows}</span>
            <span className={styles.statLabel}>🟨</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{summary.reds}</span>
            <span className={styles.statLabel}>🟥</span>
          </div>
        </div>
      </section>

      <section className={styles.tableCard}>
        <h2 className={styles.heading}>試合別の出場記録</h2>
        {appearances.length === 0 ? (
          <p className={styles.empty}>このチームの試合データがまだありません。</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>日付</th>
                  <th>ステージ</th>
                  <th>対戦</th>
                  <th>結果</th>
                  <th>出場</th>
                  <th title="出場時間 (分)">時間</th>
                  <th title="ゴール">G</th>
                  <th title="アシスト">A</th>
                  <th title="カード">⚠</th>
                </tr>
              </thead>
              <tbody>
                {appearances.map((a) => {
                  const opp = teamsRes.map.get(a.opponentId);
                  const oppName = opp?.name ?? a.opponentLabel ?? a.opponentId;
                  const myScore = a.isHome ? a.homeScore : a.awayScore;
                  const oppScore = a.isHome ? a.awayScore : a.homeScore;
                  const myPk = a.penaltyScore
                    ? a.isHome
                      ? a.penaltyScore.home
                      : a.penaltyScore.away
                    : null;
                  const oppPk = a.penaltyScore
                    ? a.isHome
                      ? a.penaltyScore.away
                      : a.penaltyScore.home
                    : null;
                  const scoreText =
                    myScore !== null && oppScore !== null
                      ? `${myScore}-${oppScore}${a.penaltyScore ? ` (PK ${myPk}-${oppPk})` : ""}`
                      : a.matchStatus === "live"
                        ? "ライブ中"
                        : "—";
                  const resultClass =
                    a.result === "win"
                      ? styles.resultWin
                      : a.result === "loss"
                        ? styles.resultLoss
                        : a.result === "draw"
                          ? styles.resultDraw
                          : "";
                  const resultText =
                    a.result === "win"
                      ? "勝"
                      : a.result === "loss"
                        ? "負"
                        : a.result === "draw"
                          ? "分"
                          : "—";
                  // 出場ラベル: スタメン/途中出場/ベンチ等 + 交代分があれば併記
                  let apDisplay: string;
                  if (a.status === "starter") {
                    apDisplay =
                      a.endMinute != null && a.endMinute < 90
                        ? `先発→${a.endMinute}'`
                        : "先発";
                  } else if (a.status === "sub-on") {
                    apDisplay =
                      a.endMinute != null && a.endMinute < 90
                        ? `${a.startMinute}'→${a.endMinute}'`
                        : `${a.startMinute}'〜`;
                  } else {
                    apDisplay = STATUS_LABEL[a.status];
                  }
                  return (
                    <tr key={a.matchId}>
                      <td className={styles.numCell}>
                        <Link to={`/matches/${a.matchId}`} className={styles.matchLink}>
                          {a.matchNumber !== null ? `#${a.matchNumber}` : a.matchId}
                        </Link>
                      </td>
                      <td>{formatDateJa(a.date)}</td>
                      <td className={styles.stageCell}>
                        {stageLabel(a.stage)}
                      </td>
                      <td className={styles.oppCell}>
                        {"vs "}
                        {opp ? (
                          <Link to={`/teams/${opp.id}`} className={styles.teamLink}>
                            <Flag
                              isoCode={opp.isoCode}
                              size={16}
                              alt={oppName}
                              className={styles.oppFlag}
                            />
                            {oppName}
                          </Link>
                        ) : (
                          oppName
                        )}
                      </td>
                      <td className={resultClass}>
                        <span className={styles.resultBadge}>{resultText}</span>
                        {" "}
                        <span className={styles.scoreText}>{scoreText}</span>
                      </td>
                      <td>{apDisplay}</td>
                      <td className={styles.numCell}>
                        {a.minutes > 0 ? a.minutes : "—"}
                      </td>
                      <td className={a.goals > 0 ? styles.statG : styles.statZero}>
                        {a.goals > 0
                          ? Array.from({ length: a.goals }, (_, i) => (
                              <span key={i} className={styles.goalIcon}>
                                ⚽
                              </span>
                            ))
                          : "—"}
                      </td>
                      <td className={a.assists > 0 ? styles.statG : styles.statZero}>
                        {a.assists > 0
                          ? Array.from({ length: a.assists }, (_, i) => (
                              <span key={i} className={styles.assistIcon}>
                                Ⓐ
                              </span>
                            ))
                          : "—"}
                      </td>
                      <td className={styles.cardsCell}>
                        {a.bookings.length === 0 && a.ownGoals === 0
                          ? "—"
                          : (
                              <>
                                {a.bookings.map((b, i) => (
                                  <span key={`b${i}`} className={styles.cardItem}>
                                    {BOOKING_LABEL[b.type]}
                                    <span className={styles.cardMinute}>
                                      {b.minute}
                                      {b.addedTime ? `+${b.addedTime}` : ""}'
                                    </span>
                                  </span>
                                ))}
                                {Array.from({ length: a.ownGoals }, (_, i) => (
                                  <span
                                    key={`og${i}`}
                                    className={styles.ownGoalBadge}
                                    title="オウンゴール"
                                    aria-label="オウンゴール"
                                  >
                                    ⚽
                                  </span>
                                ))}
                              </>
                            )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.note}>
          ※ 出場時間は「先発/交代の時刻」から推定 (アディショナルタイム・退場による中断は概算)。
          フォーメーション・交代データが未入力の試合は「—」で表記。
        </p>
      </section>
    </div>
  );
}
