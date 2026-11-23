// HTTP adapter of the `Probes` port: a source answers when its URL gets any
// HTTP response; the 2 s bound is the caller's (health.ts).
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
          Effect.asVoid,
          Effect.mapError(
            (error) =>
              new ToolError({ reason: "unreachable", message: error.message }),
          ),
        );
      return Probes.of({
        api: ping(config.apiUrl),
        grafana: ping(`${config.grafanaUrl.replace(/\/+$/, "")}/api/health`),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
