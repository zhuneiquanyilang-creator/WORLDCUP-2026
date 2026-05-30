import { NavLink } from "react-router-dom";
import styles from "./Navigation.module.css";

const items = [
  { to: "/standings", label: "順位表" },
  { to: "/schedule", label: "日程・結果" },
  { to: "/stats", label: "スタッツ" },
  { to: "/past", label: "過去の大会" },
  { to: "/columns", label: "コラム" },
];

export function Navigation() {
  return (
    <nav className={styles.nav}>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.active}` : styles.link
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
