// What the specs run against (specs/README.md, "Runner"): `ClampLimit`, tool
// queries via src/queries.ts, `Call` over the MCP server, and `spec-classes`.
import { clampLimit } from "../../src/limits.js";
import { runCall } from "./call.js";
import { approveRefusal, type ClassInput, classProblems } from "./classes.js";
import type { SpecMessage, SpecOutcome, ValueOutcome } from "./outcome.js";
import { runSourceQuery } from "./query.js";
import { makeCheck } from "./run.js";

const notImplemented = (what: string) =>
  ({ _tag: "NotImplemented", message: what }) as const;

const optionalNumber = (value: unknown) =>
  value === undefined || typeof value === "number";

const clampLimitQuery = (query: SpecMessage): ValueOutcome => {
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
  now: string | null,
): Promise<SpecOutcome> =>
  when._tag === "Call"
    ? runCall(given, when, now)
    : Promise.resolve(notImplemented(`command ${when._tag}`));

export const check = makeCheck({
  runSpec,
  runQuery: (given, query, now) =>
    query._tag === "ClampLimit"
      ? Promise.resolve(clampLimitQuery(query))
      : runSourceQuery(given, query, now),
  runAdapterSpec: (adapter, response, when) =>
    Promise.resolve(runAdapterSpec(adapter, response, when)),
});
