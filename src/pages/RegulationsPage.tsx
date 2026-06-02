/**
 * レギュレーション（大会規定）ページ。
 *
 * 内容は `docs/tournament.md` に整理済みの公式ルールを基に静的にレンダリングする:
 * - 大会概要（出場国数 / グループ構成 / 試合数 / 開幕戦・決勝 / 開催地）
 * - トーナメント方式（グループ → R32 → R16 → QF → SF → 3 位決定戦 / 決勝）
 * - R32 進出条件（上位 2 + 3 位ワイルドカード 8）
 * - グループステージ順位決定方法（FIFA 公式タイブレーカー 1〜9）
 * - フェアプレーポイントの内訳
 *
 * 出典: Wikipedia「2026 FIFAワールドカップ」（2026-05-17 取得）、
 *       FIFA 公式ルール準拠（ユーザー提供）。
 */
import {
  BroadcasterBadge,
  BROADCASTER_LEGEND,
} from "@/components/common/BroadcasterBadge";
import styles from "./RegulationsPage.module.css";

export function RegulationsPage() {
  return (
    <div className={styles.page}>
      <h1>レギュレーション</h1>
      <p className={styles.lead}>
        2026 FIFA ワールドカップの大会規定を要約。出典は Wikipedia「2026 FIFA
        ワールドカップ」および FIFA 公式ルール。
      </p>

      <section className={styles.section}>
        <h2 className={styles.h2}>大会概要</h2>
        <dl className={styles.spec}>
          <dt>開催期間</dt>
          <dd>2026 年 6 月 11 日 〜 7 月 19 日</dd>
          <dt>開催国</dt>
          <dd>カナダ・メキシコ・アメリカ合衆国（3 か国共催）</dd>
          <dt>出場国</dt>
          <dd>48 か国</dd>
          <dt>グループ</dt>
          <dd>12 グループ（A 〜 L）× 4 チーム</dd>
          <dt>試合数</dt>
          <dd>計 104 試合</dd>
          <dt>会場</dt>
          <dd>16 都市（カナダ 2 / 米国 11 / メキシコ 3）</dd>
          <dt>開幕戦</dt>
          <dd>2026 年 6 月 11 日、エスタディオ・アステカ（メキシコシティ）</dd>
          <dt>決勝戦</dt>
          <dd>2026 年 7 月 19 日、ニューヨーク・ニュージャージー・スタジアム（ニューヨーク）</dd>
        </dl>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>トーナメント方式</h2>
        <p>
          グループステージのあとに 5 ラウンドのノックアウトを行う。今大会から
          <strong>ラウンド 32（R32）</strong>が新設され、グループ各組 3 位の上位
          8 か国もノックアウトへ進出する。
        </p>
        <div className={styles.flow}>
          グループ (12 組 × 4) → 1回戦 (ベスト32) → 2回戦(ベスト16) → 準々決勝 → 準決勝 → 3
          位決定戦 / 決勝
        </div>
        <h3 className={styles.h3}>R32 進出条件</h3>
        <ul className={styles.list}>
          <li>各グループの 1 位・2 位 = 24 チーム</li>
          <li>各グループ 3 位の横断順位上位 8 チーム = 8 チーム</li>
          <li>合計 32 チームが R32 へ進出</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>グループステージ順位決定方法</h2>
        <p>
          勝利 = <strong>3 点</strong> / 引分 = <strong>1 点</strong> / 敗北 ={" "}
          <strong>0 点</strong>。同勝ち点で並んだ場合は以下を上から順に適用する。
        </p>
        <ol className={styles.tiebreakers}>
          <li>当該チーム間の対戦における勝ち点（head-to-head points）</li>
          <li>当該チーム間の対戦における得失点差（head-to-head GD）</li>
          <li>当該チーム間の対戦における得点（head-to-head goals for）</li>
        </ol>
        <p className={styles.note}>
          1 〜 3 を適用しても並びが残る場合、その並びのチーム同士で
          <strong> 1 〜 3 を再帰的に再適用</strong>する。それでも決まらなければ
          4 以降に進む。
        </p>
        <ol className={styles.tiebreakers} start={4}>
          <li>全試合での得失点差（overall GD）</li>
          <li>全試合での得点（overall goals for）</li>
          <li>
            フェアプレーポイント（選手・チーム役員のカードを以下で集計）
            <ul className={styles.fairplay}>
              <li>イエローカード: <strong>−1</strong></li>
              <li>イエローカード 2 枚による退場: <strong>−3</strong></li>
              <li>一発レッド: <strong>−4</strong></li>
              <li>イエロー後の一発レッド: <strong>−5</strong></li>
            </ul>
          </li>
          <li>最新の FIFA ランキング</li>
          <li>過去の FIFA ランキング（新しい方から順に決まるまで遡る）</li>
        </ol>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>ノックアウトステージ</h2>
        <ul className={styles.list}>
          <li>
            90 分で決着しない場合は <strong>延長 30 分</strong>（前後半 15 分）。
          </li>
          <li>
            延長でも決着しない場合は <strong>PK 戦</strong>で勝者を決定。
          </li>
          <li>
            <strong>3 位決定戦</strong>を実施（準決勝の敗者同士）。決勝の前日に行われる。
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>登録メンバー</h2>
        <ul className={styles.list}>
          <li>
            各国は <strong>26 名</strong>（うち GK 最低 3 名）の最終メンバーを登録する。
          </li>
          <li>
            負傷者の差し替えは大会規定に従って大会前まで可能。
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>テレビ放送・配信（日本国内）</h2>
        <p>
          試合カードに表示されるバッジは、その試合の日本国内中継・配信を示します。
          出典: FIFA 公式「Scores &amp; Fixtures」のページから日本向け放送局情報（2026 年 5 月 26 日取得）。
        </p>
        <ul className={styles.broadcasterList}>
          {BROADCASTER_LEGEND.map((b) => (
            <li key={b.code} className={styles.broadcasterItem}>
              <BroadcasterBadge code={b.code} />
              <span className={styles.broadcasterName}>{b.name}</span>
              <span className={styles.broadcasterNote}>— {b.note}</span>
            </li>
          ))}
        </ul>
        <p className={styles.note}>
          DAZN は全 104 試合を独占ストリーミング配信。NHK・日テレ・フジテレビは
          一部の試合のみ地上波／BS で放送します。試合ごとの中継局は「日程・結果」
          ページの各試合カードに付いているバッジで確認できます。
        </p>
      </section>

      <p className={styles.sources}>
        出典: <a
          href="https://ja.wikipedia.org/wiki/2026_FIFA%E3%83%AF%E3%83%BC%E3%83%AB%E3%83%89%E3%82%AB%E3%83%83%E3%83%97"
          target="_blank"
          rel="noreferrer noopener"
        >
          Wikipedia「2026 FIFA ワールドカップ」
        </a>{" "}
        ／ FIFA 公式大会規則（Regulations of the FIFA World Cup 26™）。
      </p>
    </div>
  );
}
