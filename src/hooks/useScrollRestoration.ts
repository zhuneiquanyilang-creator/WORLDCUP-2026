/**
 * 画面遷移時のスクロール位置を管理するフック。
 *
 * react-router-dom の `<ScrollRestoration />` は loader でデータが揃ってから
 * 復元する設計のため、本プロジェクトのように useEffect でデータ取得する場合
 * 「復元 → データロードでページ高さが変わる → 復元位置が無効化」が起きやすい。
 *
 * このフックは:
 *   1. window の scroll イベントで `{ key, y }` を継続的に追跡
 *   2. 画面遷移時、直前 location.key の最終スクロール位置を sessionStorage に保存
 *   3. POP (戻る/進む) なら保存値を復元。ただし非同期データでページ高さが
 *      後から伸びる場合に備えて 50/150/350/700ms にもリトライ
 *   4. PUSH / REPLACE (新規遷移) は先頭にスクロール
 *
 * sessionStorage キー: `wc2026:scrollPositions`
 *   形式: { [location.key]: scrollY }
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const STORAGE_KEY = "wc2026:scrollPositions";

function loadPositions(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function savePositions(positions: Record<string, number>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    /* quota 超過等は無視 */
  }
}

export function useScrollRestoration() {
  const location = useLocation();
  const navType = useNavigationType();
  // 現在表示中の location.key / pathname と、その上での最終スクロール位置を保持。
  // pathname を持っておくのは「クエリだけ変わった (フィルタ切替) ときに先頭へ
  // 戻らない」判定のため。
  const lastRef = useRef({
    key: location.key,
    pathname: location.pathname,
    y: 0,
  });

  // ブラウザの自動復元を切る (一度きり)。
  // これがオンのままだと React Router の復元と競合して場所が定まらない。
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  // window scroll を継続的に追跡 (passive)。ref に書くだけなので re-render しない。
  useEffect(() => {
    const onScroll = () => {
      lastRef.current.y = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 画面遷移時: 直前 key の位置を保存 → 新 key を復元 or トップへ
  useEffect(() => {
    const prev = lastRef.current;
    const samePath = prev.pathname === location.pathname;
    if (prev.key !== location.key) {
      // 直前画面の最終位置を保存
      const positions = loadPositions();
      positions[prev.key] = prev.y;
      savePositions(positions);
      // ref を新 key に切替。pathname が同じならスクロール位置は維持されるので
      // 現在の scrollY を引き継ぐ、違うなら 0 から開始。
      lastRef.current = {
        key: location.key,
        pathname: location.pathname,
        y: samePath ? window.scrollY : 0,
      };
    }

    if (navType === "POP") {
      const positions = loadPositions();
      const target = positions[location.key] ?? 0;
      // 非同期データロードでページ高さが後から伸びるケースに備え、複数回リトライ。
      // 既に target 位置に居る (= 別ページで保存値と同位置) ならそのまま、
      // height < target なら scrollTo は内部的に max にクランプされるが
      // 後続リトライでページが伸びれば最終的に target に到達する。
      const restore = () => {
        window.scrollTo({ top: target, left: 0, behavior: "auto" });
      };
      restore();
      const timers = [50, 150, 350, 700].map((d) => window.setTimeout(restore, d));
      return () => timers.forEach((t) => window.clearTimeout(t));
    }

    // 新規遷移 (PUSH / REPLACE) は先頭へ。
    // ただし pathname が変わっていない (= 同じページ内でクエリだけ変えた、
    // 例: /standings?group=A → /standings?group=B) ならスクロール位置を維持する。
    if (!samePath) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [location.key, location.pathname, navType]);
}
