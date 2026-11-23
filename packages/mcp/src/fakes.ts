// In-memory sources of the specs (specs/README.md, "Fakes"): every source port
// built from the `given` events, and the clock fixed at `now`.
import { Clock, Effect, Layer, Option } from "effect";
import { Cluster, type EnvFrom } from "./cluster.js";
import { Db, type Queues, queueErrors } from "./db.js";
import { ToolError } from "./errors.js";
import { ChainRpc, RegistryLogContracts } from "./indexer-lag.js";
import { Logs } from "./logs.js";
import { ServiceMap } from "./services.js";

type Message = Readonly<Record<string, unknown>> & { readonly _tag: string };

const text = (value: unknown) => (typeof value === "string" ? value : "");

const isRef = (v: unknown): v is { name: string; key: string } =>
  typeof v === "object" && v !== null && "name" in v && "key" in v;

const refName = (v: unknown) =>
  typeof v === "object" && v !== null && "name" in v ? text(v.name) : undefined;

// `line: { repeat, times }` stands for the text repeated (specs/mcp/logs.md).
const lineText = (line: unknown): string => {
  if (typeof line !== "object" || line === null) return String(line);
  const { repeat, times } = line as { repeat?: unknown; times?: unknown };
  return String(repeat).repeat(Number(times));
};

const fixedClock = (iso: string): Clock.Clock => {
  const live = Clock.Clock.defaultValue();
  const millis = Date.parse(iso);
  const nanos = BigInt(millis) * 1_000_000n;
  return {
    currentTimeMillisUnsafe: () => millis,
    currentTimeMillis: Effect.succeed(millis),
    currentTimeNanosUnsafe: () => nanos,
    currentTimeNanos: Effect.succeed(nanos),
    monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: live.monotonicTimeNanos,
    sleep: (duration) => live.sleep(duration),
  };
};

const cluster = (
  of: (tag: string) => ReadonlyArray<Message>,
  down: boolean,
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
    events: down
      ? unavailable
      : Effect.succeed(
          of("KubeEvent").map((e) => ({
            object: text(e.object),
            reason: text(e.reason),
            message: text(e.message),
            ts: text(e.ts),
          })),
        ),
  });
};

const newest = (rows: ReadonlyArray<Message>) =>
  rows
    .filter((r) => typeof r.error === "string")
    .sort(
      (a, b) => Date.parse(text(b.createdAt)) - Date.parse(text(a.createdAt)),
    )
    .slice(0, queueErrors);

const queues = (of: (tag: string) => ReadonlyArray<Message>): Queues => {
  const kyc = of("KycOutboxRow");
  const open = kyc
    .filter((r) => r.processedAt === null)
    .map((r) => text(r.createdAt))
    .sort();
  const mint = of("YieldMintOutboxRow");
  const byStatus: Record<string, number> = {};
  for (const { status } of mint)
    byStatus[text(status)] = (byStatus[text(status)] ?? 0) + 1;
  return {
    kyc: {
      unprocessed: open.length,
      oldestUnprocessedAt: open[0] ?? null,
      errors: newest(kyc).map((r) => ({
        id: Number(r.id),
        chainId: Number(r.chainId),
        error: text(r.error),
      })),
    },
    yieldMint: {
      byStatus,
      errors: newest(mint.map((r) => ({ ...r, error: r.lastError }))).map(
        (r) => ({
          chainId: Number(r.chainId),
          loanId: Number(r.loanId),
          repaymentId: Number(r.repaymentId),
          status: text(r.status),
          error: text(r.error),
        }),
      ),
    },
  };
};

