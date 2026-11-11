import {
  CompiledSqlResult,
  ExploreDefinition,
  FilterRule,
  Metric,
  MetricQuery,
  MetricQuerySchema,
  WarehouseDialect,
  assertSafeIdentifier,
  assertSafeLiteralString,
  quoteIdentifier,
} from "../../common/src/index.js";

function placeholder(index: number, dialect: WarehouseDialect): string {
  if (dialect === "postgres") return `$${index}`;
  return "?";
}

function compileAggregation(metric: Metric, dialect: WarehouseDialect): string {
  const col = `${quoteIdentifier(metric.table, dialect)}.${quoteIdentifier(metric.sqlColumn, dialect)}`;
  switch (metric.type) {
    case "count":
      return `COUNT(${col})`;
    case "count_distinct":
      return `COUNT(DISTINCT ${col})`;
    case "sum":
      return `SUM(${col})`;
    case "average":
      return `AVG(${col})`;
    case "number":
      return `MAX(${col})`;
  }
}

function compileFilter(
  rule: FilterRule,
  explore: ExploreDefinition,
  dialect: WarehouseDialect,
  params: Array<string | number | boolean>
): string {
  const dim = explore.dimensions[rule.fieldId];
  if (!dim) {
    throw new Error(`Unknown filter fieldId: ${rule.fieldId}`);
  }
  const col = `${quoteIdentifier(dim.table, dialect)}.${quoteIdentifier(dim.sqlColumn, dialect)}`;
  const values = rule.values;
  for (const v of values) {
    if (typeof v === "string") {
      assertSafeLiteralString(v);
    }
  }

  if (rule.operator === "in") {
    const marks: string[] = [];
    for (const v of values) {
      params.push(v);
      marks.push(placeholder(params.length, dialect));
    }
    return `${col} IN (${marks.join(", ")})`;
  }

  const first = values[0];
  if (first === undefined) {
    throw new Error(`Filter on ${rule.fieldId} requires at least one value`);
  }
  params.push(first);
  const p = placeholder(params.length, dialect);

  switch (rule.operator) {
    case "equals":
      return `${col} = ${p}`;
    case "not_equals":
      return `${col} <> ${p}`;
    case "greater_than":
      return `${col} > ${p}`;
    case "less_than":
      return `${col} < ${p}`;
  }
}

export function compileMetricQuerySql(
  explore: ExploreDefinition,
  rawQuery: MetricQuery,
  dialect: WarehouseDialect = "postgres"
): CompiledSqlResult {
  const query = MetricQuerySchema.parse(rawQuery);
  if (query.exploreName !== explore.name) {
    throw new Error(`Query explore '${query.exploreName}' does not match '${explore.name}'`);
  }

  const selectClauses: string[] = [];
  const groupByIndices: number[] = [];
  const selectedFieldIds: string[] = [];
  const referencedTables = new Set<string>([explore.baseTable]);

  for (const dimId of query.dimensions) {
    const dim = explore.dimensions[dimId];
    if (!dim) {
      throw new Error(`Unknown dimension: ${dimId}`);
    }
    referencedTables.add(dim.table);
    const alias = assertSafeIdentifier(dimId.replace(".", "_"), "alias");
    const col = `${quoteIdentifier(dim.table, dialect)}.${quoteIdentifier(dim.sqlColumn, dialect)}`;
    selectClauses.push(`${col} AS ${quoteIdentifier(alias, dialect)}`);
    groupByIndices.push(selectClauses.length);
    selectedFieldIds.push(dimId);
  }

  for (const metId of query.metrics) {
    const met = explore.metrics[metId];
    if (!met) {
      throw new Error(`Unknown metric: ${metId}`);
    }
    referencedTables.add(met.table);
    const alias = assertSafeIdentifier(metId.replace(".", "_"), "alias");
    selectClauses.push(`${compileAggregation(met, dialect)} AS ${quoteIdentifier(alias, dialect)}`);
    selectedFieldIds.push(metId);
  }

  const params: Array<string | number | boolean> = [];
  const whereClauses: string[] = [];
  for (const rule of query.filters) {
    const dim = explore.dimensions[rule.fieldId];
    if (dim) referencedTables.add(dim.table);
    whereClauses.push(compileFilter(rule, explore, dialect, params));
  }

  const fromRef = `${quoteIdentifier(explore.schemaName, dialect)}.${quoteIdentifier(explore.baseTable, dialect)} AS ${quoteIdentifier(explore.baseTable, dialect)}`;
  const joinClauses: string[] = [];
  for (const j of explore.joinedTables) {
    if (!referencedTables.has(j.table)) continue;
    const kw = j.type === "inner" ? "INNER JOIN" : "LEFT JOIN";
    const joinedTarget = `${quoteIdentifier(explore.schemaName, dialect)}.${quoteIdentifier(j.table, dialect)} AS ${quoteIdentifier(j.table, dialect)}`;
    const onExpr = `${quoteIdentifier(explore.baseTable, dialect)}.${quoteIdentifier(j.leftKey, dialect)} = ${quoteIdentifier(j.table, dialect)}.${quoteIdentifier(j.rightKey, dialect)}`;
    joinClauses.push(`${kw} ${joinedTarget} ON ${onExpr}`);
  }

  const orderClauses: string[] = [];
  for (const sort of query.sorts) {
    if (!selectedFieldIds.includes(sort.fieldId)) {
      throw new Error(`Cannot sort by unselected field: ${sort.fieldId}`);
    }
    const alias = assertSafeIdentifier(sort.fieldId.replace(".", "_"), "sort_alias");
    orderClauses.push(`${quoteIdentifier(alias, dialect)} ${sort.descending ? "DESC" : "ASC"}`);
  }

  const lines = [
    `SELECT ${selectClauses.join(", ")}`,
    `FROM ${fromRef}`,
    ...joinClauses,
  ];
  if (whereClauses.length > 0) {
    lines.push(`WHERE ${whereClauses.join(" AND ")}`);
  }
  if (groupByIndices.length > 0) {
    lines.push(`GROUP BY ${groupByIndices.join(", ")}`);
  }
  if (orderClauses.length > 0) {
    lines.push(`ORDER BY ${orderClauses.join(", ")}`);
  }
  lines.push(`LIMIT ${query.limit}`);

  return {
    sql: lines.join("\n"),
    params,
    selectedFieldIds,
    dialect,
  };
}
