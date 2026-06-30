import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

const RESULTS_PATH = path.resolve(__dirname, "public/data/match_results.json");
const RESULTS_REL = "public/data/match_results.json";

/** match_results.json への読み取り→書き込みを直列化するミューテックス。
 *  並行 POST や periodic-catchup と matchResultsWriter の同時書き込みで
 *  ファイルが壊れる事故 (末尾に `\n}` 混入) を防ぐ。
 *
 *  使い方: `await withWriteLock(async () => { ...read+merge+write... })`
 *  fn の中で throw しても次の caller は普通に実行される (チェーンは切れない)。 */
let writeLock: Promise<unknown> = Promise.resolve();
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(
    () => fn(),
    () => fn()
  );
  writeLock = next.catch(() => {});
  return next;
}

/**
 * `match_results.json` を読んで JSON オブジェクトを返す。普通に `JSON.parse` を
 * 試し、失敗したら末尾のバランス外 `}` 等のゴミを切り落として再パース (自己修復)。
 * 修復した場合は `repaired: true` を返すので、呼び出し側で書き戻せる。
 *
 * 過去に複数回、末尾に `\n}` が混入してファイルが parse 不能になり、公開サイトで
 * スコアが全消滅する事故が起きた。書き込み経路 (`matchResultsWriter`) は構造上
 * きれいな JSON しか出さないので、外部 (エディタの誤挿入等) で混入したと推測。
 * いずれにせよ次の書き込みで自動的に直すよう、ここで自己修復する。
 */
function selfHealJson(
  raw: string
): { data: Record<string, unknown>; repaired: boolean } | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return { data: parsed as Record<string, unknown>, repaired: false };
    return null;
  } catch {
    // バランスの取れた最後の `}` までを残して再パース。
    let depth = 0;
    let lastClose = -1;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (inStr) {
        if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) lastClose = i;
      }
    }
    if (lastClose < 0) return null;
    try {
      const parsed = JSON.parse(raw.slice(0, lastClose + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return { data: parsed as Record<string, unknown>, repaired: true };
      return null;
    } catch {
      return null;
    }
  }
}

/** GitHub Desktop の `app-X.Y.Z` フォルダを動的に列挙する。
 *  バージョン番号でソートして新しい方から優先。固定パスがバージョン更新で失効する事故を防ぐ。 */
