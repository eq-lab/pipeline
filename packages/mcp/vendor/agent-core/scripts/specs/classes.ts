// Spec classes (specs/tooling/spec-classes.md). Class A is every spec outside
// `specs/flex/`: approved by a human, hash in specs/approved. Class B is everything
// under `specs/flex/`: an agent edits it in the same PR as the code, there is no hash.
// Pure: the file and ratchet tooling and the `spec-classes` adapter share it.

export const flexDir = "specs/flex"

export const isFlexSpec = (path: string) => path.startsWith(`${flexDir}/`)

// Why `pnpm spec:approve <path>` refuses a path, or null when it may go on.
export const approveRefusal = (path: string): string | null =>
  isFlexSpec(path) ? "class_b_not_approved" : null

// The hash of a spec file against specs/approved: no line, same, or different.
export type HashState = "match" | "differs" | "none"

export interface ClassFile {
  readonly path: string
  readonly status: "draft" | "approved"
  readonly hash: HashState
}

export interface ClassScenario {
  readonly path: string
  readonly name: string
  readonly red?: boolean | undefined
}

export type ClassCode =
  | "changed"
  | "unapproved"
  | "class_mismatch"
  | "listed_missing"
  | "listed_not_approved"
  | "stale_passing"
  | "regression"

export interface ClassProblem {
  readonly path: string
  readonly code: ClassCode
}

export interface ClassInput {
  readonly files: ReadonlyArray<ClassFile>
  // paths listed in specs/approved
  readonly approved: ReadonlyArray<string>
  // approved scenarios (and their verdict), when stale and regression lines are checked
  readonly scenarios?: ReadonlyArray<ClassScenario> | undefined
  // lines `<path>#<heading>` of specs/passing
  readonly passing?: ReadonlyArray<string> | undefined
}

export const classProblems = (input: ClassInput): ReadonlyArray<ClassProblem> => {
  const listed = new Set(input.approved)
  const problems: Array<ClassProblem> = []
  const add = (path: string, code: ClassCode) => {
    if (!problems.some((p) => p.path === path && p.code === code)) problems.push({ path, code })
  }
  for (const file of input.files) {
    if (isFlexSpec(file.path)) {
      if (listed.has(file.path)) add(file.path, "class_mismatch")
    } else if (file.status === "approved") {
      if (file.hash === "none") add(file.path, "unapproved")
      else if (file.hash === "differs") add(file.path, "changed")
    } else if (listed.has(file.path)) add(file.path, "listed_not_approved")
  }
  const existing = new Set(input.files.map((f) => f.path))
  for (const path of input.approved) if (!existing.has(path)) add(path, "listed_missing")
  if (input.scenarios !== undefined || input.passing !== undefined) {
    const scenarios = new Map((input.scenarios ?? []).map((s) => [`${s.path}#${s.name}`, s]))
    for (const id of input.passing ?? []) {
      const path = id.slice(0, id.indexOf("#"))
      const scenario = scenarios.get(id)
      if (scenario === undefined) {
        if (!isFlexSpec(path)) add(path, "stale_passing")
      } else if (scenario.red === true) add(path, "regression")
    }
  }
  return problems
}
