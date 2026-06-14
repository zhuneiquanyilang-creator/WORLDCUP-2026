import { useEffect, useMemo, useState } from "react";
import type { Booking, FormationData, Goal, Substitution } from "@/types/match";
import type { Team } from "@/types/team";
import { Flag } from "@/components/common/Flag";
import {
  applySubsToLineup,
  summarizeCards,
  type SpotWithSub,
  type BenchWithSub,
} from "@/utils/applySubs";
import { formatMinute } from "@/utils/eventMinute";
import styles from "./CombinedFormation.module.css";

/**
 * ピッチ上の表示用に名前から姓だけを抜き出す。ベンチはフルネームのままにする。
 *
 *  - "Cole Palmer"             → "Palmer"   (英語名: 最後のスペース以降)
 *  - "Enzo Fernández"          → "Fernández"
 *  - "ジョーダン・ピックフォード"  → "ピックフォード" (カタカナ西洋名: 最後の中黒以降)
 *  - "南野 拓実"               → "南野"     (日本名 姓+空白+名: 最初のトークン)
 *  - "Cucurella" / 名前1語のみ  → そのまま
 *  - "van de Ven"              → "Ven"     (前置詞は無視、簡易ロジックの限界)
 */
function surnameOf(name: string): string {
  if (!name) return name;
  // カタカナ西洋名: 中黒 (・) 区切りなら最後のトークン
  if (name.includes("・") || name.includes("·")) {
    const parts = name.split(/[・·]+/);
    return parts[parts.length - 1] || name;
  }
  // 日本式 姓+空白+名: ひらがな/カタカナ/漢字が含まれていて空白区切りなら最初のトークン
  if (
    /[぀-ヿ一-鿿]/.test(name) &&
    /[\s　]/.test(name)
  ) {
    return name.split(/[\s　]+/)[0];
  }
  // 英語名: 最後のスペース以降
  if (/\s/.test(name)) {
    const parts = name.split(/\s+/);
    return parts[parts.length - 1];
  }
  return name;
}

/** チームに応じてフォーメーション上の表示名を決める。
 *  韓国は「キム・スンギュ」のように姓先頭・中黒区切りで、surnameOf だと
 *  名のみ ("スンギュ") が出てしまう。要望に応じてフルネームで表示する。 */
function displayName(name: string, useFullName: boolean): string {
  if (useFullName) return name;
  return surnameOf(name);
}

const FULL_NAME_TEAMS = new Set<string>(["KOR"]);

type Props = {
  homeTeam: Team | undefined;
  homeTeamId: string;
  homeLabel?: string;
  homeFormation?: FormationData;
  homeSubs?: Substitution[];
  homeBookings?: Booking[];
  awayTeam: Team | undefined;
  awayTeamId: string;
  awayLabel?: string;
  awayFormation?: FormationData;
  awaySubs?: Substitution[];
  awayBookings?: Booking[];
  /** 試合の全ゴール (両チーム分)。applySubsToLineup が teamId で振り分ける。
   *  オウンゴール (type === "own") は相手チームの選手として帰属させるためにも、
   *  ここでは home/away で事前フィルタしない全体配列を渡す。 */
  goals?: Goal[];
};

/** スマホ幅 (640px 以下) かどうかを監視する。 */
function useIsNarrow(maxWidth = 640): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    setNarrow(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return narrow;
}

type PitchLayout = {
  pitchW: number;
  pitchH: number;
  maxWidth: number;
  nameSize: number;
  homePos: (spot: SpotWithSub) => [number, number];
  awayPos: (spot: SpotWithSub) => [number, number];
};

/* ===== 横向きレイアウト (PC) =====
 * ホームは左半分・攻撃方向→右、アウェイは右半分・攻撃方向→左。
 * y=0 (チーム視点の左サイド): ホームは画面下、アウェイは画面上。 */
const H_PAD_GOAL = 3;
const H_PAD_SIDE = 6;

function horizontalHomePos(spot: SpotWithSub): [number, number] {
  const half = 160 / 2;
  const px = H_PAD_GOAL + (spot.x / 100) * (half - H_PAD_GOAL * 2);
  const py = H_PAD_SIDE + ((100 - spot.y) / 100) * (100 - H_PAD_SIDE * 2);
  return [px, py];
}

