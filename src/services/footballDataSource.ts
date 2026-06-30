import type { Match, MatchStatus } from "@/types/match";
import type { LiveUpdate } from "@/types/live";
import type { LiveSource } from "./liveSource";
import { dataUrl } from "@/utils/dataUrl";

/**
 * Football-Data.org v4 を使ったライブソース。
 *
 * **取れるもの**: 試合スコア / ステータス / 経過分 / PK スコア / 順位表 / 得点者ランキング
 * **取れないもの**: フォーメーション / ゴール時系列 / カード / 交代 / スタッツ
 *
 * Football-Data.org の Tier One (無料) プランは「Total Matches in League」レベルの
 * データしか提供しないので、フォーメーション・イベントは別経路 (手動入力か別 API)
 * で補う必要がある。
 *
 * ## なぜ /teams/{fdTeamId}/matches エンドポイントを使うのか
 *
 * 2026 年 6 月時点で Football-Data 側のキャッシュ問題があり、
 *  - `/matches/{id}`
 *  - `/competitions/WC/matches`
 *  - `/matches?status=IN_PLAY`
 * のいずれも **古いキャッシュ** (試合前のスケジュール) を返してしまう。
 * 一方で `/teams/{fdTeamId}/matches?competitions=2000&dateFrom=X&dateTo=X` は
 * **最新のライブデータ** (IN_PLAY / 得点経過) を返す。
 * そのため本ソースは team-specific endpoint をホームチーム側で叩く設計。
 *
 * 無料枠: 10 req/分。1 試合あたり 1 リクエスト × 1 分ポーリング =
 *   - 1 試合同時 LIVE → 1 req/分 (枠内)
 *   - 6 試合同時 LIVE → 6 req/分 (枠内)
 *   - 12 試合同時 LIVE → 10 req/分超過 → 一部スキップ
 * Cache TTL = 60s で重複叩きは防ぐ。
 *
 * 試合 ID マッピングは `public/data/footballdata_mapping.json`
 * (m??? → { fdMatchId, fdHomeTeamId, fdAwayTeamId })。
 */
const API_BASE = "/football-data-api"; // Vite dev proxy 経由
// キャッシュ TTL は poll interval (30s) より少し短く取って、各 poll でほぼ毎回
// 新しい fetch が走るようにする。試合分数の表示遅延を最小化する目的。
const TEAM_MATCHES_TTL_MS = 25_000;

type MappingEntry = {
  fdMatchId: number;
  fdHomeTeamId: number | null;
  fdAwayTeamId: number | null;
};

type MappingFile = { mapping: Record<string, MappingEntry | number> };

type FdScoreSide = { home: number | null; away: number | null };
type FdMatch = {
  id: number;
  utcDate: string;
  status:
    | "TIMED"
    | "SCHEDULED"
    | "LIVE"
    | "IN_PLAY"
    | "PAUSED"
    | "FINISHED"
    | "POSTPONED"
    | "SUSPENDED"
    | "CANCELLED"
    | "AWARDED";
  minute?: number | null;
  injuryTime?: number | null;
  homeTeam?: { id: number; name?: string };
  awayTeam?: { id: number; name?: string };
  score?: {
    winner?: string | null;
    duration?: string;
    fullTime?: FdScoreSide;
    halfTime?: FdScoreSide;
    extraTime?: FdScoreSide;
    penalties?: FdScoreSide;
  };
};

type FdTeamMatchesResponse = { matches?: FdMatch[] };

// --- モジュールキャッシュ -----------------------------------------------------

let mappingCache: Record<string, MappingEntry> | null = null;
// team-matches キャッシュ: キーは "{fdTeamId}:{ymd}" (1 日 1 試合の想定)
const teamMatchesCache = new Map<
  string,
  { time: number; matches: FdMatch[] }
>();

async function loadMapping(): Promise<Record<string, MappingEntry>> {
  if (mappingCache) return mappingCache;
  try {
    const r = await fetch(dataUrl("footballdata_mapping.json"));
    if (!r.ok) {
      mappingCache = {};
      return mappingCache;
    }
    const data = (await r.json()) as MappingFile;
    const m: Record<string, MappingEntry> = {};
    for (const [k, v] of Object.entries(data.mapping ?? {})) {
      // 旧フォーマット (数値だけ) の互換性も維持
      if (typeof v === "number") {
        m[k] = { fdMatchId: v, fdHomeTeamId: null, fdAwayTeamId: null };
      } else if (v && typeof v === "object") {
        m[k] = v;
      }
    }
    mappingCache = m;
  } catch {
    mappingCache = {};
  }
  return mappingCache;
}

