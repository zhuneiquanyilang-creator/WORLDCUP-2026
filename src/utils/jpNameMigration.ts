/**
 * 一回限りの localStorage 移行: JPN 選手名を「苗字 名前」(半角スペース区切り)
 * に統一する。
 *
 * 背景: JPN.json と public/data/match_results.json は事前に空白入り表記へ
 * 更新済みだが、ユーザーの localStorage (matchEdits / matchOverrides) は
 * 旧表記「鈴木彩艶」「上田」(苗字のみ) などのまま残ることがある。
 * これが残っていると useAutoSyncResults が毎回 match_results.json を
 * 旧表記で上書きしてしまったり、SpotName の shortName ルックアップが失敗して
 * 名前ラベルが苗字のみになり、ゴール・交代マッチも取れなくなる。
 *
 * 実行方式: localStorage の JSON 文字列に対して、ダブルクォート込みの
 * 文字列置換を 3 段階で行う:
 *   1) `"鈴木彩艶"` (スペース無し) → `"鈴木 彩艶"` (半角スペース)
 *   2) `"鈴木　彩艶"` (全角スペース) → `"鈴木 彩艶"` (半角スペース)
 *   3) `"上田"` (苗字のみ、JPN 内で一意な苗字限定) → `"上田 綺世"` (フルネーム)
 *
 * 冪等性: 既に置換済みなら no-op。
 * フラグ `wc2026:jpNameMigrationV2` を立てて 2 回目以降は skip。
 * 旧 V1 フラグから昇格: V2 は #2 (全角) と #3 (苗字補完) を追加したため、
 *   旧フラグを残しても再実行が必要。flag キー自体を変えることで自動再実行。
 */

const FLAG_KEY = "wc2026:jpNameMigrationV2";
const TARGET_KEYS = ["wc2026:matchEdits", "wc2026:matchOverrides"];

/**
 * 「苗字のみ」(例: `"上田"`) → 「苗字 名前」(例: `"上田 綺世"`) の補完。
 * 早期のフォーメーション編集で苗字だけ保存されてしまった場合に shortName
 * ルックアップが失敗して名前ラベル・ゴール/交代マッチが取れなくなる事象の救済。
 *
 * JPN.json で **苗字が一意な選手のみ** 対象 (鈴木 = 彩艶/唯人/淳之介 のように
 * 重複する苗字は曖昧で誤マッチするため除外)。
 */
const SURNAME_ONLY_MAP: Record<string, string> = {
  上田: "上田 綺世",
  鎌田: "鎌田 大地",
  伊東: "伊東 純也",
  伊藤: "伊藤 洋輝",
  板倉: "板倉 滉",
  冨安: "冨安 健洋",
  堂安: "堂安 律",
  中村: "中村 敬斗",
  佐野: "佐野 海舟",
  田中: "田中 碧",
  久保: "久保 建英",
  菅原: "菅原 由勢",
  谷口: "谷口 彰悟",
  長友: "長友 佑都",
  町野: "町野 修斗",
  後藤: "後藤 啓介",
  前田: "前田 大然",
  大迫: "大迫 敬介",
  渡辺: "渡辺 剛",
  小川: "小川 航基",
  瀬古: "瀬古 歩夢",
  早川: "早川 友基",
  塩貝: "塩貝 健斗",
};

const NAME_MAP: Record<string, string> = {
  鈴木彩艶: "鈴木 彩艶",
  菅原由勢: "菅原 由勢",
  谷口彰悟: "谷口 彰悟",
  板倉滉: "板倉 滉",
  長友佑都: "長友 佑都",
  町野修斗: "町野 修斗",
  田中碧: "田中 碧",
  久保建英: "久保 建英",
  後藤啓介: "後藤 啓介",
  堂安律: "堂安 律",
  前田大然: "前田 大然",
  大迫敬介: "大迫 敬介",
  中村敬斗: "中村 敬斗",
  伊東純也: "伊東 純也",
  鎌田大地: "鎌田 大地",
  渡辺剛: "渡辺 剛",
  鈴木唯人: "鈴木 唯人",
  上田綺世: "上田 綺世",
  小川航基: "小川 航基",
  瀬古歩夢: "瀬古 歩夢",
  伊藤洋輝: "伊藤 洋輝",
  冨安健洋: "冨安 健洋",
  早川友基: "早川 友基",
  佐野海舟: "佐野 海舟",
  鈴木淳之介: "鈴木 淳之介",
  塩貝健斗: "塩貝 健斗",
};

export function runJpNameMigration() {
  if (typeof window === "undefined" || !window.localStorage) return;
  if (localStorage.getItem(FLAG_KEY)) return;

  for (const key of TARGET_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    let text = raw;
    let changed = false;
    // 1) スペース無し氏名 → スペース入り氏名 (例: "上田綺世" → "上田 綺世")
    for (const [old, neo] of Object.entries(NAME_MAP)) {
      const needle = `"${old}"`;
      if (text.includes(needle)) {
        text = text.split(needle).join(`"${neo}"`);
        changed = true;
      }
    }
    // 2) 全角スペース → 半角スペース (例: "上田　綺世" → "上田 綺世")
    for (const neo of Object.values(NAME_MAP)) {
      const surnameGiven = neo.split(" ");
      if (surnameGiven.length !== 2) continue;
      const zenSpaced = `"${surnameGiven[0]}　${surnameGiven[1]}"`;
      const target = `"${neo}"`;
      if (text.includes(zenSpaced)) {
        text = text.split(zenSpaced).join(target);
        changed = true;
      }
    }
    // 3) 苗字のみ → フルネーム (一意な苗字のみ。例: "上田" → "上田 綺世")
    for (const [surname, full] of Object.entries(SURNAME_ONLY_MAP)) {
      const needle = `"${surname}"`;
      if (text.includes(needle)) {
        text = text.split(needle).join(`"${full}"`);
        changed = true;
      }
    }
    if (changed) {
      try {
        localStorage.setItem(key, text);
        console.log(
          `[jpNameMigration] ${key}: 旧 JPN 選手名表記をスペース入り表記に更新しました`
        );
      } catch {
        /* quota 等は無視 */
      }
    }
  }

  try {
    localStorage.setItem(FLAG_KEY, "1");
  } catch {
    /* 無視 */
  }
}
