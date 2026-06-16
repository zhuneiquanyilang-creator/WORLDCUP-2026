import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

const RESULTS_PATH = path.resolve(__dirname, "public/data/match_results.json");
const RESULTS_REL = "public/data/match_results.json";

// GitHub Desktop バンドル版 git のパス。PATH に git が無い環境向けフォールバック。
const GIT_BIN_CANDIDATES = [
  "git",
  "C:\\Program Files\\Git\\cmd\\git.exe",
  `${process.env.LOCALAPPDATA ?? ""}\\GitHubDesktop\\app-3.5.8\\resources\\app\\git\\cmd\\git.exe`,
];

let cachedGitBin: string | null = null;
async function findGit(): Promise<string | null> {
  if (cachedGitBin) return cachedGitBin;
  for (const candidate of GIT_BIN_CANDIDATES) {
    if (!candidate) continue;
    try {
      // 存在チェック (絶対パスなら fs.access、それ以外は spawn でテスト)
      if (candidate.includes("\\") || candidate.includes("/")) {
        await fs.access(candidate);
        cachedGitBin = candidate;
        return candidate;
      } else {
        await new Promise<void>((resolve, reject) => {
          const p = spawn(candidate, ["--version"]);
          p.on("error", reject);
          p.on("close", (code) =>
            code === 0 ? resolve() : reject(new Error(`exit ${code}`))
          );
        });
        cachedGitBin = candidate;
        return candidate;
      }
    } catch {
      // 次の候補
    }
  }
  return null;
}

function runGit(gitBin: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const p = spawn(gitBin, args, { cwd });
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", (e) =>
      resolve({ code: -1, stdout, stderr: stderr + String(e) })
    );
    p.on("close", (code) =>
      resolve({ code: code ?? -1, stdout, stderr })
    );
  });
}

