/**
 * コラム一覧。新しい順に並ぶ。
 * クリックで `/columns/:id` の詳細ページへ。
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useColumns } from "@/hooks/useColumns";
import { Loading, ErrorMessage } from "@/components/common/AsyncState";
import styles from "./ColumnsPage.module.css";

function formatDate(iso: string): string {
  // "2026-05-31" → "2026年5月31日"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

export function ColumnsPage() {
  const res = useColumns();

  const sorted = useMemo(() => {
    if (res.status !== "ready") return null;
    return [...res.data].sort((a, b) => b.date.localeCompare(a.date));
  }, [res]);

  if (res.status === "loading") return <Loading />;
  if (res.status === "error") return <ErrorMessage message={res.error} />;
  if (!sorted || sorted.length === 0) {
    return (
      <div>
        <h1>コラム</h1>
        <p className={styles.empty}>記事はまだありません。</p>
      </div>
    );
  }

  return (
    <div>
      <h1>コラム</h1>
      <p className={styles.lead}>大会の見どころや本サイトの使い方を不定期に綴ります。</p>
      <ul className={styles.list}>
        {sorted.map((c) => (
          <li key={c.id}>
            <Link to={`/columns/${c.id}`} className={styles.item}>
              <div className={styles.itemHead}>
                <span className={styles.date}>{formatDate(c.date)}</span>
                {c.tags && c.tags.length > 0 && (
                  <span className={styles.tags}>
                    {c.tags.map((t) => (
                      <span key={t} className={styles.tag}>
                        {t}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              <h2 className={styles.title}>{c.title}</h2>
              <p className={styles.summary}>{c.summary}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
