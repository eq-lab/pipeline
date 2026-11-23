// Kubernetes adapter of `Cluster` (docs/design-docs/mcp-test-env.md, checklist
// item 3): in-cluster ServiceAccount, GET (get/list) of deployments, pods, events.
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { Config, Effect, Layer, Option, Schema } from "effect";
import { Cluster } from "./cluster.js";
import { ToolError } from "./errors.js";

const account = "/var/run/secrets/kubernetes.io/serviceaccount";

const Deployment = Schema.Struct({
  spec: Schema.Struct({
    // shortcut: only `matchLabels` selectors; add `matchExpressions` if a chart uses them.
    selector: Schema.Struct({
      matchLabels: Schema.Record(Schema.String, Schema.String),
    }),
    template: Schema.Struct({
      spec: Schema.Struct({
        // shortcut: the first container's image; list every container if a service gets sidecars.
        containers: Schema.NonEmptyArray(
          Schema.Struct({ image: Schema.String }),
        ),
      }),
    }),
  }),
});

const PodList = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      metadata: Schema.Struct({
        name: Schema.String,
        creationTimestamp: Schema.String,
      }),
      status: Schema.Struct({
        phase: Schema.String,
        startTime: Schema.optionalKey(Schema.String),
        conditions: Schema.optionalKey(
          Schema.Array(
            Schema.Struct({ type: Schema.String, status: Schema.String }),
          ),
        ),
        containerStatuses: Schema.optionalKey(
          Schema.Array(Schema.Struct({ restartCount: Schema.Number })),
        ),
      }),
    }),
  ),
});

const Timestamp = Schema.optionalKey(Schema.NullOr(Schema.String));

const EventList = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      metadata: Schema.Struct({ creationTimestamp: Schema.String }),
      involvedObject: Schema.Struct({
        name: Schema.optionalKey(Schema.String),
      }),
      reason: Schema.optionalKey(Schema.String),
      message: Schema.optionalKey(Schema.String),
      lastTimestamp: Timestamp,
      eventTime: Timestamp,
    }),
  ),
});

interface Reply {
  readonly status: number;
  readonly body: string;
}

const send = (host: string, port: string, path: string, signal: AbortSignal) =>
  new Promise<Reply>((resolve, reject) => {
    const req = request(
      {
        host,
        port,
        path,
        method: "GET",
        signal,
        timeout: 5_000,
        ca: readFileSync(`${account}/ca.crt`),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${readFileSync(`${account}/token`, "utf8").trim()}`,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });

export const k8s = Layer.effect(
  Cluster,
  Effect.gen(function* () {
    const host = yield* Config.NonEmptyString("KUBERNETES_SERVICE_HOST");
    const port = yield* Config.NonEmptyString("KUBERNETES_SERVICE_PORT");
    const namespace = encodeURIComponent(
      yield* Config.NonEmptyString("MCP_K8S_NAMESPACE"),
    );
    const get = <A>(path: string, schema: Schema.Decoder<A>) =>
      Effect.tryPromise((signal) => send(host, port, path, signal)).pipe(
        Effect.flatMap(({ status, body }) =>
          status === 404
            ? Effect.succeedNone
            : status === 200
              ? Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(
                  body,
                ).pipe(Effect.map(Option.some))
              : Effect.fail(new Error(`GET ${path}: HTTP ${String(status)}`)),
        ),
        Effect.tapError((cause) => Effect.logWarning("k8s", cause)),
        Effect.mapError(() => new ToolError({ reason: "cluster_unavailable" })),
      );
    const list = <A>(path: string, schema: Schema.Decoder<{ items: A }>) =>
      get(path, schema).pipe(
        Effect.map(Option.match({ onNone: () => [], onSome: (l) => l.items })),
      );
    return Cluster.of({
      deployment: (name) =>
        get(
          `/apis/apps/v1/namespaces/${namespace}/deployments/${encodeURIComponent(name)}`,
          Deployment,
        ).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeedNone,
              onSome: ({ spec }) =>
                list(
                  `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(
                    Object.entries(spec.selector.matchLabels)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(","),
                  )}`,
                  PodList,
                ).pipe(
                  Effect.map((pods) =>
                    Option.some({
                      image: spec.template.spec.containers[0].image,
                      pods: pods.map(({ metadata, status }) => ({
                        name: metadata.name,
                        phase: status.phase,
                        ready: (status.conditions ?? []).some(
                          (c) => c.type === "Ready" && c.status === "True",
                        ),
                        restarts: (status.containerStatuses ?? []).reduce(
                          (sum, c) => sum + c.restartCount,
                          0,
                        ),
                        startedAt:
                          status.startTime ?? metadata.creationTimestamp,
                      })),
                    }),
                  ),
                ),
            }),
          ),
        ),
      events: list(`/api/v1/namespaces/${namespace}/events`, EventList).pipe(
        Effect.map((events) =>
          events.map((e) => ({
            object: e.involvedObject.name ?? "",
            reason: e.reason ?? "",
            message: e.message ?? "",
            ts: e.lastTimestamp ?? e.eventTime ?? e.metadata.creationTimestamp,
          })),
        ),
      ),
    });
  }),
);
