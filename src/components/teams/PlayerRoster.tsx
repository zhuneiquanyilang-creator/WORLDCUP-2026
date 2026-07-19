import { Fragment, useMemo } from "react";
import { Link } from "react-router-dom";
import { usePlayers } from "@/hooks/usePlayers";
import { useMatches } from "@/hooks/useMatches";
import { computePlayerStats } from "@/utils/computePlayerStats";
import { calculateAge } from "@/utils/age";
import { Loading, ErrorMessage } from "@/components/common/AsyncState";
import type { Player, Position } from "@/types/player";
import styles from "./PlayerRoster.module.css";

type Props = {
  teamId: string;
};

const POSITION_ORDER: Position[] = ["GK", "DF", "MF", "FW"];
const POSITION_LABEL: Record<Position, string> = {
  GK: "ゴールキーパー",
  DF: "ディフェンダー",
  MF: "ミッドフィルダー",
  FW: "フォワード",
};

/**
 * クラブ名の末尾に付く「（イングランド）」等の国名を落として表示する。
 * 一覧では列幅を氏名に回したいため。`players/*.json` のデータ自体は
 * 国名付きのまま保持する (選手詳細など他画面はそのまま)。
 * 国名が付かないクラブ (例「ボカ・ジュニアーズ」) はそのまま返る。
 * 括弧は全角・半角どちらも、開き閉じが混在していても受け付ける
 * (データに「レッドスター・ベオグラード(セルビア）」のような表記ゆれがあるため)。
 */
function clubLabel(club: string | undefined): string {
  if (!club) return "—";
  const stripped = club.replace(/[（(][^（）()]*[）)]\s*$/, "").trim();
  return stripped || club;
}

/**
 * 氏名を「・」の位置だけで折り返せるようにする。
 *
 * 「エミリアーノ・マルティネス」が「エミリアーノ・マルティ / ネス」のように
 * 名前の途中で切れると読みにくいので、区切りの直後に `<wbr>` (改行可能位置) を
 * 置き、CSS 側の `word-break: keep-all` でそれ以外の位置での改行を禁止する。
 * 結果として「エミリアーノ・」/「マルティネス」と姓名で行が分かれる。
 * 1 行に収まる幅があるときはそのまま 1 行 (PC 表示など)。
 */
function NameWithBreaks({ name }: { name: string }) {
  const parts = name.split("・");
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {i < parts.length - 1 ? `${part}・` : part}
        </Fragment>
      ))}
    </>
  );
}

function groupByPosition(players: Player[]): Map<Position, Player[]> {
  const m = new Map<Position, Player[]>();
  POSITION_ORDER.forEach((p) => m.set(p, []));
  for (const p of players) {
    m.get(p.position)?.push(p);
  }
  return m;
}

export function PlayerRoster({ teamId }: Props) {
  const playersRes = usePlayers();
  const matchesRes = useMatches();

  /** 選手 id → 試合から集計したゴール/アシスト。試合データ未取得時は 0 扱い。 */
  const statsMap = useMemo(() => {
    if (playersRes.status !== "ready" || matchesRes.status !== "ready") {
      return new Map<string, { goals: number; assists: number }>();
    }
    return computePlayerStats(playersRes.data, matchesRes.data);
  }, [playersRes, matchesRes]);

  const grouped = useMemo(() => {
    if (playersRes.status !== "ready") return null;
    const filtered = playersRes.data.filter((p) => p.teamId === teamId);
    return groupByPosition(filtered);
  }, [playersRes, teamId]);

  if (playersRes.status === "loading") {
    return (
      <section className={styles.card}>
        <h2 className={styles.heading}>選手一覧</h2>
        <Loading />
      </section>
    );
  }
  if (playersRes.status === "error") {
    return (
      <section className={styles.card}>
        <h2 className={styles.heading}>選手一覧</h2>
        <ErrorMessage message={playersRes.error} />
      </section>
    );
  }

  const totalCount = grouped
    ? Array.from(grouped.values()).reduce((s, arr) => s + arr.length, 0)
    : 0;

  if (totalCount === 0) {
    return (
      <section className={styles.card}>
        <h2 className={styles.heading}>選手一覧</h2>
        <p className={styles.empty}>このチームの選手データは未登録です。</p>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <h2 className={styles.heading}>
        選手一覧 <span className={styles.count}>{totalCount}名</span>
      </h2>
      {POSITION_ORDER.map((pos) => {
        const players = grouped?.get(pos) ?? [];
        if (players.length === 0) return null;
        return (
          <div key={pos} className={styles.section}>
            <h3 className={styles.posHeading}>
              <span className={styles.posBadge}>{pos}</span>
              {POSITION_LABEL[pos]}
              <span className={styles.posCount}>{players.length}名</span>
            </h3>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.colNumber}>背番号</th>
                  <th className={styles.colName}>氏名</th>
                  <th className={styles.colClub}>所属クラブ</th>
                  <th className={styles.colAge}>年齢</th>
                  <th className={styles.colStat} title="ゴール">G</th>
                  <th className={styles.colStat} title="アシスト">A</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const age = calculateAge(p.birthDate);
                  const stat = statsMap.get(p.id);
                  const goals = stat?.goals ?? 0;
                  const assists = stat?.assists ?? 0;
                  return (
                    <tr key={p.id}>
                      <td className={styles.number}>
                        {p.number != null ? p.number : "—"}
                      </td>
                      <td className={styles.name}>
                        <Link to={`/players/${p.id}`} className={styles.nameLink}>
                          <NameWithBreaks name={p.name} />
                        </Link>
                      </td>
                      <td className={styles.club}>{clubLabel(p.club)}</td>
                      <td className={styles.age}>
                        {age !== null ? `${age}` : "—"}
                      </td>
                      <td
                        className={
                          goals > 0 ? styles.statValue : styles.statZero
                        }
                      >
                        {goals > 0 ? goals : "—"}
                      </td>
                      <td
                        className={
                          assists > 0 ? styles.statValue : styles.statZero
                        }
                      >
                        {assists > 0 ? assists : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className={styles.note}>※ 年齢は2026年6月11日（開幕日）時点</p>
    </section>
  );
}