/** YYYY-MM-DD (UTC) を返す */
function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `/teams/{fdTeamId}/matches?competitions=2000&dateFrom=X&dateTo=Y` を取得・キャッシュ */
async function fetchTeamMatches(
  fdTeamId: number,
  matchDate: Date
): Promise<FdMatch[]> {
  const dayKey = ymd(matchDate);
  const cacheKey = `${fdTeamId}:${dayKey}`;
  const cached = teamMatchesCache.get(cacheKey);
  if (cached && Date.now() - cached.time < TEAM_MATCHES_TTL_MS) {
    return cached.matches;
  }
  // dateFrom/dateTo は ±1 日に広げて取りこぼし防止 (W 杯はタイムゾーンで日跨ぎあり)
  const before = new Date(matchDate.getTime() - 86400_000);
  const after = new Date(matchDate.getTime() + 86400_000);
  const url =
    `${API_BASE}/teams/${fdTeamId}/matches` +
    `?competitions=2000&dateFrom=${ymd(before)}&dateTo=${ymd(after)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return cached?.matches ?? [];
    const data = (await r.json()) as FdTeamMatchesResponse;
    const matches = data.matches ?? [];
    teamMatchesCache.set(cacheKey, { time: Date.now(), matches });
    return matches;
  } catch {
    return cached?.matches ?? [];
  }
}

// --- 変換 -------------------------------------------------------------------

function mapStatus(s: FdMatch["status"]): MatchStatus | undefined {
  switch (s) {
    case "TIMED":
    case "SCHEDULED":
    case "POSTPONED":
      return "scheduled";
    case "LIVE":
    case "IN_PLAY":
    case "PAUSED":
      return "live";
    case "FINISHED":
    case "AWARDED":
      return "finished";
    case "SUSPENDED":
    case "CANCELLED":
      return undefined;
    default:
      return undefined;
  }
}

function statusLabel(
  s: FdMatch["status"],
  minute?: number | null,
  duration?: string
): string {
  if (s === "PAUSED") return "Halftime";
  if (s === "FINISHED") return "Full time";
  if (s === "IN_PLAY" || s === "LIVE") {
    if (duration === "EXTRA_TIME") {
      if (typeof minute === "number" && minute > 105) return "Extra time 2nd";
      return "Extra time 1st";
    }
    if (duration === "PENALTY_SHOOTOUT") return "Penalty";
    // REGULAR (= 1st/2nd half + ロスタイム)
    if (typeof minute === "number" && minute > 0) {
      return minute > 45 ? "2nd half" : "1st half";
    }
    return "Live";
  }
  if (s === "SCHEDULED" || s === "TIMED") return "Scheduled";
  return String(s);
}

// --- LiveSource 実装 ---------------------------------------------------------

export class FootballDataLiveSource implements LiveSource {
  async fetchUpdate(match: Match): Promise<LiveUpdate | null> {
    const mapping = await loadMapping();
    const entry = mapping[match.id];
    if (!entry) return null;

    // ホームチーム ID を優先で使う。null なら away、両方 null なら諦め
    // (KO の TBD カード時はチーム ID が解決していないので live で取れない)
    const fdTeamId = entry.fdHomeTeamId ?? entry.fdAwayTeamId;
    if (!fdTeamId) return null;

    const matchDate = new Date(match.date);
    const teamMatches = await fetchTeamMatches(fdTeamId, matchDate);

    // 取得した試合のうち fdMatchId 一致 (または日時一致) のものを採用
    const fx =
      teamMatches.find((m) => m.id === entry.fdMatchId) ??
      teamMatches.find(
        (m) =>
          Math.abs(new Date(m.utcDate).getTime() - matchDate.getTime()) <
          12 * 3600_000
      );
    if (!fx) return null;

    const update: LiveUpdate = { matchId: match.id };

    const status = mapStatus(fx.status);
    if (status) update.status = status;

    const ft = fx.score?.fullTime;
    const pk = fx.score?.penalties;
    // PK 戦進行中、FD は fullTime に PK 本数を加算した「累計」を返す
    // (例: 真の FT 1-1 + PK 2-3 が観測されると fullTime = 3-4 として返ってくる)。
    // duration === "PENALTY_SHOOTOUT" かつ未確定 (FINISHED 以外) のとき
    // fullTime - penalties で真の FT に補正する。
    // FINISHED 後は FD が fullTime を正しい FT に戻すのでそのまま採用。
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

    update.liveLabel = statusLabel(
      fx.status,
      fx.minute ?? undefined,
      fx.score?.duration
    );

    return update;
  }
}
