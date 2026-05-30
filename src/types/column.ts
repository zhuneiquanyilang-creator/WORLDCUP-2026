/**
 * コラム記事の型。
 *
 * `body` は段落の配列。1要素 = 1段落として `<p>` に描画される。
 * 将来 Markdown を入れたくなったら body の型を `string` に変えて renderer を足す。
 */
export type Column = {
  id: string;
  title: string;
  /** ISO 8601 date (YYYY-MM-DD)。一覧では新しい順に並ぶ */
  date: string;
  /** 一覧カードに出す短い要約 */
  summary: string;
  /** 段落の配列 (詳細ページで表示) */
  body: string[];
  /** 筆者名 (任意) */
  author?: string;
  /** タグ・トピックの任意配列。一覧で小さなチップとして表示 */
  tags?: string[];
};
