// What the specs run against (specs/README.md, "Runner"): queries over the
// package's pure functions, `Call` over the MCP server, and `spec-classes`.
import { clampLimit } from "../../src/limits.js";
import { runCall } from "./call.js";
import { approveRefusal, type ClassInput, classProblems } from "./classes.js";
import type { SpecMessage, SpecOutcome, ValueOutcome } from "./outcome.js";
import { makeCheck } from "./run.js";

const notImplemented = (what: string) =>
  ({ _tag: "NotImplemented", message: what }) as const;

const optionalNumber = (value: unknown) =>
  value === undefined || typeof value === "number";

const runQuery = (
  _given: ReadonlyArray<SpecMessage>,
  query: SpecMessage,
): ValueOutcome => {
  if (query._tag !== "ClampLimit") return notImplemented(`query ${query._tag}`);
  const { limit, max, fallback } = query;
  if (
    !optionalNumber(limit) ||
    typeof max !== "number" ||
    typeof fallback !== "number"
  )
    return { _tag: "Rejected", reason: "invalid_query" };
  return { _tag: "Value", value: { limit: clampLimit(limit, max, fallback) } };
};

const runAdapterSpec = (
  adapter: string,
  response: unknown,
  when: SpecMessage,
): ValueOutcome => {
  if (adapter !== "spec-classes") return notImplemented(`adapter ${adapter}`);
  if (when._tag === "Verify")
    return {
      _tag: "Value",
      value: { problems: classProblems(response as ClassInput) },
    };
  if (when._tag === "Approve" && typeof when.path === "string") {
    const reason = approveRefusal(when.path);
    return reason === null
      ? { _tag: "Value", value: { approved: true } }
      : { _tag: "Rejected", reason };
  }
  return notImplemented(`spec-classes ${when._tag}`);
};

const runSpec = (
  given: ReadonlyArray<SpecMessage>,
  when: SpecMessage,
): Promise<SpecOutcome> =>
  when._tag === "Call"
    ? runCall(given, when)
    : Promise.resolve(notImplemented(`command ${when._tag}`));

export const check = makeCheck({
  runSpec,
  runQuery: (given, query) => Promise.resolve(runQuery(given, query)),
  runAdapterSpec: (adapter, response, when) =>
    Promise.resolve(runAdapterSpec(adapter, response, when)),
});
