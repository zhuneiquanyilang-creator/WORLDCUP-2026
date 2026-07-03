export type Position = "GK" | "DF" | "MF" | "FW";

export type Player = {
  id: string;
  name: string;
  teamId: string;
  position: Position;
  goals: number;
  assists: number;
  /** PK による得点数 (goals の内数)。ゴールランキングで `4 (PK 1)` のように補足表示する。 */
  penaltyGoals?: number;
  /** 背番号 (代表チームでの公式番号)。Sofascore の shirtNumber と突合して得点者を特定 */
  number?: number;
  /** ISO 8601 date (YYYY-MM-DD) */
  birthDate?: string;
  /** 所属クラブ名 */
  club?: string;
  /** フォーメーション画面 (ピッチ上) に表示する略称。
   *  デフォルトはカタカナ・英名なら姓のみ、KOR など姓先頭ルールは別途調整。
   *  個別に編集すれば任意の文字列を出せる。空 / 未設定なら surnameOf(name) フォールバック。 */
  shortName?: string;
};
