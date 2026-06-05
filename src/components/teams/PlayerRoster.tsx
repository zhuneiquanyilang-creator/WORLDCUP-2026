import { useMemo } from "react";
import { usePlayers } from "@/hooks/usePlayers";
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
                </tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const age = calculateAge(p.birthDate);
                  return (
                    <tr key={p.id}>
                      <td className={styles.number}>
                        {p.number != null ? p.number : "—"}
                      </td>
                      <td className={styles.name}>{p.name}</td>
                      <td className={styles.club}>{p.club ?? "—"}</td>
                      <td className={styles.age}>
                        {age !== null ? `${age}` : "—"}
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
