import type { Column } from "@/types/column";
import { useJsonResource } from "./useJsonResource";
import { dataUrl } from "@/utils/dataUrl";

export function useColumns() {
  return useJsonResource<Column[]>(dataUrl("columns.json"));
}
