// Evaluates the registered checks against run.json and writes stacks/<tag>/result.json; see docs/e2e.md.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { journeys as registry } from "./journeys/index";
import { journeyId, type Journey, type StackState } from "./lib/journey";
import { redact, redactFile } from "./lib/redact";
import { errorMessage, readJson, stackDir } from "./lib/stack";
import type { RunRecord } from "./run";

export const SCHEMA_VERSION = 1;
const CHECK_ID = /^(stellar|evm)\.[a-z0-9-]+\.[a-z0-9-]+$/;

export interface OptionalEntry {
  issue: number | "pending";
  finding?: string;
}

export interface CheckResult {
  id: string;
  ok: boolean;
  optional: boolean;
  title: string;
  details?: string;
  issue?: number | "pending";
  finding?: string;
}

export interface Result {
  schemaVersion: number;
  tag: string;
  commit: string | null;
  contracts: { stellar: string | null; evm: string | null };
  startedAt: string | null;
  finishedAt: string;
  durations: { up: number | null; run: number | null; check: number };
  ok: boolean;
  error?: string;
  checks: CheckResult[];
  canBeRequired: string[];
  artifacts: string[];
}

export function parseChecksFile(raw: unknown): Record<string, OptionalEntry> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("checks.json: expected an object");
  for (const [id, entry] of Object.entries(raw as Record<string, OptionalEntry>)) {
    const { issue, finding } = entry ?? {};
    if (!CHECK_ID.test(id)) throw new Error(`checks.json: bad check id "${id}"`);
    if (issue === "pending") {
      if (typeof finding !== "string" || !finding.trim()) throw new Error(`checks.json: ${id} is pending without a finding`);
    } else if (!Number.isInteger(issue) || (issue as number) <= 0) {
      throw new Error(`checks.json: ${id} needs "issue": <number> or "pending"`);
    }
  }
  return raw as Record<string, OptionalEntry>;
}

export interface BuildInput {
  tag: string;
  state: StackState | undefined;
  run: RunRecord | undefined;
  journeys: Journey[];
  optional: Record<string, OptionalEntry>;
  overrides?: { optional?: string[]; require?: string[] };
  artifacts: string[];
  checkSeconds: number;
  finishedAt: string;
}

export function buildResult(input: BuildInput): Result {
  const { run, state, overrides = {} } = input;
  const ran = new Set(run?.journeys ?? []);
  const checks = input.journeys
    .filter((j) => ran.has(journeyId(j)))
    .flatMap((j) => j.checks)
    .map((check): CheckResult => {
      let outcome;
      try {
        outcome = check.evaluate(run!.recorded);
      } catch (e) {
        outcome = { ok: false, details: errorMessage(e) };
      }
      const entry = input.optional[check.id];
      const optional = overrides.require?.includes(check.id)
        ? false
        : !!entry || !!overrides.optional?.includes(check.id);
      const result: CheckResult = { id: check.id, ok: outcome.ok, optional, title: check.title };
      if (outcome.details !== undefined) result.details = redact(outcome.details);
      if (entry) result.issue = entry.issue;
      if (entry?.finding) result.finding = entry.finding;
      return result;
    });
  const error = run
    ? (run.error && redact(run.error)) || (checks.length ? "" : "no checks ran")
    : "no run.json: run.ts did not run";
  return {
    schemaVersion: SCHEMA_VERSION,
    tag: input.tag,
    commit: run?.commit ?? null,
    contracts: { stellar: state?.contracts?.stellar ?? null, evm: state?.contracts?.evm ?? null },
    startedAt: run?.startedAt ?? null,
    finishedAt: input.finishedAt,
    durations: { up: state?.durations?.up ?? null, run: run?.durations?.run ?? null, check: input.checkSeconds },
    ok: !error && checks.every((c) => c.ok || c.optional),
    ...(error ? { error } : {}),
    checks,
    canBeRequired: checks.filter((c) => c.ok && c.optional).map((c) => c.id),
    artifacts: input.artifacts,
  };
}

export const exitCode = (r: Result) => (r.error ? 2 : r.ok ? 0 : 1);

function validateIds(journeys: Journey[], overrides: string[]): void {
  const ids = journeys.flatMap((j) => j.checks.map((c) => c.id));
  for (const id of ids) if (!CHECK_ID.test(id)) throw new Error(`bad check id "${id}"`);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`duplicate check id "${dup}"`);
  const unknown = overrides.filter((id) => !ids.includes(id));
  if (unknown.length) throw new Error(`unknown check id: ${unknown.join(", ")}`);
}

function redactLogs(dir: string): string[] {
  const logs = join(dir, "logs");
  if (!existsSync(logs)) return [];
  return readdirSync(logs, { withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => {
      redactFile(join(logs, f.name));
      return `logs/${f.name}`;
    })
    .sort();
}

const CHECKS_JSON = join(dirname(fileURLToPath(import.meta.url)), "checks.json");

export function check(argv: string[], journeys: Journey[] = registry, checksPath = CHECKS_JSON): number {
  const started = Date.now();
  let failed: { tag: string; json?: boolean } | undefined;
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        tag: { type: "string" },
        json: { type: "boolean" },
        optional: { type: "string", multiple: true, default: [] },
        require: { type: "string", multiple: true, default: [] },
      },
    });
    if (!values.tag) throw new Error("--tag is required");
    failed = { tag: values.tag, json: values.json };
    const both = values.optional.filter((id) => values.require.includes(id));
    if (both.length) throw new Error(`both --optional and --require: ${both.join(", ")}`);
    validateIds(journeys, [...values.optional, ...values.require]);
    const dir = stackDir(values.tag);
    if (!existsSync(dir)) throw new Error(`no stack ${dir}`);
    const result = buildResult({
      tag: values.tag,
      state: readJson<StackState>(join(dir, "state.json")),
      run: readJson<RunRecord>(join(dir, "run.json")),
      journeys,
      optional: parseChecksFile(JSON.parse(readFileSync(checksPath, "utf8"))),
      overrides: { optional: values.optional, require: values.require },
      artifacts: redactLogs(dir),
      checkSeconds: Math.round((Date.now() - started) / 1000),
      finishedAt: new Date().toISOString(),
    });
    const json = JSON.stringify(result, null, 2) + "\n";
    writeFileSync(join(dir, "result.json"), json);
    if (values.json) {
      process.stdout.write(json);
    } else {
      for (const c of result.checks) {
        const note = c.optional ? ` (optional, issue ${c.issue ?? "none"})` : "";
        console.log(`${c.ok ? "✅" : "❌"} ${c.id}: ${c.title}${note}${c.details ? ` — ${c.details}` : ""}`);
      }
      if (result.error) console.log(`❌ run failed: ${result.error}`);
      console.log(`${result.ok ? "ok" : "FAILED"}; result: ${join(dir, "result.json")}`);
    }
    return exitCode(result);
  } catch (e) {
    const error = redact(errorMessage(e));
    console.error(`check: ${error}`);
    // Overwrite a stale result.json with a minimal failure, so a caller reading the file never sees an old ok:true.
    // shortcut: a missing --tag or stack dir writes nothing (there is no file to go stale), upgrade if callers need one anyway.
    if (failed && existsSync(stackDir(failed.tag))) {
      const json = JSON.stringify({ schemaVersion: SCHEMA_VERSION, tag: failed.tag, ok: false, error }, null, 2) + "\n";
      writeFileSync(join(stackDir(failed.tag), "result.json"), json);
      if (failed.json) process.stdout.write(json);
    }
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(check(process.argv.slice(2)));
}
