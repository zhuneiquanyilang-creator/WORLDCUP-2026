/**
 * 試合イベントの「分」表示・ソート・パース ユーティリティ。
 *
 * データモデル:
 *   { minute: 90, addedTime: 3 }  → "90+3"
 *   { minute: 67 }                → "67"
 *
 * Goal / Booking / Substitution で共通利用する。
 */

export type WithMinute = { minute: number; addedTime?: number };

/** 表示用の文字列を返す (末尾に ' は付けない、付ける側は呼び出し側で)。 */
export function formatMinute(minute: number, addedTime?: number): string {
  if (typeof addedTime === "number" && addedTime > 0) {
    return `${minute}+${addedTime}`;
  }
  return String(minute);
}

/** ソート用のキー。45+1 < 45+2 < 46 / 90+1 < 90+2 < 91 を保証する。 */
export function eventSortKey(e: WithMinute): number {
  return e.minute * 100 + (e.addedTime ?? 0);
}

/** 「90+3」「67」等の入力を `{ minute, addedTime }` にパースする。
 *  失敗時は null。空白は許容、addedTime=0 は addedTime undefined と同じ扱い。 */
export function parseMinuteText(
  s: string
): { minute: number; addedTime?: number } | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d+)(?:\s*\+\s*(\d+))?$/);
  if (!m) return null;
  const minute = parseInt(m[1], 10);
  if (!Number.isFinite(minute)) return null;
  const raw = m[2] ? parseInt(m[2], 10) : 0;
  return raw > 0 ? { minute, addedTime: raw } : { minute };
}
