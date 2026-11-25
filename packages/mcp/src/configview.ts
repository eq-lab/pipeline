// `config` (specs/mcp/config.md): the env of each configured service's
// Deployment with ConfigMap values resolved and secrets masked; Secret
// references and `envFrom` sources are shown by name, never read.
import { Effect, Option, Schema } from "effect";
import { Cluster, type EnvVar, type Workload } from "./cluster.js";
import { ServiceMap } from "./services.js";

const mask = "***";

const SecretRef = Schema.Struct({ secret: Schema.String, key: Schema.String });

export const ConfigState = Schema.Struct({
  services: Schema.Array(
    Schema.Struct({
      service: Schema.String,
      env: Schema.Record(Schema.String, Schema.String),
      secrets: Schema.optionalKey(Schema.Record(Schema.String, SecretRef)),
      envFrom: Schema.optionalKey(
        Schema.Array(
          Schema.Union([
            Schema.Struct({ secret: Schema.String }),
            Schema.Struct({ configMap: Schema.String }),
          ]),
        ),
      ),
    }),
  ),
});

const hasCredentials = (part: string) => {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(part)) return false;
  try {
    const url = new URL(part);
    return (
      url.username !== "" ||
      url.password !== "" ||
      !["", "/"].includes(url.pathname) ||
      url.search !== "" ||
      url.hash !== ""
    );
  } catch {
    return true;
  }
};

export const masked = (name: string, value: string) =>
  /KEY|SECRET|TOKEN|PASSWORD/i.test(name) ||
  value.split(",").some((part) => hasCredentials(part.trim()))
    ? mask
    : value;

// A secretKeyRef, an unresolved reference or a value-less entry is masked.
const resolve = (cluster: Cluster["Service"], v: EnvVar) => {
  const ref = v.configMapKeyRef;
  if (v.secretKeyRef !== undefined) return Effect.succeed(mask);
  if (ref === undefined) return Effect.succeed(masked(v.name, v.value ?? mask));
  return cluster
    .configMap(ref.name)
    .pipe(
      Effect.map((map) =>
        masked(v.name, Option.getOrUndefined(map)?.[ref.key] ?? mask),
      ),
    );
};

const view = (
  cluster: Cluster["Service"],
  service: string,
  { env, envFrom }: Workload,
) =>
  Effect.forEach(env, (v) =>
    resolve(cluster, v).pipe(Effect.map((value) => [v.name, value] as const)),
  ).pipe(
    Effect.map((entries) => {
      const secrets = env.flatMap(({ name, secretKeyRef }) =>
        secretKeyRef === undefined
          ? []
          : [
              [
                name,
                { secret: secretKeyRef.name, key: secretKeyRef.key },
              ] as const,
            ],
      );
      return {
        service,
        env: Object.fromEntries(entries),
        ...(secrets.length > 0 && { secrets: Object.fromEntries(secrets) }),
        ...(envFrom.length > 0 && { envFrom }),
      };
    }),
  );

export const configView = Effect.gen(function* () {
  const services = yield* ServiceMap;
  const cluster = yield* Cluster;
  const found = yield* Effect.forEach(
    [...services].sort(([a], [b]) => (a < b ? -1 : 1)),
    ([service, name]) =>
      cluster.deployment(name).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed([]),
            onSome: (workload) =>
              view(cluster, service, workload).pipe(Effect.map((s) => [s])),
          }),
        ),
      ),
  );
  return { services: found.flat() };
});
