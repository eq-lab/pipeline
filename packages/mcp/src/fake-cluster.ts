// In-memory `Cluster` of the specs (specs/README.md, "Fakes"): Deployments,
// their env and `envFrom`, pods, ConfigMap values and events from `given`.
// `SecretValue` events are never read.
import { Effect, Option } from "effect";
import { Cluster, type EnvFrom } from "./cluster.js";
import { ToolError } from "./errors.js";

export type Message = Readonly<Record<string, unknown>> & {
  readonly _tag: string;
};

export const text = (value: unknown) =>
  typeof value === "string" ? value : "";

const isRef = (v: unknown): v is { name: string; key: string } =>
  typeof v === "object" && v !== null && "name" in v && "key" in v;

const refName = (v: unknown) =>
  typeof v === "object" && v !== null && "name" in v ? text(v.name) : undefined;

// `SourceSlow: { source, ms }` makes a source answer after `ms`.
export type Delay = <A, E>(e: Effect.Effect<A, E>) => Effect.Effect<A, E>;

export const cluster = (
  of: (tag: string) => ReadonlyArray<Message>,
  down: boolean,
  slow: Delay,
) => {
  const unavailable = Effect.fail(
    new ToolError({ reason: "cluster_unavailable" }),
  );
  return Cluster.of({
    deployment: (name) => {
      if (down) return unavailable;
      const envFrom = of("DeploymentEnvFrom").filter(
        (e) => e.deployment === name,
      );
      const found =
        of("Deployment").find((d) => d.name === name) ??
        (envFrom.length > 0 ||
        of("DeploymentEnv").some((e) => e.deployment === name)
          ? { _tag: "Deployment" }
          : undefined);
      return Effect.succeed(
        Option.fromNullishOr(found).pipe(
          Option.map((d) => ({
            image: text(d.image),
            env: of("DeploymentEnv")
              .filter((e) => e.deployment === name)
              .map((e) => ({
                name: text(e.name),
                ...(typeof e.value === "string" && { value: e.value }),
                ...(isRef(e.configMapKeyRef) && {
                  configMapKeyRef: e.configMapKeyRef,
                }),
                ...(isRef(e.secretKeyRef) && { secretKeyRef: e.secretKeyRef }),
              })),
            envFrom: envFrom.flatMap<EnvFrom>((e) => {
              const secret = refName(e.secretRef);
              const configMap = refName(e.configMapRef);
              return secret !== undefined
                ? [{ secret }]
                : configMap !== undefined
                  ? [{ configMap }]
                  : [];
            }),
            pods: of("Pod")
              .filter((pod) => pod.deployment === name)
              .map((pod) => ({
                name: text(pod.name),
                phase: text(pod.phase),
                ready: pod.ready === true,
                restarts: typeof pod.restarts === "number" ? pod.restarts : 0,
                startedAt: text(pod.startedAt),
              })),
          })),
        ),
      );
    },
    configMap: (name) =>
      down
        ? unavailable
        : Effect.succeed(
            Option.some(
              Object.fromEntries(
                of("ConfigMapValue")
                  .filter((m) => m.name === name)
                  .map((m) => [text(m.key), text(m.value)]),
              ),
            ),
          ),
    events: slow(
      down
        ? unavailable
        : Effect.succeed(
            of("KubeEvent").map((e) => ({
              object: text(e.object),
              reason: text(e.reason),
              message: text(e.message),
              ts: text(e.ts),
            })),
          ),
    ),
  });
};