function horizontalAwayPos(spot: SpotWithSub): [number, number] {
  const half = 160 / 2;
  const px = 160 - H_PAD_GOAL - (spot.x / 100) * (half - H_PAD_GOAL * 2);
  const py = H_PAD_SIDE + (spot.y / 100) * (100 - H_PAD_SIDE * 2);
  return [px, py];
}

const HORIZONTAL_LAYOUT: PitchLayout = {
  pitchW: 160,
  pitchH: 100,
  maxWidth: 900,
  nameSize: 2.5,
  homePos: horizontalHomePos,
  awayPos: horizontalAwayPos,
};

/* ===== 縦向きレイアウト (スマホ) =====
 * ホームは上半分・攻撃方向↓、アウェイは下半分・攻撃方向↑。
 * y=0 (チーム視点の左サイド): ホームは画面左、アウェイは画面右。 */
const V_PAD_GOAL = 8;
const V_PAD_CENTER = 2;
const V_PAD_SIDE = 6;
const V_HALF_DEPTH = 160 / 2 - V_PAD_GOAL - V_PAD_CENTER;

function verticalHomePos(spot: SpotWithSub): [number, number] {
  const px = V_PAD_SIDE + (spot.y / 100) * (100 - V_PAD_SIDE * 2);
  const py = V_PAD_GOAL + (spot.x / 100) * V_HALF_DEPTH;
  return [px, py];
}

function verticalAwayPos(spot: SpotWithSub): [number, number] {
  const px = 100 - V_PAD_SIDE - (spot.y / 100) * (100 - V_PAD_SIDE * 2);
  const py = 160 - V_PAD_GOAL - (spot.x / 100) * V_HALF_DEPTH;
  return [px, py];
}

const VERTICAL_LAYOUT: PitchLayout = {
  pitchW: 100,
  pitchH: 160,
  maxWidth: 440,
  nameSize: 2.25,
  homePos: verticalHomePos,
  awayPos: verticalAwayPos,
};

export function CombinedFormation({
  homeTeam,
  homeLabel,
  homeTeamId,
  homeFormation,
  homeSubs,
  homeBookings,
  awayTeam,
  awayTeamId,
  awayLabel,
  awayFormation,
  awaySubs,
  awayBookings,
  goals,
}: Props) {
  const isNarrow = useIsNarrow();
  const layout = isNarrow ? VERTICAL_LAYOUT : HORIZONTAL_LAYOUT;
  const Pitch = isNarrow ? VerticalPitch : HorizontalPitch;

  const homeProcessed = useMemo(
    () =>
      applySubsToLineup(
        homeFormation,
        homeTeamId,
        homeSubs,
        homeBookings,
        goals
      ),
    [homeFormation, homeTeamId, homeSubs, homeBookings, goals]
  );
  const awayProcessed = useMemo(
    () =>
      applySubsToLineup(
        awayFormation,
        awayTeamId,
        awaySubs,
        awayBookings,
        goals
      ),
    [awayFormation, awayTeamId, awaySubs, awayBookings, goals]
  );

  const homeHead = (
    <div className={`${styles.teamHead} ${styles.teamHeadHome}`}>
      {homeTeam && <Flag isoCode={homeTeam.isoCode} size={22} alt={homeTeam.name} />}
      <span className={styles.teamName}>{homeTeam?.name ?? homeLabel ?? ""}</span>
      {homeFormation && <span className={styles.shape}>{homeFormation.shape}</span>}
    </div>
  );
  const awayHead = (
    <div className={`${styles.teamHead} ${styles.teamHeadAway}`}>
      {awayFormation && <span className={styles.shape}>{awayFormation.shape}</span>}
      <span className={styles.teamName}>{awayTeam?.name ?? awayLabel ?? ""}</span>
      {awayTeam && <Flag isoCode={awayTeam.isoCode} size={22} alt={awayTeam.name} />}
    </div>
  );

  return (
    <section className={styles.card}>
      {/* スマホ (縦レイアウト): ピッチ上にホーム名、下にアウェイ名を別々に置く。
          PC (横レイアウト): 従来通り Home VS Away の単一ヘッダー。 */}
      {isNarrow ? (
        <div className={styles.mobileHomeHead}>{homeHead}</div>
      ) : (
        <header className={styles.header}>
          {homeHead}
          <div className={styles.vs}>VS</div>
          {awayHead}
        </header>
      )}

      <div className={styles.pitchWrap} style={{ maxWidth: layout.maxWidth }}>
        <svg
          viewBox={`0 0 ${layout.pitchW} ${layout.pitchH}`}
          preserveAspectRatio="xMidYMid meet"
          className={styles.pitch}
          aria-label="フォーメーション"
        >
          <Pitch />
          {homeProcessed?.starting.map((s, i) => {
            const [x, y] = layout.homePos(s);
            return (
              <Spot
                key={`h${i}`}
                spot={s}
                x={x}
                y={y}
                variant="home"
                nameSize={layout.nameSize}
                useFullName={homeTeam ? FULL_NAME_TEAMS.has(homeTeam.id) : false}
              />
            );
          })}
          {awayProcessed?.starting.map((s, i) => {
            const [x, y] = layout.awayPos(s);
            return (
              <Spot
                key={`a${i}`}
                spot={s}
                x={x}
                y={y}
                variant="away"
                nameSize={layout.nameSize}
                useFullName={awayTeam ? FULL_NAME_TEAMS.has(awayTeam.id) : false}
              />
            );
          })}
        </svg>
      </div>

      {isNarrow && (
        <div className={styles.mobileAwayHead}>{awayHead}</div>
      )}

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendBall}>⚽</span>
          ゴール
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendAssist}>A</span>
          アシスト
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.legendOut}`} />
          ↓ 途中退出
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.legendIn}`} />
          ↑ 途中出場
        </span>
        <span className={styles.legendItem}>
          <span className={styles.cardYellow} />
          イエロー
        </span>
        <span className={styles.legendItem}>
          <span className={styles.cardRed} />
          レッド
        </span>
      </div>

      <div className={styles.benchGrid}>
        <BenchList
          title={`${homeTeam?.name ?? homeLabel ?? "ホーム"}ベンチ`}
          items={homeProcessed?.bench}
        />
        <BenchList
          title={`${awayTeam?.name ?? awayLabel ?? "アウェイ"}ベンチ`}
          items={awayProcessed?.bench}
        />
      </div>
    </section>
  );
}

