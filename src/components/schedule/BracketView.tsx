import { useEffect, useMemo, useRef, useState } from "react";
import type { Match } from "@/types/match";
import type { Team } from "@/types/team";
import { matchNumber } from "@/utils/matchNumber";
import { Flag } from "@/components/common/Flag";
import { BracketMatch } from "./BracketMatch";
import styles from "./BracketView.module.css";

type Props = {
  matches: Match[];
  teamMap: Map<string, Team>;
};

/**
 * 左→右の縦長ブラケット。一番左の R32 列に 16 試合を縦に並べ、右に向かって
 * 半分ずつにまとまり、最右列に決勝＋3位決定戦が来る。
 *
 * 各列ではカードを 2 枚ずつ「ペア」に括り、ペアごとに「]」型の進出線
 * (`.pair::after`) と次列へ伸びる水平線 (`.pair::before`) を CSS で描画する。
 *
 * カードの位置揃え: 各 .cards に `justify-content: space-around` をかけている
 * ため、列ごとにカード数が半分になっても親カードの中央に揃う
 * (R32 16枚→R16 8枚で各 R16 がそのペア中央に来る)。
 */

// R32 の縦並び順（隣接ペアが同じ R16 試合に進むようにする）。
// QF→SF の接続は m101=W97+W99 / m102=W98+W100 なので、
// QF 列は [97, 99, 98, 100] の順に並べ、そのペアリング
// (97,99)→m101 / (98,100)→m102 が線とカード内容で一致するようにする。
// R16/R32 も同じ半 (upper / lower) 内で連続するよう並び替え。
const R32_ORDER = [74, 77, 73, 75, 83, 84, 81, 82, 76, 78, 79, 80, 86, 87, 85, 88];
const R16_ORDER = [90, 89, 93, 94, 91, 92, 95, 96];
const QF_ORDER = [97, 99, 98, 100];
const SF_ORDER = [101, 102];
const FINAL_NUM = 104;
const THIRD_NUM = 103;

// ホバー時にどの段階までを「過去 (経路)」として扱うかの序列。
// hovered.stage より rank が小さいものだけがハイライト対象になる。
const STAGE_RANK: Record<Match["stage"], number> = {
  test: 0,
  group: 0,
  round32: 1,
  round16: 2,
  quarter: 3,
  semi: 4,
  third: 5,
  final: 5,
};

function pickByOrder(matches: Match[], stage: Match["stage"], order: number[]): Match[] {
  const stageMatches = matches.filter((m) => m.stage === stage);
  return order
    .map((n) => stageMatches.find((m) => matchNumber(m.id) === n))
    .filter((m): m is Match => Boolean(m));
}

function pairUp<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += 2) out.push(arr.slice(i, i + 2));
  return out;
}

/** 決勝が確定していれば勝者のチーム ID を返す。未確定なら undefined。 */
function championTeamId(finalMatch: Match | undefined): string | undefined {
  if (!finalMatch || finalMatch.status !== "finished") return undefined;
  const s = finalMatch.score;
  if (!s) return undefined;
  if (s.home > s.away) return finalMatch.homeTeamId;
  if (s.home < s.away) return finalMatch.awayTeamId;
  const pk = finalMatch.penaltyScore;
  if (!pk) return undefined;
  if (pk.home > pk.away) return finalMatch.homeTeamId;
  if (pk.home < pk.away) return finalMatch.awayTeamId;
  return undefined;
}


const COLUMNS: { title: string; stage: Match["stage"]; order: number[] }[] = [
  { title: "ラウンド32", stage: "round32", order: R32_ORDER },
  { title: "ラウンド16", stage: "round16", order: R16_ORDER },
  { title: "準々決勝", stage: "quarter", order: QF_ORDER },
  { title: "準決勝", stage: "semi", order: SF_ORDER },
];

