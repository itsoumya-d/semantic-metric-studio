import { z } from "zod";

export const WarehouseDialectSchema = z.enum(["postgres", "bigquery", "snowflake"]);
export type WarehouseDialect = z.infer<typeof WarehouseDialectSchema>;

export const MetricTypeSchema = z.enum(["count", "count_distinct", "sum", "average", "number"]);
export type MetricType = z.infer<typeof MetricTypeSchema>;

export const DimensionSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  table: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  sqlColumn: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  type: z.enum(["string", "number", "date", "timestamp", "boolean"]),
  label: z.string().min(1),
});
export type Dimension = z.infer<typeof DimensionSchema>;

export const MetricSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  table: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  sqlColumn: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  type: MetricTypeSchema,
  label: z.string().min(1),
});
export type Metric = z.infer<typeof MetricSchema>;

export const JoinDefSchema = z.object({
  table: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  leftKey: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  rightKey: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  type: z.enum(["left", "inner"]).default("left"),
});
export type JoinDef = z.infer<typeof JoinDefSchema>;

export const FilterOperatorSchema = z.enum(["equals", "not_equals", "greater_than", "less_than", "in"]);
export type FilterOperator = z.infer<typeof FilterOperatorSchema>;

export const FilterRuleSchema = z.object({
  fieldId: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/),
  operator: FilterOperatorSchema,
  values: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
});
export type FilterRule = z.infer<typeof FilterRuleSchema>;

export const MetricQuerySchema = z.object({
  exploreName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  dimensions: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/)).default([]),
  metrics: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/)).min(1),
  filters: z.array(FilterRuleSchema).default([]),
  sorts: z
    .array(
      z.object({
        fieldId: z.string(),
        descending: z.boolean().default(true),
      })
    )
    .default([]),
  limit: z.number().int().min(1).max(5000).default(500),
});
export type MetricQuery = z.infer<typeof MetricQuerySchema>;

export interface ExploreDefinition {
  name: string;
  baseTable: string;
  schemaName: string;
  joinedTables: JoinDef[];
  dimensions: Record<string, Dimension>;
  metrics: Record<string, Metric>;
}

export interface CompiledSqlResult {
  sql: string;
  params: Array<string | number | boolean>;
  selectedFieldIds: string[];
  dialect: WarehouseDialect;
}

const UNSAFE_SQL_PATTERN = /(;|--|\/\*|\*\/|\bunion\b\s+\bselect\b|\bdrop\b|\bdelete\b|\binsert\b|\bupdate\b|\bexec\b)/i;

export function assertSafeIdentifier(raw: string, kind: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(raw)) {
    throw new Error(`Unsafe ${kind} identifier rejected: ${raw}`);
  }
  return raw;
}

export function assertSafeLiteralString(value: string): void {
  if (UNSAFE_SQL_PATTERN.test(value)) {
    throw new Error(`Suspicious SQL pattern rejected in filter literal`);
  }
}

export function quoteIdentifier(id: string, dialect: WarehouseDialect): string {
  const safe = assertSafeIdentifier(id, "column_or_table");
  if (dialect === "bigquery") {
    return `\`${safe}\``;
  }
  return `"${safe}"`;
}

export function makeFieldId(table: string, name: string): string {
  return `${assertSafeIdentifier(table, "table")}.${assertSafeIdentifier(name, "field")}`;
}
