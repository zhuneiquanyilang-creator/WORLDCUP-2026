import { useEffect, useMemo, useState } from "react";
import type { Match } from "@/types/match";
import type { LiveUpdate } from "@/types/live";
import { useJsonResource } from "./useJsonResource";
import { useTeams } from "./useTeams";
import { useThirdPlaceAssignment } from "./useThirdPlaceAssignment";
import { useMatchResults } from "./useMatchResults";
import { dataUrl } from "@/utils/dataUrl";
import {
  MATCH_OVERRIDES_EVENT,
  loadMatchOverrides,
} from "@/utils/matchOverrides";
import {
  MATCH_EDITS_EVENT,
  loadMatchEdits,
  STORAGE_KEY_MATCH_EDITS,
} from "@/utils/matchEdits";
import { resolveMatchTeams } from "@/utils/resolveMatchTeams";

/** LiveUpdate を Match に部分適用する (フィールド単位の上書きマージ)。 */
function applyUpdate(m: Match, u: LiveUpdate): Match {
  return {
    ...m,
    ...(u.status ? { status: u.status } : {}),
    ...(u.liveLabel ? { liveLabel: u.liveLabel } : {}),
    ...(u.score ? { score: u.score } : {}),
    ...(u.penaltyScore ? { penaltyScore: u.penaltyScore } : {}),
    ...(u.penaltyShootout ? { penaltyShootout: u.penaltyShootout } : {}),
    ...(u.goals ? { goals: u.goals } : {}),
    ...(u.bookings ? { bookings: u.bookings } : {}),
    ...(u.substitutions ? { substitutions: u.substitutions } : {}),
    ...(u.homeFormation ? { homeFormation: u.homeFormation } : {}),
    ...(u.awayFormation ? { awayFormation: u.awayFormation } : {}),
    ...(u.stats ? { stats: u.stats } : {}),
    ...(u.note !== undefined ? { note: u.note } : {}),
  };
}

/**
 * `matches.json` を読み、複数レイヤーの上書きを順に重ねて返す。
 *
 *   1. **base**: `public/data/matches.json`
 *   2. **file**: `public/data/match_results.json` (commit対象、公開サイトでも反映)
 *   3. **manual**: `localStorage["wc2026:matchEdits"]` (`/edit/matches` 編集 UI のみ書き込み)
 *   4. **live**: `localStorage["wc2026:matchOverrides"]` (Sofascore polling のみ書き込み)
 *
 * **live が最優先**。dev (localhost) では Sofascore のライブ取得結果がそのまま見え、
 * 手動編集 (`/edit/matches`) は localhost の表示には現れない。
 *
 * 公開サイト訪問者は live / manual の localStorage を持たないため、file
 * (= auto-sync が manual から書き出した「公式結果」) がそのまま見える。
 * これで「localhost = ライブ / 公開サイト = 手動編集」の使い分けが成立する。
 *
 * auto-sync は manual レイヤーだけを file に書き出すので、ライブ取得結果が
 * 誤って公式記録に流れ込むこともない。
 *
 * さらに teams.json + third_place_assignment.json が読めていれば、
 * トーナメント表のプレースホルダ (`GA1` / `W73` / `G3_ABCDF` 等) を
 * 確定済みチームの実 ID に差し替える (`utils/resolveMatchTeams.ts`)。
 */
export function useMatches() {
  const fileState = useJsonResource<Match[]>(dataUrl("matches.json"));
  const teamsState = useTeams();
  const thirdPlaceState = useThirdPlaceAssignment();
  const resultsState = useMatchResults();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === "wc2026:matchOverrides" ||
        e.key === STORAGE_KEY_MATCH_EDITS
      )
        bump();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(MATCH_OVERRIDES_EVENT, bump);
    window.addEventListener(MATCH_EDITS_EVENT, bump);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(MATCH_OVERRIDES_EVENT, bump);
      window.removeEventListener(MATCH_EDITS_EVENT, bump);
    };
  }, []);

  return useMemo(() => {
    if (fileState.status !== "ready") return fileState;
    const fileResults =
      resultsState.status === "ready" ? resultsState.data : {};
    const liveOverrides = loadMatchOverrides();
    const manualEdits = loadMatchEdits();
    const merged: Match[] = fileState.data.map((m) => {
      let next = m;
      const fileR = fileResults[m.id];
      if (fileR) next = applyUpdate(next, fileR);
      const manualR = manualEdits[m.id];
      if (manualR) next = applyUpdate(next, manualR);
      const liveR = liveOverrides[m.id];
      if (liveR) next = applyUpdate(next, liveR);
      return next;
    });
    const data =
      teamsState.status === "ready"
        ? resolveMatchTeams(
            merged,
            teamsState.data,
            thirdPlaceState.status === "ready" ? thirdPlaceState.data : null
          )
        : merged;
    return { ...fileState, data };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileState, teamsState, thirdPlaceState, resultsState, version]);
}
