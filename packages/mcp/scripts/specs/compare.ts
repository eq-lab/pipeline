// specs/README.md, "Format": events match exactly and in order, fields inside
// them partially; numbers within 1e-9.
import type { SpecOutcome, ValueOutcome } from "./outcome.js";
import type { Expected, ExpectedValue } from "./parse.js";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const show = (value: unknown) =>
  (JSON.stringify(value) as string | undefined) ?? String(value);

const closeEnough = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

export const partialDiff = (
  expected: unknown,
  actual: unknown,
  path: string,
): Array<string> => {
  if (isRecord(expected)) {
    if (!isRecord(actual))
      return [`${path}: expected a map, got ${show(actual)}`];
    return Object.entries(expected).flatMap(([key, value]) =>
      partialDiff(value, actual[key], path === "" ? key : `${path}.${key}`),
    );
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return [`${path}: expected ${show(expected)}, got ${show(actual)}`];
    }
    return expected.flatMap((value, i) =>
      partialDiff(value, actual[i], `${path}[${String(i)}]`),
    );
  }
  if (typeof expected === "number" && typeof actual === "number") {
    return closeEnough(expected, actual)
      ? []
      : [`${path}: expected ${String(expected)}, got ${String(actual)}`];
  }
  return Object.is(expected, actual)
    ? []
    : [`${path}: expected ${show(expected)}, got ${show(actual)}`];
};

const tags = (events: ReadonlyArray<{ readonly _tag: string }>) =>
  events.length === 0 ? "no events" : events.map((e) => e._tag).join(", ");

export const compare = (
  expected: Expected,
  outcome: SpecOutcome,
): string | null => {
  if (outcome._tag === "NotImplemented")
    return `not implemented: ${outcome.message}`;
  if (expected._tag === "Rejected") {
    if (outcome._tag === "Rejected") {
      return outcome.reason === expected.reason
        ? null
        : `expected rejection ${expected.reason}, got rejection ${outcome.reason}`;
    }
    return `expected rejection ${expected.reason}, got ${tags(outcome.events)}`;
  }
  if (outcome._tag === "Rejected") {
    return `expected ${tags(expected.events)}, got rejection ${outcome.reason}`;
  }
  const actual = outcome.events;
  if (actual.length !== expected.events.length) {
    return `expected ${tags(expected.events)}, got ${tags(actual)}`;
  }
  const diffs = expected.events.flatMap((event, n) => {
    const got = actual[n];
    const i = String(n);
    if (got?._tag !== event._tag)
      return [`then[${i}]: expected ${event._tag}, got ${String(got?._tag)}`];
    return partialDiff(event, got, `then[${i}] ${event._tag}`);
  });
  return diffs.length === 0 ? null : diffs.join("; ");
};

export const compareValue = (
  expected: ExpectedValue,
  outcome: ValueOutcome,
): string | null => {
  if (outcome._tag === "NotImplemented")
    return `not implemented: ${outcome.message}`;
  if (expected._tag === "Rejected") {
    if (outcome._tag === "Rejected") {
      return outcome.reason === expected.reason
        ? null
        : `expected rejection ${expected.reason}, got rejection ${outcome.reason}`;
    }
    return `expected rejection ${expected.reason}, got ${show(outcome.value)}`;
  }
  if (outcome._tag === "Rejected")
    return `expected a value, got rejection ${outcome.reason}`;
  const diffs = partialDiff(expected.value, outcome.value, "then");
  return diffs.length === 0 ? null : diffs.join("; ");
};
