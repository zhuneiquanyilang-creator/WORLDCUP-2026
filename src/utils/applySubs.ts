import type {
  Booking,
  FormationData,
  FormationSpot,
  Goal,
  Substitution,
} from "@/types/match";

export type SpotWithSub = FormationSpot & {
  /** 先発出場した選手が、途中交代で下がった場合の分 */
  subbedOutAt?: number;
  /** その分のアディショナルタイム (90+3 等)。表示は `formatMinute` 経由 */
  subbedOutAddedTime?: number;
  /** 受けたカード一覧 (時系列順) */
  cards?: Booking[];
  /** この選手が決めたゴール一覧 (時系列順) */
  goals?: Goal[];
  /** この選手がアシストしたゴール一覧 (時系列順) */
  assists?: Goal[];
};

export type BenchWithSub = {
  number?: number;
  name: string;
  /** ベンチスタートから途中出場した場合の分 */
  subbedInAt?: number;
  /** その分のアディショナルタイム (90+3 等)。表示は `formatMinute` 経由 */
  subbedInAddedTime?: number;
  cards?: Booking[];
  goals?: Goal[];
  assists?: Goal[];
};

export type ProcessedLineup = {
  starting: SpotWithSub[];
  bench: BenchWithSub[];
};

/**
 * フォーメーション (先発11 + ベンチ) に対して交代・カード・ゴール情報を参照し、
 * **スタメン位置はそのまま** 保ちつつ、状況だけを各選手にマークする。
 *
 * - 先発11: 配置は変えない。途中交代で下がった選手に `subbedOutAt`、カード・ゴールがあれば付与
 * - ベンチ: 並び順そのまま。途中出場した選手に `subbedInAt`、カード・ゴールがあれば付与
 *
 * 自殺点 (type === "own") はそのチームの選手 (オウンゴール者) ではなく、
 * 相手チームの得点として扱われるので、選手にはマークしない。
 */
export function applySubsToLineup(
  formation: FormationData | undefined,
  subs: Substitution[] = [],
  bookings: Booking[] = [],
  goals: Goal[] = []
): ProcessedLineup | undefined {
  if (!formation) return undefined;

  // 選手名 → カード一覧 (1選手が複数枚もらう場合あり: Y のあと Y2R など)
  const cardsByName = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (!b.playerName) continue;
    const arr = cardsByName.get(b.playerName) ?? [];
    arr.push(b);
    cardsByName.set(b.playerName, arr);
  }

  // 選手名 → ゴール一覧 (ハットトリック等で複数あり得る)。自殺点は除外。
  const goalsByName = new Map<string, Goal[]>();
  for (const g of goals) {
    if (g.type === "own") continue;
    if (!g.playerName) continue;
    const arr = goalsByName.get(g.playerName) ?? [];
    arr.push(g);
    goalsByName.set(g.playerName, arr);
  }

  // 選手名 → アシストしたゴール一覧。自殺点はアシスト無しなので除外。
  const assistsByName = new Map<string, Goal[]>();
  for (const g of goals) {
    if (g.type === "own") continue;
    if (!g.assistPlayerName) continue;
    const arr = assistsByName.get(g.assistPlayerName) ?? [];
    arr.push(g);
    assistsByName.set(g.assistPlayerName, arr);
  }

  const starting: SpotWithSub[] = formation.starting.map((s) => {
    const out = subs.find((sub) => sub.outName === s.name);
    const cards = cardsByName.get(s.name);
    const playerGoals = goalsByName.get(s.name);
    const playerAssists = assistsByName.get(s.name);
    return {
      ...s,
      ...(out
        ? {
            subbedOutAt: out.minute,
            ...(out.addedTime ? { subbedOutAddedTime: out.addedTime } : {}),
          }
        : {}),
      ...(cards ? { cards } : {}),
      ...(playerGoals ? { goals: playerGoals } : {}),
      ...(playerAssists ? { assists: playerAssists } : {}),
    };
  });

  const bench: BenchWithSub[] = (formation.bench ?? []).map((b) => {
    const inSub = subs.find((sub) => sub.inName === b.name);
    const cards = cardsByName.get(b.name);
    const playerGoals = goalsByName.get(b.name);
    const playerAssists = assistsByName.get(b.name);
    return {
      ...b,
      ...(inSub
        ? {
            subbedInAt: inSub.minute,
            ...(inSub.addedTime ? { subbedInAddedTime: inSub.addedTime } : {}),
          }
        : {}),
      ...(cards ? { cards } : {}),
      ...(playerGoals ? { goals: playerGoals } : {}),
      ...(playerAssists ? { assists: playerAssists } : {}),
    };
  });

  return { starting, bench };
}

/** 一連の bookings から「黄」「赤」のフラグを返す */
export function summarizeCards(cards: Booking[] | undefined): {
  yellow: boolean;
  red: boolean;
} {
  if (!cards || cards.length === 0) return { yellow: false, red: false };
  let yellow = false;
  let red = false;
  for (const c of cards) {
    if (c.type === "Y") yellow = true;
    if (c.type === "Y2R" || c.type === "YR") {
      yellow = true;
      red = true;
    }
    if (c.type === "R") red = true;
  }
  return { yellow, red };
}
