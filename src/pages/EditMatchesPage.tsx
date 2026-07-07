import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useJsonResource } from "@/hooks/useJsonResource";
import { useMatchResults } from "@/hooks/useMatchResults";
import { useTeamMap } from "@/hooks/useTeams";
import { usePlayers } from "@/hooks/usePlayers";
import { Loading, ErrorMessage } from "@/components/common/AsyncState";
import { dataUrl } from "@/utils/dataUrl";
import { matchNumber } from "@/utils/matchNumber";
import { dayKey } from "@/utils/date";
import { generateFormation } from "@/utils/formation";
import { formatMinute, parseMinuteText } from "@/utils/eventMinute";
import type {
  Booking,
  BookingType,
  FormationData,
  Goal,
  GoalType,
  Match,
  MatchStatus,
  PkAttempt,
  PkResult,
  Substitution,
} from "@/types/match";
import type { LiveUpdate } from "@/types/live";
import type { Player } from "@/types/player";
import { loadMatchEdits, saveMatchEdits } from "@/utils/matchEdits";
import styles from "./EditMatchesPage.module.css";

type GoalDraft = {
  minute: string;
  teamId: string;
  playerId: string;
  /** playerId に該当する Player が無い時の表示名フォールバック (Sofascore の英語名等)。
   *  保存時に playerId 未選択でも playerName だけは保持する。 */
  playerName?: string;
  assistPlayerId: string;
  assistPlayerName?: string;
  type: GoalType;
};

type StarterDraft = {
  playerId: string;
  name?: string;
  number?: number;
};

/** フォーメーション編集ドラフト。
 *  - shape: "4-3-3" 等
 *  - starters: 長さ = 1 + Σparts。
 *    index 0 = GK / 以降 layer 0..N-1 の順に「右→左」で並ぶ
 *    (write-m00X-formations.mjs と同じ規約)。
 *  - captainName: キャプテン名 (starting / bench いずれかから 1 名)。
 *    formationToData で `isCaptain` を該当 spot / bench entry に付与する。
 *  - mvpName: MVP 名 (starting / bench いずれかから 1 名)。
 *    formationToData で `isMvp` を該当 spot / bench entry に付与する。 */
type FormationDraft = {
  shape: string;
  starters: StarterDraft[];
  captainName?: string;
  mvpName?: string;
};

type BookingDraft = {
  minute: string;
  teamId: string;
  playerId: string;
  playerName?: string;
  type: BookingType;
};

type SubDraft = {
  minute: string;
  teamId: string;
  inPlayerId: string;
  inName?: string;
  outPlayerId: string;
  outName?: string;
};

type PkDraft = {
  teamId: string;
  playerId: string;
  playerName?: string;
  result: PkResult;
};

/** 編集 UI が直接扱わないフィールド。save 時にそのまま LiveUpdate に書き戻して
 *  巻き込み消去を防ぐ。現状は stats のみ (liveLabel は Phase に統合済み)。 */
type Passthrough = Pick<LiveUpdate, "stats">;

/** 状態ドロップダウンで選べるフェーズ。
 *  "" = 未設定 (status / liveLabel どちらも書き込まない)
 *  "scheduled" / "finished" = status のみ書き込み
 *  "first-half" / "halftime" / "second-half" / "extra-time" = status="live" + 対応する
 *    liveLabel を書き込む。liveLabel は MatchEvents の ハーフタイム / 後半終了 divider
 *    のトリガーに使われる。 */
type Phase =
  | ""
  | "scheduled"
  | "first-half"
  | "halftime"
  | "second-half"
  | "extra-time"
  | "extra-time-second"
  | "finished";

/** Phase → (status, liveLabel) を返す。"" のときは両方 undefined。 */
function phaseToStatusLabel(phase: Phase): {
  status?: MatchStatus;
  liveLabel?: string;
} {
  switch (phase) {
    case "scheduled":
      return { status: "scheduled" };
    case "first-half":
      return { status: "live", liveLabel: "1st half" };
    case "halftime":
      return { status: "live", liveLabel: "Halftime" };
    case "second-half":
      return { status: "live", liveLabel: "2nd half" };
    case "extra-time":
      return { status: "live", liveLabel: "Extra time 1st" };
    case "extra-time-second":
      return { status: "live", liveLabel: "Extra time 2nd" };
    case "finished":
      return { status: "finished", liveLabel: "Full time" };
    case "":
    default:
      return {};
  }
}

/** (status, liveLabel) → Phase に推定。
 *  status="live" の場合 liveLabel の中身で前半/HT/後半/延長戦に振り分け。
 *  どれにも合致しない場合は "first-half" を既定として扱う。 */
function inferPhase(
  status: MatchStatus | undefined,
  liveLabel: string | undefined
): Phase {
  if (status === "scheduled") return "scheduled";
  if (status === "finished") return "finished";
  if (status === "live") {
    const ll = (liveLabel ?? "").toLowerCase();
    if (ll.includes("halftime") || ll.includes("half time")) return "halftime";
    if (ll.includes("extra time 2nd") || ll.includes("extra time break"))
      return "extra-time-second";
    if (ll.includes("extra time") || ll.includes("penalty"))
      return "extra-time";
    if (ll.includes("2nd half") || ll.includes("second half"))
      return "second-half";
    if (ll.includes("1st half") || ll.includes("first half"))
      return "first-half";
    return "first-half";
  }
  return "";
}

type Editable = {
  /** 状態ドロップダウンが選んだ Phase。save 時に status + liveLabel に展開される。 */
  status: Phase;
  scoreHome: string;
  scoreAway: string;
  pkHome: string;
  pkAway: string;
  /** チェックすると periodic-catchup / GitHub Actions が score/status/PK を
   *  自動更新しなくなる。Football-Data が公式と食い違うケース用の手動保護。 */
  manualLock: boolean;
  /** 試合の特記事項テロップ (例: "中断中")。設定するとライブ中に琥珀色バッジで
   *  表示される。空文字を保存すると明示的にクリア扱い。manualLock=true のときのみ
   *  matchEdits に書き込まれる (FD の note 自動更新と競合させないため)。 */
  note: string;
  goals: GoalDraft[];
  homeFormation: FormationDraft;
  awayFormation: FormationDraft;
  bookings: BookingDraft[];
  substitutions: SubDraft[];
  /** PK 戦の蹴った順序。配列の並び = 蹴順。 */
  penaltyShootout: PkDraft[];
  passthrough: Passthrough;
};

function freshEditable(): Editable {
  return {
    status: "",
    scoreHome: "",
    scoreAway: "",
    pkHome: "",
    pkAway: "",
    manualLock: false,
    note: "",
    goals: [],
    homeFormation: { shape: "", starters: [] },
    awayFormation: { shape: "", starters: [] },
    bookings: [],
    substitutions: [],
    penaltyShootout: [],
    passthrough: {},
  };
}

const STAGE_ORDER: Match["stage"][] = [
  "group",
  "round32",
  "round16",
  "quarter",
  "semi",
  "third",
  "final",
];

const STAGE_LABEL: Record<Match["stage"], string> = {
  test: "テスト",
  group: "グループ",
  round32: "R32",
  round16: "R16",
  quarter: "QF",
  semi: "SF",
  third: "3位",
  final: "決勝",
};

const GOAL_TYPE_LABEL: Record<GoalType, string> = {
  normal: "通常",
  penalty: "PK",
  own: "オウン",
};

const BOOKING_TYPE_LABEL: Record<BookingType, string> = {
  Y: "🟨 イエロー",
  Y2R: "🟨🟥 2枚目イエロー",
  R: "🟥 一発レッド",
  YR: "🟨→🟥 イエロー後レッド",
};

const PK_RESULT_LABEL: Record<PkResult, string> = {
  scored: "⚽ 成功",
  missed: "✕ 失敗",
};

/** shape 入力フィールドのサジェスト用候補。 */
const SHAPE_SUGGESTIONS = [
  "4-3-3",
  "4-2-3-1",
  "4-1-2-3",
  "4-4-2",
  "4-4-1-1",
  "4-1-4-1",
  "4-3-2-1",
  "4-3-1-2",
  "3-5-2",
  "3-4-3",
  "3-4-2-1",
  "3-4-1-2",
  "3-1-4-2",
  "5-3-2",
  "5-4-1",
];

