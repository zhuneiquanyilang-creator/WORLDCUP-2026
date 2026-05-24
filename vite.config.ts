import { defineConfig, type Plugin } from "vite";
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

export default defineConfig({
  plugins: [react(), matchResultsWriter()],
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
    },
  },
});
