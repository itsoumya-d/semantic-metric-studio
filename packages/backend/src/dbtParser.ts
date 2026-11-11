import yaml from "js-yaml";
import { z } from "zod";
import {
  Dimension,
  ExploreDefinition,
  Metric,
  MetricTypeSchema,
  assertSafeIdentifier,
  makeFieldId,
} from "../../common/src/index.js";

const DbtColumnMetricSchema = z.object({
  type: MetricTypeSchema,
  label: z.string().min(1),
});

const DbtColumnSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  meta: z
    .object({
      dimension: z
        .object({
          type: z.enum(["string", "number", "date", "timestamp", "boolean"]).default("string"),
          label: z.string().optional(),
        })
        .optional(),
      metrics: z.record(DbtColumnMetricSchema).optional(),
    })
    .optional(),
});

const DbtModelYamlSchema = z.object({
  version: z.literal(2),
  models: z
    .array(
      z.object({
        name: z.string().min(1),
        meta: z
          .object({
            schema: z.string().default("analytics"),
            joins: z
              .array(
                z.object({
                  join: z.string().min(1),
                  left_key: z.string().min(1),
                  right_key: z.string().min(1),
                  type: z.enum(["left", "inner"]).default("left"),
                })
              )
              .default([]),
          })
          .optional(),
        columns: z.array(DbtColumnSchema).default([]),
      })
    )
    .min(1),
});

export function parseDbtYamlToExplores(yamlContent: string): ExploreDefinition[] {
  const parsed = yaml.load(yamlContent);
  const doc = DbtModelYamlSchema.parse(parsed);
  const explores: ExploreDefinition[] = [];

  for (const model of doc.models) {
    const baseTable = assertSafeIdentifier(model.name, "dbt_model");
    const schemaName = assertSafeIdentifier(model.meta?.schema ?? "analytics", "schema");
    const dimensions: Record<string, Dimension> = {};
    const metrics: Record<string, Metric> = {};

    for (const col of model.columns) {
      const sqlCol = assertSafeIdentifier(col.name, "dbt_column");
      const dimMeta = col.meta?.dimension;
      if (dimMeta) {
        const fieldId = makeFieldId(baseTable, sqlCol);
        dimensions[fieldId] = {
          name: sqlCol,
          table: baseTable,
          sqlColumn: sqlCol,
          type: dimMeta.type,
          label: dimMeta.label ?? sqlCol,
        };
      }
      const colMetrics = col.meta?.metrics ?? {};
      for (const [metricName, mDef] of Object.entries(colMetrics)) {
        const safeMetricName = assertSafeIdentifier(metricName, "metric_name");
        const fieldId = makeFieldId(baseTable, safeMetricName);
        metrics[fieldId] = {
          name: safeMetricName,
          table: baseTable,
          sqlColumn: sqlCol,
          type: mDef.type,
          label: mDef.label,
        };
      }
    }

    explores.push({
      name: baseTable,
      baseTable,
      schemaName,
      joinedTables: (model.meta?.joins ?? []).map((j) => ({
        table: assertSafeIdentifier(j.join, "join_table"),
        leftKey: assertSafeIdentifier(j.left_key, "left_key"),
        rightKey: assertSafeIdentifier(j.right_key, "right_key"),
        type: j.type,
      })),
      dimensions,
      metrics,
    });
  }

  return explores;
}
