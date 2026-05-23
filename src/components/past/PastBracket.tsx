import { useMemo } from "react";
import type { KnockoutMatch, KnockoutRound } from "@/types/worldCupResult";
import styles from "./PastBracket.module.css";

type Props = {
  matches: KnockoutMatch[];
};

const COLUMN_ORDER: KnockoutRound[] = ["round16", "quarter", "semi", "final"];

const ROUND_LABEL: Record<KnockoutRound, string> = {
  round16: "ラウンド16",
  quarter: "準々決勝",
  semi: "準決勝",
  third: "3位決定戦",
  final: "決勝",
};

function winnerOf(m: KnockoutMatch): string {
  return m.winner === 1 ? m.team1 : m.team2;
}

type ByRound = Partial<Record<KnockoutRound, KnockoutMatch[]>>;

/**
 * 試合配列を「ブラケット並び」に並び替える。
 *
 * 決勝 → 準決勝 → 準々決勝 → R16 と上から辿り、親の team1 を勝ち上がらせた
 * 試合を「上」、team2 を勝ち上がらせた試合を「下」に置く。
 * これにより列同士が視覚的にきれいに繋がる（matches.json の配列順がブラケット
 * 順でなくても列が正しく揃う）。
 *
 * 系譜が辿れない試合（winner 不明・名前不一致）は各ラウンドの末尾に回す。
 */
function bracketOrder(matches: KnockoutMatch[]): ByRound {
  const byRound: ByRound = {};
  for (const m of matches) {
    if (!byRound[m.round]) byRound[m.round] = [];
    byRound[m.round]!.push(m);
  }

  const final = byRound.final?.[0];
  if (!final) return byRound;

  const result: ByRound = { final: [final] };
  const FEEDER: Partial<Record<KnockoutRound, KnockoutRound>> = {
    final: "semi",
    semi: "quarter",
    quarter: "round16",
  };

  let parents: KnockoutMatch[] = [final];
  for (const parentRound of ["final", "semi", "quarter"] as const) {
    const feederRound = FEEDER[parentRound];
    if (!feederRound) continue;
    const feeders = byRound[feederRound];
    if (!feeders || feeders.length === 0) continue;

    const ordered: KnockoutMatch[] = [];
    const used = new Set<KnockoutMatch>();
    for (const p of parents) {
      const f1 = feeders.find((m) => !used.has(m) && winnerOf(m) === p.team1);
      if (f1) {
        ordered.push(f1);
        used.add(f1);
      }
      const f2 = feeders.find((m) => !used.has(m) && winnerOf(m) === p.team2);
      if (f2) {
        ordered.push(f2);
        used.add(f2);
      }
    }
    for (const m of feeders) if (!used.has(m)) ordered.push(m);
    result[feederRound] = ordered;
    parents = ordered;
  }

  if (byRound.third) result.third = byRound.third;
  return result;
}

function MatchCard({ match }: { match: KnockoutMatch }) {
  return (
    <div className={styles.match}>
      <div className={`${styles.row} ${match.winner === 1 ? styles.winner : styles.loser}`}>
        <span className={styles.team}>{match.team1}</span>
        <span className={styles.score}>{match.score1}</span>
      </div>
      <div className={`${styles.row} ${match.winner === 2 ? styles.winner : styles.loser}`}>
        <span className={styles.team}>{match.team2}</span>
        <span className={styles.score}>{match.score2}</span>
      </div>
      {match.note && <div className={styles.note}>{match.note}</div>}
    </div>
  );
}

export function PastBracket({ matches }: Props) {
  const ordered = useMemo(() => bracketOrder(matches), [matches]);
  const columns = COLUMN_ORDER.filter((r) => (ordered[r]?.length ?? 0) > 0);
  const third = ordered.third?.[0];

  if (columns.length === 0) return null;

  return (
    <div className={styles.scroll}>
      <div className={styles.bracket}>
        {columns.map((r) => (
          <div key={r} className={styles.col}>
            <div className={styles.colTitle}>{ROUND_LABEL[r]}</div>
            <div className={styles.colMatches}>
              {ordered[r]!.map((m, i) => (
                <MatchCard key={i} match={m} />
              ))}
            </div>
            {r === "final" && third && (
              <div className={styles.third}>
                <div className={styles.thirdTitle}>{ROUND_LABEL.third}</div>
                <MatchCard match={third} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
