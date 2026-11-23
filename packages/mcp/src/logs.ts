// The `logs` tool (specs/mcp/logs.md): the `Logs` port and the pure limits
// around one port call; `ServiceMap` maps a service to its `container` label.
import { Context, Effect, Schema } from "effect";
import { ToolError } from "./errors.js";
import { clampLimit } from "./limits.js";
import { ServiceMap } from "./services.js";

export interface LogLine {
  readonly ts: string;
  readonly line: string;
}

export interface LogQuery {
  readonly container: string;
  readonly sinceSeconds: number;
  readonly contains: string | undefined;
  readonly level?: string;
  readonly limit: number;
}

// Lines of `container` within the last `sinceSeconds` that contain `contains`
// literally: the newest `limit`, newest first.
export class Logs extends Context.Service<
  Logs,
  {
    readonly lines: (
      query: LogQuery,
    ) => Effect.Effect<ReadonlyArray<LogLine>, ToolError>;
  }
>()("@pipeline/mcp/Logs") {}

export const maxSinceSeconds = 24 * 3600;
const maxLimit = 500;
const fallbackLimit = 100;
const maxLineBytes = 2048;
const unitSeconds: Readonly<Record<string, number>> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

export const LogsParams = Schema.Struct({
  service: Schema.String.annotate({ description: "configured service name" }),
  since: Schema.String.check(Schema.isPattern(/^\d+[smhd]$/)).annotate({
    description: "window back from now, e.g. 15m, 2h (at most 24h)",
  }),
  grep: Schema.optionalKey(
    Schema.String.annotate({ description: "literal text a line contains" }),
  ),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThan(0)).annotate({
      description: "most recent lines to return (default 100, at most 500)",
    }),
  ),
});

export const LogsResult = Schema.Struct({
  lines: Schema.Array(
    Schema.Struct({ ts: Schema.String, line: Schema.String }),
  ),
  truncated: Schema.Boolean,
});

// The first `maxLineBytes` bytes of UTF-8, never splitting a character.
const cut = (line: string) => {
  const bytes = Buffer.from(line);
  if (bytes.length <= maxLineBytes) return line;
  let end = maxLineBytes;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString();
};

// The container of a configured service and the requested window in seconds.
export const target = Effect.fnUntraced(function* (
  params: Pick<typeof LogsParams.Type, "service" | "since">,
) {
  const services = yield* ServiceMap;
  const container = services.get(params.service);
  if (container === undefined)
    return yield* new ToolError({
      reason: "unknown_service",
      message: `unknown service '${params.service}'; configured: ${[...services.keys()].sort().join(", ")}`,
    });
  const requested =
    Number(params.since.slice(0, -1)) *
    (unitSeconds[params.since.slice(-1)] ?? 0);
  return { container, requested };
});

export const readLogs = Effect.fnUntraced(function* (
  params: typeof LogsParams.Type,
) {
  const { container, requested } = yield* target(params);
  const limit = clampLimit(params.limit, maxLimit, fallbackLimit);
  const found = yield* (yield* Logs).lines({
    container,
    sinceSeconds: Math.min(requested, maxSinceSeconds),
    contains: params.grep,
    limit: limit + 1,
  });
  const kept = found.slice(0, limit).reverse();
  const lines = kept.map(({ ts, line }) => ({ ts, line: cut(line) }));
  return {
    lines,
    truncated:
      requested > maxSinceSeconds ||
      (params.limit ?? 0) > maxLimit ||
      found.length > limit ||
      lines.some((l, i) => l.line !== kept[i]?.line),
  };
});

export const logsQuery = (input: unknown) =>
  Schema.decodeUnknownEffect(LogsParams)(input).pipe(
    Effect.mapError(
      (error) =>
        new ToolError({ reason: "invalid_input", message: error.message }),
    ),
    Effect.flatMap(readLogs),
  );
