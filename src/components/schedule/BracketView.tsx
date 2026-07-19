import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigationType } from "react-router-dom";
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
  highlightedCardIds,
  highlightedPathIds,
  onHoverMatch,
}: {
  title: string;
  matches: Match[];
  teamMap: Map<string, Team>;
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
    <div className={styles.column}>
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

  // 初期表示位置: 決勝カードが縦横とも「全体が」見える状態にする。
  //
  //  - 横: 決勝は最終列なので右端まで送る。ただし決勝カードは absolute 配置で
  //    列内に置かれており、国旗画像の読み込み等で列幅が後から変わるため、
  //    「スクロール上限へ送る」だけだとカード右端が切れることがある。
  //    そこでカードの実測 rect を見て、右端が可視領域に収まるまで補正する。
  //  - 縦: ブラケットは min-height 1280px あり、決勝カードはその高さの中央
  //    (top: 50%) に置かれるので、ページ先頭のままだと画面外に出てしまう。
  const bracketRef = useRef<HTMLDivElement>(null);
  const finalCardRef = useRef<HTMLDivElement>(null);
  const navType = useNavigationType();
  useEffect(() => {
    const bracket = bracketRef.current;
    if (!bracket) return;

    // 自分が設定した scrollLeft を覚えておき、ユーザーが手で動かした後は
    // 再補正しない (勝手に位置を奪わないため)。
    let lastSet: number | null = null;

    /** 決勝カードの右端が可視領域内に収まるまで横スクロールする。 */
    const revealFinalHorizontally = () => {
      if (lastSet !== null && Math.abs(bracket.scrollLeft - lastSet) > 1) return;
      bracket.scrollLeft = Math.max(0, bracket.scrollWidth - bracket.clientWidth);
      const card = finalCardRef.current;
      if (card) {
        const cardRect = card.getBoundingClientRect();
        const boxRect = bracket.getBoundingClientRect();
        // 右端に少し余白 (8px) を残して収める。切れている分だけ追加スクロール。
        const overflow = cardRect.right - (boxRect.right - 8);
        if (overflow > 0) bracket.scrollLeft += overflow;
      }
      lastSet = bracket.scrollLeft;
    };

    revealFinalHorizontally();
    // 国旗 (flagcdn の img) は幅指定が無く、読み込み完了後に列幅が広がる。
    // その結果 scrollWidth が後から伸びてカード右端が切れるので、描画が
    // 落ち着くタイミングで再補正する。
    const retries = [150, 400, 1000].map((d) =>
      window.setTimeout(revealFinalHorizontally, d)
    );

    // POP (戻る/進む) では縦スクロールを触らない。useScrollRestoration が
    // 復元したユーザーの元の位置を奪わないため。
    // requestAnimationFrame で遅らせるのは、親 (Layout) の
    // useScrollRestoration が新規遷移時に window.scrollTo(0) するのが
    // 子のこの effect より後に走るため。rAF でその後に実行して上書きする。
    const clearRetries = () => retries.forEach((t) => window.clearTimeout(t));
    if (navType === "POP") return clearRetries;
    const raf = requestAnimationFrame(() => {
      // 縦だけ動かす (inline: "nearest" だと横位置を戻されることがあるため、
      // 縦位置は自前で計算して window.scrollTo する)。
      const card = finalCardRef.current;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const top = window.scrollY + rect.top - (window.innerHeight - rect.height) / 2;
      window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
      revealFinalHorizontally();
    });
    return () => {
      clearRetries();
      cancelAnimationFrame(raf);
    };
  }, [navType]);

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
        {COLUMNS.map((col) => (
          <BracketColumn
            key={col.title}
            title={col.title}
            matches={pickByOrder(matches, col.stage, col.order)}
            teamMap={teamMap}
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
          <div
            className={`${styles.cards} ${styles.finalCards} ${
              fin && hoveredMatchId === fin.id ? styles.finalCardsHighlighted : ""
            }`}
          >
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
              <div className={styles.finalCardWrap} ref={finalCardRef}>
                <BracketMatch
                  match={fin}
                  teamMap={teamMap}
                  highlighted={cardIds.has(fin.id)}
                  onHoverMatch={setHoveredMatchId}
                />
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
