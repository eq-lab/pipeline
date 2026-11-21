// The spec runner with the ratchet as a test suite (specs/README.md, "Ratchet"),
// run by test/specs.test.ts.
import {
  approvalProblems,
  listSpecFiles,
  readSpec,
  readStatus,
} from "./files.js";
import {
  readPassing,
  runAll,
  staleEntries,
  summary,
  tally,
  verdict,
  verdictProblem,
} from "./ratchet.js";
import type { Check } from "./run.js";

export interface TestApi {
  readonly describe: (name: string, body: () => void) => void;
  readonly it: {
    (name: string, body: () => void): void;
    readonly todo: (name: string) => void;
  };
  readonly fail: (message: string) => never;
}

export const specSuite = (
  check: Check,
  { describe, it, fail }: TestApi,
  root = process.cwd(),
) => {
  describe("specs/approved", () => {
    it("every approved spec matches its recorded hash", () => {
      const problems = approvalProblems(root);
      if (problems.length > 0) fail(problems.join("\n"));
    });
  });

  const passing = readPassing(root);
  const results = runAll(root, check);
  const verdicts = results.map((r) => verdict(r, passing));
  const greenDrafts: Array<string> = [];

  for (const path of listSpecFiles(root)) {
    describe(path, () => {
      const status = readStatus(readSpec(root, path));
      if (typeof status !== "string") {
        it("has a status line", () => fail(`${path}: ${status.error}`));
        return;
      }
      results.forEach((result, i) => {
        if (result.path !== path) return;
        const v = verdicts[i];
        if (v === undefined) return;
        const line = String(result.line);
        const title = `${result.name} (line ${line})`;
        const problem = verdictProblem(result, v);
        if (problem !== null) it(title, () => fail(problem));
        else if (v._tag === "Green") it(title, () => {});
        else if (v._tag === "Backlog")
          it.todo(`[approved, red] ${title}: ${v.red}`);
        else if (v._tag === "DraftRed")
          it.todo(`[draft, red] ${title}: ${v.red}`);
        else {
          greenDrafts.push(`${path}:${line} ${result.name}`);
          it(`[draft] ${title}`, () => {});
        }
      });
    });
  }

  describe("specs/passing", () => {
    it("names only existing approved scenarios", () => {
      const stale = staleEntries(results, passing);
      if (stale.length > 0) fail(stale.join("\n"));
    });
  });

  it("exec spec summary", () => {
    const lines = [
      summary(tally(verdicts)),
      ...(greenDrafts.length > 0
        ? ["green drafts, ready for human review:", ...greenDrafts]
        : []),
    ];
    console.log(lines.join("\n"));
  });
};
