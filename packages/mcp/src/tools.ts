// Tool registry of the MCP server (docs/design-docs/mcp-test-env.md, "Tools"):
// every tool is read only and needs the source ports (`Cluster`, `ServiceMap`).
import { Effect, Layer } from "effect";
import { McpServer, Tool, Toolkit } from "effect/ai";
import type { Cluster } from "./cluster.js";
import { deployment, DeploymentInput, DeploymentState } from "./deployment.js";
import { ToolError } from "./errors.js";
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
);

const handlers = toolkit.toLayer(
  Effect.gen(function* () {
    const sources = yield* Effect.context<Cluster | ServiceMap>();
    return toolkit.of({
      deployment: (input) => deployment(input).pipe(Effect.provide(sources)),
    });
  }),
);

export const tools = McpServer.toolkit(toolkit).pipe(Layer.provide(handlers));
