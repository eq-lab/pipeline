// The configured `service → workload` map of `logs` and `deployment`
// (docs/design-docs/mcp-test-env.md, "Logs"): MCP_SERVICES, a JSON object.
import { Config, Context, Effect, Layer, Schema } from "effect";

export class ServiceMap extends Context.Service<
  ServiceMap,
  ReadonlyMap<string, string>
>()("@pipeline/mcp/ServiceMap") {
  static readonly config = Layer.effect(
    ServiceMap,
    Effect.gen(function* () {
      const map = yield* Config.schema(
        Schema.fromJsonString(
          Schema.Record(Schema.String, Schema.NonEmptyString),
        ),
        "MCP_SERVICES",
      );
      return new Map(Object.entries(map));
    }),
  );
}