/** 横向きピッチ (160×100)。中央縦ライン・左右ゴール。 */
function HorizontalPitch() {
  const W = 160;
  const H = 100;
  return (
    <g>
      {Array.from({ length: 8 }, (_, i) => (
        <rect
          key={i}
          x={(W / 8) * i}
          y={0}
          width={W / 8}
          height={H}
          fill={i % 2 === 0 ? "#308f3d" : "#2c8538"}
        />
      ))}
      <rect x={2} y={2} width={W - 4} height={H - 4} fill="none" stroke="#fff" strokeWidth={0.5} />
      <line x1={W / 2} y1={2} x2={W / 2} y2={H - 2} stroke="#fff" strokeWidth={0.4} />
      <circle cx={W / 2} cy={H / 2} r={9} fill="none" stroke="#fff" strokeWidth={0.4} />
      <circle cx={W / 2} cy={H / 2} r={0.7} fill="#fff" />
      <rect x={2} y={22} width={18} height={56} fill="none" stroke="#fff" strokeWidth={0.4} />
      <rect x={2} y={37} width={6} height={26} fill="none" stroke="#fff" strokeWidth={0.4} />
      <circle cx={14} cy={50} r={1} fill="#fff" />
      <rect x={W - 20} y={22} width={18} height={56} fill="none" stroke="#fff" strokeWidth={0.4} />
      <rect x={W - 8} y={37} width={6} height={26} fill="none" stroke="#fff" strokeWidth={0.4} />
      <circle cx={W - 14} cy={50} r={1} fill="#fff" />
    </g>
  );
}

/** 縦向きピッチ (100×160)。中央横ライン・上下ゴール。 */
function VerticalPitch() {
  const W = 100;
  const H = 160;
  const cx = W / 2;
  return (
    <g>
      {Array.from({ length: 8 }, (_, i) => (
        <rect
          key={i}
          x={0}
          y={(H / 8) * i}
          width={W}
          height={H / 8}
          fill={i % 2 === 0 ? "#308f3d" : "#2c8538"}
        />
      ))}
      <rect x={2} y={2} width={W - 4} height={H - 4} fill="none" stroke="#fff" strokeWidth={0.5} />
      <line x1={2} y1={H / 2} x2={W - 2} y2={H / 2} stroke="#fff" strokeWidth={0.4} />
      <circle cx={cx} cy={H / 2} r={9} fill="none" stroke="#fff" strokeWidth={0.4} />
      <circle cx={cx} cy={H / 2} r={0.7} fill="#fff" />
      <rect x={cx - 28} y={2} width={56} height={18} fill="none" stroke="#fff" strokeWidth={0.4} />
      <rect x={cx - 13} y={2} width={26} height={6} fill="none" stroke="#fff" strokeWidth={0.4} />
      <circle cx={cx} cy={14} r={1} fill="#fff" />
      <rect x={cx - 28} y={H - 20} width={56} height={18} fill="none" stroke="#fff" strokeWidth={0.4} />
      <rect x={cx - 13} y={H - 8} width={26} height={6} fill="none" stroke="#fff" strokeWidth={0.4} />
      <circle cx={cx} cy={H - 14} r={1} fill="#fff" />
    </g>
  );
}

