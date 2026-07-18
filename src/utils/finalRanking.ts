import type { Match } from "@/types/match";
import { winnerSide } from "@/utils/matchOutcome";

/** 大会最終順位。未確定の位置は undefined。 */
export type FinalRanking = {
  /** 優勝 = 決勝 (m104) の勝者 */
  first?: string;
  /** 準優勝 = 決勝の敗者 */
  second?: string;
  /** 3位 = 3位決定戦 (m103) の勝者 */
  third?: string;
  /** 4位 = 3位決定戦の敗者 */
  fourth?: string;
};

/**
 * 決勝 (`stage: "final"`) と 3位決定戦 (`stage: "third"`) の結果から
 * 1〜4位を導出する。試合が終わるたびに自動で埋まっていく。
 *
 * 判定条件は `status === "finished"` かつスコアあり。同点なら PK スコアで
 * 勝者を決める (`utils/matchOutcome.ts`)。3位決定戦と決勝は独立して
 * 判定するので、片方だけ終わっていればその2枠だけが埋まる。
 */
export function computeFinalRanking(matches: Match[]): FinalRanking {
  const ranking: FinalRanking = {};

  const decide = (
    stage: Match["stage"]
  ): { winner: string; loser: string } | null => {
    const m = matches.find((x) => x.stage === stage);
    if (!m || m.status !== "finished") return null;
    const side = winnerSide(m);
    if (side === null) return null;
    return side === "home"
      ? { winner: m.homeTeamId, loser: m.awayTeamId }
      : { winner: m.awayTeamId, loser: m.homeTeamId };
  };

  const final = decide("final");
  if (final) {
    ranking.first = final.winner;
    ranking.second = final.loser;
  }

  const third = decide("third");
  if (third) {
    ranking.third = third.winner;
    ranking.fourth = third.loser;
  }

  return ranking;
}