async function listGitHubDesktopGitBins(): Promise<string[]> {
  const root = `${process.env.LOCALAPPDATA ?? ""}\\GitHubDesktop`;
  if (!process.env.LOCALAPPDATA) return [];
  try {
    const dirs = await fs.readdir(root);
    const appDirs = dirs.filter((d) => /^app-\d/.test(d));
    // app-3.5.11 のような形式を降順ソート (新しい方を先に試す)
    appDirs.sort((a, b) => {
      const pa = a.replace("app-", "").split(".").map((n) => parseInt(n, 10) || 0);
      const pb = b.replace("app-", "").split(".").map((n) => parseInt(n, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });
    return appDirs.map(
      (d) => `${root}\\${d}\\resources\\app\\git\\cmd\\git.exe`
    );
  } catch {
    return [];
  }
}

let cachedGitBin: string | null = null;
let gitBinCandidatesCache: string[] | null = null;
async function getGitBinCandidates(): Promise<string[]> {
  if (gitBinCandidatesCache) return gitBinCandidatesCache;
  const githubDesktopBins = await listGitHubDesktopGitBins();
  gitBinCandidatesCache = [
    "git",
    "C:\\Program Files\\Git\\cmd\\git.exe",
    ...githubDesktopBins,
  ];
  return gitBinCandidatesCache;
}

async function findGit(): Promise<string | null> {
  if (cachedGitBin) return cachedGitBin;
  const candidates = await getGitBinCandidates();
  for (const candidate of candidates) {
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
      let push = await runGit(gitBin, ["push", "origin", "HEAD"], cwd);
      if (push.code !== 0) {
        // 4a) reject されたら recovery: fetch + merge → match_results.json のみ
        //     conflict なら ours (= ローカルの periodic-catchup 最新値) で resolve →
        //     再 push。GitHub Actions が先に push したケース (non-fast-forward) を
        //     ローカルから自動回復するための仕組み。
        //     conflict が他ファイルにも及ぶ場合は abort して諦める (安全側)。
        const isRejected =
          /\b(rejected|non-fast-forward|fetch first)\b/i.test(push.stderr);
        if (!isRejected) {
          console.warn(`[auto-push] git push failed: ${push.stderr.trim()}`);
          return;
        }
        console.warn(
          `[auto-push] git push rejected — recovery (fetch + merge + retry)`
        );
        const fetchRes = await runGit(
          gitBin,
          ["fetch", "origin", "main"],
          cwd
        );
        if (fetchRes.code !== 0) {
          console.warn(
            `[auto-push] recovery fetch failed: ${fetchRes.stderr.trim()}`
          );
          return;
        }
        const merge = await runGit(
          gitBin,
          ["merge", "--no-edit", "FETCH_HEAD"],
          cwd
        );
        if (merge.code !== 0) {
          // 競合発生 — match_results.json のみなら ours で resolve
          const conf = await runGit(
            gitBin,
            ["diff", "--name-only", "--diff-filter=U"],
            cwd
          );
          const files = conf.stdout
            .trim()
            .split(/\r?\n/)
            .filter(Boolean);
          if (files.length === 1 && files[0] === RESULTS_REL) {
            await runGit(
              gitBin,
              ["checkout", "--ours", "--", RESULTS_REL],
              cwd
            );
            await runGit(gitBin, ["add", "--", RESULTS_REL], cwd);
            const mergeCommit = await runGit(
              gitBin,
              ["commit", "--no-edit"],
              cwd
            );
            if (mergeCommit.code !== 0) {
              await runGit(gitBin, ["merge", "--abort"], cwd);
              console.warn(
                `[auto-push] recovery merge commit failed: ${mergeCommit.stderr.trim()}`
              );
              return;
            }
          } else {
            await runGit(gitBin, ["merge", "--abort"], cwd);
            console.warn(
              `[auto-push] recovery aborted — conflicts in other files: ${
                files.join(", ") || "(unknown)"
              }`
            );
            return;
          }
        }
        push = await runGit(gitBin, ["push", "origin", "HEAD"], cwd);
        if (push.code !== 0) {
          console.warn(
            `[auto-push] re-push after merge failed: ${push.stderr.trim()}`
          );
          return;
        }
        console.log(
          `[auto-push] match_results.json pushed after merge-recovery (${ts})`
        );
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
          // Buffer 配列に貯めてから一括 toString('utf8') する。
          // `body += chunk` で逐次 string 化するとマルチバイト UTF-8 が
          // チャンク境界をまたいだ瞬間に無効バイト列扱いされ U+FFFD に
          // 置換される (2026-06-28 に「ルスタムジョン・アシュルマトフ」→
          // 「ルスタムジョン・アシュルマト��」のような 1 文字破損が頻発)。
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const body = Buffer.concat(chunks).toString("utf8");
          const incoming = JSON.parse(body);
          if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
            res.statusCode = 400;
            res.end("body must be an object");
            return;
          }
          // 読み取り → merge → 書き込み → verify の一連を直列化。
          // 並行 POST と periodic-catchup を同時に動かしても破損しない。
          type WriteOutcome =
            | { kind: "ok"; count: number }
            | { kind: "rejected" }
            | { kind: "verifyFailed"; message: string; count: number };
          const outcome = await withWriteLock<WriteOutcome>(async () => {
            let existing: Record<string, unknown> = {};
            try {
              const raw = await fs.readFile(RESULTS_PATH, "utf8");
              const healed = selfHealJson(raw);
              if (!healed) {
                console.warn(
                  "[match-results-writer] 既存 match_results.json が parse 不能 & 自己修復不能 — 書き込みを拒否してデータ保護"
                );
                return { kind: "rejected" };
              }
              existing = healed.data;
              if (healed.repaired) {
                console.warn(
                  "[match-results-writer] 既存 match_results.json の末尾ゴミを自動修復しました"
                );
              }
            } catch (e: unknown) {
              const code = (e as { code?: string } | null)?.code;
              if (code !== "ENOENT") throw e;
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
            const output = JSON.stringify(merged, null, 2) + "\n";
            await fs.writeFile(RESULTS_PATH, output, "utf8");
            // 書き戻し検証 (ロック内なので他者の書き込みは挟まらないはず)
            try {
              const verify = await fs.readFile(RESULTS_PATH, "utf8");
              JSON.parse(verify);
            } catch (verr) {
              return {
                kind: "verifyFailed",
                message: verr instanceof Error ? verr.message : String(verr),
                count: Object.keys(merged).length,
              };
            }
            return { kind: "ok", count: Object.keys(merged).length };
          });
          if (outcome.kind === "rejected") {
            res.statusCode = 500;
            res.end(
              "match_results.json is corrupt and cannot be self-healed; refusing write to protect data"
            );
            return;
          }
          if (outcome.kind === "verifyFailed") {
            console.warn(
              `[match-results-writer] 書き込み後の verify に失敗: ${outcome.message}`
            );
          }
          res.setHeader("Content-Type", "application/json");
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, count: outcome.count }));

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
        // 1) JSON 自己修復 — 起動時に壊れたファイルを検知したら直しておく。
        //    Football-Data 取得の前に走らせるので、catchup 側で
        //    parse 失敗 → 空ファイル扱い → 既存データ喪失、という事故を防ぐ。
        runStartupSelfHeal().catch((e) =>
          console.warn(
            `[startup-self-heal] failed: ${e?.message ?? e}`
          )
        );
        if (process.env.STARTUP_CATCHUP_RESULTS === "0") return;
        // 2) サーバー起動と並走させる (await しない)
        runStartupCatchup(apiKey).catch((e) =>
          console.warn(`[startup-catchup] failed: ${e?.message ?? e}`)
        );
        // 3) 周期的 catchup — 試合中のスコア変更を自動で match_results.json
        //    に反映し schedulePush で GitHub に push する。公開サイトの
        //    スコアが手動 commit なしで更新される。
        //    エンドポイント: /competitions/WC/matches (1 req で全 104 試合)
        //    間隔: 60 秒 (Football-Data 無料枠 10 req/min に余裕)
        //    停止: 環境変数 `PERIODIC_CATCHUP=0`
        if (process.env.PERIODIC_CATCHUP === "0") return;
        if (!apiKey) return;
        const PERIODIC_INTERVAL_MS = 60_000;
        const startDelay = 30_000; // startup-catchup が終わるのを少し待つ
        setTimeout(() => {
          const tick = () => {
            runPeriodicCatchup(apiKey).catch((e) =>
              console.warn(
                `[periodic-catchup] failed: ${e?.message ?? e}`
              )
            );
          };
          tick();
          setInterval(tick, PERIODIC_INTERVAL_MS);
        }, startDelay);
      });
    },
  };
}

