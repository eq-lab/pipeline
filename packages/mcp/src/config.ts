// Startup config from env (docs/design-docs/mcp-test-env.md, "Transport and
// auth"): MCP_PORT and MCP_TOKENS, a JSON array of {id, secret} per client;
// the `logs` source ("Logs"): GRAFANA_URL, GRAFANA_TOKEN (a Viewer
// service-account token) and LOKI_DATASOURCE_UID; MCP_CHAINS, a JSON object
// chain id → {kind, rpcUrl, registryLogContracts?}. MCP_SERVICES is read by
// `ServiceMap.config` (services.ts).
import { Config, Schema } from "effect";

const Url = Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/));

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

const Chains = Schema.fromJsonString(
  Schema.Record(
    Schema.String.check(Schema.isPattern(/^[1-9]\d{0,15}$/)),
    Schema.Struct({
      kind: Schema.Literals(["evm", "stellar"]),
      rpcUrl: Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/)),
      registryLogContracts: Schema.optionalKey(
        Schema.Array(Schema.NonEmptyString),
      ),
    }),
  ),
);

export const mcpConfig = Config.all({
  port: Config.Port("MCP_PORT"),
  tokens: Config.schema(Tokens, "MCP_TOKENS"),
  // The test API's base URL, probed by `health`.
  apiUrl: Config.schema(Url, "MCP_API_URL"),
  grafana: Config.all({
    url: Config.schema(Url, "GRAFANA_URL"),
    token: Config.schema(
      Schema.Redacted(Schema.NonEmptyString),
      "GRAFANA_TOKEN",
    ),
    datasourceUid: Config.NonEmptyString("LOKI_DATASOURCE_UID"),
  }),
  // The read-only role's connection string; `statement_timeout` of every call.
  db: Config.all({
    url: Config.schema(
      Schema.Redacted(Schema.NonEmptyString),
      "MCP_DATABASE_URL",
    ),
    statementTimeoutMs: Config.schema(
      Schema.Int.check(Schema.isBetween({ minimum: 5_000, maximum: 10_000 })),
      "MCP_STATEMENT_TIMEOUT_MS",
    ).pipe(Config.withDefault(10_000)),
  }),
  chains: Config.schema(Chains, "MCP_CHAINS").pipe(
    Config.map(
      (chains) =>
        new Map(Object.entries(chains).map(([id, c]) => [Number(id), c])),
    ),
  ),
});
