// In-memory sources of the specs (specs/README.md, "Fakes"): every source port
// built from the `given` events, and the clock fixed at `now`.
import { Clock, Effect, Layer, Option } from "effect";
import { Cluster } from "./cluster.js";
import { ToolError } from "./errors.js";
import { Logs } from "./logs.js";
import { ServiceMap } from "./services.js";

type Message = Readonly<Record<string, unknown>> & { readonly _tag: string };

const text = (value: unknown) => (typeof value === "string" ? value : "");

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
      const found = of("Deployment").find((d) => d.name === name);
      return Effect.succeed(
        Option.fromNullishOr(found).pipe(
          Option.map((d) => ({
            image: text(d.image),
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
    Layer.succeed(
      Logs,
      logs(of, down("grafana"), now === null ? Date.now() : Date.parse(now)),
    ),
    now === null ? Layer.empty : Layer.succeed(Clock.Clock, fixedClock(now)),
  );
};