const db = (of: (tag: string) => ReadonlyArray<Message>, down: boolean) => {
  const unavailable = Effect.fail(new ToolError({ reason: "db_unavailable" }));
  const cursors = (tag: string, field: string) =>
    of(tag).map((c) => ({
      chainId: Number(c.chainId),
      contract: text(c.contract),
      cursor: Number(c[field]),
    }));
  return Db.of({
    queues: down ? unavailable : Effect.sync(() => queues(of)),
    syncState: down
      ? unavailable
      : Effect.succeed({
          indexer: of("IndexerCursor").map((c) => ({
            chainId: Number(c.chainId),
            next: Number(c.lastIndexedBlock),
            ...(typeof c.updatedAt === "string"
              ? { updatedAt: c.updatedAt }
              : {}),
          })),
          registry: cursors("SecurityRegistryCursor", "projectedLogId"),
          accessManager: cursors("AccessManagerCursor", "lastLogId"),
        }),
    maxLogId: (chainId, contracts, events) =>
      down
        ? unavailable
        : Effect.succeed(
            Math.max(
              0,
              ...of("ContractLog")
                .filter(
                  (l) =>
                    l.chainId === chainId &&
                    contracts.includes(text(l.contract)) &&
                    (events === undefined || events.includes(text(l.event))),
                )
                .map((l) => Number(l.id)),
            ),
          ),
    tables: down
      ? unavailable
      : Effect.succeed(
          of("Table")
            .filter((t) => t.schema === "public")
            .map((t) => ({
              name: text(t.name),
              columns: Array.isArray(t.columns) ? t.columns : [],
            }))
            .sort((a, b) => (a.name < b.name ? -1 : 1)),
        ),
  });
};

const chainRpc = (of: (tag: string) => ReadonlyArray<Message>) =>
  ChainRpc.of({
    head: (chainId) => {
      const found = of("ChainHead").find((h) => h.chainId === chainId);
      return found === undefined ||
        of("ChainDown").some((d) => d.chainId === chainId)
        ? Effect.fail(new ToolError({ reason: "unreachable" }))
        : Effect.succeed(Number(found.head));
    },
  });

const logs = (
  of: (tag: string) => ReadonlyArray<Message>,
  down: boolean,
  nowMs: number,
) => {
  const stored = of("LokiLine")
    .map((e) => ({
      container: String(e.container),
      ts: String(e.ts),
      at: Date.parse(String(e.ts)),
      line: lineText(e.line),
      level: text(e.level),
    }))
    .sort((a, b) => b.at - a.at);
  return Logs.of({
    lines: (query) =>
      down
        ? Effect.fail(
            new ToolError({
              reason: "logs_unavailable",
              message: "logs unavailable: grafana down",
            }),
          )
        : Effect.succeed(
            stored
              .filter(
                (l) =>
                  l.container === query.container &&
                  l.at >= nowMs - query.sinceSeconds * 1000 &&
                  l.at <= nowMs &&
                  (query.level === undefined || l.level === query.level) &&
                  (query.contains === undefined ||
                    l.line.includes(query.contains)),
              )
              .slice(0, query.limit)
              .map(({ ts, line }) => ({ ts, line })),
          ),
  });
};

export const fakes = (
  given: ReadonlyArray<Message>,
  now: string | null,
): Layer.Layer<never> => {
  const of = (tag: string) => given.filter((m) => m._tag === tag);
  const down = (source: string) =>
    of("SourceDown").some((m) => m.source === source);
  return Layer.mergeAll(
    Layer.succeed(
      ServiceMap,
      new Map(
        of("ServiceContainer").map((m) => [text(m.service), text(m.container)]),
      ),
    ),
    Layer.succeed(Cluster, cluster(of, down("k8s"))),
    Layer.succeed(Db, db(of, down("db"))),
    Layer.succeed(ChainRpc, chainRpc(of)),
    Layer.succeed(
      RegistryLogContracts,
      new Map(
        of("RegistryLogContracts").map((m) => [
          Number(m.chainId),
          Array.isArray(m.contracts) ? m.contracts.map(text) : [],
        ]),
      ),
    ),
    Layer.succeed(
      Logs,
      logs(of, down("grafana"), now === null ? Date.now() : Date.parse(now)),
    ),
    now === null ? Layer.empty : Layer.succeed(Clock.Clock, fixedClock(now)),
  );
};
