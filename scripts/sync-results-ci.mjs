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

    // SUSPENDED (悪天候・安全上等) を検知したら note="中断中" を自動セット、
    // IN_PLAY / LIVE / PAUSED (通常進行 or HT) に戻ったら note="" で明示クリア。
    if (fx.status === "SUSPENDED") {
      update.status = "live"; // 表示上はライブ扱いを維持
      update.note = "中断中";
    } else if (
      fx.status === "IN_PLAY" ||
      fx.status === "LIVE" ||
      fx.status === "PAUSED"
    ) {
      update.note = "";
    }

    const prev = existing[matchId] ?? {};

    // liveLabel: FD の状態から書き込む。公開サイトも HT/後半/延長/PK を表示できるように。
    // 「HT を一度でも観測したら以降の IN_PLAY REGULAR は "2nd half"」方式で前半/後半を追跡する。
    // - PAUSED → "Halftime"
    // - IN_PLAY + EXTRA_TIME → "Extra time"
    // - IN_PLAY + PENALTY_SHOOTOUT → "Penalty"
    // - IN_PLAY + REGULAR → HT 経験済みなら "2nd half"、未経験なら ""
    // - FINISHED → "" (試合終了で HT ラベルをクリア)
    // SCHEDULED/TIMED/POSTPONED/SUSPENDED は現状値を保持。
    // 内部ラベル遷移:
    //   1st half → Halftime → 2nd half → Pre extra time (HT) →
    //   Extra time 1st → Extra time break (HT) → Extra time 2nd →
    //   End of extra time → Penalty
    const prevPastHalftime =
      prev.liveLabel === "Halftime" ||
      prev.liveLabel === "2nd half" ||
      prev.liveLabel === "Pre extra time" ||
      prev.liveLabel === "End of 2nd half" ||
      prev.liveLabel === "Extra time" ||
      prev.liveLabel === "Extra time 1st" ||
      prev.liveLabel === "Extra time break" ||
      prev.liveLabel === "Extra time 2nd" ||
      prev.liveLabel === "End of extra time" ||
      prev.liveLabel === "Penalty";
    if (fx.status === "PAUSED") {
      // duration=EXTRA_TIME なら延長中の中断 → ET 系ラベルに強制 (prev スタック対策)
      if (fx.score?.duration === "EXTRA_TIME") {
        if (
          prev.liveLabel === "Extra time 2nd" ||
          prev.liveLabel === "End of extra time"
        ) {
          update.liveLabel = "End of extra time";
        } else {
          update.liveLabel = "Extra time break";
        }
      } else if (fx.score?.duration === "PENALTY_SHOOTOUT") {
        update.liveLabel = "End of extra time";
      } else if (
        prev.liveLabel === "2nd half" ||
        prev.liveLabel === "Pre extra time" ||
        prev.liveLabel === "End of 2nd half"
      ) {
        update.liveLabel = "Pre extra time";
      } else {
        update.liveLabel = "Halftime";
      }
    } else if (fx.status === "IN_PLAY" || fx.status === "LIVE") {
      if (fx.score?.duration === "PENALTY_SHOOTOUT") {
        update.liveLabel = "Penalty";
      } else if (fx.score?.duration === "EXTRA_TIME") {
        if (prev.liveLabel === "Extra time break" || prev.liveLabel === "Extra time 2nd") {
          update.liveLabel = "Extra time 2nd";
        } else {
          update.liveLabel = "Extra time 1st";
        }
      } else {
        update.liveLabel = prevPastHalftime ? "2nd half" : "1st half";
      }
    } else if (fx.status === "FINISHED" || fx.status === "AWARDED") {
      update.liveLabel = "";
    }
    // manualLock: true なら手動値を保護するため自動更新スキップ。
    // /edit/matches で確定したスコア (Football-Data と食い違っているケース等)
    // を Actions による上書きから守る。note (中断中 等) も同様に保護される。
    if (prev.manualLock === true) {
      unchanged++;
      continue;
    }
    const sameStatus = prev.status === update.status;
    const sameScore =
      JSON.stringify(prev.score) === JSON.stringify(update.score);
    const samePk =
      JSON.stringify(prev.penaltyScore) === JSON.stringify(update.penaltyScore);
    const sameNote = (prev.note ?? "") === (update.note ?? "");
    const sameLabel =
      !("liveLabel" in update) ||
      (prev.liveLabel ?? "") === (update.liveLabel ?? "");
    if (sameStatus && sameScore && samePk && sameNote && sameLabel) {
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