function parseShape(shape: string): number[] {
  return shape
    .split("-")
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function expectedStarterCount(shape: string): number {
  const parts = parseShape(shape);
  if (parts.length === 0) return 0;
  return 1 + parts.reduce((a, b) => a + b, 0);
}

function syncStarters(starters: StarterDraft[], shape: string): StarterDraft[] {
  const need = expectedStarterCount(shape);
  if (need === 0) return [];
  const next = starters.slice(0, need);
  while (next.length < need)
    next.push({ playerId: "", name: undefined, number: undefined });
  return next;
}

function goalToDraft(g: Goal): GoalDraft {
  return {
    minute: formatMinute(g.minute, g.addedTime),
    teamId: g.teamId,
    playerId: g.playerId ?? "",
    playerName: g.playerName,
    assistPlayerId: g.assistPlayerId ?? "",
    assistPlayerName: g.assistPlayerName,
    type: g.type ?? "normal",
  };
}

function draftToGoal(
  d: GoalDraft,
  playerMap: Map<string, Player>
): Goal | null {
  const m = parseMinuteText(d.minute);
  if (!m || !d.teamId) return null;
  const goal: Goal = { minute: m.minute, teamId: d.teamId, type: d.type };
  if (m.addedTime) goal.addedTime = m.addedTime;
  const player = d.playerId ? playerMap.get(d.playerId) : undefined;
  if (player) {
    goal.playerId = player.id;
    goal.playerName = player.name;
  } else if (d.playerName) {
    goal.playerName = d.playerName;
  }
  const assist = d.assistPlayerId ? playerMap.get(d.assistPlayerId) : undefined;
  if (assist) {
    goal.assistPlayerId = assist.id;
    goal.assistPlayerName = assist.name;
  } else if (d.assistPlayerName) {
    goal.assistPlayerName = d.assistPlayerName;
  }
  return goal;
}

function formationFromData(
  f: FormationData | undefined,
  teamPlayers: Player[]
): FormationDraft {
  if (!f) return { shape: "", starters: [] };
  const byNumber = new Map<number, Player>();
  const byName = new Map<string, Player>();
  for (const p of teamPlayers) {
    if (typeof p.number === "number") byNumber.set(p.number, p);
    byName.set(p.name, p);
  }
  const starters: StarterDraft[] = (f.starting ?? []).map((s) => {
    const p =
      (typeof s.number === "number" ? byNumber.get(s.number) : undefined) ??
      byName.get(s.name);
    return {
      playerId: p?.id ?? "",
      name: p?.name ?? s.name,
      number: p?.number ?? s.number,
    };
  });
  const captainSpot = (f.starting ?? []).find((s) => s.isCaptain);
  const captainBench = (f.bench ?? []).find((b) => b.isCaptain);
  const captainName = captainSpot?.name ?? captainBench?.name;
  const mvpSpot = (f.starting ?? []).find((s) => s.isMvp);
  const mvpBench = (f.bench ?? []).find((b) => b.isMvp);
  const mvpName = mvpSpot?.name ?? mvpBench?.name;
  return {
    shape: f.shape,
    starters,
    ...(captainName ? { captainName } : {}),
    ...(mvpName ? { mvpName } : {}),
  };
}

function formationToData(
  d: FormationDraft,
  teamPlayers: Player[],
  playerMap: Map<string, Player>
): FormationData | undefined {
  if (!d.shape) return undefined;
  const need = expectedStarterCount(d.shape);
  if (need === 0) return undefined;
  if (d.starters.length !== need) return undefined;
  const hasAny = d.starters.some((s) => s.playerId || s.name);
  if (!hasAny) return undefined;

  const rawPlayers = d.starters.map((s) => {
    const p = s.playerId ? playerMap.get(s.playerId) : undefined;
    const name = p?.name ?? s.name ?? "?";
    const number = p?.number ?? s.number;
    return { number, name };
  });

  // ベンチは「そのチームの全選手 − スタメン11名」を背番号順で自動算出。
  const starterIds = new Set(
    d.starters.map((s) => s.playerId).filter(Boolean)
  );
  const starterNames = new Set(rawPlayers.map((p) => p.name));
  const bench = teamPlayers
    .filter((p) => !starterIds.has(p.id) && !starterNames.has(p.name))
    .sort((a, b) => (a.number ?? 999) - (b.number ?? 999))
    .map((p) => ({ number: p.number, name: p.name }));

  const formation = generateFormation(d.shape, rawPlayers, bench);
  // キャプテン / MVP: starting / bench どちらかの該当エントリにフラグを付与
  const markFlag = (name: string, key: "isCaptain" | "isMvp") => {
    const sIdx = formation.starting.findIndex((s) => s.name === name);
    if (sIdx >= 0) {
      formation.starting[sIdx] = { ...formation.starting[sIdx], [key]: true };
      return;
    }
    if (!formation.bench) return;
    const bIdx = formation.bench.findIndex((b) => b.name === name);
    if (bIdx >= 0) {
      formation.bench[bIdx] = { ...formation.bench[bIdx], [key]: true };
    }
  };
  if (d.captainName) markFlag(d.captainName, "isCaptain");
  if (d.mvpName) markFlag(d.mvpName, "isMvp");
  return formation;
}

function bookingToDraft(
  b: Booking,
  playersByTeam: Map<string, Player[]>
): BookingDraft {
  const arr = playersByTeam.get(b.teamId) ?? [];
  const p = arr.find((x) => x.name === b.playerName);
  return {
    minute: formatMinute(b.minute, b.addedTime),
    teamId: b.teamId,
    playerId: p?.id ?? "",
    playerName: b.playerName,
    type: b.type ?? "Y",
  };
}

function draftToBooking(
  d: BookingDraft,
  playerMap: Map<string, Player>
): Booking | null {
  const m = parseMinuteText(d.minute);
  if (!m || !d.teamId) return null;
  const p = d.playerId ? playerMap.get(d.playerId) : undefined;
  const name = p?.name ?? d.playerName ?? "";
  if (!name) return null;
  const out: Booking = {
    minute: m.minute,
    teamId: d.teamId,
    playerName: name,
    type: d.type,
  };
  if (m.addedTime) out.addedTime = m.addedTime;
  return out;
}

function subToDraft(
  s: Substitution,
  playersByTeam: Map<string, Player[]>
): SubDraft {
  const arr = playersByTeam.get(s.teamId) ?? [];
  const inP = arr.find((x) => x.name === s.inName);
  const outP = arr.find((x) => x.name === s.outName);
  return {
    minute: formatMinute(s.minute, s.addedTime),
    teamId: s.teamId,
    inPlayerId: inP?.id ?? "",
    inName: s.inName,
    outPlayerId: outP?.id ?? "",
    outName: s.outName,
  };
}

function pkToDraft(
  a: PkAttempt,
  playersByTeam: Map<string, Player[]>
): PkDraft {
  const arr = playersByTeam.get(a.teamId) ?? [];
  const p = a.playerId
    ? arr.find((x) => x.id === a.playerId)
    : a.playerName
      ? arr.find((x) => x.name === a.playerName)
      : undefined;
  return {
    teamId: a.teamId,
    playerId: p?.id ?? a.playerId ?? "",
    playerName: a.playerName,
    result: a.result,
  };
}

function draftToPk(
  d: PkDraft,
  playerMap: Map<string, Player>
): PkAttempt | null {
  if (!d.teamId) return null;
  const p = d.playerId ? playerMap.get(d.playerId) : undefined;
  const out: PkAttempt = { teamId: d.teamId, result: d.result };
  if (p) {
    out.playerId = p.id;
    out.playerName = p.name;
  } else if (d.playerName) {
    out.playerName = d.playerName;
  }
  return out;
}

function draftToSub(
  d: SubDraft,
  playerMap: Map<string, Player>
): Substitution | null {
  const m = parseMinuteText(d.minute);
  if (!m || !d.teamId) return null;
  const inName =
    (d.inPlayerId ? playerMap.get(d.inPlayerId)?.name : undefined) ??
    d.inName ??
    "";
  const outName =
    (d.outPlayerId ? playerMap.get(d.outPlayerId)?.name : undefined) ??
    d.outName ??
    "";
  if (!inName || !outName) return null;
  const out: Substitution = {
    minute: m.minute,
    teamId: d.teamId,
    inName,
    outName,
  };
  if (m.addedTime) out.addedTime = m.addedTime;
  return out;
}

/** 交代枠を「ホーム最低 5 / アウェイ最低 5」になるよう空エントリで補充する。
 *  finished の試合で **既に交代エントリが 1 つ以上入っている** ケースだけは
 *  触らない (= 編集完了済みとみなしてこれ以上枠を増やさない)。
 *  finished + 交代 0 件のケース (試合終了直後でまだ手入力していない) は
 *  5+5 枠を出して即入力できるようにする。
 *  空のまま保存しても draftToSub が null を返すので、公開サイト (試合詳細)
 *  には反映されない (= 未記入は試合詳細に出ない)。 */
function padSubstitutions(editable: Editable, match: Match): Editable {
  const effectiveStatus = editable.status || match.status;
  if (effectiveStatus === "finished" && editable.substitutions.length > 0)
    return editable;
  const homeCount = editable.substitutions.filter(
    (s) => s.teamId === match.homeTeamId
  ).length;
  const awayCount = editable.substitutions.filter(
    (s) => s.teamId === match.awayTeamId
  ).length;
  const homeToAdd = Math.max(0, 5 - homeCount);
  const awayToAdd = Math.max(0, 5 - awayCount);
  if (homeToAdd === 0 && awayToAdd === 0) return editable;
  const padded = [...editable.substitutions];
  for (let i = 0; i < homeToAdd; i++) {
    padded.push({
      minute: "",
      teamId: match.homeTeamId,
      inPlayerId: "",
      outPlayerId: "",
    });
  }
  for (let i = 0; i < awayToAdd; i++) {
    padded.push({
      minute: "",
      teamId: match.awayTeamId,
      inPlayerId: "",
      outPlayerId: "",
    });
  }
  return { ...editable, substitutions: padded };
}

function fromUpdate(
  u: LiveUpdate | undefined,
  match: Match,
  playersByTeam: Map<string, Player[]>
): Editable {
  const e = freshEditable();
  if (!u) return e;

  if (u.stats) e.passthrough.stats = u.stats;

  // (status, liveLabel) → Phase に逆算してドロップダウンの選択値とする
  e.status = inferPhase(u.status, u.liveLabel);
  e.scoreHome = u.score ? String(u.score.home) : "";
  e.scoreAway = u.score ? String(u.score.away) : "";
  e.pkHome = u.penaltyScore ? String(u.penaltyScore.home) : "";
  e.pkAway = u.penaltyScore ? String(u.penaltyScore.away) : "";
  e.manualLock = u.manualLock === true;
  e.note = u.note ?? "";
  e.goals = (u.goals ?? []).map(goalToDraft);

  const homePlayers = playersByTeam.get(match.homeTeamId) ?? [];
  const awayPlayers = playersByTeam.get(match.awayTeamId) ?? [];
  e.homeFormation = formationFromData(u.homeFormation, homePlayers);
  e.awayFormation = formationFromData(u.awayFormation, awayPlayers);
  e.bookings = (u.bookings ?? []).map((b) => bookingToDraft(b, playersByTeam));
  e.substitutions = (u.substitutions ?? []).map((s) =>
    subToDraft(s, playersByTeam)
  );
  e.penaltyShootout = (u.penaltyShootout ?? []).map((a) =>
    pkToDraft(a, playersByTeam)
  );
  return e;
}

function toUpdate(
  matchId: string,
  e: Editable,
  playerMap: Map<string, Player>,
  match: Match,
  playersByTeam: Map<string, Player[]>
): LiveUpdate | null {
  const u: LiveUpdate = { matchId };
  // status / score / penaltyScore は manualLock=true のときだけ matchEdits に
  // 含める。理由: これら 3 フィールドは Football-Data 経由の periodic-catchup /
  // GitHub Actions が自動更新する責務。ロックなしで含めると、auto-sync が
  // 自動同期された (= 古い snapshot 由来の) 値で file を上書きし、periodic-
  // catchup が直す → auto-sync が再度上書き、というフラップ事故が起きる。
  // (2026-06-28: m001/m002/m007/m072 等で finished/live ⇄ scheduled が
  // 繰り返し書き戻される事故があった。原因はこの分岐がなかったこと)
  if (e.manualLock) {
    // Phase → (status, liveLabel) に展開。phase="" のときは両方とも未指定。
    const { status, liveLabel } = phaseToStatusLabel(e.status);
    if (status) u.status = status;
    if (liveLabel !== undefined) u.liveLabel = liveLabel;
    if (e.scoreHome !== "" && e.scoreAway !== "") {
      const h = Number(e.scoreHome);
      const a = Number(e.scoreAway);
      if (Number.isFinite(h) && Number.isFinite(a))
        u.score = { home: h, away: a };
    }
    if (e.pkHome !== "" && e.pkAway !== "") {
      const h = Number(e.pkHome);
      const a = Number(e.pkAway);
      if (Number.isFinite(h) && Number.isFinite(a))
        u.penaltyScore = { home: h, away: a };
    }
    // note は空文字も書き出す (明示クリア用)。"中断中" を入れれば琥珀バッジ表示、
    // 空にすれば file の note を "" で上書き → LiveBadge が通常表示に戻る。
    u.note = e.note;
  }
  // manualLock は常に出力 (true でも false でも)。field-level merge で
  // 既存値を確実に上書きできるようにするため。"true → false" でロック解除
  // を反映するには boolean を必ず送る必要がある。
  u.manualLock = e.manualLock;
  const goals = e.goals
    .map((d) => draftToGoal(d, playerMap))
    .filter((g): g is Goal => g !== null)
    .sort((a, b) => a.minute - b.minute);
  if (goals.length > 0) u.goals = goals;

  const homeF = formationToData(
    e.homeFormation,
    playersByTeam.get(match.homeTeamId) ?? [],
    playerMap
  );
  if (homeF) u.homeFormation = homeF;
  const awayF = formationToData(
    e.awayFormation,
    playersByTeam.get(match.awayTeamId) ?? [],
    playerMap
  );
  if (awayF) u.awayFormation = awayF;

  const bookings = e.bookings
    .map((d) => draftToBooking(d, playerMap))
    .filter((b): b is Booking => b !== null)
    .sort((a, b) => a.minute - b.minute);
  if (bookings.length > 0) u.bookings = bookings;

  const subs = e.substitutions
    .map((d) => draftToSub(d, playerMap))
    .filter((s): s is Substitution => s !== null)
    .sort((a, b) => a.minute - b.minute);
  if (subs.length > 0) u.substitutions = subs;

  // PK 戦は配列の並び順がそのまま蹴順なのでソートしない。
  const pks = e.penaltyShootout
    .map((d) => draftToPk(d, playerMap))
    .filter((a): a is PkAttempt => a !== null);
  if (pks.length > 0) {
    u.penaltyShootout = pks;
    // PK スコアは attempts (蹴ったキッカー × scored/missed) から自動算出し、
    // 行内の手動 PK 入力欄 (pkHome/pkAway) より優先する。manualLock 不要 —
    // shootout 詳細を入力していれば集計は自動なので、その値を必ず保存する。
    const homeScored = pks.filter(
      (p) => p.teamId === match.homeTeamId && p.result === "scored"
    ).length;
    const awayScored = pks.filter(
      (p) => p.teamId === match.awayTeamId && p.result === "scored"
    ).length;
    u.penaltyScore = { home: homeScored, away: awayScored };
  }

  const p = e.passthrough;
  if (p.stats) u.stats = p.stats;

  if (
    !u.status &&
    !u.score &&
    !u.penaltyScore &&
    !u.penaltyShootout &&
    !u.goals &&
    !u.bookings &&
    !u.substitutions &&
    !u.homeFormation &&
    !u.awayFormation &&
    !u.stats &&
    !u.manualLock
  )
    return null;
  return u;
}

export function EditMatchesPage() {
  const matchesRes = useJsonResource<Match[]>(dataUrl("matches.json"));
  const fileResultsRes = useMatchResults();
  const teamsRes = useTeamMap();
  const playersRes = usePlayers();

  const playerMap = useMemo(() => {
    const m = new Map<string, Player>();
    if (playersRes.status === "ready")
      playersRes.data.forEach((p) => m.set(p.id, p));
    return m;
  }, [playersRes]);

  const playersByTeam = useMemo(() => {
    const m = new Map<string, Player[]>();
    if (playersRes.status === "ready") {
      for (const p of playersRes.data) {
        const arr = m.get(p.teamId) ?? [];
        arr.push(p);
        m.set(p.teamId, arr);
      }
      for (const arr of m.values())
        arr.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    }
    return m;
  }, [playersRes]);

  const [edits, setEdits] = useState<Record<string, Editable>>({});
  const [stageFilter, setStageFilter] = useState<Match["stage"] | "all">("all");
  const [todayOnly, setTodayOnly] = useState(true);
  const [savedMsg, setSavedMsg] = useState("");
  const [exportText, setExportText] = useState("");
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showBackTop, setShowBackTop] = useState(false);

  // ページ下方へスクロールしたら「↑ 上へ」ボタンを出す (400px 超で表示)。
  useEffect(() => {
    const onScroll = () => setShowBackTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // file (公式記録) と matchEdits (手動編集レイヤー) を「file → manual」の順で
  // 重ねて初期値とする。両方ある場合は manual のフィールドが file の同名
  // フィールドを上書きする。
  // matchOverrides (ライブ取得レイヤー) は seed に使わない — 編集 UI は
  // 「手動で確定した公式記録」のみを扱う。スコア/ステータス/PK は下の
  // auto-sync useEffect が matchesRes 経由 (live > manual > file > base) で
  // 追従させるので、「↓ ライブ」ボタンを押さなくても自動で最新値になる。
  useEffect(() => {
    if (matchesRes.status !== "ready") return;
    const fileResults =
      fileResultsRes.status === "ready" ? fileResultsRes.data : {};
    const manual = loadMatchEdits();
    // 既に edits state に存在する試合は触らない。
    // 理由: live polling や matchEdits 変更で matchesRes が再生成される
    // たびに seed useEffect が再実行されるが、その時に setEdits(seed) で
    // 全置換すると「typed-but-unsaved な入力」「pad 済みの空 10 枠」が
    // ライブ取得タイミングごとに消失する。初期化されていない試合だけ
    // 構築すれば、既存編集セッションを守れる。
    setEdits((prev) => {
      const next: Record<string, Editable> = { ...prev };
      for (const m of matchesRes.data) {
        if (next[m.id]) continue;
        const fileR = fileResults[m.id];
        const manualR = manual[m.id];
        const combined: LiveUpdate | undefined =
          fileR && manualR
            ? { ...fileR, ...manualR }
            : (manualR ?? fileR);
        next[m.id] = padSubstitutions(
          fromUpdate(combined, m, playersByTeam),
          m
        );
      }
      return next;
    });
  }, [matchesRes, fileResultsRes, playersByTeam]);

  // status / score / penaltyScore の 3 フィールドだけ matchesRes (= live > manual >
  // file > base の最終マージ結果) から自動同期する。これで GitHub Actions が
  // file を更新した / ライブ polling が来た / 他デバイスから push された場合も、
  // 「↓ ライブ」ボタンを押さずに編集フォームのスコア表示が追従する。
  // goals / formation / bookings / substitutions / passthrough は手動編集領域なので
  // 触らない (Football-Data の無料枠はそもそも返さない、保護フィールド)。
  // 既に手動で matchEdits に保存していれば manual レイヤーが file に勝つので、
  // 確定済みの値は GitHub Actions に上書きされない。
  //
  // 例外: manualLock=true の試合は auto-sync をスキップして手動編集値を保護する。
  // 理由: 古い matchEdits.status (例 "scheduled") が manual レイヤーとして残ったまま
  // file.status="finished" を上書きすると、ユーザーがドロップダウンで "finished" に
  // 変更してリロードしても矛盾値で逆戻り表示される問題があった。manualLock=true は
  // 「手動値を最優先する」明示シグナルなので、auto-sync はそれを尊重する。
  useEffect(() => {
    if (matchesRes.status !== "ready") return;
    setEdits((prev) => {
      let changed = false;
      const next: Record<string, Editable> = { ...prev };
      for (const m of matchesRes.data) {
        const cur = next[m.id];
        if (!cur) continue;
        if (cur.manualLock) continue; // manualLock=true は手動値を保護
        // (status, liveLabel) から Phase を逆算して比較・反映する
        const inPhase = inferPhase(m.status, m.liveLabel);
        const inScoreH = m.score ? String(m.score.home) : "";
        const inScoreA = m.score ? String(m.score.away) : "";
        const inPkH = m.penaltyScore ? String(m.penaltyScore.home) : "";
        const inPkA = m.penaltyScore ? String(m.penaltyScore.away) : "";
        const inNote = m.note ?? "";
        if (
          cur.status === inPhase &&
          cur.scoreHome === inScoreH &&
          cur.scoreAway === inScoreA &&
          cur.pkHome === inPkH &&
          cur.pkAway === inPkA &&
          cur.note === inNote
        )
          continue;
        next[m.id] = {
          ...cur,
          status: inPhase,
          scoreHome: inScoreH,
          scoreAway: inScoreA,
          pkHome: inPkH,
          pkAway: inPkA,
          note: inNote,
        };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [matchesRes]);

  if (
    matchesRes.status === "loading" ||
    teamsRes.status === "loading" ||
    playersRes.status === "loading"
  )
    return <Loading />;
  if (matchesRes.status === "error")
    return <ErrorMessage message={matchesRes.error} />;
  if (teamsRes.status === "error")
    return <ErrorMessage message={teamsRes.error} />;
  if (playersRes.status === "error")
    return <ErrorMessage message={playersRes.error} />;

  const allMatches = [...matchesRes.data].sort((a, b) => {
    const an = matchNumber(a.id) ?? 0;
    const bn = matchNumber(b.id) ?? 0;
    return an - bn;
  });
  const todayKey = dayKey(new Date().toISOString());
  const filtered = allMatches.filter((m) => {
    if (stageFilter !== "all" && m.stage !== stageFilter) return false;
    if (todayOnly && dayKey(m.date) !== todayKey) return false;
    return true;
  });

  const updateEdit = (matchId: string, patch: Partial<Editable>) => {
    setEdits((prev) => ({
      ...prev,
      [matchId]: { ...(prev[matchId] ?? freshEditable()), ...patch },
    }));
  };

  const updateGoal = (
    matchId: string,
    idx: number,
    patch: Partial<GoalDraft>
  ) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? freshEditable();
      const goals = [...cur.goals];
      goals[idx] = { ...goals[idx], ...patch };
      return { ...prev, [matchId]: { ...cur, goals } };
    });
  };

  const addGoal = (match: Match) => {
    setEdits((prev) => {
      const cur = prev[match.id] ?? freshEditable();
      const goals = [...cur.goals];
      goals.push({
        minute: "",
        teamId: match.homeTeamId,
        playerId: "",
        assistPlayerId: "",
        type: "normal",
      });
      return { ...prev, [match.id]: { ...cur, goals } };
    });
  };

  const removeGoal = (matchId: string, idx: number) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? freshEditable();
      const goals = cur.goals.filter((_, i) => i !== idx);
      return { ...prev, [matchId]: { ...cur, goals } };
    });
  };

  const updateShape = (matchId: string, side: "home" | "away", shape: string) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? freshEditable();
      const key = side === "home" ? "homeFormation" : "awayFormation";
      const f = cur[key];
      const starters = syncStarters(f.starters, shape);
      return { ...prev, [matchId]: { ...cur, [key]: { ...f, shape, starters } } };
    });
  };

  const updateStarter = (
    matchId: string,
    side: "home" | "away",
    idx: number,
    patch: Partial<StarterDraft>
  ) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? freshEditable();
      const key = side === "home" ? "homeFormation" : "awayFormation";
      const f = cur[key];
      const starters = [...f.starters];
      starters[idx] = { ...(starters[idx] ?? { playerId: "" }), ...patch };
      return { ...prev, [matchId]: { ...cur, [key]: { ...f, starters } } };
    });
  };

  const updateCaptain = (
    matchId: string,
    side: "home" | "away",
    captainName: string
  ) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? freshEditable();
      const key = side === "home" ? "homeFormation" : "awayFormation";
      const f = cur[key];
      return {
        ...prev,
        [matchId]: {
          ...cur,
          [key]: { ...f, captainName: captainName || undefined },
        },
      };
    });
  };

  const updateMvp = (
    matchId: string,
    side: "home" | "away",
    mvpName: string
  ) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? freshEditable();
      // MVP は試合 1 人。反対側のチームに既に MVP が立っていれば外す。
      const otherKey =
        side === "home" ? "awayFormation" : "homeFormation";
      const selfKey = side === "home" ? "homeFormation" : "awayFormation";
      const self = cur[selfKey];
      const other = cur[otherKey];
      return {
        ...prev,
        [matchId]: {
          ...cur,
          [selfKey]: { ...self, mvpName: mvpName || undefined },
          ...(mvpName && other.mvpName
            ? { [otherKey]: { ...other, mvpName: undefined } }
            : {}),
        },
      };
    });
  };

  const updateBooking = (
    matchId: string,
    idx: number,
    patch: Partial<BookingDraft>
  ) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? freshEditable();
      const bookings = [...cur.bookings];
      bookings[idx] = { ...bookings[idx], ...patch };
      return { ...prev, [matchId]: { ...cur, bookings } };
    });
  };

  const addBooking = (match: Match) => {
    setEdits((prev) => {
      const cur = prev[match.id] ?? freshEditable();
      const bookings = [
        ...cur.bookings,
        {
          minute: "",
          teamId: match.homeTeamId,
          playerId: "",
          type: "Y" as BookingType,
        },
      ];
      return { ...prev, [match.id]: { ...cur, bookings } };
    });
  };

  const removeBooking = (matchId: string, idx: number) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? freshEditable();
      const bookings = cur.bookings.filter((_, i) => i !== idx);
      return { ...prev, [matchId]: { ...cur, bookings } };
    });
  };

  const updateSub = (
    matchId: string,
    idx: number,
    patch: Partial<SubDraft>
  ) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? freshEditable();
      const subs = [...cur.substitutions];
      subs[idx] = { ...subs[idx], ...patch };
      return { ...prev, [matchId]: { ...cur, substitutions: subs } };
    });
  };

  const addSub = (match: Match) => {
    setEdits((prev) => {
      const cur = prev[match.id] ?? freshEditable();
      const subs = [
        ...cur.substitutions,
        {
          minute: "",
          teamId: match.homeTeamId,
          inPlayerId: "",
          outPlayerId: "",
        },
      ];
      return { ...prev, [match.id]: { ...cur, substitutions: subs } };
    });
  };

  const removeSub = (matchId: string, idx: number) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? freshEditable();
      const subs = cur.substitutions.filter((_, i) => i !== idx);
      return { ...prev, [matchId]: { ...cur, substitutions: subs } };
    });
  };

  const updatePk = (
    matchId: string,
    idx: number,
    patch: Partial<PkDraft>
  ) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? freshEditable();
      const pks = [...cur.penaltyShootout];
      pks[idx] = { ...pks[idx], ...patch };
      return { ...prev, [matchId]: { ...cur, penaltyShootout: pks } };
    });
  };

  const addPk = (match: Match, firstTeamIdIfEmpty?: string) => {
    setEdits((prev) => {
      const cur = prev[match.id] ?? freshEditable();
      // 既存の蹴った順から次のチームを推定 (ホーム → アウェイ → ホーム...)。
      // 空の場合は先攻選択を反映 (未指定ならホームがデフォルト)。
      const last = cur.penaltyShootout[cur.penaltyShootout.length - 1];
      const nextTeamId = last
        ? last.teamId === match.homeTeamId
          ? match.awayTeamId
          : match.homeTeamId
        : (firstTeamIdIfEmpty ?? match.homeTeamId);
      const pks = [
        ...cur.penaltyShootout,
        {
          teamId: nextTeamId,
          playerId: "",
          result: "scored" as PkResult,
        },
      ];
      return { ...prev, [match.id]: { ...cur, penaltyShootout: pks } };
    });
  };

  const removePk = (matchId: string, idx: number) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? freshEditable();
      const pks = cur.penaltyShootout.filter((_, i) => i !== idx);
      return { ...prev, [matchId]: { ...cur, penaltyShootout: pks } };
    });
  };

  const movePk = (matchId: string, idx: number, dir: -1 | 1) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? freshEditable();
      const pks = [...cur.penaltyShootout];
      const j = idx + dir;
      if (j < 0 || j >= pks.length) return prev;
      [pks[idx], pks[j]] = [pks[j], pks[idx]];
      return { ...prev, [matchId]: { ...cur, penaltyShootout: pks } };
    });
  };

  const handleSave = () => {
    const next: Record<string, LiveUpdate> = {};
    for (const m of allMatches) {
      const e = edits[m.id];
      if (!e) continue;
      const u = toUpdate(m.id, e, playerMap, m, playersByTeam);
      if (u) next[m.id] = u;
    }
    saveMatchEdits(next);
    setSavedMsg(
      `${Object.keys(next).length} 試合分を手動編集レイヤー (matchEdits) に保存しました`
    );
    setTimeout(() => setSavedMsg(""), 3000);
  };

  const handleClear = () => {
    if (
      !confirm(
        "手動編集レイヤー (matchEdits) を全クリアします。ライブ取得 (matchOverrides) はそのまま残ります。よろしいですか？"
      )
    )
      return;
    saveMatchEdits({});
    const cleared: Record<string, Editable> = {};
    for (const m of allMatches)
      cleared[m.id] = padSubstitutions(freshEditable(), m);
    setEdits(cleared);
    setSavedMsg("手動編集をクリアしました");
    setTimeout(() => setSavedMsg(""), 3000);
  };

  const handleExport = () => {
    const out: Record<string, LiveUpdate> = {};
    for (const m of allMatches) {
      const e = edits[m.id];
      if (!e) continue;
      const u = toUpdate(m.id, e, playerMap, m, playersByTeam);
      if (u) out[m.id] = u;
    }
    setExportText(JSON.stringify(out, null, 2));
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setImportMsg("JSON はオブジェクトで指定してください");
        return;
      }
      saveMatchEdits(parsed);
      const merged: Record<string, Editable> = {};
      for (const m of allMatches)
        merged[m.id] = fromUpdate(parsed[m.id], m, playersByTeam);
      setEdits(merged);
      setImportMsg(`${Object.keys(parsed).length} 試合分を取り込みました`);
      setTimeout(() => setImportMsg(""), 3000);
    } catch (e) {
      setImportMsg(`JSON パース失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.headRow}>
        <h1 className={styles.title}>試合結果 編集</h1>
        <Link to="/" className={styles.back}>
          ← トップへ
        </Link>
      </div>
      <p className={styles.note}>
        各試合に PK / <strong>得点者</strong> /{" "}
        <strong>フォーメーション・スタメン</strong> / <strong>カード</strong> /{" "}
        <strong>交代</strong>を入力できます。
        <strong>スコアと状態 (scheduled/live/finished) は Football-Data から自動更新</strong>されるためこの画面では編集できません。手動で固定したい場合は <strong>🔒 列のチェックを入れて保存</strong>すると、その試合の score/status/PK が自動更新で上書きされなくなります (誤値や公式発表とのズレを保護)。値そのものを書き換えたい場合は <code>public/data/match_results.json</code> を直接編集して manualLock を立ててください。
        ベンチは「<strong>そのチームの全選手 − スタメン11名</strong>」を背番号順で自動算出します。
        保存先は <strong>matchEdits</strong> レイヤー (<code>localStorage["wc2026:matchEdits"]</code>) で、
        ライブ取得 (matchOverrides) とは別管理。
        <strong>localhost の見た目はライブが最優先</strong>なので、ここで保存しても localhost の他ページの表示はライブのままです。
        dev サーバー実行中なら matchEdits だけが <code>match_results.json</code> に自動同期され、
        <strong>commit / push して GitHub Pages にデプロイされた公開サイトでは編集内容が見える</strong>ようになります。
      </p>

      {/* 全 FormationEditor が共通で参照する shape サジェスト */}
      <datalist id="shape-suggest">
        {SHAPE_SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className={styles.filters}>
        <label className={styles.label}>ステージ:</label>
        <select
          className={styles.select}
          value={stageFilter}
          onChange={(e) =>
            setStageFilter(e.target.value as Match["stage"] | "all")
          }
        >
          <option value="all">すべて</option>
          {STAGE_ORDER.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        <label className={styles.label}>
          <input
            type="checkbox"
            checked={todayOnly}
            onChange={(e) => setTodayOnly(e.target.checked)}
          />
          {" "}今日の試合のみ
        </label>
        <span className={styles.count}>{filtered.length} 試合</span>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.saveBtn} onClick={handleSave}>
          手動編集として保存
        </button>
        <button type="button" className={styles.resetBtn} onClick={handleClear}>
          手動編集をクリア
        </button>
      </div>
      {savedMsg && <p className={styles.savedMsg}>{savedMsg}</p>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>番号</th>
              <th>ステージ</th>
              <th>対戦</th>
              <th>スコア</th>
              <th>PK</th>
              <th>状態</th>
              <th title="ライブ中に琥珀色バッジで表示されるテロップ (例: 中断中)。空欄で解除。">テロップ</th>
              <th title="チェックすると Football-Data からの自動更新を停止し、現状の score/status/PK を保護します。">🔒</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const e = edits[m.id] ?? freshEditable();
              const num = matchNumber(m.id);
              const home =
                teamsRes.map.get(m.homeTeamId)?.name ??
                m.homeTeamLabel ??
                m.homeTeamId;
              const away =
                teamsRes.map.get(m.awayTeamId)?.name ??
                m.awayTeamLabel ??
                m.awayTeamId;
              const isKo = m.stage !== "group" && m.stage !== "test";
              const expanded = expandedId === m.id;
              const homeTeamPlayers = playersByTeam.get(m.homeTeamId) ?? [];
              const awayTeamPlayers = playersByTeam.get(m.awayTeamId) ?? [];
              const totalEvents =
                e.goals.length + e.bookings.length + e.substitutions.length;
              return (
                <Fragment key={m.id}>
                  <tr>
                    <td className={styles.num}>
                      {num !== null ? `#${num}` : m.id}
                    </td>
                    <td>{STAGE_LABEL[m.stage]}</td>
                    <td>
                      <div>
                        {home} <span className={styles.vs}>vs</span> {away}
                      </div>
                      <button
                        type="button"
                        className={styles.expandBtn}
                        onClick={() =>
                          setExpandedId(expanded ? null : m.id)
                        }
                        style={{ marginTop: "0.3rem" }}
                      >
                        {expanded ? "▲ 閉じる" : `▼ 編集 (${totalEvents})`}
                      </button>
                    </td>
                    <td className={styles.scoreCell}>
                      <input
                        type="number"
                        className={styles.numInput}
                        value={e.scoreHome}
                        onChange={(ev) =>
                          updateEdit(m.id, { scoreHome: ev.target.value })
                        }
                        min={0}
                        aria-label="score home"
                      />
                      <span className={styles.dash}>-</span>
                      <input
                        type="number"
                        className={styles.numInput}
                        value={e.scoreAway}
                        onChange={(ev) =>
                          updateEdit(m.id, { scoreAway: ev.target.value })
                        }
                        min={0}
                        aria-label="score away"
                      />
                    </td>
                    <td className={styles.scoreCell}>
                      {isKo ? (
                        (() => {
                          // PK shootout に蹴順入力があれば、その scored 集計で
                          // PK スコアを自動表示し、手動入力欄は無効化。
                          // shootout が空のときだけ手動入力が編集可能。
                          const hasShootout = e.penaltyShootout.length > 0;
                          const derivedHome = e.penaltyShootout.filter(
                            (p) =>
                              p.teamId === m.homeTeamId && p.result === "scored"
                          ).length;
                          const derivedAway = e.penaltyShootout.filter(
                            (p) =>
                              p.teamId === m.awayTeamId && p.result === "scored"
                          ).length;
                          return (
                            <>
                              <input
                                type="number"
                                className={styles.numInput}
                                value={
                                  hasShootout ? String(derivedHome) : e.pkHome
                                }
                                onChange={(ev) =>
                                  updateEdit(m.id, {
                                    pkHome: ev.target.value,
                                  })
                                }
                                min={0}
                                disabled={hasShootout}
                                title={
                                  hasShootout
                                    ? "PK 蹴順入力から自動算出 (下の編集フォームから変更)"
                                    : undefined
                                }
                                aria-label="PK home"
                              />
                              <span className={styles.dash}>-</span>
                              <input
                                type="number"
                                className={styles.numInput}
                                value={
                                  hasShootout ? String(derivedAway) : e.pkAway
                                }
                                onChange={(ev) =>
                                  updateEdit(m.id, {
                                    pkAway: ev.target.value,
                                  })
                                }
                                min={0}
                                disabled={hasShootout}
                                title={
                                  hasShootout
                                    ? "PK 蹴順入力から自動算出 (下の編集フォームから変更)"
                                    : undefined
                                }
                                aria-label="PK away"
                              />
                            </>
                          );
                        })()
                      ) : (
                        <span className={styles.pkNa}>—</span>
                      )}
                    </td>
                    <td>
                      <select
                        value={e.status}
                        onChange={(ev) =>
                          updateEdit(m.id, {
                            status: ev.target.value as Editable["status"],
                          })
                        }
                        aria-label={`${m.id} の試合フェーズ`}
                      >
                        <option value="">(未設定)</option>
                        <option value="scheduled">scheduled</option>
                        <option value="first-half">前半</option>
                        <option value="halftime">ハーフタイム</option>
                        <option value="second-half">後半</option>
                        <option value="extra-time">延長前半</option>
                        <option value="extra-time-second">延長後半</option>
                        <option value="finished">finished</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={e.note}
                        onChange={(ev) =>
                          updateEdit(m.id, { note: ev.target.value })
                        }
                        placeholder="例: 中断中"
                        maxLength={12}
                        style={{ width: "6rem" }}
                        aria-label={`${m.id} のテロップ`}
                        title="ライブ中に琥珀色バッジで表示されます (例: 中断中)。空欄にすると解除。manualLock=true 必須。"
                      />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={e.manualLock}
                        onChange={(ev) =>
                          updateEdit(m.id, { manualLock: ev.target.checked })
                        }
                        aria-label={`${m.id} の自動更新を停止 (manualLock)`}
                        title="チェック中: Football-Data からの自動更新を停止し、ここで保存したスコア/状態/PK を保護します。"
                      />
                    </td>
                  </tr>
                  {expanded && (
                    <tr className={styles.expandedRow}>
                      <td colSpan={8}>
                        <div className={styles.editorStack}>
                          <GoalEditor
                            match={m}
                            goals={e.goals}
                            homeTeamName={home}
                            awayTeamName={away}
                            playersByTeam={playersByTeam}
                            playerMap={playerMap}
                            onUpdate={(idx, patch) =>
                              updateGoal(m.id, idx, patch)
                            }
                            onRemove={(idx) => removeGoal(m.id, idx)}
                            onAdd={() => addGoal(m)}
                          />
                          <FormationEditor
                            side="home"
                            teamName={home}
                            draft={e.homeFormation}
                            teamPlayers={homeTeamPlayers}
                            playerMap={playerMap}
                            onShape={(s) => updateShape(m.id, "home", s)}
                            onStarter={(idx, patch) =>
                              updateStarter(m.id, "home", idx, patch)
                            }
                            onCaptain={(name) =>
                              updateCaptain(m.id, "home", name)
                            }
                            onMvp={(name) => updateMvp(m.id, "home", name)}
                          />
                          <FormationEditor
                            side="away"
                            teamName={away}
                            draft={e.awayFormation}
                            teamPlayers={awayTeamPlayers}
                            playerMap={playerMap}
                            onShape={(s) => updateShape(m.id, "away", s)}
                            onStarter={(idx, patch) =>
                              updateStarter(m.id, "away", idx, patch)
                            }
                            onCaptain={(name) =>
                              updateCaptain(m.id, "away", name)
                            }
                            onMvp={(name) => updateMvp(m.id, "away", name)}
                          />
                          <BookingEditor
                            match={m}
                            bookings={e.bookings}
                            homeTeamName={home}
                            awayTeamName={away}
                            playersByTeam={playersByTeam}
                            onUpdate={(idx, patch) =>
                              updateBooking(m.id, idx, patch)
                            }
                            onAdd={() => addBooking(m)}
                            onRemove={(idx) => removeBooking(m.id, idx)}
                          />
                          <SubEditor
                            match={m}
                            subs={e.substitutions}
                            homeTeamName={home}
                            awayTeamName={away}
                            playersByTeam={playersByTeam}
                            onUpdate={(idx, patch) =>
                              updateSub(m.id, idx, patch)
                            }
                            onAdd={() => addSub(m)}
                            onRemove={(idx) => removeSub(m.id, idx)}
                          />
                          {isKo && (
                            <PkShootoutEditor
                              match={m}
                              pks={e.penaltyShootout}
                              homeTeamName={home}
                              awayTeamName={away}
                              playersByTeam={playersByTeam}
                              onUpdate={(idx, patch) =>
                                updatePk(m.id, idx, patch)
                              }
                              onAdd={(firstTeamIdIfEmpty) =>
                                addPk(m, firstTeamIdIfEmpty)
                              }
                              onRemove={(idx) => removePk(m.id, idx)}
                              onMove={(idx, dir) => movePk(m.id, idx, dir)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className={styles.exportSection}>
        <h2 className={styles.subTitle}>公開サイト向け JSON 出力</h2>
        <p className={styles.subNote}>
          出力した JSON を <code>public/data/match_results.json</code> に貼り付けて
          commit / push すると公開サイトに反映されます。
          dev サーバー実行中は finished 試合の自動同期が走るので通常はこの操作は不要です。
        </p>
        <button type="button" onClick={handleExport} className={styles.exportBtn}>
          JSON を出力
        </button>
        {exportText && (
          <textarea
            className={styles.exportText}
            value={exportText}
            readOnly
            spellCheck={false}
          />
        )}
      </section>

      <section className={styles.exportSection}>
        <h2 className={styles.subTitle}>JSON 取り込み</h2>
        <p className={styles.subNote}>
          既存の <code>match_results.json</code> や他端末でエクスポートした JSON を貼り付けて
          「取り込み」を押すと、現在の localStorage に反映できます。
        </p>
        <textarea
          className={styles.exportText}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder='{"m073": {"matchId":"m073","status":"finished","score":{"home":2,"away":1}}}'
          spellCheck={false}
        />
        <button type="button" onClick={handleImport} className={styles.exportBtn}>
          取り込み
        </button>
        {importMsg && <p className={styles.savedMsg}>{importMsg}</p>}
      </section>

      {showBackTop && (
        <button
          type="button"
          className={styles.backToTop}
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="ページの上に戻る"
          title="ページの上に戻る"
        >
          ↑ 上へ
        </button>
      )}
    </div>
  );
}

type GoalEditorProps = {
  match: Match;
  goals: GoalDraft[];
  homeTeamName: string;
  awayTeamName: string;
  playersByTeam: Map<string, Player[]>;
  playerMap: Map<string, Player>;
  onUpdate: (idx: number, patch: Partial<GoalDraft>) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
};

function GoalEditor({
  match,
  goals,
  homeTeamName,
  awayTeamName,
  playersByTeam,
  playerMap,
  onUpdate,
  onRemove,
  onAdd,
}: GoalEditorProps) {
  const homePlayers = playersByTeam.get(match.homeTeamId) ?? [];
  const awayPlayers = playersByTeam.get(match.awayTeamId) ?? [];

  return (
    <div className={styles.goalEditor}>
      <div className={styles.goalEditorHead}>
        <span className={styles.goalEditorTitle}>得点者</span>
        <button
          type="button"
          className={styles.addGoalBtn}
          onClick={onAdd}
        >
          + 得点を追加
        </button>
      </div>
      {goals.length === 0 ? (
        <p className={styles.goalEmpty}>まだ得点者がいません。</p>
      ) : (
        <table className={styles.goalTable}>
          <thead>
            <tr>
              <th>分</th>
              <th>チーム</th>
              <th>種別</th>
              <th>得点者</th>
              <th>アシスト</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {goals.map((g, i) => {
              // オウンゴール: 「決めた選手」は相手チームの選手 (自陣ゴールに入れた側)。
              //   通常: g.teamId と一致するチームの選手から選ぶ
              //   オウン: g.teamId と一致しないチーム (= 相手) の選手から選ぶ
              const isOwn = g.type === "own";
              const rawPlayers = isOwn
                ? g.teamId === match.homeTeamId
                  ? awayPlayers
                  : g.teamId === match.awayTeamId
                  ? homePlayers
                  : []
                : g.teamId === match.homeTeamId
                ? homePlayers
                : g.teamId === match.awayTeamId
                ? awayPlayers
                : [];
              // BookingEditor / SubEditor と同じく背番号順にソート
              const players = [...rawPlayers].sort(
                (a, b) => (a.number ?? 999) - (b.number ?? 999)
              );
              const noPlayerRoster = players.length === 0;
              const selectedExists = g.playerId && playerMap.has(g.playerId);
              const selectedAssistExists =
                g.assistPlayerId && playerMap.has(g.assistPlayerId);
              return (
                <tr key={i}>
                  <td>
                    <input
                      type="text"
                      className={styles.minuteInput}
                      value={g.minute}
                      onChange={(ev) =>
                        onUpdate(i, { minute: ev.target.value })
                      }
                      placeholder="例: 67 / 90+3"
                      title="分。アディショナルタイムは 90+3 形式で入力"
                    />
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={g.teamId}
                      onChange={(ev) =>
                        onUpdate(i, {
                          teamId: ev.target.value,
                          playerId: "",
                          assistPlayerId: "",
                        })
                      }
                    >
                      <option value={match.homeTeamId}>{homeTeamName}</option>
                      <option value={match.awayTeamId}>{awayTeamName}</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={g.type}
                      onChange={(ev) => {
                        const newType = ev.target.value as GoalType;
                        // own と他種別を切り替えるときは選手リストの母集団が
                        // 相手チームに切り替わるので、playerId/playerName を
                        // 一度クリアして選び直してもらう。
                        const togglingOwn = (g.type === "own") !== (newType === "own");
                        onUpdate(
                          i,
                          togglingOwn
                            ? {
                                type: newType,
                                playerId: "",
                                playerName: undefined,
                              }
                            : { type: newType }
                        );
                      }}
                    >
                      {(["normal", "penalty", "own"] as GoalType[]).map((t) => (
                        <option key={t} value={t}>
                          {GOAL_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={g.playerId}
                      onChange={(ev) =>
                        onUpdate(i, { playerId: ev.target.value })
                      }
                    >
                      <option value="">
                        {g.playerName
                          ? `— 選択 — (現在: ${g.playerName})`
                          : "— 選択 —"}
                      </option>
                      {players.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.number != null ? `#${p.number} ` : ""}
                          {p.name} ({p.position})
                        </option>
                      ))}
                      {g.playerId && !selectedExists && (
                        <option value={g.playerId}>
                          {g.playerId} (不明)
                        </option>
                      )}
                    </select>
                    {noPlayerRoster && (
                      <div className={styles.rosterMissing}>
                        ※ このチームの選手データがまだありません
                      </div>
                    )}
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={g.assistPlayerId}
                      onChange={(ev) =>
                        onUpdate(i, { assistPlayerId: ev.target.value })
                      }
                    >
                      <option value="">
                        {g.assistPlayerName
                          ? `— なし — (現在: ${g.assistPlayerName})`
                          : "— なし —"}
                      </option>
                      {players.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.number != null ? `#${p.number} ` : ""}
                          {p.name} ({p.position})
                        </option>
                      ))}
                      {g.assistPlayerId && !selectedAssistExists && (
                        <option value={g.assistPlayerId}>
                          {g.assistPlayerId} (不明)
                        </option>
                      )}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.removeGoalBtn}
                      onClick={() => onRemove(i)}
                      aria-label="この得点を削除"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

type FormationEditorProps = {
  side: "home" | "away";
  teamName: string;
  draft: FormationDraft;
  teamPlayers: Player[];
  playerMap: Map<string, Player>;
  onShape: (shape: string) => void;
  onStarter: (idx: number, patch: Partial<StarterDraft>) => void;
  onCaptain: (captainName: string) => void;
  onMvp: (mvpName: string) => void;
};

function FormationEditor({
  side,
  teamName,
  draft,
  teamPlayers,
  playerMap,
  onShape,
  onStarter,
  onCaptain,
  onMvp,
}: FormationEditorProps) {
  const parts = parseShape(draft.shape);
  const sortedPlayers = useMemo(
    () =>
      [...teamPlayers].sort(
        (a, b) => (a.number ?? 999) - (b.number ?? 999)
      ),
    [teamPlayers]
  );
  const need = expectedStarterCount(draft.shape);
  const filledCount = draft.starters.filter(
    (s) => s.playerId || s.name
  ).length;

  const starterIds = new Set(
    draft.starters.map((s) => s.playerId).filter(Boolean)
  );
  const starterNames = new Set(
    draft.starters
      .map((s) =>
        s.playerId ? playerMap.get(s.playerId)?.name : s.name
      )
      .filter(Boolean) as string[]
  );
  const benchPreview = sortedPlayers.filter(
    (p) => !starterIds.has(p.id) && !starterNames.has(p.name)
  );

  const noRoster = teamPlayers.length === 0;

  return (
    <div className={styles.formationEditor}>
      <div className={styles.formationHead}>
        <span className={styles.formationTitle}>
          {side === "home" ? "🏠 ホーム" : "✈ アウェイ"} ({teamName})
          フォーメーション
        </span>
        <label className={styles.shapeLabel}>
          配置:
          <input
            type="text"
            list="shape-suggest"
            className={styles.shapeInput}
            value={draft.shape}
            onChange={(ev) => onShape(ev.target.value)}
            placeholder="例: 4-3-3"
          />
        </label>
        <label className={styles.shapeLabel}>
          (C):
          <select
            className={styles.select}
            value={draft.captainName ?? ""}
            onChange={(ev) => onCaptain(ev.target.value)}
            disabled={noRoster}
          >
            <option value="">— なし —</option>
            {sortedPlayers.map((p) => (
              <option key={p.id} value={p.name}>
                #{p.number ?? "?"} {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.shapeLabel}>
          ★ MVP:
          <select
            className={styles.select}
            value={draft.mvpName ?? ""}
            onChange={(ev) => onMvp(ev.target.value)}
            disabled={noRoster}
          >
            <option value="">— なし —</option>
            {sortedPlayers.map((p) => (
              <option key={p.id} value={p.name}>
                #{p.number ?? "?"} {p.name}
              </option>
            ))}
          </select>
        </label>
        {parts.length > 0 && (
          <span className={styles.formationCount}>
            スタメン {filledCount}/{need}
          </span>
        )}
      </div>

      {noRoster && (
        <p className={styles.rosterMissing}>
          ※ このチームの選手データがまだありません。スタメン選択はできません。
        </p>
      )}

      {parts.length === 0 ? (
        <p className={styles.formationHint}>
          shape (例: <code>4-3-3</code> / <code>4-2-3-1</code> /{" "}
          <code>3-4-2-1</code>) を入力するとスタメン枠が出ます。
          各レイヤーは <strong>右サイド → 左サイド</strong> の順で並べてください
          (write-m00X-formations.mjs と同じ規約)。
        </p>
      ) : (
        <>
          <div className={styles.starterLayers}>
            <StarterRow
              label="GK"
              indices={[0]}
              starters={draft.starters}
              players={sortedPlayers}
              onStarter={onStarter}
            />
            {parts.map((count, layerIdx) => {
              const before = parts
                .slice(0, layerIdx)
                .reduce((a, b) => a + b, 0);
              const startIdx = 1 + before;
              const indices = Array.from(
                { length: count },
                (_, i) => startIdx + i
              );
              const role =
                layerIdx === 0
                  ? "DF"
                  : layerIdx === parts.length - 1
                  ? "FW"
                  : "MF";
              return (
                <StarterRow
                  key={layerIdx}
                  label={`${role} (右→左)`}
                  indices={indices}
                  starters={draft.starters}
                  players={sortedPlayers}
                  onStarter={onStarter}
                />
              );
            })}
          </div>
          <p className={styles.benchPreview}>
            <strong>ベンチ (自動 {benchPreview.length}名):</strong>{" "}
            {benchPreview.length === 0
              ? "—"
              : benchPreview
                  .map((p) =>
                    p.number != null ? `#${p.number} ${p.name}` : p.name
                  )
                  .join(" / ")}
          </p>
        </>
      )}
    </div>
  );
}

type StarterRowProps = {
  label: string;
  indices: number[];
  starters: StarterDraft[];
  players: Player[];
  onStarter: (idx: number, patch: Partial<StarterDraft>) => void;
};

function StarterRow({
  label,
  indices,
  starters,
  players,
  onStarter,
}: StarterRowProps) {
  return (
    <div className={styles.starterRow}>
      <span className={styles.starterRowLabel}>{label}</span>
      <div className={styles.starterRowSlots}>
        {indices.map((i) => {
          const s = starters[i] ?? {
            playerId: "",
            name: undefined,
            number: undefined,
          };
          const selectedExists =
            s.playerId && players.some((p) => p.id === s.playerId);
          return (
            <select
              key={i}
              className={styles.starterSelect}
              value={s.playerId}
              onChange={(ev) => {
                const pid = ev.target.value;
                const p = players.find((x) => x.id === pid);
                onStarter(i, {
                  playerId: pid,
                  name: p?.name ?? s.name,
                  number: p?.number ?? s.number,
                });
              }}
            >
              <option value="">
                {s.name
                  ? `— 選択 — (現在: ${
                      s.number != null ? `#${s.number} ` : ""
                    }${s.name})`
                  : "— 選択 —"}
              </option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number != null ? `#${p.number} ` : ""}
                  {p.name} ({p.position})
                </option>
              ))}
              {s.playerId && !selectedExists && (
                <option value={s.playerId}>{s.playerId} (不明)</option>
              )}
            </select>
          );
        })}
      </div>
    </div>
  );
}

type BookingEditorProps = {
  match: Match;
  bookings: BookingDraft[];
  homeTeamName: string;
  awayTeamName: string;
  playersByTeam: Map<string, Player[]>;
  onUpdate: (idx: number, patch: Partial<BookingDraft>) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
};

function BookingEditor({
  match,
  bookings,
  homeTeamName,
  awayTeamName,
  playersByTeam,
  onUpdate,
  onAdd,
  onRemove,
}: BookingEditorProps) {
  return (
    <div className={styles.goalEditor}>
      <div className={styles.goalEditorHead}>
        <span className={styles.goalEditorTitle}>カード (bookings)</span>
        <button type="button" className={styles.addGoalBtn} onClick={onAdd}>
          + カードを追加
        </button>
      </div>
      {bookings.length === 0 ? (
        <p className={styles.goalEmpty}>まだカードがありません。</p>
      ) : (
        <table className={styles.goalTable}>
          <thead>
            <tr>
              <th>分</th>
              <th>チーム</th>
              <th>選手</th>
              <th>種別</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b, i) => {
              const arr =
                b.teamId === match.homeTeamId
                  ? (playersByTeam.get(match.homeTeamId) ?? [])
                  : b.teamId === match.awayTeamId
                  ? (playersByTeam.get(match.awayTeamId) ?? [])
                  : [];
              const sorted = [...arr].sort(
                (a, b2) => (a.number ?? 999) - (b2.number ?? 999)
              );
              const selectedExists =
                b.playerId && sorted.some((p) => p.id === b.playerId);
              return (
                <tr key={i}>
                  <td>
                    <input
                      type="text"
                      className={styles.minuteInput}
                      value={b.minute}
                      onChange={(ev) =>
                        onUpdate(i, { minute: ev.target.value })
                      }
                      placeholder="例: 45+2"
                      title="分。アディショナルタイムは 45+2 形式で入力"
                    />
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={b.teamId}
                      onChange={(ev) =>
                        onUpdate(i, {
                          teamId: ev.target.value,
                          playerId: "",
                        })
                      }
                    >
                      <option value={match.homeTeamId}>{homeTeamName}</option>
                      <option value={match.awayTeamId}>{awayTeamName}</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={b.playerId}
                      onChange={(ev) => {
                        const pid = ev.target.value;
                        const p = sorted.find((x) => x.id === pid);
                        onUpdate(i, {
                          playerId: pid,
                          playerName: p?.name ?? b.playerName,
                        });
                      }}
                    >
                      <option value="">
                        {b.playerName
                          ? `— 選択 — (現在: ${b.playerName})`
                          : "— 選択 —"}
                      </option>
                      {sorted.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.number != null ? `#${p.number} ` : ""}
                          {p.name}
                        </option>
                      ))}
                      {b.playerId && !selectedExists && (
                        <option value={b.playerId}>{b.playerId} (不明)</option>
                      )}
                    </select>
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={b.type}
                      onChange={(ev) =>
                        onUpdate(i, { type: ev.target.value as BookingType })
                      }
                    >
                      {(["Y", "Y2R", "R", "YR"] as BookingType[]).map((t) => (
                        <option key={t} value={t}>
                          {BOOKING_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.removeGoalBtn}
                      onClick={() => onRemove(i)}
                      aria-label="このカードを削除"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

type PkShootoutEditorProps = {
  match: Match;
  pks: PkDraft[];
  homeTeamName: string;
  awayTeamName: string;
  playersByTeam: Map<string, Player[]>;
  onUpdate: (idx: number, patch: Partial<PkDraft>) => void;
  onAdd: (firstTeamIdIfEmpty?: string) => void;
  onRemove: (idx: number) => void;
  onMove: (idx: number, dir: -1 | 1) => void;
};

function PkShootoutEditor({
  match,
  pks,
  homeTeamName,
  awayTeamName,
  playersByTeam,
  onUpdate,
  onAdd,
  onRemove,
  onMove,
}: PkShootoutEditorProps) {
  // 先攻選択: pks 空の状態で「先攻」を選ばせ、それを最初の PK 追加時に使う。
  // pks が既にあるときは pks[0].teamId が先攻扱いなので UI からは変更不可
  // (順番を変えたいときは PK エントリ側で teamId を編集する)。
  const initialFirst = pks[0]?.teamId ?? match.homeTeamId;
  const [firstTeamId, setFirstTeamId] = useState(initialFirst);
  // pks[0] が変わったら (別セッション読み込み等) 追従
  useEffect(() => {
    if (pks[0]?.teamId && pks[0].teamId !== firstTeamId) {
      setFirstTeamId(pks[0].teamId);
    }
  }, [pks, firstTeamId]);

  // 配列順 = 蹴順。ホーム/アウェイの成功数を逐次集計して、各行に「PK 進行表」
  // を出して入力ミスを目視確認しやすくする (例: "2-1" で迎える 4 本目)。
  let homeScored = 0;
  let awayScored = 0;
  const runningScores = pks.map((d) => {
    if (d.result === "scored") {
      if (d.teamId === match.homeTeamId) homeScored++;
      else if (d.teamId === match.awayTeamId) awayScored++;
    }
    return { home: homeScored, away: awayScored };
  });

  const isEmpty = pks.length === 0;

  return (
    <div className={styles.goalEditor}>
      <div className={styles.goalEditorHead}>
        <span className={styles.goalEditorTitle}>
          PK 戦 (蹴順)
          {pks.length > 0 && (
            <span style={{ marginLeft: "0.6rem", fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
              現在 {homeScored} - {awayScored}
            </span>
          )}
        </span>
        <button
          type="button"
          className={styles.addGoalBtn}
          onClick={() => onAdd(isEmpty ? firstTeamId : undefined)}
        >
          + PK を追加
        </button>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          margin: "0.3rem 0 0.5rem",
          fontSize: "0.85rem",
        }}
      >
        <label htmlFor={`pk-first-${match.id}`}>先攻:</label>
        <select
          id={`pk-first-${match.id}`}
          className={styles.input}
          value={firstTeamId}
          onChange={(ev) => setFirstTeamId(ev.target.value)}
          disabled={!isEmpty}
          title={
            isEmpty
              ? "PK を追加すると 1 本目はこのチームになります"
              : "PK が既に入力されているため変更できません (先攻を変えたい場合は全 PK を削除してください)"
          }
        >
          <option value={match.homeTeamId}>{homeTeamName}</option>
          <option value={match.awayTeamId}>{awayTeamName}</option>
        </select>
      </div>
      {isEmpty ? (
        <p className={styles.goalEmpty}>
          「先攻」を選んでから「+ PK を追加」で蹴られた順に PK を入力してください。
        </p>
      ) : (
        <table className={styles.goalTable}>
          <thead>
            <tr>
              <th>#</th>
              <th>チーム</th>
              <th>選手</th>
              <th>結果</th>
              <th>進行</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pks.map((d, i) => {
              const arr =
                d.teamId === match.homeTeamId
                  ? (playersByTeam.get(match.homeTeamId) ?? [])
                  : d.teamId === match.awayTeamId
                    ? (playersByTeam.get(match.awayTeamId) ?? [])
                    : [];
              const sorted = [...arr].sort(
                (a, b) => (a.number ?? 999) - (b.number ?? 999)
              );
              const selectedExists =
                d.playerId && sorted.some((p) => p.id === d.playerId);
              const rs = runningScores[i];
              return (
                <tr key={i}>
                  <td style={{ textAlign: "center", fontWeight: 700 }}>
                    {i + 1}
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={d.teamId}
                      onChange={(ev) =>
                        onUpdate(i, {
                          teamId: ev.target.value,
                          playerId: "",
                          playerName: undefined,
                        })
                      }
                    >
                      <option value={match.homeTeamId}>{homeTeamName}</option>
                      <option value={match.awayTeamId}>{awayTeamName}</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={d.playerId}
                      onChange={(ev) => {
                        const pid = ev.target.value;
                        const p = sorted.find((x) => x.id === pid);
                        onUpdate(i, {
                          playerId: pid,
                          playerName: p?.name ?? d.playerName,
                        });
                      }}
                    >
                      <option value="">
                        {d.playerName
                          ? `— 選択 — (現在: ${d.playerName})`
                          : "— 選択 —"}
                      </option>
                      {sorted.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.number != null ? `#${p.number} ` : ""}
                          {p.name}
                        </option>
                      ))}
                      {d.playerId && !selectedExists && (
                        <option value={d.playerId}>{d.playerId} (不明)</option>
                      )}
                    </select>
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={d.result}
                      onChange={(ev) =>
                        onUpdate(i, { result: ev.target.value as PkResult })
                      }
                    >
                      {(["scored", "missed"] as PkResult[]).map((r) => (
                        <option key={r} value={r}>
                          {PK_RESULT_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ textAlign: "center", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {rs.home} - {rs.away}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      className={styles.removeGoalBtn}
                      onClick={() => onMove(i, -1)}
                      disabled={i === 0}
                      aria-label="この PK を 1 つ前へ"
                      title="1 つ前へ"
                      style={{ marginRight: "0.2rem" }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={styles.removeGoalBtn}
                      onClick={() => onMove(i, 1)}
                      disabled={i === pks.length - 1}
                      aria-label="この PK を 1 つ後ろへ"
                      title="1 つ後ろへ"
                      style={{ marginRight: "0.2rem" }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={styles.removeGoalBtn}
                      onClick={() => onRemove(i)}
                      aria-label="この PK を削除"
                      title="削除"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

type SubEditorProps = {
  match: Match;
  subs: SubDraft[];
  homeTeamName: string;
  awayTeamName: string;
  playersByTeam: Map<string, Player[]>;
  onUpdate: (idx: number, patch: Partial<SubDraft>) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
};

function SubEditor({
  match,
  subs,
  homeTeamName,
  awayTeamName,
  playersByTeam,
  onUpdate,
  onAdd,
  onRemove,
}: SubEditorProps) {
  return (
    <div className={styles.goalEditor}>
      <div className={styles.goalEditorHead}>
        <span className={styles.goalEditorTitle}>交代 (substitutions)</span>
        <button type="button" className={styles.addGoalBtn} onClick={onAdd}>
          + 交代を追加
        </button>
      </div>
      {subs.length === 0 ? (
        <p className={styles.goalEmpty}>まだ交代がありません。</p>
      ) : (
        <table className={styles.goalTable}>
          <thead>
            <tr>
              <th>分</th>
              <th>チーム</th>
              <th>🔁 IN (投入)</th>
              <th>OUT (退場)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {subs.map((s, i) => {
              const arr =
                s.teamId === match.homeTeamId
                  ? (playersByTeam.get(match.homeTeamId) ?? [])
                  : s.teamId === match.awayTeamId
                  ? (playersByTeam.get(match.awayTeamId) ?? [])
                  : [];
              const sorted = [...arr].sort(
                (a, b) => (a.number ?? 999) - (b.number ?? 999)
              );
              const inExists =
                s.inPlayerId && sorted.some((p) => p.id === s.inPlayerId);
              const outExists =
                s.outPlayerId && sorted.some((p) => p.id === s.outPlayerId);
              return (
                <tr key={i}>
                  <td>
                    <input
                      type="text"
                      className={styles.minuteInput}
                      value={s.minute}
                      onChange={(ev) =>
                        onUpdate(i, { minute: ev.target.value })
                      }
                      placeholder="例: 67 / 90+3"
                      title="分。アディショナルタイムは 90+3 形式で入力"
                    />
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={s.teamId}
                      onChange={(ev) =>
                        onUpdate(i, {
                          teamId: ev.target.value,
                          inPlayerId: "",
                          outPlayerId: "",
                        })
                      }
                    >
                      <option value={match.homeTeamId}>{homeTeamName}</option>
                      <option value={match.awayTeamId}>{awayTeamName}</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={s.inPlayerId}
                      onChange={(ev) => {
                        const pid = ev.target.value;
                        const p = sorted.find((x) => x.id === pid);
                        onUpdate(i, {
                          inPlayerId: pid,
                          inName: p?.name ?? s.inName,
                        });
                      }}
                    >
                      <option value="">
                        {s.inName
                          ? `— 選択 — (現在: ${s.inName})`
                          : "— 選択 —"}
                      </option>
                      {sorted.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.number != null ? `#${p.number} ` : ""}
                          {p.name}
                        </option>
                      ))}
                      {s.inPlayerId && !inExists && (
                        <option value={s.inPlayerId}>
                          {s.inPlayerId} (不明)
                        </option>
                      )}
                    </select>
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={s.outPlayerId}
                      onChange={(ev) => {
                        const pid = ev.target.value;
                        const p = sorted.find((x) => x.id === pid);
                        onUpdate(i, {
                          outPlayerId: pid,
                          outName: p?.name ?? s.outName,
                        });
                      }}
                    >
                      <option value="">
                        {s.outName
                          ? `— 選択 — (現在: ${s.outName})`
                          : "— 選択 —"}
                      </option>
                      {sorted.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.number != null ? `#${p.number} ` : ""}
                          {p.name}
                        </option>
                      ))}
                      {s.outPlayerId && !outExists && (
                        <option value={s.outPlayerId}>
                          {s.outPlayerId} (不明)
                        </option>
                      )}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.removeGoalBtn}
                      onClick={() => onRemove(i)}
                      aria-label="この交代を削除"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
