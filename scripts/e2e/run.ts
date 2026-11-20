// Runs the selected journeys and records what they saw in stacks/<tag>/run.json; see docs/e2e.md.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { journeys as registry } from "./journeys/index";
import { CHAINS, journeyId, type Journey, type Recorded, type StackState } from "./lib/journey";
import { redact } from "./lib/redact";
import { errorMessage, readJson, stackDir } from "./lib/stack";

export interface RunRecord {
  commit: string | null;
  startedAt: string;
  finishedAt: string;
  durations: { run: number };
  journeys: string[];
  recorded: Recorded;
  error?: string;
}

function gitHead(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function list(value: string | undefined, all: readonly string[], what: string): string[] {
  if (value === undefined) return [...all];
  const items = value.split(",").filter(Boolean);
  const unknown = items.filter((i) => !all.includes(i));
  if (unknown.length) throw new Error(`unknown ${what}: ${unknown.join(", ")}`);
  return items;
}

export async function run(argv: string[], journeys: Journey[] = registry): Promise<number> {
  let dir: string;
  let selected: Journey[];
  let tag: string;
  try {
    const { values } = parseArgs({
      args: argv,
      options: { tag: { type: "string" }, chains: { type: "string" }, journeys: { type: "string" } },
    });
    if (!values.tag) throw new Error("--tag is required");
    tag = values.tag;
    dir = stackDir(tag);
    const chains = list(values.chains, CHAINS, "chain");
    const names = list(values.journeys, [...new Set(journeys.map((j) => j.name))], "journey");
    selected = journeys.filter((j) => chains.includes(j.chain) && names.includes(j.name));
    if (!selected.length) throw new Error("the selection matches no journey");
  } catch (e) {
    console.error(`run: ${errorMessage(e)}`);
    return 2;
  }

  const started = Date.now();
  const record: RunRecord = {
    commit: gitHead(),
    startedAt: new Date(started).toISOString(),
    finishedAt: "",
    durations: { run: 0 },
    journeys: selected.map(journeyId),
    recorded: {},
  };
  try {
    const state = readJson<StackState>(join(dir, "state.json"));
    if (!state) throw new Error(`no state.json in ${dir}: is the stack up?`);
    for (const journey of selected) {
      for (const step of journey.steps) {
        console.error(`run: ${journeyId(journey)} / ${step.name}`);
        try {
          await step.run({ tag, state, recorded: record.recorded });
        } catch (e) {
          throw new Error(`${journeyId(journey)} / ${step.name}: ${errorMessage(e)}`);
        }
      }
    }
  } catch (e) {
    record.error = redact(errorMessage(e));
    console.error(`run: ${record.error}`);
  }
  record.finishedAt = new Date().toISOString();
  record.durations.run = Math.round((Date.now() - started) / 1000);
  try {
    writeFileSync(join(dir, "run.json"), JSON.stringify(record, null, 2) + "\n");
  } catch (e) {
    console.error(`run: cannot write run.json: ${errorMessage(e)}`);
    return 2;
  }
  return record.error ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
