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
 *  GK ↔ DF の衝突も同じ枠で扱う: GK は常に (x=8, y=50) のため、奇数バック
 *  (3-X-X-X / 5-X-X) のセンターバック (y=50) と名前が被る。GK を仮想的に
 *  最前列の「中央あり層」とみなして DF を前進させる (GK 自体は動かさない)。
 *
 *  4-3-3 のように両層中央ありでも元の間隔が十分 (26) ある場合は何もしない。
 *  保存データ (`match_results.json`) は変更しない、レンダー時に毎回適用。 */
export function spreadFormationLayers(
  formation: FormationData
): FormationData {
  if (!formation.starting || formation.starting.length === 0) return formation;
  const fieldSpots = formation.starting.filter((s) => s.role !== "GK");
  if (fieldSpots.length === 0) return formation;
  const gk = formation.starting.find((s) => s.role === "GK");
  // GK が中央 (y∈[40,60]) なら最前面 (x=GK.x) として layer 列に含める。
  // GK は実際には動かさない (map step で除外) — DF を前進させるためのアンカー。
  const gkAsLayer = gk && gk.y >= 40 && gk.y <= 60 ? gk : null;

  const fieldDistinctX = [...new Set(fieldSpots.map((s) => s.x))].sort(
    (a, b) => a - b
  );
  const distinctX = gkAsLayer
    ? [gkAsLayer.x, ...fieldDistinctX.filter((x) => x !== gkAsLayer.x)]
    : fieldDistinctX;
  if (distinctX.length < 2) return formation;

  // 各層の y 値リスト (GK 仮想層は y=50 1点とみなす)
  const ysFor = (x: number): number[] => {
    if (gkAsLayer && x === gkAsLayer.x) return [50];
    return fieldSpots.filter((s) => s.x === x).map((s) => s.y);
  };
  const hasCenterAt = (x: number): boolean =>
    ysFor(x).some((y) => y >= 40 && y <= 60);
  // 「両層の中で y 値が近接 (< Y_PROX) するペアがあるか」を判定。
  // 3-4-1-2 などで DF (y=16.67) と MF1 (y=12.5) のように縦位置がほぼ同じ場合、
  // 名前ラベルが長いと x 間隔 17 では衝突するのでこれを検出して spread する。
  const Y_PROX = 15;
  const yProximity = (xa: number, xb: number): boolean => {
    const ya = ysFor(xa);
    const yb = ysFor(xb);
    return ya.some((va) => yb.some((vb) => Math.abs(va - vb) < Y_PROX));
  };

  // 3-field-layer (4-3-3 / 4-4-2 等) は generateFormation の X_MIN=28 / X_MAX=80
  // で自然に 26 単位間隔があり名前は被らない。4-field-layer (3-4-1-2 / 4-2-3-1
  // 等) は 17 単位しかないので、縦位置が近い隣接層に WEAK_SPREAD を強制する。
  const isPacked = fieldDistinctX.length >= 4;

  const STRONG_SPREAD = 30; // bothCenter 用 (GK ↔ 奇数バックのセンターバック等)
                            // 30 にしてあるのは: GK が長い名前 (例 ノードフェルト) の場合
                            // 名前ラベルを内側にずらす (CombinedFormation の labelDX) と
                            // DF センター (例 ヒエン) の名前と被ってしまうため、
                            // DF 側もしっかり前に押し出して間隔を確保する。
  const WEAK_SPREAD = 20;   // 4-packed で y 近接時の最低横間隔
  const SAFE_GAP = 12;      // 強制 spread が無くても前層との余白を確保
  const MAX_X = 95;
  // 第 1 段階: spread 量だけ守って累積。MAX_X 越えは無視 (後で比例縮小する)。
  const adjusted = new Map<number, number>();
  for (let i = 0; i < distinctX.length; i++) {
    const original = distinctX[i];
    if (i === 0) {
      adjusted.set(original, original);
      continue;
    }
    const prevOriginal = distinctX[i - 1];
    const prevAdjusted = adjusted.get(prevOriginal)!;
    let minSpread = 0;
    if (hasCenterAt(prevOriginal) && hasCenterAt(original)) {
      minSpread = STRONG_SPREAD;
    } else if (isPacked && yProximity(prevOriginal, original)) {
      minSpread = WEAK_SPREAD;
    }
    let target = original;
    if (minSpread > 0) {
      target = Math.max(original, prevAdjusted + minSpread);
    } else if (prevAdjusted + SAFE_GAP > original) {
      // 前層が押し出された結果 original に近づきすぎた → 最低限離す
      target = prevAdjusted + SAFE_GAP;
    }
    adjusted.set(original, target);
  }

  // 第 2 段階: 累積結果が MAX_X を超えていれば、全層を比例縮小して収める。
  // (個別 cap だと最後の層だけが MAX_X に張り付いて手前の層と詰まる
  //  ── 例えば 3-1-4-2 で FW が x=108 → 95 にクランプされ MF と 7 単位差
  //  まで合体してしまう ── のを防ぐ。)
  const firstX = distinctX[0];
  const lastX = distinctX[distinctX.length - 1];
  const lastAdjusted = adjusted.get(lastX)!;
  if (lastAdjusted > MAX_X) {
    const range = lastAdjusted - firstX;
    const newRange = MAX_X - firstX;
    const scale = newRange / range;
    for (const [k, v] of adjusted) {
      adjusted.set(k, firstX + (v - firstX) * scale);
    }
  }

  // 「全体的に左に寄せる」最終調整: GK を含む全選手の x を一律
  // SHIFT_LEFT 単位ぶん自陣ゴール側に下げる。クロアチアのように
  // 名前が長く中央ラインに圧迫感が出るフォーメーションを救うため。
  // 層間距離は変わらないので overlap 自体は spread 側で別途解決する。
  const SHIFT_LEFT = 5;

  let changed = SHIFT_LEFT > 0;
  if (!changed) {
    for (const [k, v] of adjusted) {
      if (k !== v) {
        changed = true;
        break;
      }
    }
  }
  if (!changed) return formation;

  return {
    ...formation,
    starting: formation.starting.map((s) => {
      const baseX = s.role === "GK" ? s.x : (adjusted.get(s.x) ?? s.x);
      return { ...s, x: Math.max(0, baseX - SHIFT_LEFT) };
    }),
  };
}
