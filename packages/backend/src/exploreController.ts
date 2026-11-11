import {
  CompiledSqlResult,
  ExploreDefinition,
  MetricQuery,
  MetricQuerySchema,
  WarehouseDialect,
  WarehouseDialectSchema,
} from "../../common/src/index.js";
import { compileMetricQuerySql } from "../../warehouses/src/sqlCompiler.js";

export type ProjectRole = "viewer" | "interactive_viewer" | "editor" | "admin";

export interface SessionActor {
  userId: string;
  orgId: string;
  roleByProject: Record<string, ProjectRole>;
}

export interface ApiRequest<T> {
  actor: SessionActor;
  orgId: string;
  projectId: string;
  body: T;
}

export interface ApiResponse<T> {
  status: 200 | 400 | 403 | 404;
  payload: T | { error: string };
}

const ROLE_WEIGHT: Record<ProjectRole, number> = {
  viewer: 1,
  interactive_viewer: 2,
  editor: 3,
  admin: 4,
};

export class SemanticExploreController {
  private readonly explores = new Map<string, ExploreDefinition>();

  constructor(private readonly expectedOrgId: string) {}

  registerExplore(projectId: string, explore: ExploreDefinition): void {
    this.explores.set(`${projectId}:${explore.name}`, explore);
  }

  compileQueryEndpoint(
    req: ApiRequest<{ query: MetricQuery; dialect?: WarehouseDialect }>
  ): ApiResponse<CompiledSqlResult> {
    if (req.actor.orgId !== this.expectedOrgId || req.orgId !== this.expectedOrgId) {
      return { status: 403, payload: { error: "Cross-organization access denied" } };
    }
    const role = req.actor.roleByProject[req.projectId];
    if (!role || ROLE_WEIGHT[role] < ROLE_WEIGHT.interactive_viewer) {
      return { status: 403, payload: { error: "Project role insufficient to run ad-hoc explore queries" } };
    }

    const queryParsed = MetricQuerySchema.safeParse(req.body.query);
    if (!queryParsed.success) {
      return { status: 400, payload: { error: queryParsed.error.issues[0]?.message ?? "Invalid metric query" } };
    }
    const dialectParsed = WarehouseDialectSchema.safeParse(req.body.dialect ?? "postgres");
    if (!dialectParsed.success) {
      return { status: 400, payload: { error: "Unsupported warehouse dialect" } };
    }

    const explore = this.explores.get(`${req.projectId}:${queryParsed.data.exploreName}`);
    if (!explore) {
      return { status: 404, payload: { error: "Explore not found in project" } };
    }

    try {
      const compiled = compileMetricQuerySql(explore, queryParsed.data, dialectParsed.data);
      return { status: 200, payload: compiled };
    } catch (err) {
      return {
        status: 400,
        payload: { error: err instanceof Error ? err.message : "Compilation failed" },
      };
    }
  }
}
