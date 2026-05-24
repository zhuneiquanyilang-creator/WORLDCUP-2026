import type {
  Match,
  Goal,
  Booking,
  Substitution,
  MatchStatus,
  FormationData,
  MatchStats,
} from "@/types/match";
import type { LiveUpdate } from "@/types/live";
import type { LiveSource } from "./liveSource";
import { generateFormation, type RawPlayer } from "@/utils/formation";
import { dataUrl } from "@/utils/dataUrl";

const API_BASE = "/sofascore-api"; // Vite dev proxy 経由

type SofascoreMapping = {
  mapping: Record<string, number>;
};

let mappingCache: Record<string, number> | null = null;

async function loadMapping(): Promise<Record<string, number>> {
  if (mappingCache) return mappingCache;
  const res = await fetch(dataUrl("sofascore_mapping.json"));
  if (!res.ok) {
    mappingCache = {};
    return mappingCache;
  }
  const data = (await res.json()) as SofascoreMapping;
  mappingCache = data.mapping ?? {};
  return mappingCache;
}

type SofaEvent = {
  id: number;
  status?: { type?: string; description?: string };
  isLive?: boolean;
  homeScore?: { current?: number; penalties?: number };
  awayScore?: { current?: number; penalties?: number };
  time?: { currentPeriodStartTimestamp?: number };
  homeTeam?: { name?: string };
  awayTeam?: { name?: string };
};

type SofaIncident = {
  time?: number;
  addedTime?: number;
  incidentType?: string;
  incidentClass?: string;
  player?: { name?: string };
  assist1?: { name?: string };
  playerIn?: { name?: string };
  playerOut?: { name?: string };
  isHome?: boolean;
};

type SofaIncidentsResponse = { incidents?: SofaIncident[] };

type SofaPlayerEntry = {
  player?: { name?: string; shortName?: string };
  shirtNumber?: number;
  position?: string; // G / D / M / F
  substitute?: boolean;
};

type SofaLineupSide = {
  formation?: string;
  players?: SofaPlayerEntry[];
};

type SofaLineupsResponse = {
  confirmed?: boolean;
  home?: SofaLineupSide;
  away?: SofaLineupSide;
};

type SofaStatItem = {
  name?: string;
  home?: string | number;
  away?: string | number;
  homeValue?: number;
  awayValue?: number;
};

type SofaStatGroup = {
  groupName?: string;
  statisticsItems?: SofaStatItem[];
};

type SofaStatPeriod = {
  period?: string; // "ALL" | "1ST" | "2ND" | ...
  groups?: SofaStatGroup[];
};

type SofaStatisticsResponse = {
  statistics?: SofaStatPeriod[];
};

function mapStatus(s: SofaEvent["status"], isLive?: boolean): MatchStatus | undefined {
  if (isLive) return "live";
  const t = s?.type;
  if (t === "finished") return "finished";
  if (t === "inprogress") return "live";
  if (t === "notstarted") return "scheduled";
  return undefined;
}

function mapGoalType(klass: string | undefined): Goal["type"] {
  if (klass === "penalty") return "penalty";
  if (klass === "ownGoal" || klass === "own-goal") return "own";
  return "normal";
}

function mapCardType(klass: string | undefined): Booking["type"] | undefined {
  if (klass === "yellow") return "Y";
  if (klass === "red") return "R";
  if (klass === "yellowRed" || klass === "yellow-red") return "Y2R";
  return undefined;
}

function totalMinute(time: number | undefined, addedTime: number | undefined): number {
  return (time ?? 0) + (addedTime ?? 0);
}

function toRawPlayer(p: SofaPlayerEntry): RawPlayer {
  return {
    name: p.player?.name ?? p.player?.shortName ?? "?",
    number: p.shirtNumber,
    category: p.position,
  };
}

function parseStatNumber(v: string | number | undefined): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return undefined;
  // "55%" や "1.84" などをパース
  const n = parseFloat(v.replace("%", ""));
  return Number.isFinite(n) ? n : undefined;
}

function findStat(
  items: SofaStatItem[],
  ...names: string[]
): { home: number; away: number } | undefined {
  const norm = (s: string) => s.toLowerCase().trim();
  const wanted = names.map(norm);
  const found = items.find(
    (it) => typeof it.name === "string" && wanted.includes(norm(it.name))
  );
  if (!found) return undefined;
  const home = found.homeValue ?? parseStatNumber(found.home);
  const away = found.awayValue ?? parseStatNumber(found.away);
  if (typeof home !== "number" || typeof away !== "number") return undefined;
  return { home, away };
}

function parseStats(json: SofaStatisticsResponse): MatchStats | undefined {
  const all = json.statistics?.find((s) => s.period === "ALL") ?? json.statistics?.[0];
  if (!all) return undefined;
  const items: SofaStatItem[] = (all.groups ?? []).flatMap(
    (g) => g.statisticsItems ?? []
  );
  if (items.length === 0) return undefined;

  const stats: MatchStats = {};
  const possession = findStat(items, "Ball possession", "Possession");
  if (possession) stats.possession = possession;
  const xG = findStat(items, "Expected goals", "xG", "Expected Goals (xG)");
  if (xG) stats.xG = xG;
  const shots = findStat(items, "Total shots", "Shots");
  if (shots) stats.shots = shots;
  const sot = findStat(items, "Shots on target", "Shots on goal");
  if (sot) stats.shotsOnTarget = sot;

  return Object.keys(stats).length === 0 ? undefined : stats;
}