function BracketColumn({
  title,
  matches,
  teamMap,
  innerRef,
  highlightedCardIds,
  highlightedPathIds,
  onHoverMatch,
}: {
  title: string;
  matches: Match[];
  teamMap: Map<string, Team>;
  innerRef?: React.Ref<HTMLDivElement>;
  /** カード自体をハイライトする対象 (hovered 段階以前の全カード) */
  highlightedCardIds: Set<string>;
  /** pair 接続線をハイライトする対象 (hovered より前の段階のカードのみ) */
  highlightedPathIds: Set<string>;
  onHoverMatch: (id: string | null) => void;
}) {
  const pairs = pairUp(matches);
  const isCardHl = (id: string) => highlightedCardIds.has(id);
  const isPathHl = (id: string) => highlightedPathIds.has(id);
  return (
    <div className={styles.column} ref={innerRef}>
      <div className={styles.columnTitle}>{title}</div>
      <div className={styles.cards}>
        {pairs.map((pair, i) => {
          if (pair.length !== 2) {
            return (
              <div key={i} className={styles.pairSingle}>
                {pair.map((m) => (
                  <BracketMatch
                    key={m.id}
                    match={m}
                    teamMap={teamMap}
                    highlighted={isCardHl(m.id)}
                    onHoverMatch={onHoverMatch}
                  />
                ))}
              </div>
            );
          }
          // pair 接続線は「その先」ではないため、hovered より前の段階の pair のみ
          // ハイライトする (= highlightedPathIds に該当するカードを持つ pair)。
          const pairHl = isPathHl(pair[0].id) || isPathHl(pair[1].id);
          return (
            <div
              key={i}
              className={`${styles.pair} ${pairHl ? styles.pairHighlighted : ""}`}
            >
              <BracketMatch
                match={pair[0]}
                teamMap={teamMap}
                highlighted={isCardHl(pair[0].id)}
                onHoverMatch={onHoverMatch}
              />
              <BracketMatch
                match={pair[1]}
                teamMap={teamMap}
                highlighted={isCardHl(pair[1].id)}
                onHoverMatch={onHoverMatch}
              />
              <div className={styles.branchTop} aria-hidden />
              <div className={styles.branchBottom} aria-hidden />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BracketView({ matches, teamMap }: Props) {
  const fin = matches.find(
    (m) => m.stage === "final" && matchNumber(m.id) === FINAL_NUM
  );
  const third = matches.find(
    (m) => m.stage === "third" && matchNumber(m.id) === THIRD_NUM
  );

  // 初期スクロール位置:
  //  - スマホ (≤640px): SF (準決勝) 列が可視領域の中央に来るようにスクロール
  //    (SF を中心に据えて左右に QF / 決勝が見える構図)
  //  - PC (>640px): R16 (ラウンド16) 列の左端が可視領域の左端に来るようにスクロール
  //    (R32 を左に隠して残りが横一覧できるようにする)
  const bracketRef = useRef<HTMLDivElement>(null);
  const r16Ref = useRef<HTMLDivElement>(null);
  const sfRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bracket = bracketRef.current;
    if (!bracket) return;
    const isMobile = window.matchMedia("(max-width: 640px)").matches;
    if (isMobile) {
      const sf = sfRef.current;
      if (!sf) return;
      // SF 列を viewport 中央に揃える。負にならないように clamp。
      const target = sf.offsetLeft - (bracket.clientWidth - sf.offsetWidth) / 2;
      bracket.scrollLeft = Math.max(0, target);
    } else {
      const r16 = r16Ref.current;
      if (!r16) return;
      // 列間 gap (0.75rem = 12px) 分だけ引いて、R16 タイトルが端に張り付かない
      // 少しの余白を残す。
      bracket.scrollLeft = r16.offsetLeft - 12;
    }
  }, []);

  // ホバー中カードから、そのカードで対戦する両チームが「そこに至るまで」に通って
  // きた過去試合カード + 接続線をハイライトする。プレースホルダー ID (W89, GA1 等 =
  // 未確定) は除外して、実チーム ID だけを追跡対象にする。
  // hovered の stage より先のカードは「まだ勝ち抜いていない未来」として無視する。
  const [hoveredMatchId, setHoveredMatchId] = useState<string | null>(null);
  const { cardIds, pathIds } = useMemo(() => {
    const empty = { cardIds: new Set<string>(), pathIds: new Set<string>() };
    if (!hoveredMatchId) return empty;
    const target = matches.find((m) => m.id === hoveredMatchId);
    if (!target) return empty;
    const teams = new Set<string>();
    if (teamMap.has(target.homeTeamId)) teams.add(target.homeTeamId);
    if (teamMap.has(target.awayTeamId)) teams.add(target.awayTeamId);
    if (teams.size === 0) return empty;
    const targetRank = STAGE_RANK[target.stage] ?? 0;
    const cardIds = new Set<string>();
    const pathIds = new Set<string>();
    for (const m of matches) {
      if (!teams.has(m.homeTeamId) && !teams.has(m.awayTeamId)) continue;
      const rank = STAGE_RANK[m.stage] ?? 0;
      if (rank > targetRank) continue; // 先の段階は無視
      cardIds.add(m.id);
      // pair 接続線 (「]」 + 次列への水平線) は「その先」を明るくしないため、
      // hovered と同じ段階の pair は除外する。過去段階のペアだけを highlight する。
      if (rank < targetRank) pathIds.add(m.id);
    }
    return { cardIds, pathIds };
  }, [hoveredMatchId, matches, teamMap]);

  return (
    <div>
      <div className={styles.bracket} ref={bracketRef}>
        {COLUMNS.map((col, i) => (
          <BracketColumn
            key={col.title}
            title={col.title}
            matches={pickByOrder(matches, col.stage, col.order)}
            teamMap={teamMap}
            innerRef={i === 1 ? r16Ref : i === 3 ? sfRef : undefined}
            highlightedCardIds={cardIds}
            highlightedPathIds={pathIds}
            onHoverMatch={setHoveredMatchId}
          />
        ))}

        {/* 他の列と同じ「columnTitle + cards」構造にして、垂直位置を揃える。
            「決勝」は columnTitle の枠内に gold pill バッジで表示。
            決勝カードは絶対配置で連結線の右に固定する (線とカードが被らない)。 */}
        <div className={`${styles.column} ${styles.finalCol}`}>
          <div className={styles.columnTitle}>
            <span className={styles.finalTitleBadge}>決勝</span>
          </div>
          <div className={`${styles.cards} ${styles.finalCards}`}>
            {/* 優勝チーム欄: 決勝が終わるまで空。決着したら勝者を自動表示。 */}
            <div className={styles.championWrap}>
              <div className={styles.championLabel}>優勝</div>
              <div className={styles.championBox}>
                {(() => {
                  const champId = championTeamId(fin);
                  const champTeam = champId ? teamMap.get(champId) : undefined;
                  if (!champTeam) return <span className={styles.championPending} aria-hidden />;
                  return (
                    <>
                      <Flag isoCode={champTeam.isoCode} size={22} alt={champTeam.name} />
                      <span className={styles.championName}>{champTeam.name}</span>
                    </>
                  );
                })()}
              </div>
            </div>
            {fin && (
              <div className={styles.finalCardWrap}>
                <BracketMatch match={fin} teamMap={teamMap} />
              </div>
            )}
            {third && (
              <div className={styles.thirdWrap}>
                <div className={styles.thirdTitle}>3位決定戦</div>
                <BracketMatch match={third} teamMap={teamMap} />
              </div>
            )}
          </div>
        </div>
      </div>

      <p className={styles.note}>
        ※ R16 以降の対戦カードは「73試合勝者」のようなラベル表記です。番号は各カード左上の{" "}
        <span className={styles.numChip}>#73</span> で照合できます。
      </p>
    </div>
  );
}
