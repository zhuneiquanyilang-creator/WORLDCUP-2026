import type { FormationData, FormationSpot } from "@/types/match";

export type RawPlayer = {
  number?: number;
  name: string;
  /** Sofascore 由来の大分類: "G" / "D" / "M" / "F"。生成のヒント用 */
  category?: string;
};

/**
 * フォーメーション文字列 (例: "4-3-3", "4-2-3-1", "3-5-2") と
 * 先発11名 (GK→守備→攻撃 の順を想定) から SVG ピッチ用の x/y 座標を生成する。
 *
 * 想定する Sofascore の配列順:
 *   players[0] = GK
 *   players[1..count[0]] = 第1層 (DF)
 *   players[count[0]+1..] = 以降の層 (中盤→前線へ)
 *
 * x: 0=自陣GK / 100=相手ゴール方向
 * y: 0=左サイド / 100=右サイド
 */
export function generateFormation(
  formationStr: string,
  players: RawPlayer[],
  bench?: { number?: number; name: string }[]
): FormationData {
  const parts = formationStr
    .split("-")
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  const spots: FormationSpot[] = [];

  // GK
  if (players[0]) {
    spots.push({
      x: 8,
      y: 50,
      number: players[0].number,
      name: players[0].name,
      role: "GK",
    });
  }

  // 各層を 28%〜80% の範囲で等間隔に並べる。
  // X_MIN=22 だと GK (x=8) と最終ラインのラベルが横方向に被ることがあるので、
  // 最終ラインを少しだけ内側 (= ホームなら右、アウェイなら左) にずらす。
  const X_MIN = 28;
  const X_MAX = 80;
  const layerCount = parts.length;
  let cursor = 1;

  parts.forEach((count, layerIdx) => {
    const x =
      layerCount === 1
        ? (X_MIN + X_MAX) / 2
        : X_MIN + (layerIdx / (layerCount - 1)) * (X_MAX - X_MIN);

    for (let i = 0; i < count; i++) {
      const p = players[cursor];
      cursor++;
      if (!p) continue;
      const y = ((i + 0.5) / count) * 100;
      spots.push({
        x,
        y,
        number: p.number,
        name: p.name,
        role: layerRoleHint(layerIdx, layerCount, p.category),
      });
    }
  });

  return {
    shape: formationStr,
    starting: spots,
    bench: bench && bench.length > 0 ? bench : undefined,
  };
}

function layerRoleHint(
  layerIdx: number,
  totalLayers: number,
  category?: string
): string | undefined {
  if (category === "G") return "GK";
  if (totalLayers <= 1) return category;
  if (layerIdx === 0) return "DF";
  if (layerIdx === totalLayers - 1) return "FW";
  return "MF";
}

/** 表示用に「層と層の x 間隔が狭すぎて選手名が重なる」フォーメーションを
 *  描画前に調整する。前後の層が**両方とも中央 (y=50 付近) に選手を抱えている**
 *  ときだけ、`MIN_LAYER_SPREAD` 単位の間隔を確保するように後方の層を前進させる。
 *
 *  例: 4-2-3-1 (層 x = 28 / 45.33 / 62.67 / 80)
 *    - DF: y=12.5/37.5/62.5/87.5 (中央なし)
 *    - DM: y=25/75 (中央なし)
 *    - AM: y=16.67/50/83.33 (中央あり)
 *    - ST: y=50 (中央あり)
 *    → AM と ST が「両方中央あり」かつ間隔 17.33 で名前が重なる → ST を 80→83.67 に前進
 *
 *  4-3-3 のように両層中央ありでも元の間隔が十分 (26) ある場合は何もしない。
 *  GK (role: "GK") は層調整の対象外。
 *  保存データ (`match_results.json`) は変更しない、レンダー時に毎回適用。 */
export function spreadFormationLayers(
  formation: FormationData
): FormationData {
  if (!formation.starting || formation.starting.length === 0) return formation;
  const fieldSpots = formation.starting.filter((s) => s.role !== "GK");
  if (fieldSpots.length === 0) return formation;

  const distinctX = [...new Set(fieldSpots.map((s) => s.x))].sort(
    (a, b) => a - b
  );
  if (distinctX.length < 2) return formation;

  // 各層が中央 (y∈[40,60]) に選手を持つかを記録
  const hasCenter = new Map<number, boolean>();
  for (const x of distinctX) {
    const inLayer = fieldSpots.filter((s) => s.x === x);
    hasCenter.set(x, inLayer.some((s) => s.y >= 40 && s.y <= 60));
  }

  const MIN_LAYER_SPREAD = 25;
  const MAX_X = 95;
  const adjusted = new Map<number, number>();
  for (let i = 0; i < distinctX.length; i++) {
    const original = distinctX[i];
    if (i === 0) {
      adjusted.set(original, original);
      continue;
    }
    const prevOriginal = distinctX[i - 1];
    const prevAdjusted = adjusted.get(prevOriginal)!;
    const bothCenter = hasCenter.get(prevOriginal) && hasCenter.get(original);
    if (!bothCenter) {
      adjusted.set(original, original);
      continue;
    }
    const minHere = prevAdjusted + MIN_LAYER_SPREAD;
    const x = Math.min(MAX_X, Math.max(original, minHere));
    adjusted.set(original, x);
  }

  let changed = false;
  for (const [k, v] of adjusted) {
    if (k !== v) {
      changed = true;
      break;
    }
  }
  if (!changed) return formation;

  return {
    ...formation,
    starting: formation.starting.map((s) =>
      s.role === "GK" ? s : { ...s, x: adjusted.get(s.x) ?? s.x }
    ),
  };
}
