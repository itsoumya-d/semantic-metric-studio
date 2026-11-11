import { ExploreDefinition } from "../../common/src/index.js";

export type ChartKind = "cartesian" | "table" | "big_number";

export interface ChartSeriesSpec {
  kind: ChartKind;
  xField: string | null;
  seriesFields: Array<{ key: string; label: string; aggregateType: string }>;
  rows: Array<Record<string, string | number | boolean | null>>;
}

export function buildChartSeriesModel(
  explore: ExploreDefinition,
  dimensionIds: string[],
  metricIds: string[],
  rows: Array<Record<string, string | number | boolean | null>>
): ChartSeriesSpec {
  const xField = dimensionIds[0]?.replace(".", "_") ?? null;
  const seriesFields = metricIds.map((id) => {
    const m = explore.metrics[id];
    return {
      key: id.replace(".", "_"),
      label: m?.label ?? id,
      aggregateType: m?.type ?? "number",
    };
  });

  if (dimensionIds.length === 0 && metricIds.length === 1 && rows.length <= 1) {
    return { kind: "big_number", xField: null, seriesFields, rows };
  }
  if (dimensionIds.length >= 2) {
    return { kind: "table", xField, seriesFields, rows };
  }
  return { kind: "cartesian", xField, seriesFields, rows };
}