const AUTO_PUSH_DEBOUNCE_MS = 30_000;
let pushTimer: NodeJS.Timeout | null = null;
let isPushing = false;
async function schedulePush() {
  // 環境変数で opt-out 可能
  if (process.env.AUTO_PUSH_RESULTS === "0") return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    pushTimer = null;
    if (isPushing) {
      // 既に走っていれば後でリトライ
      schedulePush();
      return;
    }
    isPushing = true;
    try {
      const gitBin = await findGit();
      if (!gitBin) {
        console.warn("[auto-push] git not found — skipping push");
        return;
      }
      const cwd = __dirname;
      // 0) JSON 健全性チェック — 壊れたファイルを GitHub Pages に送らない。
      //    過去に末尾に余分な `}` が混入した事故があり、公開サイトで全試合
      //    のスコアが消える障害になった。手動編集経路でも auto-push 経路でも
      //    最終的にここを通るので、ここで弾けば公開サイトには絶対に行かない。
      try {
        const raw = await fs.readFile(RESULTS_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          console.warn(
            "[auto-push] match_results.json is not a JSON object — skipping push"
          );
          return;
        }
      } catch (e) {
        console.warn(
          `[auto-push] match_results.json failed JSON.parse — skipping push: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
        return;
      }
      // 1) 対象ファイルだけステージ (他の変更は巻き込まない)
      const add = await runGit(gitBin, ["add", "--", RESULTS_REL], cwd);
      if (add.code !== 0) {
        console.warn(`[auto-push] git add failed: ${add.stderr.trim()}`);
        return;
      }
      // 2) ステージに差分があるかチェック (--cached --exit-code: 差分あり=1, なし=0)
      const diff = await runGit(
        gitBin,
        ["diff", "--cached", "--quiet", "--", RESULTS_REL],
        cwd
      );
      if (diff.code === 0) {
        // 差分なし — push する必要なし
        return;
      }
      // 3) ステージしたファイルだけ commit
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const msg = `auto: update match_results.json (${ts})`;
      const commit = await runGit(
        gitBin,
        ["commit", "-m", msg, "--", RESULTS_REL],
        cwd
      );
      if (commit.code !== 0) {
        console.warn(`[auto-push] git commit failed: ${commit.stderr.trim()}`);
        return;
      }
      // 4) push
      const push = await runGit(gitBin, ["push", "origin", "HEAD"], cwd);
      if (push.code !== 0) {
        console.warn(`[auto-push] git push failed: ${push.stderr.trim()}`);
        return;
      }
      console.log(`[auto-push] match_results.json pushed (${ts})`);
    } finally {
      isPushing = false;
    }
  }, AUTO_PUSH_DEBOUNCE_MS);
}

/**
 * dev サーバー専用の書き込みエンドポイント。
 *   POST /__dev/match-results  body: {<matchId>: <LiveUpdate>, ...}
 *
 * ブラウザの localStorage で確定した結果を `public/data/match_results.json`
 * に書き戻すために使う。本番 (vite build した SPA) では存在しないので
 * クライアント側は失敗を許容してフォールバックする。
 *
 * 書き込みは "field-level merge" モード:
 *   1) 既存ファイルの試合と POST された試合の **両方** を残す
 *   2) 同じ試合 ID が両方にある場合は、フィールド単位で incoming が existing
 *      を上書き (= incoming に無いフィールド bookings / substitutions / etc.
 *      は existing から保持)
 *   これにより /edit/matches の限定的な save (status/score のみ等) が、
 *   既存の bookings/subs/formation 等を巻き込み消去しない。
 *
 * 書き込みが完了したら、30 秒デバウンスで自動的に
 *   git add public/data/match_results.json
 *   git commit -m "auto: update match_results.json (timestamp)"
 *   git push origin HEAD
 * を実行する (=「完全自動 publish」)。`AUTO_PUSH_RESULTS=0` で無効化可。
 * 他のファイルの変更は push 対象に含めない (commit に明示的に -- パスを渡す)。
 */
function matchResultsWriter(): Plugin {
  return {
    name: "match-results-writer",
    apply: "serve", // dev server only
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== "/__dev/match-results") return next();
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("method not allowed");
          return;
        }
        try {
          let body = "";
          for await (const chunk of req) body += chunk;
          const incoming = JSON.parse(body);
          if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
            res.statusCode = 400;
            res.end("body must be an object");
            return;
          }
          let existing: Record<string, unknown> = {};
          try {
            const raw = await fs.readFile(RESULTS_PATH, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
              existing = parsed as Record<string, unknown>;
          } catch {
            // ファイルが無いか壊れているなら空から始める
          }
          // field-level merge per match (cf. ヘッダコメント)
          const merged: Record<string, unknown> = { ...existing };
          for (const [id, val] of Object.entries(incoming)) {
            if (val && typeof val === "object" && !Array.isArray(val)) {
              const existingMatch = merged[id];
              if (
                existingMatch &&
                typeof existingMatch === "object" &&
                !Array.isArray(existingMatch)
              ) {
                merged[id] = {
                  ...(existingMatch as Record<string, unknown>),
                  ...(val as Record<string, unknown>),
                };
              } else {
                merged[id] = val;
              }
            } else {
              merged[id] = val;
            }
          }
          await fs.writeFile(
            RESULTS_PATH,
            JSON.stringify(merged, null, 2) + "\n",
            "utf8"
          );
          res.setHeader("Content-Type", "application/json");
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, count: Object.keys(merged).length }));

          // 書き込み成功後に push をスケジュール (await しない)
          schedulePush();
        } catch (e) {
          res.statusCode = 500;
          res.end(`error: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    },
  };
}

/**
 * dev サーバー起動時のキャッチアップ同期。
 *
 * サーバーが落ちている間に終了した試合は polling では拾えないので、起動直後に
 * 1 回だけ Football-Data.org を叩いて `match_results.json` を更新する。
 *
 * 対象: KO 時刻が現在より 30 分以上前で、かつ `match_results.json` の status が
 * "finished" になっていない試合。
 *
 * 制約:
 * - Football-Data は無料枠 10 req/分なので 7 秒スロットルを挟む
 * - 同じチーム/日付の試合は 1 回しか叩かない
 * - キーが未設定なら警告だけ出してスキップ
 * - `STARTUP_CATCHUP_RESULTS=0` で無効化
 * - 書き込みが発生したら schedulePush() で自動 commit/push をスケジュール
 *   (= matchResultsWriter と同じ仕組み)
 */
function startupCatchup(apiKey: string): Plugin {
  return {
    name: "startup-catchup",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        if (process.env.STARTUP_CATCHUP_RESULTS === "0") return;
        // サーバー起動と並走させる (await しない)
        runStartupCatchup(apiKey).catch((e) =>
          console.warn(`[startup-catchup] failed: ${e?.message ?? e}`)
        );
      });
    },
  };
}

