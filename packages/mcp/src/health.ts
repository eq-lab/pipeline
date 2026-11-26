// The `health` tool (specs/mcp/health.md): one probe per source, all at once,
// each bounded by 2 s; a failing probe is reported in its own field.
import { Clock, Context, Effect, Schema } from "effect";
import { Cluster } from "./cluster.js";
import { Db } from "./db.js";
import { ToolError } from "./errors.js";

// The HTTP sources: `api` and `grafana` answer when their URL answers.
export class Probes extends Context.Service<
  Probes,
  {
    readonly api: Effect.Effect<void, ToolError>;
    readonly grafana: Effect.Effect<void, ToolError>;
  }
>()("@pipeline/mcp/Probes") {}

const Status = Schema.Union([
  Schema.Literal("ok"),
  Schema.Struct({
    error: Schema.String,
    detail: Schema.optionalKey(Schema.String),
  }),
]);

export const HealthResult = Schema.Struct({
  api: Status,
  worker: Status,
  db: Status,
  grafana: Status,
  k8s: Status,
});

// shortcut: a fixed 10 min threshold, not configurable; make it config when
// the worker's poll interval is known to differ.
const staleAfterMs = 10 * 60 * 1000;

const probe = (source: Effect.Effect<unknown, ToolError>) =>
  source.pipe(
    Effect.timeout("2 seconds"),
    Effect.match({
      onSuccess: (): typeof Status.Type => "ok",
      onFailure: (error): typeof Status.Type =>
        error._tag === "TimeoutError"
          ? { error: "timeout" }
          : {
              error: error.reason === "stale" ? "stale" : "unreachable",
              detail: error.message === "" ? error.reason : error.message,
            },
    }),
  );

export const health = Effect.gen(function* () {
  const probes = yield* Probes;
  const db = yield* Db;
  const cluster = yield* Cluster;
  const now = yield* Clock.currentTimeMillis;
  const worker = db.cursors.pipe(
    Effect.filterOrFail(
      (cursors) =>
        cursors.every((c) => now - Date.parse(c.updatedAt) <= staleAfterMs),
      () =>
        new ToolError({
          reason: "stale",
          message: "an indexer cursor stopped moving",
        }),
    ),
  );
  return yield* Effect.all(
    {
      api: probe(probes.api),
      worker: probe(worker),
      db: probe(db.cursors),
      grafana: probe(probes.grafana),
      k8s: probe(cluster.events),
    },
    { concurrency: "unbounded" },
  );
});
