import { useMemo } from "react";
import type { Match, Goal, Booking, Substitution } from "@/types/match";
import type { Player } from "@/types/player";
import type { Team } from "@/types/team";
import { eventSortKey, formatMinute } from "@/utils/eventMinute";
import styles from "./MatchEvents.module.css";

type Props = {
  match: Match;
  teamMap: Map<string, Team>;
  playerMap: Map<string, Player>;
};

type EventItem =
  | { kind: "goal"; minute: number; addedTime?: number; teamId: string; data: Goal }
  | { kind: "booking"; minute: number; addedTime?: number; teamId: string; data: Booking }
  | { kind: "sub"; minute: number; addedTime?: number; teamId: string; data: Substitution };

type RenderItem = EventItem | { kind: "halftime" };

function bookingIcon(type: Booking["type"]): { icon: string; label: string } {
  switch (type) {
    case "Y":
      return { icon: "🟨", label: "イエロー" };
    case "Y2R":
      return { icon: "🟨🟥", label: "2枚目イエローで退場" };
    case "R":
      return { icon: "🟥", label: "一発レッド" };
    case "YR":
      return { icon: "🟨🟥", label: "イエロー後の一発レッド" };
  }
}

function goalTypeBadge(type: Goal["type"]): string {
  if (type === "penalty") return "(PK)";
  if (type === "own") return "(OG)";
  return "";
}

function resolveName(
  playerId: string | undefined,
  playerName: string | undefined,
  playerMap: Map<string, Player>
): string {
  if (playerId) {
    const p = playerMap.get(playerId);
    if (p) return p.name;
  }
  return playerName ?? playerId ?? "";
}

