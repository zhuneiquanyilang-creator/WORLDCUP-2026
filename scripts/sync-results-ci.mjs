// GitHub Actions 用: Football-Data.org v4 から W 杯全試合のスコア/ステータスを直接取得し、
// public/data/match_results.json に field-level merge で書き込む。
//
// 既存の sync-footballdata-results.mjs との違い:
//   - dev サーバープロキシではなく https://api.football-data.org/v4/... を直叩き
//   - /competitions/WC/matches を 1 リクエストで全 104 試合まとめて取得 (無料枠 10 req/分に余裕)
//   - 認証は環境変数 FOOTBALL_DATA_TOKEN
//
// 触るフィールド: status / score / penaltyScore のみ。
// 保護フィールド (絶対に上書きしない): goals / bookings / substitutions / homeFormation /
//                                       awayFormation / note / lineup
// → 手動で入れた得点者・フォーメーション・「中断中」ノート等は壊さない。
//
// 終了コード: 変更があれば 0 で書き込み、無ければ 0 で no-op、API エラーは 1。

import fs from "fs";
import path from "path";

const API_BASE = "https://api.football-data.org/v4";
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!TOKEN) {
  console.error("FOOTBALL_DATA_TOKEN env var is required");
  process.exit(1);
}

const resultsPath = path.resolve("public/data/match_results.json");
const mappingPath = path.resolve("public/data/footballdata_mapping.json");

const mapping = JSON.parse(fs.readFileSync(mappingPath, "utf8")).mapping;

function mapStatus(s) {
  if (s === "FINISHED" || s === "AWARDED") return "finished";
  if (s === "IN_PLAY" || s === "LIVE" || s === "PAUSED") return "live";
  if (s === "TIMED" || s === "SCHEDULED" || s === "POSTPONED") return "scheduled";
  return null;
}

async function fetchAllMatches() {
  const url = `${API_BASE}/competitions/WC/matches`;
  const r = await fetch(url, { headers: { "X-Auth-Token": TOKEN } });
  if (!r.ok) {
    throw new Error(`Football-Data fetch failed: ${r.status} ${r.statusText}`);
  }
  const j = await r.json();
  return j.matches ?? [];
}

async function main() {
  const fdMatches = await fetchAllMatches();
  const byId = new Map(fdMatches.map((x) => [x.id, x]));
  console.log(`Fetched ${fdMatches.length} matches from Football-Data.org`);

  let existing = {};
  if (fs.existsSync(resultsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
    } catch {}
  }

  let synced = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const [matchId, entry] of Object.entries(mapping)) {
    const fdMatchId = typeof entry === "number" ? entry : entry.fdMatchId;
    if (!fdMatchId) {
      skipped++;
      continue;
    }
    const fx = byId.get(fdMatchId);
    if (!fx) {
      skipped++;
      continue;
    }

    const update = { matchId };
    const status = mapStatus(fx.status);
    if (status) update.status = status;
    const ft = fx.score?.fullTime;
    const pk = fx.score?.penalties;
    // PK 戦進行中、FD は fullTime に PK 本数を加算した「累計」を返す
    // (例: 真の FT 1-1 + PK 2-3 → fullTime = 3-4 で返る)。
    // duration === "PENALTY_SHOOTOUT" かつ未確定 (FINISHED 以外) のとき
    // fullTime - penalties で真の FT に補正。FINISHED 後は FD が直すのでそのまま。
    const inShootout = fx.score?.duration === "PENALTY_SHOOTOUT";
    const isLive = fx.status !== "FINISHED" && fx.status !== "AWARDED";
    if (typeof ft?.home === "number" && typeof ft?.away === "number") {
      if (
        inShootout &&
        isLive &&
        typeof pk?.home === "number" &&
        typeof pk?.away === "number"
      ) {
        update.score = {
          home: ft.home - pk.home,
          away: ft.away - pk.away,
        };
      } else {
        update.score = { home: ft.home, away: ft.away };
      }
    }
    if (typeof pk?.home === "number" && typeof pk?.away === "number") {
      update.penaltyScore = { home: pk.home, away: pk.away };
    }

    const prev = existing[matchId] ?? {};
    // manualLock: true なら手動値を保護するため自動更新スキップ。
    // /edit/matches で確定したスコア (Football-Data と食い違っているケース等)
    // を Actions による上書きから守る。
    if (prev.manualLock === true) {
      unchanged++;
      continue;
    }
    const sameStatus = prev.status === update.status;
    const sameScore =
      JSON.stringify(prev.score) === JSON.stringify(update.score);
    const samePk =
      JSON.stringify(prev.penaltyScore) === JSON.stringify(update.penaltyScore);
    if (sameStatus && sameScore && samePk) {
      unchanged++;
      continue;
    }

    existing[matchId] = { ...prev, ...update };
    synced++;
    console.log(
      `  ${matchId}: ${fx.homeTeam?.tla ?? "?"} ${ft?.home ?? "-"}-${
        ft?.away ?? "-"
      } ${fx.awayTeam?.tla ?? "?"} [${fx.status}]`
    );
  }

  if (synced > 0) {
    fs.writeFileSync(
      resultsPath,
      JSON.stringify(existing, null, 2) + "\n",
      "utf8"
    );
    console.log(`\nWrote ${resultsPath}`);
  }
  console.log(`Synced ${synced}, unchanged ${unchanged}, skipped ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