/**
 * 周期 catchup: `/competitions/WC/matches` を 1 リクエストで取得し、
 * status / score / penaltyScore に差分があるものだけ match_results.json
 * に書き込む。goals / formations / cards / bookings は触らないので、
 * `/edit/matches` で入力した手作業データを潰さない。
 *
 * 書き込み後は schedulePush() で 30 秒デバウンスの git push が走り、
 * GitHub Pages の公開サイトに反映される。
 */
async function runPeriodicCatchup(apiKey: string) {
  const url = "https://api.football-data.org/v4/competitions/WC/matches";
  let fdMatches: Array<Record<string, any>>;
  try {
    const r = await fetch(url, { headers: { "X-Auth-Token": apiKey } });
    if (r.status === 429) {
      console.warn("[periodic-catchup] 429 rate limit — skip");
      return;
    }
    if (!r.ok) {
      console.warn(`[periodic-catchup] fetch ${r.status}`);
      return;
    }
    const j = await r.json();
    fdMatches = (j.matches ?? []) as Array<Record<string, any>>;
  } catch (e) {
    console.warn(
      `[periodic-catchup] fetch error: ${e instanceof Error ? e.message : String(e)}`
    );
    return;
  }

  // m??? → fdMatchId 逆引きマップ
  const mappingPath = path.resolve(
    __dirname,
    "public/data/footballdata_mapping.json"
  );
  let mapping: Record<
    string,
    number | { fdMatchId: number; fdHomeTeamId?: number; fdAwayTeamId?: number }
  >;
  try {
    mapping = JSON.parse(await fs.readFile(mappingPath, "utf8")).mapping;
  } catch (e) {
    console.warn(
      `[periodic-catchup] mapping 読み込み失敗: ${e instanceof Error ? e.message : String(e)}`
    );
    return;
  }
  const fdToLocal = new Map<number, string>();
  for (const [localId, entry] of Object.entries(mapping)) {
    const fdId = typeof entry === "number" ? entry : entry.fdMatchId;
    if (typeof fdId === "number") fdToLocal.set(fdId, localId);
  }

  // read → merge → write をロックで直列化
  const updated = await withWriteLock<number>(async () => {
    let results: Record<string, Record<string, unknown>> = {};
    try {
      const raw = await fs.readFile(RESULTS_PATH, "utf8");
      const healed = selfHealJson(raw);
      if (!healed) {
        console.warn(
          "[periodic-catchup] match_results.json が parse 不能 — abort (データ保護)"
        );
        return 0;
      }
      results = healed.data as Record<string, Record<string, unknown>>;
    } catch (e: unknown) {
      const code = (e as { code?: string } | null)?.code;
      if (code !== "ENOENT") throw e;
    }

    let count = 0;
    for (const fx of fdMatches) {
      const localId = fdToLocal.get(fx.id);
      if (!localId) continue;
      const status = mapFdStatus(fx.status);
      const update: Record<string, unknown> = { matchId: localId };
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

      const prev = results[localId] ?? {};
      // manualLock: true なら手動値を保護するため自動更新スキップ。
      // 公式発表と Football-Data が食い違うケース (例: 誤入力スコアが
      // しばらく直らない) を `/edit/matches` の保存で固定するための機構。
      if (prev.manualLock === true) continue;
      const sameStatus = prev.status === update.status;
      const sameScore =
        JSON.stringify(prev.score) === JSON.stringify(update.score);
      const samePk =
        JSON.stringify(prev.penaltyScore) ===
        JSON.stringify(update.penaltyScore);
      if (sameStatus && sameScore && samePk) continue;

      results[localId] = { ...prev, ...update };
      count++;
      console.log(
        `[periodic-catchup] ${localId}: ${fx.homeTeam?.tla} ${ft?.home ?? "?"}-${ft?.away ?? "?"} ${fx.awayTeam?.tla} [${fx.status}]`
      );
    }

    if (count === 0) return 0;

    await fs.writeFile(
      RESULTS_PATH,
      JSON.stringify(results, null, 2) + "\n",
      "utf8"
    );
    return count;
  });

  if (updated === 0) return;
  console.log(
    `[periodic-catchup] ${updated} 試合を match_results.json に書き込み`
  );
  schedulePush();
}

