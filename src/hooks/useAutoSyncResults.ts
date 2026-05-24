import { useEffect, useRef } from "react";
import type { LiveUpdate } from "@/types/live";
import {
  MATCH_EDITS_EVENT,
  STORAGE_KEY_MATCH_EDITS,
  loadMatchEdits,
} from "@/utils/matchEdits";

/**
 * 「`/edit/matches` で確定した内容を `public/data/match_results.json` に
 * 自動反映する」ためのフック。
 *
 * 対象は **matchEdits レイヤーだけ**。Sofascore polling の `matchOverrides` は
 * 触らない（ライブ取得結果が公式記録に流れ込むのを防ぐ）。
 *
 * dev サーバーの `/__dev/match-results` 書き込みエンドポイントへ POST する。
 * 本番 (vite build した SPA) ではこのエンドポイントが存在しないので、
 * fetch が失敗しても警告だけ出して静かにフォールバックする。
 *
 * 動作:
 *  - matchEdits 変化を listen
 *  - finished かつ score を持つエントリだけ抽出 (確定済みのみ)
 *  - 直前の sync 内容と差分があれば 1.5s デバウンスで POST
 *
 * dev でのみ動かす (`import.meta.env.DEV`)。本番ビルドからは実質コードごと
 * ツリーシェイクされる。
 */
export function useAutoSyncResults() {
  const lastSyncedJson = useRef<string>("");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const syncNow = async () => {
      const edits = loadMatchEdits();
      const finished: Record<string, LiveUpdate> = {};
      for (const [id, u] of Object.entries(edits)) {
        if (u && u.status === "finished" && u.score) finished[id] = u;
      }
      // matchEdits に確定済み試合が 1 つも無いときは POST しない。
      // server 側の field-level merge は空 incoming で existing を消さないが、
      // そもそも余計な write を発生させないことで「クリア操作 → file 触る」の
      // 連鎖をゼロにする (二重防衛)。
      if (Object.keys(finished).length === 0) {
        lastSyncedJson.current = "{}";
        return;
      }
      const json = JSON.stringify(finished);
      if (json === lastSyncedJson.current) return;

      try {
        const res = await fetch("/__dev/match-results", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: json,
        });
        if (!res.ok) {
          console.warn(
            `[auto-sync] dev endpoint returned ${res.status} ${res.statusText}`
          );
          return;
        }
        lastSyncedJson.current = json;
        const ok = await res.json().catch(() => null);
        if (ok)
          console.log(
            `[auto-sync] match_results.json updated (${Object.keys(finished).length} finished, total ${ok.count})`
          );
      } catch (e) {
        console.warn("[auto-sync] failed (dev server only):", e);
      }
    };

    const scheduleSync = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(syncNow, 1500);
    };

    scheduleSync();

    window.addEventListener(MATCH_EDITS_EVENT, scheduleSync);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_MATCH_EDITS) scheduleSync();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(MATCH_EDITS_EVENT, scheduleSync);
      window.removeEventListener("storage", onStorage);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);
}
