# semantic-metric-studio

Open-source TypeScript semantic layer prototype demonstrating dbt YAML metric parsing, dialect-safe parameterized SQL compilation (Postgres / BigQuery / Snowflake), RBAC-enforced Express-compatible explore controller, and headless chart series modeling.

## Architecture

- `packages/common`: Strict Zod schemas for explores, dimensions, metrics, filter ASTs, and SQL identifier safety guards.
- `packages/warehouses`: Dialect-aware compiler generating quoted identifiers and bound positional parameters (`$1` vs `?`) without raw string interpolation.
- `packages/backend`: `dbt` YAML v2 parser (`meta.dimension` / `meta.metrics` / joins) + multi-tenant `SemanticExploreController`.
- `packages/frontend`: Headless visualization state builder (`cartesian`, `table`, `big_number`).

## Verification

```bash
npm install
npm run build
npm test
```
