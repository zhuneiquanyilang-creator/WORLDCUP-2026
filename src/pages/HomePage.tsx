import { Link } from "react-router-dom";
import styles from "./HomePage.module.css";

const menus = [
  { to: "/standings", label: "順位表", desc: "グループ別の順位と勝点" },
  { to: "/bracket", label: "トーナメント表", desc: "R32 から決勝までのブラケット" },
  { to: "/schedule", label: "日程・結果", desc: "全試合の日程・会場・スコア" },
  { to: "/stats", label: "スタッツ", desc: "得点・アシストランキング" },
  { to: "/past", label: "過去の大会", desc: "1930〜2022 年の歴代 W 杯と各賞" },
  { to: "/columns", label: "コラム", desc: "見どころや本サイトの使い方" },
  { to: "/regulations", label: "レギュレーション", desc: "大会の公式ルールまとめ" },
];

export function HomePage() {
  return (
    <div>
      <section className={styles.hero}>
        <h1 className={styles.title}>FIFA World Cup 2026</h1>
        <p className={styles.subtitle}>48か国・104試合・3か国共催の歴史的大会</p>
      </section>

      <section className={styles.menuGrid}>
        {menus.map((m) => (
          <Link key={m.to} to={m.to} className={styles.menuCard}>
            <span className={styles.menuLabel}>{m.label}</span>
            <span className={styles.menuDesc}>{m.desc}</span>
          </Link>
        ))}
      </section>
    </div>
  );
}
