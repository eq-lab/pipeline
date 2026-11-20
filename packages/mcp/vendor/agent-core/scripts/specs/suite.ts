import { approvalProblems, listSpecFiles, readSpec, readStatus } from "./files"
import {
  readPassing,
  runAll,
  staleEntries,
  summary,
  tally,
  verdict,
  verdictProblem
} from "./ratchet"
import type { Check } from "./run"

// The exec spec runner with the ratchet (specs/README.md), as the test suite of a repo: the
// core's and every agent's test/specs.test.ts is
//
//   import { assert, describe, it } from "@effect/vitest"
//   import { check } from "../scripts/specs/bindings"
//   import { specSuite } from "agent-core/scripts/specs/suite"
//   specSuite(check, { describe, it, fail: (message) => assert.fail(message) })
//
// Approved specs must match their recorded hashes. Red approved scenarios are the backlog,
// reported as todo; an approved scenario listed in specs/passing that is red fails
// (regression), and a green one not listed fails until pnpm spec:ratchet records it. Drafts
// run too and never block.

export interface TestApi {
  readonly describe: (name: string, body: () => void) => void
  readonly it: {
    (name: string, body: () => void): void
    readonly todo: (name: string) => void
  }
  readonly fail: (message: string) => never
}

export const specSuite = (check: Check, { describe, it, fail }: TestApi, root = process.cwd()) => {
  describe("specs/approved", () => {
    it("every approved spec matches its recorded hash", () => {
      const problems = approvalProblems(root)
      if (problems.length > 0) fail(problems.join("\n"))
    })
  })

  const passing = readPassing(root)
  const results = runAll(root, check)
  const verdicts = results.map((r) => verdict(r, passing))
  const greenDrafts: Array<string> = []

  for (const path of listSpecFiles(root)) {
    describe(path, () => {
      const status = readStatus(readSpec(root, path))
      if (typeof status !== "string") {
        it("has a status line", () => fail(`${path}: ${status.error}`))
        return
      }
      results.forEach((result, i) => {
        if (result.path !== path) return
        const v = verdicts[i]
        if (v === undefined) return
        const title = `${result.name} (line ${result.line})`
        const problem = verdictProblem(result, v)
        if (problem !== null) it(title, () => fail(problem))
        else if (v._tag === "Green") it(title, () => {})
        else if (v._tag === "Backlog") it.todo(`[approved, red] ${title}: ${v.red}`)
        else if (v._tag === "DraftRed") it.todo(`[draft, red] ${title}: ${v.red}`)
        else {
          greenDrafts.push(`${path}:${result.line} ${result.name}`)
          it(`[draft] ${title}`, () => {})
        }
      })
    })
  }

  describe("specs/passing", () => {
    it("names only existing approved scenarios", () => {
      const stale = staleEntries(results, passing)
      if (stale.length > 0) fail(stale.join("\n"))
    })
  })

  // Runs last and never fails: the summary line in the `pnpm check` output.
  it("exec spec summary", () => {
    const lines = [
      summary(tally(verdicts)),
      ...(greenDrafts.length > 0 ? ["green drafts, ready for human review:", ...greenDrafts] : [])
    ]
    console.log(lines.join("\n"))
  })
}