export function MatchEvents({ match, teamMap, playerMap }: Props) {
  const events = useMemo<EventItem[]>(() => {
    const list: EventItem[] = [];
    (match.goals ?? []).forEach((g) =>
      list.push({
        kind: "goal",
        minute: g.minute,
        addedTime: g.addedTime,
        teamId: g.teamId,
        data: g,
      })
    );
    (match.bookings ?? []).forEach((b) =>
      list.push({
        kind: "booking",
        minute: b.minute,
        addedTime: b.addedTime,
        teamId: b.teamId,
        data: b,
      })
    );
    (match.substitutions ?? []).forEach((s) =>
      list.push({
        kind: "sub",
        minute: s.minute,
        addedTime: s.addedTime,
        teamId: s.teamId,
        data: s,
      })
    );
    // 45+1 < 45+2 < 46 / 90+1 < 90+2 < 91 を保証する 100 進数ソートキー
    return list.sort((a, b) => eventSortKey(a) - eventSortKey(b));
  }, [match]);

  const renderItems = useMemo<RenderItem[]>(() => {
    const list: RenderItem[] = [];
    let htInserted = false;
    for (const ev of events) {
      if (!htInserted && ev.minute > 45) {
        list.push({ kind: "halftime" });
        htInserted = true;
      }
      list.push(ev);
    }
    // ライブ取得で「ハーフタイム以降」と分かっているときは、末尾にもハーフタイム
    // ディバイダーを置く (まだ後半イベントが入っておらずループ内で挿入されない場合)。
    //
    // 主判定: API の liveLabel が halftime/2nd half/extra time/penalty を含む。
    //   Football-Data.org の PAUSED → "Halftime"、IN_PLAY + minute>45 → "2nd half"
    //   が footballDataSource.ts で設定される。
    //
    // フォールバック: liveLabel が "Live" (= FD が minute を返さなかった IN_PLAY)
    //   のとき、後半開始直後に HT divider が一瞬消える事象があった。KO 時刻からの
    //   実経過時間が **60 分超** なら「1st half + ロスタイム + HT 休憩」を確実に
    //   過ぎているので HT として扱う。50 分閾値だと前半ロスタイム中に誤発火する
    //   ため不可。60 分は (45 + 7 stoppage + 15 break ≈ 67 分) より短いが、
    //   ロスタイム実時間 7 分は稀なので実用上問題なし。
    //
    // finished の自動付与はしない (前半のみゴールの試合で末尾に出てしまうため)。
    if (!htInserted && match.status === "live") {
      const ll = (match.liveLabel ?? "").toLowerCase();
      const labelPastHalftime =
        ll.includes("halftime") ||
        ll.includes("half time") ||
        ll.includes("2nd half") ||
        ll.includes("second half") ||
        ll.includes("extra time") ||
        ll.includes("penalty");
      const koMs = new Date(match.date).getTime();
      const elapsedMin = (Date.now() - koMs) / 60_000;
      const timePastHalftime = Number.isFinite(elapsedMin) && elapsedMin > 60;
      if (labelPastHalftime || timePastHalftime) {
        list.push({ kind: "halftime" });
      }
    }
    return list;
  }, [events, match.status, match.liveLabel, match.date]);

  if (renderItems.length === 0) {
    return (
      <section className={styles.section}>
        <p className={styles.empty}>試合経過のデータはまだありません。</p>
      </section>
    );
  }

  const homeTeamId = match.homeTeamId;

  return (
    <section className={styles.section}>
      <div className={styles.headRow}>
        <div className={styles.headSide}>
          {teamMap.get(match.homeTeamId)?.name ?? match.homeTeamId}
        </div>
        <div className={styles.headTime}>時間</div>
        <div className={styles.headSide}>
          {teamMap.get(match.awayTeamId)?.name ?? match.awayTeamId}
        </div>
      </div>
      <ol className={styles.timeline}>
        {renderItems.map((item, i) => {
          if (item.kind === "halftime") {
            return (
              <li key={`ht-${i}`} className={styles.halftimeRow}>
                <span className={styles.halftimeLine} aria-hidden />
                <span className={styles.halftimeBlock}>
                  <span className={styles.halftimeLabel}>ハーフタイム</span>
                  {match.note && (
                    <span className={styles.halftimeNote}>{match.note}</span>
                  )}
                </span>
                <span className={styles.halftimeLine} aria-hidden />
              </li>
            );
          }
          const isHome = item.teamId === homeTeamId;
          return (
            <li
              key={`${item.kind}-${item.minute}-${i}`}
              className={isHome ? styles.rowHome : styles.rowAway}
            >
              <div className={styles.side}>
                {isHome && (
                  <EventContent event={item} playerMap={playerMap} align="right" />
                )}
              </div>
              <div className={styles.minute}>
                {formatMinute(item.minute, item.addedTime)}&apos;
              </div>
              <div className={styles.side}>
                {!isHome && (
                  <EventContent event={item} playerMap={playerMap} align="left" />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function EventContent({
  event,
  playerMap,
  align,
}: {
  event: EventItem;
  playerMap: Map<string, Player>;
  align: "left" | "right";
}) {
  const alignClass = align === "left" ? styles.alignLeft : styles.alignRight;

  if (event.kind === "goal") {
    const g = event.data;
    const scorer = resolveName(g.playerId, g.playerName, playerMap);
    const assist = g.assistPlayerId || g.assistPlayerName
      ? resolveName(g.assistPlayerId, g.assistPlayerName, playerMap)
      : undefined;
    const badge = goalTypeBadge(g.type);
    return (
      <div className={`${styles.event} ${alignClass}`}>
        <span className={styles.icon}>⚽</span>
        <span className={styles.text}>
          <span className={styles.name}>
            {scorer} {badge}
          </span>
          {assist && <span className={styles.assist}>A: {assist}</span>}
        </span>
      </div>
    );
  }

  if (event.kind === "booking") {
    const b = event.data;
    const { icon, label } = bookingIcon(b.type);
    return (
      <div className={`${styles.event} ${alignClass}`} title={label}>
        <span className={styles.icon}>{icon}</span>
        <span className={styles.text}>
          <span className={styles.name}>{b.playerName}</span>
        </span>
      </div>
    );
  }

  // sub
  const s = event.data;
  return (
    <div className={`${styles.event} ${alignClass}`}>
      <span className={styles.icon}>🔁</span>
      <span className={styles.text}>
        <span className={styles.subIn}>IN: {s.inName}</span>
        <span className={styles.subOut}>OUT: {s.outName}</span>
      </span>
    </div>
  );
}
