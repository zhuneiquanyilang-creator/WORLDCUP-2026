/**
 * Sofascore マッピング生成スクリプト（PCで実行 / dev サーバー起動中に限る）
 *
 * Sofascore の大会日程（FIFA World Cup 2026）を取得し、ローカル試合ID
 * (matches.json の m001..m104) と Sofascore event ID の対応表を作って
 * public/data/sofascore_mapping.json に書き出す。
 *
 * 使い方:
 *   1. dev サーバーを起動しておく（npm run dev）
 *   2. node scripts/build-mapping.mjs
 *
 * 仕組み:
 *   - 取得は dev サーバーのプロキシ (http://localhost:5173/sofascore-api) 経由。
 *     Node から api.sofascore.com を直接叩くと 403 になるため、プロキシを通す。
 *   - グループ戦: 出場2チームの組で matches.json と照合（一意に決まる）。
 *   - 決勝トーナメント: 進出条件ラベル（「73試合勝者」「A組2位」等）で照合。
 *     ※ 日程順では FIFA 試合番号順と一致しないため、ラベル照合が必須。
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROXY = "http://localhost:5173/sofascore-api";
const TOURNAMENT = 16;
const SEASON = 58210;

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "public", "data");

const KO_STAGES = ["round32", "round16", "quarter", "semi", "third", "final"];
// matches.json の stage → Sofascore の roundInfo.round（整合性チェック用）
const SOFA_ROUND = { round32: 6, round16: 5, quarter: 27, semi: 28, third: 50, final: 29 };

const isWcId = (id) => /^m\d+$/.test(id);
const matchNum = (id) => parseInt(id.slice(1), 10);

async function fetchAllEvents() {
  const events = [];
  for (let p = 0; p <= 8; p++) {
    const res = await fetch(
      `${PROXY}/unique-tournament/${TOURNAMENT}/season/${SEASON}/events/next/${p}`
    );
    if (!res.ok) {
      throw new Error(
        `Sofascore ページ ${p}: HTTP ${res.status}（dev サーバーは起動していますか？）`
      );
    }
    const json = await res.json();
    events.push(...(json.events ?? []));
    if (!json.hasNextPage) break;
  }
  return events;
}

// Sofascore のチーム → matches.json の teamId（isoCode で突合、英国構成国は別名）
function teamResolver(teams) {
  const byIso = new Map(teams.map((t) => [t.isoCode.toLowerCase(), t.id]));
  const alias = { en: "ENG", sx: "SCO" };
  return (team) => {
    const a2 = team?.country?.alpha2?.toLowerCase();
    if (!a2) return undefined;
    return alias[a2] ?? byIso.get(a2);
  };
}

// Sofascore のプレースホルダ名 → 正規化 feeder 文字列
//   "W73"→"W73"  "L101"→"L101"  "2A"→"P2_A"  "G1"→"P1_G"
//   "3A/3B/3C/3D/3F"→"P3_ABCDF"
function normSofaFeeder(name) {
  if (!name) return null;
  let m;
  if ((m = /^W(\d+)$/.exec(name))) return `W${+m[1]}`;
  if ((m = /^L(\d+)$/.exec(name))) return `L${+m[1]}`;
  if ((m = /^([123])([A-L])$/.exec(name))) return `P${m[1]}_${m[2]}`;
  if ((m = /^([GH])([12])$/.exec(name))) return `P${m[2]}_${m[1]}`;
  if (/^[123][A-L](\/[123][A-L])+$/.test(name)) {
    const parts = name.split("/");
    const place = parts[0][0];
    const groups = parts.map((p) => p[1]).sort().join("");
    return `P${place}_${groups}`;
  }
  return null;
}

// matches.json のラベル → 正規化 feeder 文字列
//   "73試合勝者"→"W73"  "101試合敗者"→"L101"  "A組2位"→"P2_A"
//   "A/B/C/D/F組3位"→"P3_ABCDF"
function normJsonFeeder(label) {
  if (!label) return null;
  let m;
  if ((m = /^(\d+)試合勝者$/.exec(label))) return `W${+m[1]}`;
  if ((m = /^(\d+)試合敗者$/.exec(label))) return `L${+m[1]}`;
  if ((m = /^([A-L](?:\/[A-L])*)組([123])位$/.exec(label))) {
    const groups = m[1].split("/").sort().join("");
    return `P${m[2]}_${groups}`;
  }
  return null;
}

const feederKey = (a, b) => [a, b].sort().join(" + ");

async function main() {
  const matches = JSON.parse(await readFile(join(DATA, "matches.json"), "utf8"));
  const teams = JSON.parse(await readFile(join(DATA, "teams.json"), "utf8"));
  const old = JSON.parse(await readFile(join(DATA, "sofascore_mapping.json"), "utf8"));

  const events = await fetchAllEvents();
  console.log(`Sofascore events fetched: ${events.length}\n`);

  const resolve = teamResolver(teams);
  const mapping = {};
  let problems = 0;

  // --- グループ戦: 2チームの組で照合 ---
  const pairKey = (a, b) => [a, b].sort().join("|");
  const groupMatchByPair = new Map();
  for (const m of matches) {
    if (m.stage === "group") groupMatchByPair.set(pairKey(m.homeTeamId, m.awayTeamId), m);
  }
  for (const e of events) {
    const grp = e.tournament?.groupSign;
    if (!grp) continue;
    const h = resolve(e.homeTeam);
    const a = resolve(e.awayTeam);
    if (!h || !a) {
      console.log(`  [GROUP] チーム解決失敗: event ${e.id} ${e.homeTeam?.name}/${e.awayTeam?.name}`);
      problems++;
      continue;
    }
    const m = groupMatchByPair.get(pairKey(h, a));
    if (!m) {
      console.log(`  [GROUP] 対応試合なし: event ${e.id} ${h}/${a} (grp ${grp})`);
      problems++;
      continue;
    }
    if (m.groupId !== grp) {
      console.log(`  [GROUP] グループ不一致: ${m.id} grp ${m.groupId} != event grp ${grp}`);
      problems++;
    }
    mapping[m.id] = e.id;
  }

  // --- 決勝トーナメント: feeder ラベルで照合 ---
  const sofaByFeeder = new Map();
  for (const e of events) {
    if (e.tournament?.groupSign) continue;
    const f1 = normSofaFeeder(e.homeTeam?.name);
    const f2 = normSofaFeeder(e.awayTeam?.name);
    if (!f1 || !f2) {
      console.log(`  [KO] Sofascore feeder 解析失敗: event ${e.id} ${e.homeTeam?.name}/${e.awayTeam?.name}`);
      problems++;
      continue;
    }
    sofaByFeeder.set(feederKey(f1, f2), e);
  }

  console.log("--- 決勝トーナメント（照合結果を確認してください）---");
  const koMatches = matches
    .filter((m) => KO_STAGES.includes(m.stage))
    .sort((a, b) => matchNum(a.id) - matchNum(b.id));
  for (const m of koMatches) {
    const f1 = normJsonFeeder(m.homeTeamLabel);
    const f2 = normJsonFeeder(m.awayTeamLabel);
    if (!f1 || !f2) {
      console.log(`  [KO] ${m.id} ラベル解析失敗: ${m.homeTeamLabel}/${m.awayTeamLabel}`);
      problems++;
      continue;
    }
    const e = sofaByFeeder.get(feederKey(f1, f2));
    if (!e) {
      console.log(`  [KO] ${m.id} 対応イベントなし: ${f1} + ${f2}`);
      problems++;
      continue;
    }
    if (e.roundInfo?.round !== SOFA_ROUND[m.stage]) {
      console.log(`  [KO] ${m.id} ラウンド不一致: stage ${m.stage} / event round ${e.roundInfo?.round}`);
      problems++;
    }
    mapping[m.id] = e.id;
    console.log(`  ${m.id} <- ${e.id}  [${m.stage}]  ${f1} + ${f2}`);
  }

  // --- 非W杯エントリ (将来的なテスト用追加が出てきたら) は旧マッピングから引き継ぐ ---
  for (const [k, v] of Object.entries(old.mapping ?? {})) {
    if (!isWcId(k) && !(k in mapping)) mapping[k] = v;
  }

  // --- サマリ ---
  const wcIds = matches.filter((m) => isWcId(m.id)).map((m) => m.id);
  const missing = wcIds.filter((id) => !(id in mapping));
  console.log(`\n照合の問題: ${problems} 件`);
  console.log(`マッピング済み W杯試合: ${wcIds.length - missing.length}/${wcIds.length}`);
  if (missing.length) console.log(`未マッピング: ${missing.join(", ")}`);

  // --- 書き出し（非 W 杯エントリを先頭、その後 m### を番号順）---
  const ord = (k) => (isWcId(k) ? matchNum(k) : -1);
  const sorted = Object.fromEntries(
    Object.entries(mapping).sort((a, b) => ord(a[0]) - ord(b[0]))
  );
  const out = {
    _comment:
      "ローカル試合ID (matches.json) → Sofascore event ID マッピング。" +
      "scripts/build-mapping.mjs で生成。",
    _tournamentId: TOURNAMENT,
    _seasonId: SEASON,
    _fetchedAt: new Date().toISOString().slice(0, 10),
    mapping: sorted,
  };
  await writeFile(
    join(DATA, "sofascore_mapping.json"),
    JSON.stringify(out, null, 2) + "\n",
    "utf8"
  );
  console.log("\nsofascore_mapping.json を書き出しました。");
}

main().catch((e) => {
  console.error("エラー:", e.message);
  process.exit(1);
});
