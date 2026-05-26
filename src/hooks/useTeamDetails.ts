import { useMemo } from "react";
import type { TeamDetail } from "@/types/teamDetail";
import { useJsonResource } from "./useJsonResource";
import { dataUrl } from "@/utils/dataUrl";

/**
 * チーム詳細データ (`team_details.json`)。
 *
 * **ファイルが唯一の真実**。`/edit/history` の localStorage オーバーレイは
 * 以前はここでマージされていたが、「ファイルを直接編集したのに反映されない」
 * 混乱を避けるため、表示パスからは外した。
 *
 * 編集 UI からファイルへ反映する場合は `/edit/history` の「JSON 出力」を
 * 押し、出力された JSON を `public/data/team_details.json` に貼り付けて
 * commit / push する。
 */
export function useTeamDetails() {
  return useJsonResource<TeamDetail[]>(dataUrl("team_details.json"));
}

export function useTeamDetailMap() {
  const state = useTeamDetails();
  const map = useMemo(() => {
    const m = new Map<string, TeamDetail>();
    if (state.status === "ready") {
      state.data.forEach((d) => m.set(d.teamId, d));
    }
    return m;
  }, [state]);
  return { ...state, map };
}
