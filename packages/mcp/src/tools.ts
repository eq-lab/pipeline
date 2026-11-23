// Tool registry of the MCP server (docs/design-docs/mcp-test-env.md, "Tools"):
// every tool is read only and needs the source ports (`Cluster`, `Logs`,
// `ServiceMap`).
import { Effect, Layer } from "effect";
import { McpServer, Tool, Toolkit } from "effect/ai";
import type { Cluster } from "./cluster.js";
import { Db, schema, SchemaResult } from "./db.js";
import { deployment, DeploymentInput, DeploymentState } from "./deployment.js";
import { ErrorsParams, ErrorsResult, readErrors } from "./error-groups.js";
import { ToolError } from "./errors.js";
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
  Tool.make("errors", {
    description:
      "Error-level log lines of a configured service grouped by normalised message (numbers and hex stripped), most frequent first, at most 50 groups.",
    parameters: ErrorsParams,
    success: ErrorsResult,
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
    const sources = yield* Effect.context<Cluster | Db | Logs | ServiceMap>();
    return toolkit.of({
      deployment: (input) => deployment(input).pipe(Effect.provide(sources)),
      errors: (input) => readErrors(input).pipe(Effect.provide(sources)),
      logs: (input) => readLogs(input).pipe(Effect.provide(sources)),
      schema: () => schema.pipe(Effect.provide(sources)),
    });
  }),
);

export const tools = McpServer.toolkit(toolkit).pipe(Layer.provide(handlers));