function convertSide(side: SofaLineupSide | undefined): FormationData | undefined {
  if (!side?.formation || !side.players) return undefined;
  const starting = side.players.filter((p) => !p.substitute).map(toRawPlayer);
  const bench = side.players
    .filter((p) => p.substitute)
    .map((p) => ({ name: p.player?.name ?? p.player?.shortName ?? "?", number: p.shirtNumber }));
  if (starting.length === 0) return undefined;
  return generateFormation(side.formation, starting, bench);
}

export class SofascoreLiveSource implements LiveSource {
  async fetchUpdate(match: Match): Promise<LiveUpdate | null> {
    const mapping = await loadMapping();
    const eventId = mapping[match.id];
    if (!eventId) return null;

    // 試合の基本情報
    let event: SofaEvent;
    try {
      const r = await fetch(`${API_BASE}/event/${eventId}`);
      if (!r.ok) return null;
      const json = await r.json();
      event = json.event as SofaEvent;
      if (!event) return null;
    } catch {
      return null;
    }

    const status = mapStatus(event.status, event.isLive);
    const score =
      typeof event.homeScore?.current === "number" &&
      typeof event.awayScore?.current === "number"
        ? { home: event.homeScore.current, away: event.awayScore.current }
        : undefined;

    const penaltyScore =
      typeof event.homeScore?.penalties === "number" &&
      typeof event.awayScore?.penalties === "number"
        ? { home: event.homeScore.penalties, away: event.awayScore.penalties }
        : undefined;

    const update: LiveUpdate = { matchId: match.id };
    if (status) update.status = status;
    if (score) update.score = score;
    if (penaltyScore) update.penaltyScore = penaltyScore;
    update.liveLabel = event.status?.description;
    // 現在 period (1st half / 2nd half / ET 等) の開始時刻 (Sofascore は秒単位なので ms に変換)
    if (typeof event.time?.currentPeriodStartTimestamp === "number") {
      update.currentPeriodStart = event.time.currentPeriodStartTimestamp * 1000;
    }

    // ラインアップ取得 (confirmed === true なら確実、false でも予想スタメンが入ることが多い)
    try {
      const r = await fetch(`${API_BASE}/event/${eventId}/lineups`);
      if (r.ok) {
        const json = (await r.json()) as SofaLineupsResponse;
        const home = convertSide(json.home);
        const away = convertSide(json.away);
        if (home) update.homeFormation = home;
        if (away) update.awayFormation = away;
      }
    } catch {
      // ラインアップが無くてもスコア更新は活かす
    }

    // スタッツ取得 (試合が進行中・終了済みのときのみ。Sofascore は試合前は提供しない)
    if (status === "live" || status === "finished") {
      try {
        const r = await fetch(`${API_BASE}/event/${eventId}/statistics`);
        if (r.ok) {
          const json = (await r.json()) as SofaStatisticsResponse;
          const parsed = parseStats(json);
          if (parsed) update.stats = parsed;
        }
      } catch {
        // スタッツが取れなくても他のフィールドは活かす
      }
    }

    // ゴール・カード・交代の取得 (試合が進行中・終了済みのときのみ)
    if (status === "live" || status === "finished") {
      try {
        const r = await fetch(`${API_BASE}/event/${eventId}/incidents`);
        if (r.ok) {
          const json = (await r.json()) as SofaIncidentsResponse;
          const list = json.incidents ?? [];
          const goals: Goal[] = [];
          const bookings: Booking[] = [];
          const subs: Substitution[] = [];

          for (const inc of list) {
            const teamId = inc.isHome ? match.homeTeamId : match.awayTeamId;
            const minute = totalMinute(inc.time, inc.addedTime);
            if (inc.incidentType === "goal") {
              goals.push({
                minute,
                teamId,
                playerName: inc.player?.name,
                assistPlayerName: inc.assist1?.name,
                type: mapGoalType(inc.incidentClass),
              });
            } else if (inc.incidentType === "card") {
              const t = mapCardType(inc.incidentClass);
              if (t) {
                bookings.push({
                  minute,
                  teamId,
                  playerName: inc.player?.name ?? "",
                  type: t,
                });
              }
            } else if (inc.incidentType === "substitution") {
              subs.push({
                minute,
                teamId,
                inName: inc.playerIn?.name ?? "",
                outName: inc.playerOut?.name ?? "",
              });
            }
          }
          goals.sort((a, b) => a.minute - b.minute);
          bookings.sort((a, b) => a.minute - b.minute);
          subs.sort((a, b) => a.minute - b.minute);

          update.goals = goals;
          update.bookings = bookings;
          update.substitutions = subs;
        }
      } catch {
        // インシデントが取れなくてもスコア更新は活かす
      }
    }

    return update;
  }
}
