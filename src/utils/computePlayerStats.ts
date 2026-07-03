import type { Match } from "@/types/match";
import type { Player } from "@/types/player";

export type PlayerStats = {
  goals: number;
  assists: number;
  /** PK による得点数 (goals の内数)。ゴールランキングの補足表示用。 */
  penaltyGoals: number;
};

/**
 * 試合結果から選手別の得点・アシスト数を集計する。
 *
 * 突合ルール:
 * - `playerId` が `players.json` に存在すればそれを使う
 * - 無ければ `playerName` の完全一致で `players.json` を検索
 * - どちらも該当しない場合はカウントしない（その得点はチーム集計のみ）
 * - 自殺点 (`type === "own"`) は得点者にカウントしない（アシストは元々付かない）
 */
export function computePlayerStats(
  players: Player[],
  matches: Match[]
): Map<string, PlayerStats> {
  const stats = new Map<string, PlayerStats>();
  for (const p of players) {
    stats.set(p.id, { goals: 0, assists: 0, penaltyGoals: 0 });
  }

  const nameToId = new Map<string, string>();
  for (const p of players) {
    nameToId.set(p.name, p.id);
  }

  const resolve = (id: string | undefined, name: string | undefined): string | undefined => {
    if (id && stats.has(id)) return id;
    if (name) {
      const found = nameToId.get(name);
      if (found) return found;
    }
    return undefined;
  };

  for (const m of matches) {
    // `goals` が入っていれば status は問わない (= 「今の goals 配列で確定したと仮定」)。
    // 厳格に status==="finished" にすると、古い live override が status だけ
    // "live"/"scheduled" で残っているケースで match_results.json の goals が
    // 反映されなくなる (computeStandings と同じ理由)。
    if (!m.goals || m.goals.length === 0) continue;
    for (const g of m.goals) {
      if (g.type !== "own") {
        const scorerId = resolve(g.playerId, g.playerName);
        if (scorerId) {
          const s = stats.get(scorerId)!;
          s.goals++;
          if (g.type === "penalty") s.penaltyGoals++;
        }
      }
      const assistId = resolve(g.assistPlayerId, g.assistPlayerName);
      if (assistId) stats.get(assistId)!.assists++;
    }
  }

  return stats;
}
