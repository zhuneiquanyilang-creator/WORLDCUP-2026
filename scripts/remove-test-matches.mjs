/**
 * 一回限り: test_* (test_che_tot / test_bha_mun) を matches.json / match_results.json /
 * sofascore_mapping.json から削除する。
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "public", "data");

// --- matches.json: 既存 1 エントリ 1 行のフォーマットを保つ ---
const matchesPath = join(DATA, "matches.json");
let matches = JSON.parse(await readFile(matchesPath, "utf8"));
const beforeMatches = matches.length;
matches = matches.filter((m) => !m.id.startsWith("test_"));
function fmt(o) {
  const e = Object.entries(o).map(([k, v]) => `"${k}": ${JSON.stringify(v)}`);
  return `{ ${e.join(", ")} }`;
}
const out = ["["];
for (let i = 0; i < matches.length; i++) {
  out.push("  " + fmt(matches[i]) + (i < matches.length - 1 ? "," : ""));
}
out.push("]");
await writeFile(matchesPath, out.join("\n") + "\n", "utf8");
console.log(`matches.json: ${beforeMatches} -> ${matches.length}`);

// --- match_results.json: test_* キーを削除 ---
const resultsPath = join(DATA, "match_results.json");
const results = JSON.parse(await readFile(resultsPath, "utf8"));
const removedR = [];
for (const k of Object.keys(results)) {
  if (k.startsWith("test_")) {
    delete results[k];
    removedR.push(k);
  }
}
await writeFile(resultsPath, JSON.stringify(results, null, 2) + "\n", "utf8");
console.log(`match_results.json removed: ${removedR.join(", ")}`);

// --- sofascore_mapping.json: mapping から test_* を削除 ---
const mapPath = join(DATA, "sofascore_mapping.json");
const map = JSON.parse(await readFile(mapPath, "utf8"));
const removedM = [];
for (const k of Object.keys(map.mapping)) {
  if (k.startsWith("test_")) {
    delete map.mapping[k];
    removedM.push(k);
  }
}
await writeFile(mapPath, JSON.stringify(map, null, 2) + "\n", "utf8");
console.log(`sofascore_mapping.json removed: ${removedM.join(", ")}`);
