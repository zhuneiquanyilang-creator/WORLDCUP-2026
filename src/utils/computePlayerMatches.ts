import type { Booking, BookingType, Match } from "@/types/match";
import type { Player } from "@/types/player";
import { matchNumber } from "@/utils/matchNumber";

export type PlayerAppearanceStatus =
  | "starter"      // スタメン
  | "sub-on"       // 途中出場
  | "bench"        // ベンチ入り (出番なし)
  | "not-selected" // メンバー外
  | "unknown";     // データ不足 (フォーメーション・ベンチ未入力)

export type PlayerMatchAppearance = {
  matchId: string;
  matchNumber: number | null;
  date: string;
  stage: Match["stage"];
  opponentId: string;
  opponentLabel?: string;
  isHome: boolean;
  status: PlayerAppearanceStatus;

  // 試合結果
  homeScore: number | null;
  awayScore: number | null;
  penaltyScore: { home: number; away: number } | null;
  result: "win" | "draw" | "loss" | null;
  matchStatus: Match["status"];

  // 出場時間 (= 出場した分のみ。ベンチ・メンバー外は 0)
  startMinute: number | null;
  endMinute: number | null;
  minutes: number;

  // 個人スタッツ
  goals: number;
  assists: number;
  bookings: { minute: number; addedTime?: number; type: BookingType }[];
};

/** PK or 90 分超のイベントが入っていれば延長戦扱い (試合長を 120 分とみなす)。 */
function matchEndMinute(m: Match): number {
  const overtime =
    !!m.penaltyScore ||
    (m.penaltyShootout?.length ?? 0) > 0 ||
    (m.goals ?? []).some((g) => g.minute > 90) ||
    (m.bookings ?? []).some((b) => b.minute > 90) ||
    (m.substitutions ?? []).some((s) => s.minute > 90);
  return overtime ? 120 : 90;
}

function nameMatchesPlayer(player: Player, name: string | undefined): boolean {
  if (!name) return false;
  return name === player.name;
}

/**
 * 1 選手分の全試合出場記録を計算する。
 *
 * 出場時間の推定:
 *  - スタメン + 途中交代なし → matchEnd (90 or 120)
 *  - スタメン + 途中交代あり (out) → 0 〜 outMinute
 *  - 途中出場 (in) + 途中交代なし → inMinute 〜 matchEnd
 *  - 途中出場 (in) + 途中で out (二重交代の稀ケース) → inMinute 〜 outMinute
 *  - ベンチ入りで出番なし → 0 分 (status: bench)
 *  - フォーメーション・ベンチが未入力の試合 → "unknown" (出場 1 にカウントしない)
 *
 * レッドカード退場 (R / Y2R / YR) を受けた選手はその時刻で出場終了とみなす。
 * 交代 out との両方がある稀ケースでは早い方を採用 (= 実際にピッチを離れた時刻)。
 */
