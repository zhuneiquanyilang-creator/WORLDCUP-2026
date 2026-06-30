/**
 * チーム詳細ページの「試合結果」タブ。
 * 対象チームの試合（グループステージ＋進出が確定したノックアウト戦）を時系列順に表示。
 *
 * ノックアウト戦は `useMatches` 内の `resolveMatchTeams` がプレースホルダ ID
 * (`W73` / `GA1` / `G3_ABCDF` 等) を確定済の実チーム ID に差し替えるので、
 * homeTeamId / awayTeamId が teamId と一致する = そのチームが進出済 = 表示対象。
 * 進出未確定の KO 試合は自然にフィルタアウトされる。
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useMatches } from "@/hooks/useMatches";
import { useTeams } from "@/hooks/useTeams";
import { Flag } from "@/components/common/Flag";
import { Loading, ErrorMessage } from "@/components/common/AsyncState";
import { formatDateJa } from "@/utils/date";
import type { Match, MatchStage } from "@/types/match";
import type { Team } from "@/types/team";
import styles from "./TeamResults.module.css";

type Props = { teamId: string };

/** ステージ表示。グループは「第N節」、KO はステージ名 */
const KO_STAGE_LABEL: Partial<Record<MatchStage, string>> = {
  round32: "R32",
  round16: "R16",
  quarter: "準々決勝",
  semi: "準決勝",
  third: "3位決定戦",
  final: "決勝",
};

function pickTeamMatches(matches: Match[], teamId: string): Match[] {
  return matches
    .filter(
      (m) =>
        m.stage !== "test" &&
        (m.homeTeamId === teamId || m.awayTeamId === teamId)
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** その試合の対戦カードラベル (グループは「第N節」、KOはステージ名)。
 *  groupMatchdayIndex はグループ試合のみ意味を持つ。 */
function roundLabel(m: Match, groupMatchdayIndex: number): string {
  if (m.stage === "group") return `第${groupMatchdayIndex}節`;
  return KO_STAGE_LABEL[m.stage] ?? m.stage;
}

/** 1試合 1 行。スコアは status="finished" になった試合のみ表示。 */
type RowProps = {
  match: Match;
  teamId: string;
  label: string;
  teamMap: Map<string, Team> | null;
};

function ResultRow({ match: m, teamId, label, teamMap }: RowProps) {
  const isHome = m.homeTeamId === teamId;
  const oppId = isHome ? m.awayTeamId : m.homeTeamId;
  const opponent = teamMap?.get(oppId);

  // 確定スコアのみ表示。ライブ中・未消化は空欄。
  const showScore = m.status === "finished" && m.score;
  const own = showScore ? (isHome ? m.score!.home : m.score!.away) : null;
  const opp = showScore ? (isHome ? m.score!.away : m.score!.home) : null;

  // PK 決着の補足: 90分+延長同点でも PK で勝敗が付いた場合 (KOのみ)
  const showPk =
    !!showScore &&
    !!m.penaltyScore &&
    m.stage !== "group" &&
    own === opp;
  const ownPk = showPk
    ? isHome
      ? m.penaltyScore!.home
      : m.penaltyScore!.away
    : null;
  const oppPk = showPk
    ? isHome
      ? m.penaltyScore!.away
      : m.penaltyScore!.home
    : null;

  // 勝敗判定 (PK 決着なら PK スコアで判定、それ以外は90分+延長のスコアで判定)
  let result: "win" | "loss" | "draw" | null = null;
  if (showScore) {
    if (own! > opp!) result = "win";
    else if (own! < opp!) result = "loss";
    else if (showPk) result = ownPk! > oppPk! ? "win" : "loss";
    else result = "draw";
  }
  const resultLabel =
    result === "win" ? "勝" : result === "loss" ? "負" : result === "draw" ? "分" : "—";
  const resultClass =
    result === "win"
      ? styles.resultWin
      : result === "loss"
        ? styles.resultLoss
        : result === "draw"
          ? styles.resultDraw
          : styles.empty;

  return (
    <tr key={m.id}>
      <td className={styles.md}>
        <Link to={`/matches/${m.id}`} className={styles.mdLink}>
          {label}
        </Link>
      </td>
      <td className={styles.date}>{formatDateJa(m.date)}</td>
      <td className={styles.opp}>
        {opponent ? (
          <Link to={`/teams/${opponent.id}`} className={styles.oppLink}>
            <Flag isoCode={opponent.isoCode} size={20} alt={opponent.name} />
            <span>{opponent.name}</span>
          </Link>
        ) : (
          <span>{oppId}</span>
        )}
      </td>
      <td className={styles.resultCell}>
        <span className={resultClass}>{resultLabel}</span>
      </td>
      <td className={styles.score}>
        {showScore ? (
          <Link to={`/matches/${m.id}`} className={styles.scoreLink}>
            {own} - {opp}
            {showPk && (
              <span className={styles.pk}>
                {" "}
                (PK {ownPk}-{oppPk})
              </span>
            )}
          </Link>
        ) : (
          <span className={styles.empty}>—</span>
        )}
      </td>
    </tr>
  );
}

export function TeamResults({ teamId }: Props) {
  const matchesRes = useMatches();
  const teamsRes = useTeams();

  const teamMap = useMemo(() => {
    if (teamsRes.status !== "ready") return null;
    return new Map<string, Team>(teamsRes.data.map((t) => [t.id, t]));
  }, [teamsRes]);

  const matches = useMemo(() => {
    if (matchesRes.status !== "ready") return null;
    return pickTeamMatches(matchesRes.data, teamId);
  }, [matchesRes, teamId]);

  if (matchesRes.status === "loading" || teamsRes.status === "loading") {
    return (
      <section className={styles.card}>
        <h2 className={styles.heading}>試合結果</h2>
        <Loading />
      </section>
    );
  }
  if (matchesRes.status === "error") {
    return (
      <section className={styles.card}>
        <h2 className={styles.heading}>試合結果</h2>
        <ErrorMessage message={matchesRes.error} />
      </section>
    );
  }
  if (teamsRes.status === "error") {
    return (
      <section className={styles.card}>
        <h2 className={styles.heading}>試合結果</h2>
        <ErrorMessage message={teamsRes.error} />
      </section>
    );
  }

  if (!matches || matches.length === 0) {
    return (
      <section className={styles.card}>
        <h2 className={styles.heading}>試合結果</h2>
        <p className={styles.empty}>試合データがまだ登録されていません。</p>
      </section>
    );
  }

  // グループ試合のインデックス (第1節〜第3節) を割り当てる
  let groupCount = 0;
  const rows = matches.map((m) => {
    const mdIndex = m.stage === "group" ? ++groupCount : 0;
    return { match: m, label: roundLabel(m, mdIndex) };
  });

  const hasKnockout = matches.some((m) => m.stage !== "group");

  return (
    <section className={styles.card}>
      <h2 className={styles.heading}>
        試合結果
        <span className={styles.subHeading}>
          {hasKnockout ? "全試合" : "グループステージ"}
        </span>
      </h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.colMd}>節</th>
            <th className={styles.colDate}>日付</th>
            <th className={styles.colOpp}>対戦国</th>
            <th className={styles.colResult}>結果</th>
            <th className={styles.colScore}>スコア</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ match: m, label }) => (
            <ResultRow
              key={m.id}
              match={m}
              teamId={teamId}
              label={label}
              teamMap={teamMap}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}
