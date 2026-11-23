// `deployment` (specs/mcp/deployment.md): image, pods and the last hour's
// events (newest first, at most 50) of each configured service.
import { Clock, Effect, Option, Schema } from "effect";
import { Cluster, type KubeEvent, type Workload } from "./cluster.js";
import { ToolError } from "./errors.js";
import { ServiceMap } from "./services.js";

const eventWindowMs = 3_600_000;
const maxEvents = 50;

export const DeploymentInput = Schema.Struct({
  service: Schema.optionalKey(Schema.String),
});

export const DeploymentState = Schema.Struct({
  services: Schema.Array(
    Schema.Struct({
      service: Schema.String,
      image: Schema.String,
      pods: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          phase: Schema.String,
          ready: Schema.Boolean,
          restarts: Schema.Int,
          ageSeconds: Schema.Int,
        }),
      ),
      events: Schema.Array(
        Schema.Struct({
          object: Schema.String,
          reason: Schema.String,
          message: Schema.String,
          ts: Schema.String,
        }),
      ),
    }),
  ),
});

const byName = <A extends { readonly name: string }>(a: A, b: A) =>
  a.name < b.name ? -1 : 1;

const shape = (
  now: number,
  events: ReadonlyArray<KubeEvent>,
  [service, name]: readonly [string, string],
  { image, pods }: Workload,
) => {
  const objects = new Set([name, ...pods.map((pod) => pod.name)]);
  return {
    service,
    image,
    pods: pods
      .map(({ startedAt, ...pod }) => ({
        ...pod,
        ageSeconds: Math.floor((now - Date.parse(startedAt)) / 1000),
      }))
      .sort(byName),
    events: events
      .filter(
        (event) =>
          objects.has(event.object) &&
          now - Date.parse(event.ts) <= eventWindowMs,
      )
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
      .slice(0, maxEvents),
  };
};

export const deployment = Effect.fn("deployment")(function* ({
  service,
}: typeof DeploymentInput.Type) {
  const services = yield* ServiceMap;
  const cluster = yield* Cluster;
  if (service !== undefined && !services.has(service))
    return yield* new ToolError({ reason: "unknown_service" });
  const selected = [...services]
    .filter(([name]) => service === undefined || name === service)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const now = yield* Clock.currentTimeMillis;
  const events = yield* cluster.events;
  const found = yield* Effect.forEach(
    selected,
    (entry) =>
      cluster
        .deployment(entry[1])
        .pipe(
          Effect.map(
            Option.map((workload) => shape(now, events, entry, workload)),
          ),
        ),
    { concurrency: "unbounded" },
  );
  return { services: found.flatMap(Option.toArray) };
});
