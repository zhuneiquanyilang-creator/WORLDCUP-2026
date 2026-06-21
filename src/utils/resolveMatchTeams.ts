import type { Match } from "@/types/match";
import type { Standing } from "@/types/standing";
import type { Team } from "@/types/team";
import type { ThirdPlaceAssignment } from "@/types/thirdPlace";
import { matchNumber } from "@/utils/matchNumber";
import { clinchedRanks } from "@/utils/groupClinch";
import { computeStandings } from "@/utils/computeStandings";
import { compareCrossGroup, sortGroupStandings } from "@/utils/tiebreaker";

/**
 * matches.json のプレースホルダ team ID を、確定したチームに差し替える。
 *
 * 対応するプレースホルダ:
 *  - `G<X><N>` （例: `GA1` = A組1位）→ グループ順位が確定したら実 ID へ。
 *    最終節を待たずに勝ち点等で確定した場合も差し替える（`utils/groupClinch.ts`）。
 *  - `W<num>` / `L<num>` （例: `W73` = 73試合勝者）→ 該当試合が終了して
 *    勝者/敗者が確定したら実 ID へ。多段カスケード（R32→R16→…→決勝）に対応。
 *  - `G3_<groups>` （例: `G3_ABCDF` = A/B/C/D/F組3位の中で R32 進出した1チーム）
 *    → **全72試合のグループ戦が終了**してから、FIFA 公式の組合せ表（Annex C）
 *    に基づいて解決。組合せ表は `public/data/third_place_assignment.json`。
 *
 * 差し替えた試合は `homeTeamLabel` / `awayTeamLabel` を `undefined` に落とし、
 * `BracketMatch` / `MatchCard` 等で実チーム名・国旗が表示されるようにする。
 */

const PLACEHOLDER_GROUP = /^G([A-L])([123])$/;
const PLACEHOLDER_W = /^W(\d+)$/;
const PLACEHOLDER_L = /^L(\d+)$/;
const PLACEHOLDER_3RD = /^G3_([A-L]+)$/;

function isResolvable(id: string): boolean {
  return (
    PLACEHOLDER_GROUP.test(id) ||
    PLACEHOLDER_W.test(id) ||
    PLACEHOLDER_L.test(id) ||
    PLACEHOLDER_3RD.test(id)
  );
}

function computeGroupRanks(
  matches: Match[],
  teams: Team[]
): Map<string, Map<number, string>> {
  const byGroup = new Map<string, string[]>();
  for (const t of teams) {
    if (!t.groupId) continue;
    const arr = byGroup.get(t.groupId) ?? [];
    arr.push(t.id);
    byGroup.set(t.groupId, arr);
  }
  const result = new Map<string, Map<number, string>>();
  for (const [groupId, teamIds] of byGroup) {
    const groupMatches = matches.filter(
      (m) => m.stage === "group" && m.groupId === groupId
    );
    // トーナメント表への自動反映は「試合終了 (status === "finished") かつ
    // score 確定」したものだけを clinch 計算に使う。ライブ中のスコアは
    // まだ動く可能性があるため (例: ECU vs CUR がライブで GER の進出が
    // 暫定確定でも、後半に逆転すれば変わる)、ブラケットがちらつくのを防ぐ。
    const finished = groupMatches.filter(
      (m) => m.status === "finished" && m.score
    );
    const remaining = groupMatches.filter(
      (m) => m.status !== "finished" || !m.score
    );
    result.set(groupId, clinchedRanks(teamIds, groupId, finished, remaining));
  }
  return result;
}

/**
 * 全 72 試合のグループ戦が終わっていれば 3 位ワイルドカードを解決し、
 * 「プレースホルダ ID → 実 team ID」の Map を返す。途中段階では空 Map。
 */
