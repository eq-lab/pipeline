// The `errors` tool (specs/mcp/errors.md): error-level lines of one service
// grouped by normalised message; the grouping is pure.
import { Effect, Schema } from "effect";
import { ToolError } from "./errors.js";
import { Logs, LogsParams, maxSinceSeconds, target } from "./logs.js";

const maxGroups = 50;
// shortcut: only the newest 5000 error lines are grouped (Loki's default
// max_entries), upgrade when a window holds more.
const scanLimit = 5000;

export const ErrorsParams = Schema.Struct({
  service: LogsParams.fields.service,
  since: LogsParams.fields.since,
});

export const ErrorsResult = Schema.Struct({
  count: Schema.Number,
  groups: Schema.Array(
    Schema.Struct({
      message: Schema.String,
      count: Schema.Number,
      lastTs: Schema.String,
    }),
  ),
});

const normalise = (line: string) =>
  line.replace(/0x[0-9a-f]+/gi, "<hex>").replace(/\d+/g, "<n>");

// Lines newest first; groups by count, ties by the latest `lastTs`.
export const groupErrors = (
  lines: ReadonlyArray<{ readonly ts: string; readonly line: string }>,
) => {
  const groups = new Map<
    string,
    { message: string; count: number; lastTs: string }
  >();
  for (const { ts, line } of lines) {
    const message = normalise(line);
    const group = groups.get(message);
    if (group === undefined)
      groups.set(message, { message, count: 1, lastTs: ts });
    else group.count++;
  }
  return {
    count: lines.length,
    groups: [...groups.values()]
      .sort((a, b) => b.count - a.count || (a.lastTs < b.lastTs ? 1 : -1))
      .slice(0, maxGroups),
  };
};

export const readErrors = Effect.fnUntraced(function* (
  params: typeof ErrorsParams.Type,
) {
  const { container, requested } = yield* target(params);
  return groupErrors(
    yield* (yield* Logs).lines({
      container,
      sinceSeconds: Math.min(requested, maxSinceSeconds),
      contains: undefined,
      level: "error",
      limit: scanLimit,
    }),
  );
});

export const errorsQuery = (input: unknown) =>
  Schema.decodeUnknownEffect(ErrorsParams)(input).pipe(
    Effect.mapError(
      (error) =>
        new ToolError({ reason: "invalid_input", message: error.message }),
    ),
    Effect.flatMap(readErrors),
  );
