import { Outlet } from "react-router-dom";
import { Header } from "./Header";
import { Navigation } from "./Navigation";
import { Footer } from "./Footer";
import { useMatches } from "@/hooks/useMatches";
import { useLivePolling } from "@/hooks/useLivePolling";
import { useAutoSyncResults } from "@/hooks/useAutoSyncResults";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import styles from "./Layout.module.css";

export function Layout() {
  const matchesRes = useMatches();
  useLivePolling(matchesRes.status === "ready" ? matchesRes.data : undefined);
  // dev サーバー実行中なら、finished 試合を `match_results.json` に自動反映する
  useAutoSyncResults();
  // 戻る/進むで元のスクロール位置を復元。非同期データロード対応のため複数回リトライ。
  useScrollRestoration();

  return (
    <div className={styles.layout}>
      <Header />
      <Navigation />
      <main className={styles.main}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
