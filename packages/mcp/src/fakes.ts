// In-memory sources of the specs (specs/README.md, "Fakes"): every source port
// built from the `given` events, and the clock fixed at `now`. The database
// fake is in `fakes-db.ts`.
import { Clock, Effect, Layer } from "effect";
import { Cluster } from "./cluster.js";
import { Db } from "./db.js";
import { ToolError } from "./errors.js";
import { cluster, type Delay, type Message, text } from "./fake-cluster.js";
import { db } from "./fakes-db.js";
import { Probes } from "./health.js";
import { ChainRpc, RegistryLogContracts } from "./indexer-lag.js";
import { Logs } from "./logs.js";
import { ServiceMap } from "./services.js";

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
  const slow =
    (source: string): Delay =>
    (e) =>
      Effect.delay(
        e,
        Number(of("SourceSlow").find((m) => m.source === source)?.ms ?? 0),
      );
  const http = (source: string) => {
    const failure = of("SourceDown").find((m) => m.source === source);
    return slow(source)(
      failure === undefined
        ? Effect.void
        : Effect.fail(
            new ToolError({
              reason: "unreachable",
              message: text(failure.error),
            }),
          ),
    );
  };
  return Layer.mergeAll(
    Layer.succeed(
      Probes,
      Probes.of({ api: http("api"), grafana: http("grafana") }),
    ),
    Layer.succeed(
      ServiceMap,
      new Map(
        of("ServiceContainer").map((m) => [text(m.service), text(m.container)]),
      ),
    ),
    Layer.succeed(Cluster, cluster(of, down("k8s"), slow("k8s"))),
    Layer.succeed(Db, db(of, down("db"), slow("db"))),
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
