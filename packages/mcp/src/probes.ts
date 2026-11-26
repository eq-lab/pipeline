// HTTP adapter of the `Probes` port: a source answers when its URL gets an
// HTTP response below 500 (a 4xx still proves the server is up); a 5xx, such
// as Grafana's 503 from `/api/health` or a proxy's 502 for a dead backend, is
// not an answer. The 2 s bound is the caller's (health.ts).
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { ToolError } from "./errors.js";
import { Probes } from "./health.js";

export interface ProbesConfig {
  readonly apiUrl: string;
  readonly grafanaUrl: string;
}

export const httpProbes = (config: ProbesConfig) =>
  Layer.effect(
    Probes,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const ping = (url: string) =>
        client.get(url).pipe(
          Effect.mapError(
            (error) =>
              new ToolError({ reason: "unreachable", message: error.message }),
          ),
          Effect.flatMap((response) =>
            response.status >= 500
              ? Effect.fail(
                  new ToolError({
                    reason: "unreachable",
                    message: `HTTP ${String(response.status)}`,
                  }),
                )
              : Effect.void,
          ),
        );
      return Probes.of({
        api: ping(config.apiUrl),
        grafana: ping(`${config.grafanaUrl.replace(/\/+$/, "")}/api/health`),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
