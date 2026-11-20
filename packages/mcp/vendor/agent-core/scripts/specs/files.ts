import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { type ClassCode, type ClassFile, classProblems, flexDir } from "./classes"
import { fixtureExists, readFixtureText } from "./fixtures"
import { fixturePaths, fixturesDir, parseBlocks } from "./parse"

// Spec files on disk, their status line and the approval hashes
// (specs/README.md, "Статусы"). Paths are repo-relative with forward slashes.

export const specsDir = "specs"
export const approvedFile = "specs/approved"

export type Status = "draft" | "approved"

const toPosix = (path: string) => path.split(sep).join("/")

export const listSpecFiles = (root: string): ReadonlyArray<string> => {
  const walk = (dir: string): ReadonlyArray<string> =>
    readdirSync(join(root, dir), { withFileTypes: true })
      .flatMap((entry) => {
        const path = `${dir}/${entry.name}`
        if (entry.isDirectory()) return walk(path)
        return entry.isFile() && entry.name.endsWith(".md") ? [path] : []
      })
      .filter((path) => path !== `${specsDir}/README.md` && !path.startsWith(`${fixturesDir}/`))
  return [...walk(specsDir)].sort()
}

export const repoPath = (root: string, path: string) => toPosix(relative(root, path))

export const readSpec = (root: string, path: string) => readFileSync(join(root, path), "utf8")

const statusLine = /^Status: (\S+)\s*$/

// The first non-empty line of every spec file is its status.
export const readStatus = (text: string): Status | { readonly error: string } => {
  const first = text.split("\n").find((line) => line.trim() !== "") ?? ""
  const value = statusLine.exec(first)?.[1]
  if (value === "draft" || value === "approved") return value
  return { error: `the first line must be "Status: draft" or "Status: approved", got "${first}"` }
}

export const setStatus = (text: string, status: Status): string => {
  const lines = text.split("\n")
  const index = lines.findIndex((line) => line.trim() !== "")
  if (index >= 0 && statusLine.test(lines[index] ?? "")) {
    lines[index] = `Status: ${status}`
    return lines.join("\n")
  }
  return `Status: ${status}\n\n${text}`
}

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")

// The approval hash of a spec covers the fixtures its adapter scenarios
// reference: a spec without fixtures hashes as its text alone (so
// `shasum -a 256 -c specs/approved` checks it); with fixtures, the text is
// followed by `\n--- <path>\n<content>` per fixture in path order (a missing
// fixture hashes as "<missing>").
export const specHash = (root: string, path: string, text: string = readSpec(root, path)) => {
  const fixtures = fixturePaths(parseBlocks(text))
  if (fixtures.length === 0) return sha256(text)
  return sha256(
    text +
      fixtures
        .map((f) => `\n--- ${f}\n${fixtureExists(root, f) ? readFixtureText(root, f) : "<missing>"}`)
        .join("")
  )
}

// `specs/approved`: one `<sha256>  <path>` per line, the format of `sha256sum`.
export interface Approved {
  readonly hashes: ReadonlyMap<string, string>
  readonly malformed: ReadonlyArray<string>
}

const approvedLine = /^([0-9a-f]{64}) {2}(\S.*)$/

export const readApproved = (root: string): Approved => {
  const file = join(root, approvedFile)
  const text = existsSync(file) ? readFileSync(file, "utf8") : ""
  const hashes = new Map<string, string>()
  const malformed: Array<string> = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    const match = approvedLine.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) hashes.set(match[2], match[1])
    else malformed.push(line)
  }
  return { hashes, malformed }
}

export const writeApproved = (root: string, hashes: ReadonlyMap<string, string>) => {
  const lines = [...hashes].sort(([a], [b]) => a.localeCompare(b)).map(([p, h]) => `${h}  ${p}`)
  writeFileSync(join(root, approvedFile), lines.map((line) => `${line}\n`).join(""))
}

// Every problem that must fail `pnpm check`, as a sentence a human can act on. Specs under
// specs/flex/ (class B, scripts/specs/classes.ts) need no hash: agents edit them.
export const approvalProblems = (root: string): ReadonlyArray<string> => {
  const { hashes, malformed } = readApproved(root)
  const problems: Array<string> = malformed.map(
    (line) => `${approvedFile}: malformed line "${line}", expected "<sha256>  <path>"`
  )
  const paths = listSpecFiles(root)
  const files: Array<ClassFile> = []
  for (const path of paths) {
    const text = readSpec(root, path)
    const status = readStatus(text)
    if (typeof status !== "string") problems.push(`${path}: ${status.error}`)
    const recorded = hashes.get(path)
    files.push({
      path,
      status: status === "approved" ? "approved" : "draft",
      hash:
        recorded === undefined
          ? "none"
          : recorded === specHash(root, path, text)
            ? "match"
            : "differs"
    })
  }
  const messages: Record<ClassCode, (path: string) => string> = {
    unapproved: (path) =>
      `${path}: Status: approved, but no hash in ${approvedFile}. ` +
      `Only a human approves: pnpm spec:approve ${path}`,
    changed: (path) =>
      `${path}: changed after approval, or a fixture it references did (hash differs from ${approvedFile}). ` +
      `Approved specs change only with a new approval: revert the change, ` +
      `or a human reviews it and runs pnpm spec:approve ${path}`,
    class_mismatch: (path) =>
      `${path}: under ${flexDir}/ (class B, no approval) but listed in ${approvedFile}. ` +
      `Only the owner moves a spec between classes`,
    listed_missing: (path) => `${approvedFile}: ${path} is listed but does not exist`,
    listed_not_approved: (path) =>
      `${path}: listed in ${approvedFile}, but its status is not approved`,
    stale_passing: (path) => `${path}: stale line in specs/passing`,
    regression: (path) => `${path}: regression`
  }
  const approved = [...hashes.keys()]
  for (const { path, code } of classProblems({ files, approved }))
    problems.push(messages[code](path))
  return problems
}
