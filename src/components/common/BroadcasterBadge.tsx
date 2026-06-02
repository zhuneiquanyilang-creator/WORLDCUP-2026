/**
 * 試合カード等に並べる日本国内放送局バッジ。
 * FIFA 公式 (canadamexicousa2026/scores-fixtures?country=JP) の表示に合わせている。
 *
 * 実装方針: 各局の公式ロゴは商標なので複製せず、ブランドカラー + テキストで識別できる
 * 情報用バッジを CSS で組む。"NHK G" や "BS4K" は番組欄での識別用呼称 (固有名詞) であり
 * テキスト表記そのものは情報利用として通常許容される。
 */
import styles from "./BroadcasterBadge.module.css";

export type BroadcasterCode =
  | "nhk-g"
  | "nhk-bs1"
  | "nhk-bs4k"
  | "ntv"
  | "fuji"
  | "dazn";

type Props = { code: string };

type Meta = { label: string; full: string; className: string };

const META: Record<BroadcasterCode, Meta> = {
  "nhk-g": { label: "G", full: "NHK 総合", className: styles.nhkG },
  "nhk-bs1": { label: "BS1", full: "NHK BS1", className: styles.nhkBs1 },
  "nhk-bs4k": { label: "BS4K", full: "NHK BS4K", className: styles.nhkBs4k },
  ntv: { label: "日テレ", full: "日本テレビ", className: styles.ntv },
  fuji: { label: "フジ", full: "フジテレビ", className: styles.fuji },
  dazn: { label: "DAZN", full: "DAZN (配信)", className: styles.dazn },
};

export function BroadcasterBadge({ code }: Props) {
  const meta = META[code as BroadcasterCode];
  if (!meta) return null;
  return (
    <span className={`${styles.badge} ${meta.className}`} title={meta.full}>
      {meta.label}
    </span>
  );
}

/**
 * バッジコード一覧と人間向けの説明。`/regulations` と `/schedule` の
 * 凡例表示で共通利用する単一の真実の源。
 */
export const BROADCASTER_LEGEND: { code: BroadcasterCode; name: string; note: string }[] = [
  { code: "nhk-g", name: "NHK 総合", note: "地上波・主要試合の生中継" },
  { code: "nhk-bs1", name: "NHK BS1", note: "BS の生中継・録画放送" },
  { code: "nhk-bs4k", name: "NHK BS4K", note: "4K 画質での生中継" },
  { code: "ntv", name: "日本テレビ", note: "日本戦を含む地上波生中継" },
  { code: "fuji", name: "フジテレビ", note: "日本戦を含む地上波生中継" },
  { code: "dazn", name: "DAZN", note: "全 104 試合の独占ストリーミング配信" },
];

export function BroadcasterList({ codes }: { codes?: string[] }) {
  if (!codes || codes.length === 0) return null;
  return (
    <span className={styles.list} aria-label="放送局">
      {codes.map((c) => (
        <BroadcasterBadge key={c} code={c} />
      ))}
    </span>
  );
}