async function runStartupSelfHeal() {
  await withWriteLock(async () => {
    let raw: string;
    try {
      raw = await fs.readFile(RESULTS_PATH, "utf8");
    } catch (e: unknown) {
      const code = (e as { code?: string } | null)?.code;
      if (code === "ENOENT") return;
      throw e;
    }
    const healed = selfHealJson(raw);
    if (!healed) {
      console.warn(
        "[startup-self-heal] match_results.json が parse 不能 & 自己修復不能 — 手動で修正してください"
      );
      return;
    }
    if (!healed.repaired) return;
    await fs.writeFile(
      RESULTS_PATH,
      JSON.stringify(healed.data, null, 2) + "\n",
      "utf8"
    );
    console.warn(
      "[startup-self-heal] match_results.json の末尾ゴミを自動修復しました (commit & push 推奨)"
    );
  });
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
    const healed = selfHealJson(raw);
    if (!healed) {
      console.warn(
        "[startup-catchup] match_results.json が parse 不能 — 既存データ喪失を避けるため catchup をスキップ"
      );
      return;
    }
    results = healed.data as Record<string, Record<string, unknown>>;
  } catch (e: unknown) {
    const code = (e as { code?: string } | null)?.code;
    if (code !== "ENOENT") throw e;
    // ファイル未作成 → 空から始める
  }

  const now = Date.now();
  // 終わってるはずなのにファイル側で finished になっていない試合を抽出。
  // 30 分の余白は: KO 時刻を過ぎただけでまだ前半中の試合を拾わないため。
  // manualLock: true はスキップ (手動値を保護)。
  const candidates = matches.filter((m) => {
    const ts = new Date(m.date).getTime();
    if (!Number.isFinite(ts)) return false;
    if (ts > now - 30 * 60_000) return false;
    const r = results[m.id];
    if (r?.manualLock === true) return false;
    return r?.status !== "finished";
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
  // Football-Data から候補試合分の update を accumulate する (ロック外、遅い処理)
  const pendingUpdates: Record<string, Record<string, unknown>> = {};
  const fdMeta: Record<string, { tlaH?: string; tlaA?: string; ft?: any; rawStatus?: string }> = {};

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
    pendingUpdates[m.id] = update;
    fdMeta[m.id] = { tlaH: fx.homeTeam?.tla, tlaA: fx.awayTeam?.tla, ft, rawStatus: fx.status };
  }

  if (Object.keys(pendingUpdates).length === 0) {
    console.log("[startup-catchup] 取得結果なし");
    return;
  }

  // ロック内で再 read → merge → write (FD 取得中に他者が書き込んでいても破壊しない)
  const synced = await withWriteLock<number>(async () => {
    let freshResults: Record<string, Record<string, unknown>> = {};
    try {
      const raw = await fs.readFile(RESULTS_PATH, "utf8");
      const healed = selfHealJson(raw);
      if (!healed) {
        console.warn(
          "[startup-catchup] write 直前の re-read で parse 不能 — abort (データ保護)"
        );
        return 0;
      }
      freshResults = healed.data as Record<string, Record<string, unknown>>;
    } catch (e: unknown) {
      const code = (e as { code?: string } | null)?.code;
      if (code !== "ENOENT") throw e;
    }

    let count = 0;
    for (const [id, update] of Object.entries(pendingUpdates)) {
      const prev = freshResults[id] ?? {};
      const sameStatus = prev.status === update.status;
      const sameScore =
        JSON.stringify(prev.score) === JSON.stringify(update.score);
      const samePk =
        JSON.stringify(prev.penaltyScore) ===
        JSON.stringify(update.penaltyScore);
      if (sameStatus && sameScore && samePk) continue;
      freshResults[id] = { ...prev, ...update };
      count++;
      const meta = fdMeta[id];
      console.log(
        `[startup-catchup] ${id}: ${meta.tlaH} ${meta.ft?.home}-${meta.ft?.away} ${meta.tlaA} [${meta.rawStatus}]`
      );
    }
    if (count === 0) return 0;
    await fs.writeFile(
      RESULTS_PATH,
      JSON.stringify(freshResults, null, 2) + "\n",
      "utf8"
    );
    return count;
  });

  if (synced === 0) {
    console.log("[startup-catchup] 差分なし (全試合最新)");
    return;
  }
  console.log(
    `[startup-catchup] ${synced} 試合を match_results.json に書き込み`
  );
  schedulePush();
}

export default defineConfig(({ mode }) => {
  // .env / .env.local / .env.[mode] を読み込む。`VITE_` プレフィクスがあるものだけが
  // クライアント (import.meta.env) に露出する。`.env.local` は gitignore (*.local) で除外済み。
  const env = loadEnv(mode, process.cwd(), "");
  // ビルド (= デプロイ) 単位のバージョン。data ファイル fetch の cache-buster
  // (?v=...) として埋め込み、デプロイのたびにブラウザ / CDN を強制再取得させる。
  // 同一デプロイ内では値が変わらないので、通常のキャッシュは効いたままにできる。
  const buildVersion = Date.now().toString(36);
  return {
    define: {
      __BUILD_VERSION__: JSON.stringify(buildVersion),
    },
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