/** ⚽ バッジ (rect + text)。1点なら⚽、複数なら⚽×N。 */
function GoalBadge({ count, x, y }: { count: number; x: number; y: number }) {
  const multi = count > 1;
  const width = multi ? 5.5 : 3.6;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={-width / 2} y={-1.6} width={width} height={3.2} rx={0.8} fill="#16a34a" />
      <text
        x={multi ? 0.4 : -0.2}
        y={0.1}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={2.4}
        fontWeight={800}
        fill="#fff"
      >
        {multi ? `⚽×${count}` : "⚽"}
      </text>
    </g>
  );
}

/** オウンゴール用の赤いボールバッジ。複数 OG なら ⚽×N で表示。 */
function OwnGoalBadge({
  count,
  x,
  y,
}: {
  count: number;
  x: number;
  y: number;
}) {
  const multi = count > 1;
  const width = multi ? 5.5 : 3.6;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-width / 2}
        y={-1.6}
        width={width}
        height={3.2}
        rx={0.8}
        fill="#dc2626"
      />
      <text
        x={multi ? 0.4 : -0.2}
        y={0.1}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={2.4}
        fontWeight={800}
        fill="#fff"
      >
        {multi ? `⚽×${count}` : "⚽"}
      </text>
    </g>
  );
}

/** Ⓐ バッジ (丸の中に A)。複数アシストなら A2 等。 */
function AssistBadge({ count, x, y }: { count: number; x: number; y: number }) {
  const multi = count > 1;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle r={1.55} fill="#0ea5e9" stroke="#fff" strokeWidth={0.25} />
      <text
        x={0}
        y={0.1}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={2.1}
        fontWeight={800}
        fill="#fff"
      >
        {multi ? `A${count}` : "A"}
      </text>
    </g>
  );
}