export function computePlayerMatches(
  player: Player,
  matches: Match[]
): PlayerMatchAppearance[] {
  const teamMatches = matches
    .filter((m) => m.homeTeamId === player.teamId || m.awayTeamId === player.teamId)
    // ライブ中の試合は終了するまで集計に含めない (リアルタイム途中の出場時間や
    // 暫定スコアで通算成績がブレるのを避ける)。終了した試合 ("finished") と
    // KO 前の試合 ("scheduled") のみ集計対象。
    .filter((m) => m.status !== "live")
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const out: PlayerMatchAppearance[] = [];
  for (const m of teamMatches) {
    const isHome = m.homeTeamId === player.teamId;
    const opponentId = isHome ? m.awayTeamId : m.homeTeamId;
    const opponentLabel = isHome ? m.awayTeamLabel : m.homeTeamLabel;

    // 結果判定
    let result: PlayerMatchAppearance["result"] = null;
    if (m.status === "finished" && m.score) {
      const myScore = isHome ? m.score.home : m.score.away;
      const oppScore = isHome ? m.score.away : m.score.home;
      if (myScore > oppScore) result = "win";
      else if (myScore < oppScore) result = "loss";
      else if (m.penaltyScore) {
        const myPk = isHome ? m.penaltyScore.home : m.penaltyScore.away;
        const oppPk = isHome ? m.penaltyScore.away : m.penaltyScore.home;
        result = myPk > oppPk ? "win" : myPk < oppPk ? "loss" : "draw";
      } else {
        result = "draw";
      }
    }

    // フォーメーション・ベンチでの位置取得
    const formation = isHome ? m.homeFormation : m.awayFormation;
    const inStarting = formation?.starting.some(
      (s) =>
        s.name === player.name ||
        (typeof s.number === "number" && s.number === player.number)
    );
    const inBench = formation?.bench?.some(
      (b) =>
        b.name === player.name ||
        (typeof b.number === "number" && b.number === player.number)
    );

    // 交代記録から in/out 時刻を取得
    const subs = (m.substitutions ?? []).filter((s) => s.teamId === player.teamId);
    const subIn = subs.find((s) => nameMatchesPlayer(player, s.inName));
    const subOut = subs.find((s) => nameMatchesPlayer(player, s.outName));

    // 本人のレッドカード退場時刻 (R / Y2R / YR のうち最も早いもの)。
    // 出場終了の上限として subOut と比較し、早い方を採用する。
    const redCard = (m.bookings ?? [])
      .filter(
        (b) =>
          b.teamId === player.teamId &&
          b.playerName === player.name &&
          b.type !== "Y"
      )
      .sort((a, b) => a.minute - b.minute)[0];
    const redOutMinute = redCard?.minute ?? null;

    const matchEnd = matchEndMinute(m);
    let status: PlayerAppearanceStatus = "unknown";
    let startMinute: number | null = null;
    let endMinute: number | null = null;
    let minutes = 0;

    // 出場終了時刻 = 交代 out / レッドカード / 試合終了 のうち最も早いもの。
    const earliestEnd = (...vals: (number | null | undefined)[]): number => {
      const nums = vals.filter((v): v is number => typeof v === "number");
      return nums.length === 0 ? matchEnd : Math.min(...nums);
    };

    if (inStarting) {
      status = "starter";
      startMinute = 0;
      endMinute = earliestEnd(subOut?.minute, redOutMinute, matchEnd);
      minutes = Math.max(0, endMinute - startMinute);
    } else if (subIn) {
      status = "sub-on";
      startMinute = subIn.minute;
      endMinute = earliestEnd(subOut?.minute, redOutMinute, matchEnd);
      minutes = Math.max(0, endMinute - startMinute);
    } else if (inBench) {
      status = "bench";
    } else if (formation) {
      // 名簿あり (フォーメーション入力済) かつ自分は不在 → メンバー外
      status = "not-selected";
    } else {
      // フォーメーション未入力 → 不明 (出場数には数えない)
      status = "unknown";
    }

    // 個人ゴール・アシスト集計
    let goals = 0;
    let assists = 0;
    for (const g of m.goals ?? []) {
      if (g.teamId !== player.teamId && g.type !== "own") continue;
      if (g.type !== "own") {
        if (
          g.playerId === player.id ||
          (!g.playerId && g.playerName === player.name)
        )
          goals++;
      }
      // アシストは自分のチームに対するゴールでのみ計上 (OG にアシストは付かない)
      if (g.type === "own") continue;
      if (
        g.assistPlayerId === player.id ||
        (!g.assistPlayerId && g.assistPlayerName === player.name)
      )
        assists++;
    }

    // 自身のカード
    const bookings: PlayerMatchAppearance["bookings"] = (m.bookings ?? [])
      .filter(
        (b: Booking) =>
          b.teamId === player.teamId && b.playerName === player.name
      )
      .map((b) => ({
        minute: b.minute,
        addedTime: b.addedTime,
        type: b.type,
      }));

    out.push({
      matchId: m.id,
      matchNumber: matchNumber(m.id),
      date: m.date,
      stage: m.stage,
      opponentId,
      opponentLabel,
      isHome,
      status,
      homeScore: m.score?.home ?? null,
      awayScore: m.score?.away ?? null,
      penaltyScore: m.penaltyScore ?? null,
      result,
      matchStatus: m.status,
      startMinute,
      endMinute,
      minutes,
      goals,
      assists,
      bookings,
    });
  }
  return out;
}

export type PlayerCareerSummary = {
  matchesPlayed: number;   // 出場 (starter + sub-on)
  totalMinutes: number;
  goals: number;
  assists: number;
  yellows: number;
  reds: number;            // R / Y2R / YR をまとめて 1 件 1 退場
};

export function summarizePlayerMatches(
  matches: PlayerMatchAppearance[]
): PlayerCareerSummary {
  let matchesPlayed = 0;
  let totalMinutes = 0;
  let goals = 0;
  let assists = 0;
  let yellows = 0;
  let reds = 0;
  for (const a of matches) {
    if (a.status === "starter" || a.status === "sub-on") matchesPlayed++;
    totalMinutes += a.minutes;
    goals += a.goals;
    assists += a.assists;
    for (const b of a.bookings) {
      if (b.type === "Y") yellows++;
      else reds++;
    }
  }
  return { matchesPlayed, totalMinutes, goals, assists, yellows, reds };
}
