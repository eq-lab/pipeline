// Tool queries of specs/mcp/*.md (specs/README.md, "Queries"): the handler of
// the query's tag in src/queries.ts, run with the fakes of `given` at `now`.
import { Cause, Effect, Exit, Option } from "effect";
import type { SpecMessage, ValueOutcome } from "./outcome.js";
import { fakesLayer, loadSource } from "./seam.js";

type Handler = (
  input: Readonly<Record<string, unknown>>,
) => Effect.Effect<unknown, unknown>;

const reasonOf = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "reason" in error &&
  typeof error.reason === "string"
    ? error.reason
    : null;

const handlerFor = async (tag: string): Promise<Handler | null> => {
  const queries = (await loadSource("queries"))?.queries;
  if (typeof queries !== "object" || queries === null) return null;
  const handler: unknown = Object.getOwnPropertyDescriptor(queries, tag)?.value;
  return typeof handler === "function" ? (handler as Handler) : null;
};

export const runSourceQuery = async (
  given: ReadonlyArray<SpecMessage>,
  query: SpecMessage,
  now: string | null,
): Promise<ValueOutcome> => {
  const { _tag: tag, ...input } = query;
  const handler = await handlerFor(tag);
  if (handler === null)
    return { _tag: "NotImplemented", message: `query ${tag}` };
  const fakes = await fakesLayer(given, now);
  if (typeof fakes === "string")
    return { _tag: "NotImplemented", message: fakes };
  const exit = await Effect.runPromiseExit(
    handler(input).pipe(Effect.provide(fakes)),
  );
  if (Exit.isSuccess(exit)) return { _tag: "Value", value: exit.value };
  const reason = Option.match(Cause.findErrorOption(exit.cause), {
    onNone: () => null,
    onSome: reasonOf,
  });
  if (reason !== null) return { _tag: "Rejected", reason };
  throw new Error(Cause.pretty(exit.cause));
};
