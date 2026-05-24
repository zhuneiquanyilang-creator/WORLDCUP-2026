import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useJsonResource } from "@/hooks/useJsonResource";
import { useMatchResults } from "@/hooks/useMatchResults";
import { useTeamMap } from "@/hooks/useTeams";
import { usePlayers } from "@/hooks/usePlayers";
import { Loading, ErrorMessage } from "@/components/common/AsyncState";
import { dataUrl } from "@/utils/dataUrl";
import { matchNumber } from "@/utils/matchNumber";
import type { Goal, GoalType, Match, MatchStatus } from "@/types/match";
import type { LiveUpdate } from "@/types/live";
import type { Player } from "@/types/player";
import { loadMatchOverrides } from "@/utils/matchOverrides";
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

/** 編集 UI が直接扱わないフィールド。save 時にそのまま LiveUpdate に書き戻して
 *  巻き込み消去を防ぐ。 */
type Passthrough = Pick<
  LiveUpdate,
  | "liveLabel"
  | "bookings"
  | "substitutions"
  | "homeFormation"
  | "awayFormation"
  | "stats"
>;

type Editable = {
  status: MatchStatus | "";
  scoreHome: string;
  scoreAway: string;
  pkHome: string;
  pkAway: string;
  goals: GoalDraft[];
  passthrough: Passthrough;
};

const EMPTY: Editable = {
  status: "",
  scoreHome: "",
  scoreAway: "",
  pkHome: "",
  pkAway: "",
  goals: [],
  passthrough: {},
};

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