function Spot({
  spot,
  x,
  y,
  variant,
  nameSize,
  useFullName = false,
}: {
  spot: SpotWithSub;
  x: number;
  y: number;
  variant: "home" | "away";
  nameSize: number;
  useFullName?: boolean;
}) {
  const ringColor = variant === "home" ? "#1a3a8a" : "#b91c1c";
  const textColor = variant === "home" ? "#1a3a8a" : "#b91c1c";
  const isSubbedOut = spot.subbedOutAt !== undefined;
  const { yellow, red } = summarizeCards(spot.cards);
  const goalCount = spot.goals?.length ?? 0;
  const assistCount = spot.assists?.length ?? 0;
  const ownGoalCount = spot.ownGoals?.length ?? 0;

  // 右側に縦積みで配置 (上から ↓N' → ⚽ → 🔴⚽ (OG) → Ⓐ)。
  // 退出済みのときは ↓N' を最上段に置き、その下のバッジ群は順に 3 ずつ下げる。
  const STACK_X = 4.2;
  const subbedOutY = -4.2;
  const goalY = isSubbedOut ? 0 : -1;
  const ownGoalY = goalCount > 0 ? goalY + 3 : goalY;
  const assistY =
    ownGoalCount > 0
      ? ownGoalY + 3
      : goalCount > 0
      ? goalY + 3
      : goalY;

  return (
    <g transform={`translate(${x}, ${y})`}>
      {spot.isMvp ? (
        // MVP: 背番号サークルを金色の星形に置き換える (番号は中央に残す)
        <polygon
          points="0,-4.2 0.926,-1.273 3.994,-1.297 1.499,0.487 2.469,3.397 0,1.575 -2.469,3.397 -1.499,0.487 -3.994,-1.297 -0.926,-1.273"
          fill="#fbbf24"
          stroke="#7c2d12"
          strokeWidth={0.4}
          strokeLinejoin="round"
          aria-label="MVP"
        />
      ) : (
        <circle r={3.6} fill="#fff" stroke={ringColor} strokeWidth={0.7} />
      )}
      <text
        x={0}
        y={0.2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={3}
        fontWeight={800}
        fill={spot.isMvp ? "#7c2d12" : textColor}
      >
        {spot.number ?? ""}
      </text>
      <text
        x={0}
        y={6.8}
        textAnchor="middle"
        fontSize={nameSize}
        fontWeight={600}
        fill="#fff"
        stroke="#000"
        strokeWidth={0.18}
        paintOrder="stroke"
      >
        {displayName(spot.name, useFullName)}
        {spot.isCaptain && " (C)"}
      </text>
      {/* カード (左上に小さく) */}
      {(yellow || red) && (
        <g transform="translate(-5.5, -3.8)">
          {yellow && (
            <rect
              x={0}
              y={0}
              width={1.7}
              height={2.4}
              rx={0.25}
              fill="#fbbf24"
              stroke="#7c2d12"
              strokeWidth={0.15}
            />
          )}
          {red && (
            <rect
              x={yellow ? 1.9 : 0}
              y={0}
              width={1.7}
              height={2.4}
              rx={0.25}
              fill="#dc2626"
              stroke="#7f1d1d"
              strokeWidth={0.15}
            />
          )}
        </g>
      )}
      {/* 右側に縦積み: ↓N' (上) → ⚽ → Ⓐ */}
      {isSubbedOut && (
        <g transform={`translate(${STACK_X}, ${subbedOutY})`}>
          <rect x={-2.75} y={-1.6} width={5.5} height={3.2} rx={0.8} fill="#e30613" />
          <text
            x={0}
            y={0.1}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={2.2}
            fontWeight={800}
            fill="#fff"
          >
            ↓{formatMinute(spot.subbedOutAt!, spot.subbedOutAddedTime)}&apos;
          </text>
        </g>
      )}
      {goalCount > 0 && <GoalBadge count={goalCount} x={STACK_X} y={goalY} />}
      {ownGoalCount > 0 && (
        <OwnGoalBadge count={ownGoalCount} x={STACK_X} y={ownGoalY} />
      )}
      {assistCount > 0 && (
        <AssistBadge count={assistCount} x={STACK_X} y={assistY} />
      )}
    </g>
  );
}

function BenchList({
  title,
  items,
}: {
  title: string;
  items: BenchWithSub[] | undefined;
}) {
  if (!items || items.length === 0) return <div className={styles.benchCol} />;
  return (
    <div className={styles.benchCol}>
      <div className={styles.benchTitle}>{title} ({items.length})</div>
      <ul className={styles.benchList}>
        {items.map((p, i) => {
          const { yellow, red } = summarizeCards(p.cards);
          const goalCount = p.goals?.length ?? 0;
          const assistCount = p.assists?.length ?? 0;
          const ownGoalCount = p.ownGoals?.length ?? 0;
          return (
            <li
              key={i}
              className={p.subbedInAt !== undefined ? styles.benchIn : undefined}
            >
              {p.number !== undefined && (
                <span
                  className={
                    p.isMvp
                      ? `${styles.benchNum} ${styles.benchNumMvp}`
                      : styles.benchNum
                  }
                  aria-label={p.isMvp ? "MVP" : undefined}
                >
                  {p.number}
                </span>
              )}
              <span className={styles.benchName}>
                {p.name}
                {p.isCaptain && " (C)"}
              </span>
              {yellow && <span className={styles.cardYellow} aria-label="イエロー" />}
              {red && <span className={styles.cardRed} aria-label="レッド" />}
              {/* ゴール・OG・アシストは交代時間 (↑N') の直左に並べる */}
              {goalCount > 0 && (
                <span className={styles.goalBadge}>
                  ⚽{goalCount > 1 ? `×${goalCount}` : ""}
                </span>
              )}
              {ownGoalCount > 0 && (
                <span
                  className={styles.ownGoalBadge}
                  aria-label="オウンゴール"
                  title="オウンゴール"
                >
                  ⚽{ownGoalCount > 1 ? `×${ownGoalCount}` : ""}
                </span>
              )}
              {assistCount > 0 && (
                <span className={styles.assistBadge} aria-label="アシスト">
                  {assistCount > 1 ? `A${assistCount}` : "A"}
                </span>
              )}
              {p.subbedInAt !== undefined && (
                <span className={styles.inBadge}>
                  ↑ {formatMinute(p.subbedInAt, p.subbedInAddedTime)}&apos;
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
