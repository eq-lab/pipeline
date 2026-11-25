// Tool registry of the MCP server (docs/design-docs/mcp-test-env.md, "Tools"):
// every tool is read only and needs the source ports (`ChainRpc`, `Cluster`,
// `Db`, `Logs`, `Probes`, `RegistryLogContracts`, `ServiceMap`).
import { Effect, Layer } from "effect";
import { McpServer, Tool, Toolkit } from "effect/ai";
import { ToolReason } from "./audit.js";
import type { Cluster } from "./cluster.js";
import { configView, ConfigState } from "./configview.js";
import {
  Db,
  queues,
  QueuesResult,
  QueryParams,
  QueryResult,
  readQuery,
  schema,
  SchemaResult,
} from "./db.js";
import { deployment, DeploymentInput, DeploymentState } from "./deployment.js";
import { ErrorsParams, ErrorsResult, readErrors } from "./error-groups.js";
import { ToolError } from "./errors.js";
import { health, HealthResult, type Probes } from "./health.js";
import {
  type ChainRpc,
  indexerLag,
  IndexerLagResult,
  type RegistryLogContracts,
} from "./indexer-lag.js";
import { type Logs, LogsParams, LogsResult, readLogs } from "./logs.js";
import type { ServiceMap } from "./services.js";

const toolkit = Toolkit.make(
  Tool.make("deployment", {
    description:
      "Image, pods (phase, readiness, restarts, age) and Kubernetes events of the last hour per service of the test namespace",
    parameters: DeploymentInput,
    success: DeploymentState,
    failure: ToolError,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("config", {
    description:
      "Environment of each service's Deployment: literal and ConfigMap values shown, Secret-backed and secret-like values masked as *** with their Secret reference, envFrom sources listed by name",
    success: ConfigState,
    failure: ToolError,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("errors", {
    description:
      "Error-level log lines of a configured service grouped by normalised message (numbers and hex stripped), most frequent first, at most 50 groups.",
    parameters: ErrorsParams,
    success: ErrorsResult,
    failure: ToolError,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("health", {
    description:
      "Whether api, worker, db, grafana and k8s answer: each `ok` or {error, detail}; one probe per source, 2 s each. The worker is stale when an indexer cursor stopped moving.",
    success: HealthResult,
    failure: ToolError,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("indexer_lag", {
    description:
      "Per chain, the worker's last indexed block (ledger on Stellar) against the RPC head with lag and cursor age; per projection, its log cursor against the latest relevant log id.",
    success: IndexerLagResult,
    failure: ToolError,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("logs", {
    description:
      "Recent log lines of a configured service from Loki, oldest first; truncated says a limit was hit.",
    parameters: LogsParams,
    success: LogsResult,
    failure: ToolError,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("queues", {
    description:
      "Worker outboxes: kyc_outbox (unprocessed count, oldest age, 20 recent errors) and yield_mint_outbox (count per status, 20 recent errors); errors cut to 500 characters.",
    success: QueuesResult,
    failure: ToolError,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("query", {
    description:
      "Run one read-only SQL statement on the test database (read-only transaction, statement timeout); returns columns, rows (at most 500) and truncated; a result over 1 MiB fails as result_too_large.",
    parameters: QueryParams,
    success: QueryResult,
    failure: ToolError,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("schema", {
    description:
      "Tables of the public schema of the test database with their columns: name, type, nullable.",
    success: SchemaResult,
    failure: ToolError,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
);

const handlers = toolkit.toLayer(
  Effect.gen(function* () {
    const sources = yield* Effect.context<
      | ChainRpc
      | Cluster
      | Db
      | Logs
      | Probes
      | RegistryLogContracts
      | ServiceMap
    >();
    // Hands the rejection reason to the audit record of the request.
    const run = <A, R>(effect: Effect.Effect<A, ToolError, R>) =>
      effect.pipe(
        Effect.provide(sources),
        Effect.tapError((error) =>
          Effect.map(Effect.service(ToolReason), (holder) => {
            holder.reason = error.reason;
          }),
        ),
      );
    return toolkit.of({
      deployment: (input) => run(deployment(input)),
      config: () => run(configView),
      errors: (input) => run(readErrors(input)),
      health: () => run(health),
      indexer_lag: () => run(indexerLag),
      logs: (input) => run(readLogs(input)),
      queues: () => run(queues),
      query: (input) => run(readQuery(input)),
      schema: () => run(schema),
    });
  }),
);

export const tools = McpServer.toolkit(toolkit).pipe(Layer.provide(handlers));
