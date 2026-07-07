// public/data/players/*.json (選手マスタ) と public/data/match_results.json を突き合わせ、
// 選手名の変更を過去試合の goals / bookings / substitutions / homeFormation / awayFormation
// (starting + bench) に伝播させる。
//
// 動作原理:
//   1. goals: playerId / assistPlayerId が入っているので、そこから選手マスタの現在名を引く
//   2. formation: number が入っているので (teamId, number) で選手を特定して現在名に置換
//   3. 上記 1〜2 の過程で「旧名 → 新名」の team-scoped rename map を組み立てる
//   4. bookings / substitutions は playerId / number を持たないので、rename map で
//      名前一致するもののみ置換する (勝手な推測はしない)
//
// CLI: node scripts/sync-player-names.mjs
//      (dev サーバー側の Vite プラグインからも import して呼ばれる)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

export function syncPlayerNames({ baseDir = process.cwd() } = {}) {
  const playersDir = path.join(baseDir, "public/data/players");
  const resultsPath = path.join(baseDir, "public/data/match_results.json");
  const matchesPath = path.join(baseDir, "public/data/matches.json");

  // 1. Load all players per team
  const playerByIdAll = new Map();
  const playerByTeamNumber = new Map(); // key = `${teamId}#${number}`
  for (const file of fs.readdirSync(playersDir)) {
    if (!file.endsWith(".json")) continue;
    const teamId = file.replace(".json", "");
    const text = fs.readFileSync(path.join(playersDir, file), "utf8");
    const arr = JSON.parse(stripBOM(text));
    for (const p of arr) {
      if (p.id) playerByIdAll.set(p.id, p);
      if (p.number != null) playerByTeamNumber.set(`${teamId}#${p.number}`, p);
    }
  }

  // 2. Load matches to map matchId → home/away teamId
  const matchesArr = JSON.parse(stripBOM(fs.readFileSync(matchesPath, "utf8")));
  const matchTeams = new Map();
  for (const m of matchesArr) {
    matchTeams.set(m.id, { home: m.homeTeamId, away: m.awayTeamId });
  }

  // 3. Load match_results
  const results = JSON.parse(stripBOM(fs.readFileSync(resultsPath, "utf8")));

  let changed = 0;
  const changeSummary = [];

  for (const [matchId, entry] of Object.entries(results)) {
    const teams = matchTeams.get(matchId);
    if (!teams) continue;

    // Per-team rename map (旧名 → 新名) をこの試合の formations & goals 更新から集める。
    const renameByTeam = new Map();
    renameByTeam.set(teams.home, new Map());
    renameByTeam.set(teams.away, new Map());

    const noteRename = (teamId, oldName, newName) => {
      if (!oldName || !newName || oldName === newName) return;
      const m = renameByTeam.get(teamId);
      if (m) m.set(oldName, newName);
    };

    // 3a. formation を (teamId, number) で更新
    const sides = [
      ["homeFormation", teams.home],
      ["awayFormation", teams.away],
    ];
    for (const [side, teamId] of sides) {
      const f = entry[side];
      if (!f) continue;
      for (const arr of [f.starting, f.bench]) {
        if (!Array.isArray(arr)) continue;
        for (const spot of arr) {
          if (spot.number == null) continue;
          const p = playerByTeamNumber.get(`${teamId}#${spot.number}`);
          if (!p || !p.name) continue;
          if (spot.name !== p.name) {
            noteRename(teamId, spot.name, p.name);
            changeSummary.push(`${matchId} ${side} #${spot.number}: ${spot.name} → ${p.name}`);
            spot.name = p.name;
            changed++;
          }
        }
      }
      // ベンチから「starting と背番号が重複するエントリ」を除去する。
      // 想定: ブラウザに旧選手名が残ったまま /edit/matches で保存すると、
      // EditMatchesPage の bench 計算 (name-based exclude) が旧名と新マスタ名の
      // 不一致で starter を除外し損ねてしまう → 同一選手がベンチにも残る。
      if (Array.isArray(f.starting) && Array.isArray(f.bench)) {
        const starterNums = new Set(
          f.starting.map((s) => s.number).filter((n) => n != null)
        );
        const before = f.bench.length;
        f.bench = f.bench.filter((b) => b.number == null || !starterNums.has(b.number));
        if (f.bench.length !== before) {
          changeSummary.push(`${matchId} ${side}: bench 重複 ${before - f.bench.length} 件除去`);
          changed++;
        }
      }
    }

    // 3b. goals / assists を playerId で更新
    if (Array.isArray(entry.goals)) {
      for (const g of entry.goals) {
        if (g.playerId) {
          const p = playerByIdAll.get(g.playerId);
          if (p && p.name && g.playerName !== p.name) {
            noteRename(g.teamId, g.playerName, p.name);
            changeSummary.push(`${matchId} goal ${g.playerId}: ${g.playerName} → ${p.name}`);
            g.playerName = p.name;
            changed++;
          }
        }
        if (g.assistPlayerId) {
          const p = playerByIdAll.get(g.assistPlayerId);
          if (p && p.name && g.assistPlayerName !== p.name) {
            noteRename(g.teamId, g.assistPlayerName, p.name);
            changeSummary.push(`${matchId} assist ${g.assistPlayerId}: ${g.assistPlayerName} → ${p.name}`);
            g.assistPlayerName = p.name;
            changed++;
          }
        }
      }
    }

    // この試合の各チームのスカッド (starting + bench の現在名) を集める。
    // rename map で救えなかったスタレ名を fuzzy 一致で拾うためのフォールバック元。
    const squadByTeam = new Map();
    for (const [side, teamId] of sides) {
      const f = entry[side];
      if (!f) continue;
      const names = new Set();
      for (const arr of [f.starting, f.bench]) {
        if (!Array.isArray(arr)) continue;
        for (const spot of arr) {
          if (spot.name) names.add(spot.name);
        }
      }
      squadByTeam.set(teamId, names);
    }

    // Head-and-tail token match:
    // 中黒 (・) で分割した先頭トークン (名) と末尾トークン (姓) がスカッド内の
    // 誰かと完全一致するなら、その候補に置換する。
    // 想定シナリオ:
    //   旧: "アンドレアス・レーデルゴール・シェルデルップ"
    //   新: "アンドレアス・シェルデルップ"
    //   → 先頭 "アンドレアス" と末尾 "シェルデルップ" が一致するので新に置換。
    // これは Levenshtein では距離 7 で拾えないケースを補う。
    const tokensOf = (name) => name.split(/[・·]/).filter(Boolean);
    const headTailMatch = (teamId, name) => {
      const squad = squadByTeam.get(teamId);
      if (!squad || squad.has(name)) return name;
      const parts = tokensOf(name);
      if (parts.length < 2) return name;
      const head = parts[0];
      const tail = parts[parts.length - 1];
      const candidates = [];
      for (const c of squad) {
        const cp = tokensOf(c);
        if (cp.length < 1) continue;
        if (cp[0] === head && cp[cp.length - 1] === tail) candidates.push(c);
      }
      // 一意に決まる場合のみ採用 (同じ姓+名の別選手が居たら曖昧なので触らない)
      if (candidates.length === 1) return candidates[0];
      return name;
    };

    // Fuzzy fallback: rename map / head-tail いずれでも決まらないケースを
    // Levenshtein 距離 <= 2 でスカッド内候補に置換する。誤検知防止のため
    // 2 番手候補と 2 以上の差がある場合のみ採用する。
    const fuzzyMatch = (teamId, name) => {
      const squad = squadByTeam.get(teamId);
      if (!squad || squad.has(name)) return name;
      let best = null;
      let bestDist = Infinity;
      let secondDist = Infinity;
      for (const candidate of squad) {
        const d = levenshtein(name, candidate);
        if (d < bestDist) {
          secondDist = bestDist;
          bestDist = d;
          best = candidate;
        } else if (d < secondDist) {
          secondDist = d;
        }
      }
      if (best && bestDist <= 2 && secondDist - bestDist >= 2) return best;
      return name;
    };

    // 3c. rename map を bookings / substitutions / (id なし goals) に適用
    const applyMap = (teamId, name) => {
      const m = renameByTeam.get(teamId);
      if (m && m.has(name)) return m.get(name);
      // rename map で見つからない場合、先頭/末尾トークン一致 → fuzzy の順に救済
      const ht = headTailMatch(teamId, name);
      if (ht !== name) return ht;
      return fuzzyMatch(teamId, name);
    };

    if (Array.isArray(entry.bookings)) {
      for (const b of entry.bookings) {
        const newName = applyMap(b.teamId, b.playerName);
        if (newName !== b.playerName) {
          changeSummary.push(`${matchId} booking: ${b.playerName} → ${newName}`);
          b.playerName = newName;
          changed++;
        }
      }
    }

    if (Array.isArray(entry.substitutions)) {
      for (const s of entry.substitutions) {
        const inNew = applyMap(s.teamId, s.inName);
        if (inNew !== s.inName) {
          changeSummary.push(`${matchId} sub in: ${s.inName} → ${inNew}`);
          s.inName = inNew;
          changed++;
        }
        const outNew = applyMap(s.teamId, s.outName);
        if (outNew !== s.outName) {
          changeSummary.push(`${matchId} sub out: ${s.outName} → ${outNew}`);
          s.outName = outNew;
          changed++;
        }
      }
    }

    // goals で playerId が無いもの (ownGoal 等) は rename map で救済
    if (Array.isArray(entry.goals)) {
      for (const g of entry.goals) {
        if (!g.playerId && g.playerName) {
          const newName = applyMap(g.teamId, g.playerName);
          if (newName !== g.playerName) {
            changeSummary.push(`${matchId} goal (no id): ${g.playerName} → ${newName}`);
            g.playerName = newName;
            changed++;
          }
        }
        if (!g.assistPlayerId && g.assistPlayerName) {
          const newName = applyMap(g.teamId, g.assistPlayerName);
          if (newName !== g.assistPlayerName) {
            changeSummary.push(`${matchId} assist (no id): ${g.assistPlayerName} → ${newName}`);
            g.assistPlayerName = newName;
            changed++;
          }
        }
      }
    }
  }

  if (changed > 0) {
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2) + "\n", "utf8");
  }

  return { changed, changeSummary };
}

function stripBOM(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// Levenshtein 距離 (fuzzy 一致用)。小さい文字列同士の呼び出しに最適化するほど
// のホットパスではないので素直な二次元 DP。
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// CLI (node scripts/sync-player-names.mjs で直接実行された場合)
if (process.argv[1] === __filename) {
  const { changed, changeSummary } = syncPlayerNames();
  if (changed > 0) {
    console.log(`[sync-player-names] ${changed} 件の選手名を更新しました:`);
    for (const line of changeSummary.slice(0, 30)) console.log(`  ${line}`);
    if (changeSummary.length > 30) console.log(`  ... 他 ${changeSummary.length - 30} 件`);
  } else {
    console.log(`[sync-player-names] 更新はありません`);
  }
}
