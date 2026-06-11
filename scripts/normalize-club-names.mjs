// 所属クラブ名の表記ゆれを統一する。
//
// 課題:
//  - 「バイエルン・ミュンヘン」と「バイエルン・ミュンヘン（ドイツ）」が混在
//  - 半角 "(...)" と全角 "（...）" の混在
//  - 「（米）」と「（アメリカ）」の混在
//  - 「アル・アハリ」が Egypt の Al Ahly SC と Saudi の Al Ahli Saudi FC で衝突
//
// ルール:
//  1. アル・アハリ: エジプト代表選手 → アル・アハリ（エジプト）、それ以外 → アル・アハリ（サウジアラビア）
//  2. 半角括弧 → 全角括弧
//  3. 「（米）」 → 「（アメリカ）」
//  4. 同じ「括弧なし基底名」に対して括弧付き variant が 1 つしかない場合、裸の名前もその括弧付き variant に統一
//     （複数 variant が並走している場合は触らず、ログに残す）

import fs from "fs";
import path from "path";

const file = path.resolve("public/data/players.json");
const raw = fs.readFileSync(file, "utf8");
const players = JSON.parse(raw);

// step 1: 文字列レベルの正規化
function basicNormalize(s) {
  if (!s) return s;
  let out = s;
  // 半角括弧 → 全角
  out = out.replace(/\(([^)]+)\)/g, "（$1）");
  // 「（米）」 → 「（アメリカ）」
  out = out.replace(/（米）/g, "（アメリカ）");
  // 末尾の空白除去
  out = out.replace(/\s+$/, "");
  return out;
}

// step 2: アル・アハリ専用処理（player オブジェクトを受け取る）
function disambiguateAlAhly(p) {
  if (!p.club) return p.club;
  if (p.club === "アル・アハリ" || p.club === "アル・アハリ（）") {
    if (p.teamId === "EGY") return "アル・アハリ（エジプト）";
    // それ以外は実質 Al Ahli Saudi FC
    return "アル・アハリ（サウジアラビア）";
  }
  return p.club;
}

// まず適用
for (const p of players) {
  p.club = basicNormalize(p.club);
  p.club = disambiguateAlAhly(p);
}

// step 3: 括弧なし基底名 → 唯一の括弧付き variant があれば吸収
function baseKey(s) {
  return (s || "").replace(/[（(].+?[）)]/g, "").trim();
}

const variantsByBase = new Map(); // base → Map(fullName → count)
for (const p of players) {
  if (!p.club) continue;
  const b = baseKey(p.club);
  if (!variantsByBase.has(b)) variantsByBase.set(b, new Map());
  const m = variantsByBase.get(b);
  m.set(p.club, (m.get(p.club) || 0) + 1);
}

const canonicalByBase = new Map();
const ambiguous = [];
for (const [base, variants] of variantsByBase) {
  const keys = Array.from(variants.keys());
  // 括弧付き variant を抽出
  const withParen = keys.filter((k) => /[（(]/.test(k));
  const bare = keys.find((k) => !/[（(]/.test(k));
  if (withParen.length === 1 && bare) {
    canonicalByBase.set(base, withParen[0]);
  } else if (withParen.length >= 2 && bare) {
    ambiguous.push({ base, variants: keys });
  } else if (withParen.length === 1 && !bare) {
    // すでに全部括弧付き、何もしない
  }
}

let changed = 0;
for (const p of players) {
  if (!p.club) continue;
  const b = baseKey(p.club);
  const canon = canonicalByBase.get(b);
  if (canon && p.club !== canon) {
    p.club = canon;
    changed++;
  }
}

// step 4: 元のフォーマット (1行1選手) を保持して書き戻し
function formatPlayers(arr) {
  const lines = ["["];
  for (let i = 0; i < arr.length; i++) {
    const json = JSON.stringify(arr[i]);
    lines.push("  " + json + (i === arr.length - 1 ? "" : ","));
  }
  lines.push("]");
  return lines.join("\n") + "\n";
}

fs.writeFileSync(file, formatPlayers(players), "utf8");

console.log("Updated:", changed, "player entries");
console.log("Ambiguous bases (left untouched):");
for (const a of ambiguous) console.log("  ", a.base, "->", a.variants.join(" / "));
