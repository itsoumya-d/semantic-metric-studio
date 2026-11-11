import test from "node:test";
import assert from "node:assert/strict";
import { parseDbtYamlToExplores } from "../packages/backend/src/dbtParser.js";
import { SemanticExploreController } from "../packages/backend/src/exploreController.js";
import { compileMetricQuerySql } from "../packages/warehouses/src/sqlCompiler.js";
import { buildChartSeriesModel } from "../packages/frontend/src/chartModel.js";

const SAMPLE_DBT_YAML = `
version: 2
models:
  - name: orders
    meta:
      schema: analytics_prod
      joins:
        - join: customers
          left_key: customer_id
          right_key: id
          type: left
    columns:
      - name: created_date
        meta:
          dimension:
            type: date
            label: Order Date
      - name: status
        meta:
          dimension:
            type: string
            label: Order Status
      - name: amount_cents
        meta:
          metrics:
            total_revenue_cents:
              type: sum
              label: Total Revenue (Cents)
            order_count:
              type: count
              label: Order Count
`;

test("parses dbt semantic YAML into ExploreDefinition and compiles multi-dialect parameterized SQL", () => {
  const [explore] = parseDbtYamlToExplores(SAMPLE_DBT_YAML);
  assert.ok(explore);
  assert.equal(explore.name, "orders");
  assert.ok(explore.dimensions["orders.status"]);
  assert.ok(explore.metrics["orders.total_revenue_cents"]);

  const pgResult = compileMetricQuerySql(
    explore,
    {
      exploreName: "orders",
      dimensions: ["orders.created_date"],
      metrics: ["orders.total_revenue_cents", "orders.order_count"],
      filters: [{ fieldId: "orders.status", operator: "equals", values: ["completed"] }],
      sorts: [{ fieldId: "orders.total_revenue_cents", descending: true }],
      limit: 100,
    },
    "postgres"
  );
  assert.match(pgResult.sql, /"analytics_prod"\."orders" AS "orders"/);
  assert.match(pgResult.sql, /SUM\("orders"\."amount_cents"\) AS "orders_total_revenue_cents"/);
  assert.match(pgResult.sql, /WHERE "orders"\."status" = \$1/);
  assert.deepEqual(pgResult.params, ["completed"]);

  const bqResult = compileMetricQuerySql(
    explore,
    {
      exploreName: "orders",
      dimensions: ["orders.created_date"],
      metrics: ["orders.order_count"],
      filters: [{ fieldId: "orders.status", operator: "in", values: ["completed", "shipped"] }],
      sorts: [],
      limit: 50,
    },
    "bigquery"
  );
  assert.match(bqResult.sql, /`analytics_prod`\.`orders` AS `orders`/);
  assert.match(bqResult.sql, /WHERE `orders`\.`status` IN \(\?, \?\)/);
  assert.deepEqual(bqResult.params, ["completed", "shipped"]);
});

test("rejects SQL injection fragments and enforces tenant + RBAC rules in controller", () => {
  const [explore] = parseDbtYamlToExplores(SAMPLE_DBT_YAML);
  assert.ok(explore);

  const ctrl = new SemanticExploreController("org_lightdash");
  ctrl.registerExplore("proj_1", explore);

  // SQL injection attempt in filter literal
  const sqliRes = ctrl.compileQueryEndpoint({
    actor: { userId: "u1", orgId: "org_lightdash", roleByProject: { proj_1: "editor" } },
    orgId: "org_lightdash",
    projectId: "proj_1",
    body: {
      query: {
        exploreName: "orders",
        dimensions: ["orders.status"],
        metrics: ["orders.order_count"],
        filters: [{ fieldId: "orders.status", operator: "equals", values: ["paid'; DROP TABLE orders; --"] }],
        sorts: [],
        limit: 10,
      },
    },
  });
  assert.equal(sqliRes.status, 400);

  // Insufficient project role
  const rbacRes = ctrl.compileQueryEndpoint({
    actor: { userId: "u2", orgId: "org_lightdash", roleByProject: { proj_1: "viewer" } },
    orgId: "org_lightdash",
    projectId: "proj_1",
    body: {
      query: {
        exploreName: "orders",
        dimensions: [],
        metrics: ["orders.order_count"],
        filters: [],
        sorts: [],
        limit: 10,
      },
    },
  });
  assert.equal(rbacRes.status, 403);
});

test("builds headless chart model across cartesian, table, and big_number layouts", () => {
  const [explore] = parseDbtYamlToExplores(SAMPLE_DBT_YAML);
  assert.ok(explore);

  const bigNum = buildChartSeriesModel(explore, [], ["orders.order_count"], [{ orders_order_count: 42 }]);
  assert.equal(bigNum.kind, "big_number");

  const line = buildChartSeriesModel(explore, ["orders.created_date"], ["orders.total_revenue_cents"], [
    { orders_created_date: "2026-11-01", orders_total_revenue_cents: 12000 },
  ]);
  assert.equal(line.kind, "cartesian");
  assert.equal(line.xField, "orders_created_date");
});
