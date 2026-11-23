// Grafana/Loki adapter of the `Logs` port (docs/design-docs/mcp-test-env.md,
// "Logs"): query_range through the datasource proxy with a Viewer token. The
// selector is fixed server-side; `contains` is an escaped literal line filter.
import { Effect, Layer, Schema, type Redacted } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { Logs, type LogQuery } from "./logs.js";
import { ToolError } from "./errors.js";

export interface GrafanaConfig {
  readonly url: string;
  readonly token: Redacted.Redacted;
  readonly datasourceUid: string;
}

const Nanos = Schema.String.check(Schema.isPattern(/^\d+$/));

const QueryRange = Schema.Struct({
  data: Schema.Struct({
    result: Schema.Array(
      Schema.Struct({
        values: Schema.Array(Schema.Tuple([Nanos, Schema.String])),
      }),
    ),
  }),
});

// JSON string escaping is valid LogQL (Go) string escaping.
const logql = (query: LogQuery) =>
  `{container=${JSON.stringify(query.container)}}` +
  (query.contains === undefined
    ? ""
    : ` |= ${JSON.stringify(query.contains)}`) +
  (query.level === undefined
    ? ""
    : ` | detected_level=${JSON.stringify(query.level)}`);

const iso = (nanos: string) =>
  new Date(Number(BigInt(nanos) / 1_000_000n)).toISOString();

export const grafanaLogs = (config: GrafanaConfig) =>
  Layer.effect(
    Logs,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.bearerToken(config.token)),
        HttpClient.filterStatusOk,
      );
      const url = `${config.url.replace(/\/+$/, "")}/api/datasources/proxy/uid/${encodeURIComponent(config.datasourceUid)}/loki/api/v1/query_range`;
      return Logs.of({
        lines: (query) =>
          client
            .get(url, {
              urlParams: {
                query: logql(query),
                since: `${String(query.sinceSeconds)}s`,
                limit: String(query.limit),
                direction: "backward",
              },
            })
            .pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(QueryRange)),
              Effect.timeout("10 seconds"),
              Effect.map((body) =>
                body.data.result
                  .flatMap((stream) => stream.values)
                  .sort(([a], [b]) => (BigInt(b) > BigInt(a) ? 1 : -1))
                  .slice(0, query.limit)
                  .map(([nanos, line]) => ({ ts: iso(nanos), line })),
              ),
              Effect.mapError(
                (error) =>
                  new ToolError({
                    reason: "logs_unavailable",
                    message: `logs unavailable: ${error.message}`,
                  }),
              ),
            ),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