function mapFdStatus(s: string): "scheduled" | "live" | "finished" | null {
  if (s === "FINISHED" || s === "AWARDED") return "finished";
  if (s === "IN_PLAY" || s === "LIVE" || s === "PAUSED") return "live";
  if (s === "TIMED" || s === "SCHEDULED" || s === "POSTPONED") return "scheduled";
  return null;
}

function ymd(d: string | Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

const FD_THROTTLE_MS = 7000;

async function runStartupCatchup(apiKey: string) {
  if (!apiKey) {
    console.warn(
      "[startup-catchup] VITE_FOOTBALL_DATA_KEY 未設定 — スキップ"
    );
    return;
  }

  const matchesPath = path.resolve(__dirname, "public/data/matches.json");
  const mappingPath = path.resolve(
    __dirname,
    "public/data/footballdata_mapping.json"
  );

  let matches: Array<{ id: string; date: string }>;
  let mapping: Record<string, number | { fdMatchId: number; fdHomeTeamId?: number; fdAwayTeamId?: number }>;
  try {
    matches = JSON.parse(await fs.readFile(matchesPath, "utf8"));
    mapping = JSON.parse(await fs.readFile(mappingPath, "utf8")).mapping;
  } catch (e) {
    console.warn(
      `[startup-catchup] matches.json/mapping.json 読み込み失敗: ${e instanceof Error ? e.message : String(e)}`
    );
    return;
  }

  let results: Record<string, Record<string, unknown>> = {};
  try {
    const raw = await fs.readFile(RESULTS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      results = parsed;
  } catch {
    // 無ければ空
  }

  const now = Date.now();
  // 終わってるはずなのにファイル側で finished になっていない試合を抽出。
  // 30 分の余白は: KO 時刻を過ぎただけでまだ前半中の試合を拾わないため。
  const candidates = matches.filter((m) => {
    const ts = new Date(m.date).getTime();
    if (!Number.isFinite(ts)) return false;
    if (ts > now - 30 * 60_000) return false;
    return results[m.id]?.status !== "finished";
  });

  if (candidates.length === 0) {
    console.log("[startup-catchup] キャッチアップ対象なし");
    return;
  }
  console.log(
    `[startup-catchup] ${candidates.length} 試合をチェック中…`
  );

  let lastReqTs = 0;
  async function fetchTeamMatches(fdTeamId: number, date: string) {
    const wait = lastReqTs + FD_THROTTLE_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastReqTs = Date.now();
    const d = new Date(date);
    const before = ymd(new Date(d.getTime() - 86400_000));
    const after = ymd(new Date(d.getTime() + 86400_000));
    const url = `https://api.football-data.org/v4/teams/${fdTeamId}/matches?competitions=2000&dateFrom=${before}&dateTo=${after}`;
    let r = await fetch(url, { headers: { "X-Auth-Token": apiKey } });
    if (r.status === 429) {
      console.warn("[startup-catchup] 429 — 60 秒待機してリトライ");
      await new Promise((res) => setTimeout(res, 60_000));
      lastReqTs = Date.now();
      r = await fetch(url, { headers: { "X-Auth-Token": apiKey } });
    }
    if (!r.ok) {
      console.warn(`[startup-catchup] fetch ${r.status}: ${url}`);
      return [] as Array<Record<string, any>>;
    }
    const j = await r.json();
    return (j.matches ?? []) as Array<Record<string, any>>;
  }

  const teamCache = new Map<string, Array<Record<string, any>>>();
  let synced = 0;

  for (const m of candidates) {
    const entry = mapping[m.id];
    if (!entry) continue;
    const fdTeamId =
      typeof entry === "number"
        ? null
        : entry.fdHomeTeamId ?? entry.fdAwayTeamId ?? null;
    const fdMatchId = typeof entry === "number" ? entry : entry.fdMatchId;
    if (!fdTeamId) continue;

    const cacheKey = `${fdTeamId}:${ymd(m.date)}`;
    let teamMatches = teamCache.get(cacheKey);
    if (!teamMatches) {
      teamMatches = await fetchTeamMatches(fdTeamId, m.date);
      teamCache.set(cacheKey, teamMatches);
    }

    const fx =
      teamMatches.find((x) => x.id === fdMatchId) ??
      teamMatches.find(
        (x) =>
          Math.abs(
            new Date(x.utcDate).getTime() - new Date(m.date).getTime()
          ) <
          12 * 3600_000
      );
    if (!fx) continue;

    const update: Record<string, unknown> = { matchId: m.id };
    const status = mapFdStatus(fx.status);
    if (status) update.status = status;
    const ft = fx.score?.fullTime;
    if (typeof ft?.home === "number" && typeof ft?.away === "number") {
      update.score = { home: ft.home, away: ft.away };
    }
    const pk = fx.score?.penalties;
    if (typeof pk?.home === "number" && typeof pk?.away === "number") {
      update.penaltyScore = { home: pk.home, away: pk.away };
    }

    const prev = results[m.id] ?? {};
    const sameStatus = prev.status === update.status;
    const sameScore =
      JSON.stringify(prev.score) === JSON.stringify(update.score);
    const samePk =
      JSON.stringify(prev.penaltyScore) === JSON.stringify(update.penaltyScore);
    if (sameStatus && sameScore && samePk) continue;

    results[m.id] = { ...prev, ...update };
    synced++;
    console.log(
      `[startup-catchup] ${m.id}: ${fx.homeTeam?.tla} ${ft?.home}-${ft?.away} ${fx.awayTeam?.tla} [${fx.status}]`
    );
  }

  if (synced === 0) {
    console.log("[startup-catchup] 差分なし (全試合最新)");
    return;
  }

  await fs.writeFile(
    RESULTS_PATH,
    JSON.stringify(results, null, 2) + "\n",
    "utf8"
  );
  console.log(
    `[startup-catchup] ${synced} 試合を match_results.json に書き込み`
  );
  schedulePush();
}

export default defineConfig(({ mode }) => {
  // .env / .env.local / .env.[mode] を読み込む。`VITE_` プレフィクスがあるものだけが
  // クライアント (import.meta.env) に露出する。`.env.local` は gitignore (*.local) で除外済み。
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      matchResultsWriter(),
      startupCatchup(env.VITE_FOOTBALL_DATA_KEY ?? ""),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
      open: true,
      // LAN (同じ Wi-Fi 内) の他デバイスからアクセスできるよう 0.0.0.0 で待受
      host: true,
      proxy: {
        // Sofascore JSON API: ブラウザから直接叩くと CORS で弾かれるため
        // dev サーバー経由でリバースプロキシする。
        // 例: /sofascore-api/event/15186710
        //  → https://api.sofascore.com/api/v1/event/15186710
        // 注: 2026 年 6 月時点で Cloudflare が API を 403 で弾く状況。残しているが
        //     動作しないので、ライブ取得は基本的に api-football にフォールバックする。
        "/sofascore-api": {
          target: "https://api.sofascore.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/sofascore-api/, "/api/v1"),
          headers: {
            // 一部のプロキシ越しでブロックされないよう、ブラウザ風 UA を付与
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            Referer: "https://www.sofascore.com/",
          },
        },
        // API-Football (api-sports.io) のプロキシ。
        // 例: /api-football/fixtures?live=all
        //  → https://v3.football.api-sports.io/fixtures?live=all
        //
        // 認証は API キーを `x-apisports-key` ヘッダで送る。
        // dev サーバーがブラウザの代わりにヘッダを差し込む (= キーが
        // ブラウザに渡らない/devtools に露出しない)。
        // 無料枠は 100 req/日、10 req/分。
        "/api-football": {
          target: "https://v3.football.api-sports.io",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-football/, ""),
          headers: {
            "x-apisports-key": env.VITE_API_FOOTBALL_KEY ?? "",
          },
        },
        // Football-Data.org v4 プロキシ。
        // 例: /football-data-api/competitions/WC/matches
        //  → https://api.football-data.org/v4/competitions/WC/matches
        // 無料枠 10 req/分 (Tier One プラン)。スコア・順位・得点者ランキング取得可。
        // フォーメーション・イベント時系列は無料枠では取得できない。
        "/football-data-api": {
          target: "https://api.football-data.org",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/football-data-api/, "/v4"),
          headers: {
            "X-Auth-Token": env.VITE_FOOTBALL_DATA_KEY ?? "",
          },
        },
      },
    },
  };
});
