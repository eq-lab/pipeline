// Tool queries by tag (specs/README.md, "Queries"): each handler takes the raw
// fields of the query, decoded like a tool call's arguments.
import { Effect, Schema } from "effect";
import { deployment, DeploymentInput } from "./deployment.js";
import { ToolError } from "./errors.js";
import { logsQuery } from "./logs.js";

export const queries = {
  Deployment: (input: unknown) =>
    Schema.decodeUnknownEffect(DeploymentInput)(input).pipe(
      Effect.mapError(() => new ToolError({ reason: "invalid_query" })),
      Effect.flatMap(deployment),
    ),
  Logs: logsQuery,
};
