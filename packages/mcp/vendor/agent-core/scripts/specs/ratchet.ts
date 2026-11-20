import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isFlexSpec } from "./classes"
import { listSpecFiles, readSpec, readStatus, type Status } from "./files"
import { parseBlocks } from "./parse"
import type { Check } from "./run"

// The ratchet (specs/README.md, "Храповик"). `specs/passing` lists every
// approved scenario that has ever been green, one `<path>#<heading>` per line,
// sorted. Red approved scenarios not listed are the backlog; a listed one that
// turns red is a regression. Lines are only added (pnpm spec:ratchet), never
// removed by agents (except class B lines of removed scenarios, see ratchet).

export const passingFile = "specs/passing"

export const scenarioId = (path: string, name: string) => `${path}#${name}`

export interface Result {
  readonly path: string
  readonly name: string
  readonly line: number
  readonly status: Status
  readonly red: string | null
}

export type Verdict =
  | { readonly _tag: "Green" }
  | { readonly _tag: "Unrecorded" }
  | { readonly _tag: "Backlog"; readonly red: string }
  | { readonly _tag: "Regression"; readonly red: string }
  | { readonly _tag: "DraftGreen" }
  | { readonly _tag: "DraftRed"; readonly red: string }

export const verdict = (result: Result, passing: ReadonlySet<string>): Verdict => {
  if (result.status === "draft") {
    return result.red === null ? { _tag: "DraftGreen" } : { _tag: "DraftRed", red: result.red }
  }
  const listed = passing.has(scenarioId(result.path, result.name))
  if (result.red === null) return listed ? { _tag: "Green" } : { _tag: "Unrecorded" }
  return listed ? { _tag: "Regression", red: result.red } : { _tag: "Backlog", red: result.red }
}

// Verdicts that fail `pnpm check`, as sentences a human or agent can act on.
export const verdictProblem = (result: Result, v: Verdict): string | null => {
  const where = `${result.path}:${result.line} ${result.name}`
  switch (v._tag) {
    case "Regression":
      return (
        `regression: ${where} was green (listed in ${passingFile}) and is red now: ${v.red}. ` +
        `Fix the code; never remove the line from ${passingFile}`
      )
    case "Unrecorded":
      return `${where} is green but not in ${passingFile}: run pnpm spec:ratchet and commit ${passingFile}`
    default:
      return null
  }
}

// Lines of specs/passing that name no existing approved scenario.
export const staleEntries = (
  results: ReadonlyArray<Result>,
  passing: ReadonlySet<string>
): ReadonlyArray<string> => {
  const approved = new Set(
    results.filter((r) => r.status === "approved").map((r) => scenarioId(r.path, r.name))
  )
  return [...passing]
    .filter((id) => !approved.has(id) && !isFlexSpec(id))
    .sort()
    .map(
      (id) =>
        `${passingFile}: "${id}" names no approved scenario (heading renamed or removed). ` +
        `Only a human removes lines from ${passingFile} when specs change`
    )
}

// What pnpm spec:ratchet writes: the old lines plus every green approved scenario. Lines of
// specs/flex/ (class B) that name no approved scenario any more are dropped: an agent
// removed or renamed that scenario. `flexOnly` (pnpm spec:ratchet-flex, which agents may run)
// adds only green scenarios of specs/flex/: class A lines are neither added nor touched.
export const ratchet = (
  results: ReadonlyArray<Result>,
  passing: ReadonlySet<string>,
  flexOnly = false
): ReadonlyArray<string> => {
  const green = results
    .filter((r) => r.status === "approved" && r.red === null && (!flexOnly || isFlexSpec(r.path)))
    .map((r) => scenarioId(r.path, r.name))
  const approved = new Set(
    results.filter((r) => r.status === "approved").map((r) => scenarioId(r.path, r.name))
  )
  const kept = [...passing].filter((id) => !isFlexSpec(id) || approved.has(id))
  return [...new Set([...kept, ...green])].sort()
}

export interface Tally {
  readonly approved: { green: number; backlog: number; regressions: number; unrecorded: number }
  readonly draft: { green: number; red: number }
}

export const tally = (verdicts: ReadonlyArray<Verdict>): Tally => {
  const t = {
    approved: { green: 0, backlog: 0, regressions: 0, unrecorded: 0 },
    draft: { green: 0, red: 0 }
  }
  for (const v of verdicts) {
    if (v._tag === "Green") t.approved.green++
    else if (v._tag === "Unrecorded") t.approved.unrecorded++
    else if (v._tag === "Backlog") t.approved.backlog++
    else if (v._tag === "Regression") t.approved.regressions++
    else if (v._tag === "DraftGreen") t.draft.green++
    else t.draft.red++
  }
  return t
}

export const summary = ({ approved, draft }: Tally) =>
  `exec specs: approved ${approved.green + approved.unrecorded} green, ` +
  `${approved.backlog} red (backlog), ${approved.regressions} regressions` +
  (approved.unrecorded > 0 ? ` (${approved.unrecorded} green not in ${passingFile})` : "") +
  `; draft ${draft.green} green, ${draft.red} red`

export const readPassing = (root: string): ReadonlySet<string> => {
  const file = join(root, passingFile)
  if (!existsSync(file)) return new Set()
  return new Set(
    readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
  )
}

export const writePassing = (root: string, ids: ReadonlyArray<string>) =>
  writeFileSync(join(root, passingFile), ids.map((id) => `${id}\n`).join(""))

// Runs every scenario of every spec file with a valid status line.
export const runAll = (root: string, check: Check): ReadonlyArray<Result> =>
  listSpecFiles(root).flatMap((path) => {
    const text = readSpec(root, path)
    const status = readStatus(text)
    if (typeof status !== "string") return []
    return parseBlocks(text).map((block) => ({
      path,
      name: block.name,
      line: block.line,
      status,
      red: check(block, root)
    }))
  })
