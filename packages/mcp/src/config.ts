// Startup config from env (docs/design-docs/mcp-test-env.md, "Transport and
// auth"): MCP_PORT and MCP_TOKENS, a JSON array of {id, secret} per client;
// the `logs` source ("Logs"): GRAFANA_URL, GRAFANA_TOKEN (a Viewer
// service-account token) and LOKI_DATASOURCE_UID. MCP_SERVICES is read by
// `ServiceMap.config` (services.ts).
import { Config, Schema } from "effect";

const Token = Schema.Struct({
  id: Schema.NonEmptyString,
  secret: Schema.String.check(Schema.isMinLength(32)),
});

const Tokens = Schema.fromJsonString(
  Schema.Array(Token).check(
    Schema.isMinLength(1),
    Schema.makeFilter(
      (tokens) =>
        new Set(tokens.map((t) => t.id)).size === tokens.length &&
        new Set(tokens.map((t) => t.secret)).size === tokens.length,
      { expected: "unique ids and secrets" },
    ),
  ),
);

export const mcpConfig = Config.all({
  port: Config.Port("MCP_PORT"),
  tokens: Config.schema(Tokens, "MCP_TOKENS"),
  grafana: Config.all({
    url: Config.schema(
      Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/)),
      "GRAFANA_URL",
    ),
    token: Config.schema(
      Schema.Redacted(Schema.NonEmptyString),
      "GRAFANA_TOKEN",
    ),
    datasourceUid: Config.NonEmptyString("LOKI_DATASOURCE_UID"),
  }),
});
