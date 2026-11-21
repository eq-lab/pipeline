// The ratchet over specs/passing (specs/README.md, "Ratchet"): verdicts,
// stale lines, and what yarn spec:ratchet and spec:ratchet-flex write.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isFlexSpec } from "./classes.js";
import { listSpecFiles, readSpec, readStatus, type Status } from "./files.js";
import { parseBlocks } from "./parse.js";
import type { Check } from "./run.js";

export const passingFile = "specs/passing";

export const scenarioId = (path: string, name: string) => `${path}#${name}`;

export interface Result {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly status: Status;
  readonly red: string | null;
}

export type Verdict =
  | { readonly _tag: "Green" }
  | { readonly _tag: "Unrecorded" }
  | { readonly _tag: "Backlog"; readonly red: string }
  | { readonly _tag: "Regression"; readonly red: string }
  | { readonly _tag: "DraftGreen" }
  | { readonly _tag: "DraftRed"; readonly red: string };

export const verdict = (
  result: Result,
  passing: ReadonlySet<string>,
): Verdict => {
  if (result.status === "draft") {
    return result.red === null
      ? { _tag: "DraftGreen" }
      : { _tag: "DraftRed", red: result.red };
  }
  const listed = passing.has(scenarioId(result.path, result.name));
  if (result.red === null)
    return listed ? { _tag: "Green" } : { _tag: "Unrecorded" };
  return listed
    ? { _tag: "Regression", red: result.red }
    : { _tag: "Backlog", red: result.red };
};

export const verdictProblem = (result: Result, v: Verdict): string | null => {
  const where = `${result.path}:${String(result.line)} ${result.name}`;
  switch (v._tag) {
    case "Regression":
      return (
        `regression: ${where} was green (listed in ${passingFile}) and is red now: ${v.red}. ` +
        `Fix the code; never remove the line from ${passingFile}`
      );
    case "Unrecorded":
      return `${where} is green but not in ${passingFile}: run yarn spec:ratchet and commit ${passingFile}`;
    default:
      return null;
  }
};

export const staleEntries = (
  results: ReadonlyArray<Result>,
  passing: ReadonlySet<string>,
): ReadonlyArray<string> => {
  const approved = new Set(
    results
      .filter((r) => r.status === "approved")
      .map((r) => scenarioId(r.path, r.name)),
  );
  return [...passing]
    .filter((id) => !approved.has(id) && !isFlexSpec(id))
    .sort()
    .map(
      (id) =>
        `${passingFile}: "${id}" names no approved scenario (heading renamed or removed). ` +
        `Only a human removes lines from ${passingFile} when specs change`,
    );
};

export const ratchet = (
  results: ReadonlyArray<Result>,
  passing: ReadonlySet<string>,
  flexOnly = false,
): ReadonlyArray<string> => {
  const green = results
    .filter(
      (r) =>
        r.status === "approved" &&
        r.red === null &&
        (!flexOnly || isFlexSpec(r.path)),
    )
    .map((r) => scenarioId(r.path, r.name));
  const approved = new Set(
    results
      .filter((r) => r.status === "approved")
      .map((r) => scenarioId(r.path, r.name)),
  );
  const kept = [...passing].filter((id) => !isFlexSpec(id) || approved.has(id));
  return [...new Set([...kept, ...green])].sort();
};

export interface Tally {
  readonly approved: {
    green: number;
    backlog: number;
    regressions: number;
    unrecorded: number;
  };
  readonly draft: { green: number; red: number };
}

export const tally = (verdicts: ReadonlyArray<Verdict>): Tally => {
  const t = {
    approved: { green: 0, backlog: 0, regressions: 0, unrecorded: 0 },
    draft: { green: 0, red: 0 },
  };
  for (const v of verdicts) {
    if (v._tag === "Green") t.approved.green++;
    else if (v._tag === "Unrecorded") t.approved.unrecorded++;
    else if (v._tag === "Backlog") t.approved.backlog++;
    else if (v._tag === "Regression") t.approved.regressions++;
    else if (v._tag === "DraftGreen") t.draft.green++;
    else t.draft.red++;
  }
  return t;
};

export const summary = ({ approved, draft }: Tally) =>
  `exec specs: approved ${String(approved.green + approved.unrecorded)} green, ` +
  `${String(approved.backlog)} red (backlog), ${String(approved.regressions)} regressions` +
  (approved.unrecorded > 0
    ? ` (${String(approved.unrecorded)} green not in ${passingFile})`
    : "") +
  `; draft ${String(draft.green)} green, ${String(draft.red)} red`;

export const readPassing = (root: string): ReadonlySet<string> => {
  const file = join(root, passingFile);
  if (!existsSync(file)) return new Set();
  return new Set(
    readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
};

export const writePassing = (root: string, ids: ReadonlyArray<string>) => {
  writeFileSync(join(root, passingFile), ids.map((id) => `${id}\n`).join(""));
};

export const runAll = (root: string, check: Check): ReadonlyArray<Result> =>
  listSpecFiles(root).flatMap((path) => {
    const text = readSpec(root, path);
    const status = readStatus(text);
    if (typeof status !== "string") return [];
    return parseBlocks(text).map((block) => ({
      path,
      name: block.name,
      line: block.line,
      status,
      red: check(block, root),
    }));
  });