function resolveThirdPlaceWildcards(
  matches: Match[],
  teams: Team[],
  assignment: ThirdPlaceAssignment | null
): Map<string, string> {
  const result = new Map<string, string>();
  if (!assignment) return result;

  // 全グループ戦が finished か（live や scheduled が1つでもあれば未確定扱い）
  const groupMatches = matches.filter((m) => m.stage === "group");
  if (groupMatches.length === 0) return result;
  if (groupMatches.some((m) => m.status !== "finished" || !m.score))
    return result;

  // 全グループ分の順位表を一括計算 (フェアプレーポイント含む)
  const allStandings = computeStandings(teams, matches);
  const byGroup = new Map<string, Standing[]>();
  for (const s of allStandings) {
    const arr = byGroup.get(s.groupId) ?? [];
    arr.push(s);
    byGroup.set(s.groupId, arr);
  }

  const thirdByGroup = new Map<string, Standing>();
  for (const [groupId, group] of byGroup) {
    // グループ内 3 位は H2H 含むフル FIFA タイブレーカーで確定
    const sorted = sortGroupStandings(group, matches);
    if (sorted.length >= 3) thirdByGroup.set(groupId, sorted[2]);
  }

  if (thirdByGroup.size < 8) return result; // 3位がそろわなければ解決できない

  // 12グループの3位を横断ソートし、上位8グループを抽出 (cross-group なので H2H 無し)
  const ranked = [...thirdByGroup.entries()].sort((a, b) =>
    compareCrossGroup(a[1], b[1])
  );
  const top8Groups = ranked
    .slice(0, 8)
    .map(([groupId]) => groupId)
    .sort()
    .join("");

  const combo = assignment.combinations[top8Groups];
  if (!combo) {
    // 想定外のキー（データ不整合）。安全側に倒して何もしない。
    return result;
  }

  // FIFA 表の {matchId: groupLetter} を実 team ID に変換し、
  // その matchId の awayTeamId プレースホルダ → team ID の Map に積む
  const matchById = new Map(matches.map((m) => [m.id, m]));
  for (const [matchId, groupLetter] of Object.entries(combo)) {
    const m = matchById.get(matchId);
    if (!m) continue;
    const third = thirdByGroup.get(groupLetter);
    if (!third) continue;
    // 3位ワイルドカードは matches.json 上では awayTeamId 側にしか出ない想定
    if (PLACEHOLDER_3RD.test(m.awayTeamId)) {
      result.set(m.awayTeamId, third.teamId);
    } else if (PLACEHOLDER_3RD.test(m.homeTeamId)) {
      result.set(m.homeTeamId, third.teamId);
    }
  }

  return result;
}

export function resolveMatchTeams(
  matches: Match[],
  teams: Team[],
  thirdPlaceAssignment: ThirdPlaceAssignment | null = null
): Match[] {
  const groupRanks = computeGroupRanks(matches, teams);
  const thirdResolution = resolveThirdPlaceWildcards(
    matches,
    teams,
    thirdPlaceAssignment
  );
  const teamIdSet = new Set(teams.map((t) => t.id));

  const winnerOf = new Map<number, string>();
  const loserOf = new Map<number, string>();

  const resolveId = (id: string): string => {
    const g = PLACEHOLDER_GROUP.exec(id);
    if (g) {
      const cand = groupRanks.get(g[1])?.get(parseInt(g[2], 10));
      return cand && teamIdSet.has(cand) ? cand : id;
    }
    const t3 = PLACEHOLDER_3RD.exec(id);
    if (t3) {
      const cand = thirdResolution.get(id);
      return cand && teamIdSet.has(cand) ? cand : id;
    }
    const w = PLACEHOLDER_W.exec(id);
    if (w) {
      const cand = winnerOf.get(parseInt(w[1], 10));
      return cand && teamIdSet.has(cand) ? cand : id;
    }
    const l = PLACEHOLDER_L.exec(id);
    if (l) {
      const cand = loserOf.get(parseInt(l[1], 10));
      return cand && teamIdSet.has(cand) ? cand : id;
    }
    return id;
  };

  const applyTo = (m: Match): Match => {
    const newHome = resolveId(m.homeTeamId);
    const newAway = resolveId(m.awayTeamId);
    if (newHome === m.homeTeamId && newAway === m.awayTeamId) return m;
    const next: Match = { ...m, homeTeamId: newHome, awayTeamId: newAway };
    if (newHome !== m.homeTeamId) next.homeTeamLabel = undefined;
    if (newAway !== m.awayTeamId) next.awayTeamLabel = undefined;
    return next;
  };

  // W##/L## は常に「より小さい試合番号」を参照するため、試合番号順に処理すれば
  // 単純ループ1回でカスケード解決できる。グループ戦・test は番号無関係なので先に処理。
  const result: Match[] = new Array(matches.length);
  const koSorted: { idx: number; num: number }[] = [];

  matches.forEach((m, idx) => {
    if (m.stage === "group" || m.stage === "test") {
      result[idx] = applyTo(m);
    } else {
      const num = matchNumber(m.id);
      if (num !== null) koSorted.push({ idx, num });
      else result[idx] = m;
    }
  });

  koSorted.sort((a, b) => a.num - b.num);

  for (const { idx, num } of koSorted) {
    const resolved = applyTo(matches[idx]);
    result[idx] = resolved;
    if (resolved.status !== "finished" || !resolved.score) continue;
    if (isResolvable(resolved.homeTeamId) || isResolvable(resolved.awayTeamId))
      continue;
    const { home, away } = resolved.score;
    let homeWon: boolean | null = null;
    if (home > away) homeWon = true;
    else if (home < away) homeWon = false;
    else if (resolved.penaltyScore) {
      // 90分+延長で同点 → PK 決着スコアで判定
      const pk = resolved.penaltyScore;
      if (pk.home > pk.away) homeWon = true;
      else if (pk.home < pk.away) homeWon = false;
    }
    if (homeWon === null) continue; // 勝者未確定 (PK スコアも無い場合)
    const winner = homeWon ? resolved.homeTeamId : resolved.awayTeamId;
    const loser = homeWon ? resolved.awayTeamId : resolved.homeTeamId;
    winnerOf.set(num, winner);
    loserOf.set(num, loser);
  }

  return result;
}
