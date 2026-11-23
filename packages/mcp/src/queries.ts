// Tool queries by tag (specs/README.md, "Queries"): each handler takes the raw
// fields of the query, decoded like a tool call's arguments.
import { Effect, Schema } from "effect";
import { configView } from "./configview.js";
import { queues, schema } from "./db.js";
import { deployment, DeploymentInput } from "./deployment.js";
import { errorsQuery } from "./error-groups.js";
import { ToolError } from "./errors.js";
import { indexerLag } from "./indexer-lag.js";
import { logsQuery } from "./logs.js";

export const queries = {
  Config: () => configView,
  Deployment: (input: unknown) =>
    Schema.decodeUnknownEffect(DeploymentInput)(input).pipe(
      Effect.mapError(() => new ToolError({ reason: "invalid_query" })),
      Effect.flatMap(deployment),
    ),
  Errors: errorsQuery,
  IndexerLag: () => indexerLag,
  Logs: logsQuery,
  Queues: () => queues,
  Schema: () => schema,
};
