// A tool's rejection (specs/README.md, "Queries"): `reason` is what callers
// see, e.g. `unknown_service` or `cluster_unavailable`.
import { Schema } from "effect";

export class ToolError extends Schema.TaggedError<ToolError>()("ToolError", {
  reason: Schema.String,
}) {}
