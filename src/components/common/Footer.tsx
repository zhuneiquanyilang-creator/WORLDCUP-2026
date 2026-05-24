import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <small>© 2026 World Cup Fan Site (unofficial demo)</small>
        <small className={styles.credit}>
          ライブスコア・試合経過データ:{" "}
          <a
            href="https://www.sofascore.com/"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.creditLink}
          >
            Sofascore
          </a>
          {" / "}
          国旗画像:{" "}
          <a
            href="https://flagcdn.com/"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.creditLink}
          >
            flagcdn.com
          </a>
        </small>
      </div>
    </footer>
  );
}