function goalToDraft(g: Goal): GoalDraft {
  return {
    minute: String(g.minute ?? ""),
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
  const min = Number(d.minute);
  if (!Number.isFinite(min) || !d.teamId) return null;
  const goal: Goal = { minute: min, teamId: d.teamId, type: d.type };
  const player = d.playerId ? playerMap.get(d.playerId) : undefined;
  if (player) {
    goal.playerId = player.id;
    goal.playerName = player.name;
  } else if (d.playerName) {
    // playerId が未選択でも、元データの playerName (Sofascore の英語名等) は保持
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

function fromUpdate(u: LiveUpdate | undefined): Editable {
  if (!u) return { ...EMPTY, goals: [], passthrough: {} };
  const passthrough: Passthrough = {};
  if (u.liveLabel !== undefined) passthrough.liveLabel = u.liveLabel;
  if (u.bookings) passthrough.bookings = u.bookings;
  if (u.substitutions) passthrough.substitutions = u.substitutions;
  if (u.homeFormation) passthrough.homeFormation = u.homeFormation;
  if (u.awayFormation) passthrough.awayFormation = u.awayFormation;
  if (u.stats) passthrough.stats = u.stats;
  return {
    status: u.status ?? "",
    scoreHome: u.score ? String(u.score.home) : "",
    scoreAway: u.score ? String(u.score.away) : "",
    pkHome: u.penaltyScore ? String(u.penaltyScore.home) : "",
    pkAway: u.penaltyScore ? String(u.penaltyScore.away) : "",
    goals: (u.goals ?? []).map(goalToDraft),
    passthrough,
  };
}

function toUpdate(
  matchId: string,
  e: Editable,
  playerMap: Map<string, Player>
): LiveUpdate | null {
  const u: LiveUpdate = { matchId };
  if (e.status) u.status = e.status;
  if (e.scoreHome !== "" && e.scoreAway !== "") {
    const h = Number(e.scoreHome);
    const a = Number(e.scoreAway);
    if (Number.isFinite(h) && Number.isFinite(a)) u.score = { home: h, away: a };
  }
  if (e.pkHome !== "" && e.pkAway !== "") {
    const h = Number(e.pkHome);
    const a = Number(e.pkAway);
    if (Number.isFinite(h) && Number.isFinite(a))
      u.penaltyScore = { home: h, away: a };
  }
  const goals = e.goals
    .map((d) => draftToGoal(d, playerMap))
    .filter((g): g is Goal => g !== null)
    .sort((a, b) => a.minute - b.minute);
  if (goals.length > 0) u.goals = goals;
  // form が触らないフィールドはそのまま LiveUpdate に書き戻す
  const p = e.passthrough;
  if (p.liveLabel !== undefined) u.liveLabel = p.liveLabel;
  if (p.bookings) u.bookings = p.bookings;
  if (p.substitutions) u.substitutions = p.substitutions;
  if (p.homeFormation) u.homeFormation = p.homeFormation;
  if (p.awayFormation) u.awayFormation = p.awayFormation;
  if (p.stats) u.stats = p.stats;
  if (
    !u.status &&
    !u.score &&
    !u.penaltyScore &&
    !u.goals &&
    !u.bookings &&
    !u.substitutions &&
    !u.homeFormation &&
    !u.awayFormation &&
    !u.stats
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
  const [savedMsg, setSavedMsg] = useState("");
  const [exportText, setExportText] = useState("");
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // file (公式記録) と matchEdits (手動編集レイヤー) を「file → manual」の順で
  // 重ねて初期値とする。両方ある場合は manual のフィールドが file の同名
  // フィールドを上書きする。bookings/subs 等は form が直接表示しないが
  // Editable.passthrough に保持され、save 時に LiveUpdate として書き戻される
  // ので「form save で巻き込み消去」されない。
  // matchOverrides (ライブ取得レイヤー) は seed に使わない — 編集 UI は
  // 「手動で確定した公式記録」のみを扱う。ライブから現状を引き込みたい場合は
  // 各行の「↓ ライブ」ボタンを使う。
  useEffect(() => {
    if (matchesRes.status !== "ready") return;
    const fileResults =
      fileResultsRes.status === "ready" ? fileResultsRes.data : {};
    const manual = loadMatchEdits();
    const seed: Record<string, Editable> = {};
    for (const m of matchesRes.data) {
      const fileR = fileResults[m.id];
      const manualR = manual[m.id];
      const combined: LiveUpdate | undefined =
        fileR && manualR
          ? { ...fileR, ...manualR }
          : (manualR ?? fileR);
      seed[m.id] = fromUpdate(combined);
    }
    setEdits(seed);
  }, [matchesRes, fileResultsRes]);

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
  const filtered =
    stageFilter === "all"
      ? allMatches
      : allMatches.filter((m) => m.stage === stageFilter);

  const updateEdit = (matchId: string, patch: Partial<Editable>) => {
    setEdits((prev) => ({ ...prev, [matchId]: { ...prev[matchId], ...patch } }));
  };

  const updateGoal = (
    matchId: string,
    idx: number,
    patch: Partial<GoalDraft>
  ) => {
    setEdits((prev) => {
      const cur = prev[matchId] ?? EMPTY;
      const goals = [...cur.goals];
      goals[idx] = { ...goals[idx], ...patch };
      return { ...prev, [matchId]: { ...cur, goals } };
    });
  };

  const addGoal = (match: Match) => {
    setEdits((prev) => {
      const cur = prev[match.id] ?? EMPTY;
      const goals = [...cur.goals];
      // 既存最終分の次の minute を初期値に
      const lastMin = goals.length > 0 ? Number(goals[goals.length - 1].minute) || 0 : 0;
      goals.push({
        minute: String(lastMin > 0 ? lastMin + 1 : 1),
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
      const cur = prev[matchId] ?? EMPTY;
      const goals = cur.goals.filter((_, i) => i !== idx);
      return { ...prev, [matchId]: { ...cur, goals } };
    });
  };

  const handleSave = () => {
    const next: Record<string, LiveUpdate> = {};
    for (const [id, e] of Object.entries(edits)) {
      const u = toUpdate(id, e, playerMap);
      if (u) next[id] = u;
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
    for (const m of allMatches) cleared[m.id] = { ...EMPTY, goals: [] };
    setEdits(cleared);
    setSavedMsg("手動編集をクリアしました");
    setTimeout(() => setSavedMsg(""), 3000);
  };

  /** その試合の現在のライブ取得状態を編集フォームに取り込む (まだ保存はしない) */
  const handlePullFromLive = (matchId: string) => {
    const live = loadMatchOverrides()[matchId];
    if (!live) {
      setSavedMsg(`${matchId}: ライブ取得データがありません`);
      setTimeout(() => setSavedMsg(""), 3000);
      return;
    }
    setEdits((prev) => ({ ...prev, [matchId]: fromUpdate(live) }));
    setSavedMsg(`${matchId}: ライブ取得値を取り込みました (まだ未保存)`);
    setTimeout(() => setSavedMsg(""), 3000);
  };

  const handleExport = () => {
    const out: Record<string, LiveUpdate> = {};
    for (const [id, e] of Object.entries(edits)) {
      const u = toUpdate(id, e, playerMap);
      if (u) out[id] = u;
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
      for (const m of allMatches) merged[m.id] = fromUpdate(parsed[m.id]);
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
        各試合に status / スコア / PK / <strong>得点者</strong>を入力できます。
        保存先は <strong>matchEdits</strong> レイヤー (<code>localStorage["wc2026:matchEdits"]</code>) で、
        Sofascore ライブ取得 (matchOverrides) とは別管理。
        <strong>localhost の見た目はライブが最優先</strong>なので、ここで保存しても localhost の他ページの表示はライブのままです (= 編集中もライブ視聴を邪魔しない)。
        dev サーバー実行中なら matchEdits だけが <code>match_results.json</code> に自動同期され、
        <strong>commit / push して GitHub Pages にデプロイされた公開サイトでは編集内容が見える</strong>ようになります。
        編集結果は本フォームの入力値で確認できます。
        各行の「↓ ライブ」ボタンで、その試合の現在のライブ取得値を編集フォームにコピーできます (保存は別操作)。
      </p>

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
              <th>状態</th>
              <th>スコア</th>
              <th>PK</th>
              <th>得点者</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const e = edits[m.id] ?? EMPTY;
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
              return (
                <Fragment key={m.id}>
                  <tr>
                    <td className={styles.num}>
                      {num !== null ? `#${num}` : m.id}
                    </td>
                    <td>{STAGE_LABEL[m.stage]}</td>
                    <td>
                      {home} <span className={styles.vs}>vs</span> {away}
                    </td>
                    <td>
                      <select
                        className={styles.input}
                        value={e.status}
                        onChange={(ev) =>
                          updateEdit(m.id, {
                            status: ev.target.value as MatchStatus | "",
                          })
                        }
                      >
                        <option value="">—</option>
                        <option value="scheduled">scheduled</option>
                        <option value="live">live</option>
                        <option value="finished">finished</option>
                      </select>
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
                      />
                    </td>
                    <td className={styles.scoreCell}>
                      {isKo ? (
                        <>
                          <input
                            type="number"
                            className={styles.numInput}
                            value={e.pkHome}
                            onChange={(ev) =>
                              updateEdit(m.id, { pkHome: ev.target.value })
                            }
                            min={0}
                            aria-label="PK home"
                          />
                          <span className={styles.dash}>-</span>
                          <input
                            type="number"
                            className={styles.numInput}
                            value={e.pkAway}
                            onChange={(ev) =>
                              updateEdit(m.id, { pkAway: ev.target.value })
                            }
                            min={0}
                            aria-label="PK away"
                          />
                        </>
                      ) : (
                        <span className={styles.pkNa}>—</span>
                      )}
                    </td>
                    <td className={styles.actionCell}>
                      <button
                        type="button"
                        className={styles.expandBtn}
                        onClick={() =>
                          setExpandedId(expanded ? null : m.id)
                        }
                      >
                        {expanded ? "▲ 閉じる" : `▼ 編集 (${e.goals.length})`}
                      </button>
                      <button
                        type="button"
                        className={styles.pullBtn}
                        onClick={() => handlePullFromLive(m.id)}
                        title="この試合の現在のライブ取得状態を編集フォームにコピー (未保存)"
                      >
                        ↓ ライブ
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className={styles.expandedRow}>
                      <td colSpan={7}>
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
              // チーム別の選手リストを切替
              const players =
                g.teamId === match.homeTeamId
                  ? homePlayers
                  : g.teamId === match.awayTeamId
                  ? awayPlayers
                  : [];
              const noPlayerRoster = players.length === 0;
              const selectedExists = g.playerId && playerMap.has(g.playerId);
              const selectedAssistExists =
                g.assistPlayerId && playerMap.has(g.assistPlayerId);
              return (
                <tr key={i}>
                  <td>
                    <input
                      type="number"
                      className={styles.minuteInput}
                      value={g.minute}
                      onChange={(ev) =>
                        onUpdate(i, { minute: ev.target.value })
                      }
                      min={1}
                      max={130}
                    />
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={g.teamId}
                      onChange={(ev) =>
                        onUpdate(i, {
                          teamId: ev.target.value,
                          // チーム変更時はプレーヤー選択をリセット
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
                      onChange={(ev) =>
                        onUpdate(i, { type: ev.target.value as GoalType })
                      }
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
                          {p.name} ({p.position})
                        </option>
                      ))}
                      {/* 既存 playerId が roster に無い場合は残せるよう、現値を選択肢に出す */}
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
