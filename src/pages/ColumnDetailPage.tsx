/**
 * コラム詳細。`/columns/:id` でアクセス。
 * 該当 id が無ければ「見つかりませんでした」を表示し、一覧へ戻るリンクを付ける。
 */
import { Link, useParams } from "react-router-dom";
import { useColumns } from "@/hooks/useColumns";
import { Loading, ErrorMessage } from "@/components/common/AsyncState";
import styles from "./ColumnDetailPage.module.css";

function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

export function ColumnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const res = useColumns();

  if (res.status === "loading") return <Loading />;
  if (res.status === "error") return <ErrorMessage message={res.error} />;

  const column = res.data.find((c) => c.id === id);

  if (!column) {
    return (
      <div>
        <Link to="/columns" className={styles.back}>← コラム一覧へ</Link>
        <ErrorMessage message="該当する記事が見つかりませんでした。" />
      </div>
    );
  }

  return (
    <article className={styles.article}>
      <Link to="/columns" className={styles.back}>← コラム一覧へ</Link>
      <header className={styles.header}>
        <div className={styles.meta}>
          <span className={styles.date}>{formatDate(column.date)}</span>
          {column.tags && column.tags.length > 0 && (
            <span className={styles.tags}>
              {column.tags.map((t) => (
                <span key={t} className={styles.tag}>
                  {t}
                </span>
              ))}
            </span>
          )}
        </div>
        <h1 className={styles.title}>{column.title}</h1>
        {column.author && <p className={styles.author}>by {column.author}</p>}
      </header>
      <div className={styles.body}>
        {column.body.map((para, i) => (
          <p key={i} className={styles.paragraph}>
            {para}
          </p>
        ))}
      </div>
    </article>
  );
}
