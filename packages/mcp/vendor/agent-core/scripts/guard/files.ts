import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Guarded files (AGENTS.md, "Tests"): every test file anywhere, the spec and
// guard tooling (scripts/, test/) and vitest.config.ts. Each must be listed in
// guarded.sha256 with its current hash: `<sha256>  <path>` per line, the format
// of `sha256sum`, so `shasum -a 256 -c guarded.sha256` checks it as well.
// Only a human adds or refreshes lines: pnpm tests:allow <path>.

export const guardFile = "guarded.sha256"

const skipped = new Set(["node_modules", ".git", "dist"])
const testDirs = new Set(["test", "tests", "__tests__"])
const testName = /\.(test|spec)\.[cm]?[jt]sx?$/

export const isGuarded = (path: string) => {
  const parts = path.split("/")
  const name = parts.at(-1) ?? ""
  return (
    path === "vitest.config.ts" ||
    parts[0] === "scripts" ||
    testName.test(name) ||
    parts.slice(0, -1).some((dir) => testDirs.has(dir))
  )
}

// Every guarded file on disk, repo-relative with forward slashes, sorted.
export const listGuarded = (root: string): ReadonlyArray<string> => {
  const walk = (dir: string): ReadonlyArray<string> =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      if (skipped.has(entry.name)) return []
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`
      if (entry.isDirectory()) return walk(path)
      return isGuarded(path) ? [path] : []
    })
  return [...walk("")].sort()
}

export const fileHash = (root: string, path: string) =>
  createHash("sha256")
    .update(readFileSync(join(root, path)))
    .digest("hex")

export interface Allowlist {
  readonly hashes: ReadonlyMap<string, string>
  readonly malformed: ReadonlyArray<string>
}

const line = /^([0-9a-f]{64}) {2}(\S.*)$/

export const readAllowlist = (root: string): Allowlist => {
  const file = join(root, guardFile)
  const text = existsSync(file) ? readFileSync(file, "utf8") : ""
  const hashes = new Map<string, string>()
  const malformed: Array<string> = []
  for (const l of text.split("\n")) {
    if (l.trim() === "") continue
    const match = line.exec(l)
    if (match?.[1] !== undefined && match[2] !== undefined) hashes.set(match[2], match[1])
    else malformed.push(l)
  }
  return { hashes, malformed }
}

export const writeAllowlist = (root: string, hashes: ReadonlyMap<string, string>) => {
  const lines = [...hashes].sort(([a], [b]) => a.localeCompare(b)).map(([p, h]) => `${h}  ${p}\n`)
  writeFileSync(join(root, guardFile), lines.join(""))
}

export const guardRule =
  "Agents must not write or edit tests; describe behaviour as a draft exec spec instead. " +
  "Owner updates allowlist with pnpm tests:allow <path>"

// Entries that are not files of the repo but are guarded the same way (a human records
// them with pnpm tests:allow <name>):
//   package.json#scripts  how the repo runs its checks (pnpm guard, check, test, ...).
// The legacy entry agent-core/scripts (hash of the installed core's tooling) is ignored: the
// pinned core is checked for provenance instead (guard/core.ts).
export const scriptsEntry = "package.json#scripts"
const legacyCoreEntry = "agent-core/scripts"

const digest = (parts: ReadonlyArray<string>) =>
  createHash("sha256").update(parts.join("\n")).digest("hex")

const scriptsHash = (root: string) => {
  const file = join(root, "package.json")
  const pkg = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as { readonly scripts?: Record<string, string> })
    : {}
  const scripts = pkg.scripts ?? {}
  return digest(
    Object.keys(scripts)
      .sort()
      .map((k) => `${k}=${scripts[k] ?? ""}`)
  )
}

// The entries that apply here, with their current hashes.
export const virtualEntries = (root: string): ReadonlyMap<string, string> =>
  new Map([[scriptsEntry, scriptsHash(root)]])

// Every problem that fails `pnpm check`, one sentence per file.
export const guardProblems = (
  root: string,
  virtual: ReadonlyMap<string, string> = new Map()
): ReadonlyArray<string> => {
  const { hashes, malformed } = readAllowlist(root)
  const problems = malformed.map(
    (l) => `${guardFile}: malformed line "${l}", expected "<sha256>  <path>"`
  )
  const files = listGuarded(root)
  for (const path of files) {
    const hash = hashes.get(path)
    if (hash === undefined) problems.push(`${path}: guarded file not in ${guardFile}`)
    else if (hash !== fileHash(root, path))
      problems.push(`${path}: changed (hash differs from ${guardFile})`)
  }
  for (const [name, hash] of virtual) {
    const recorded = hashes.get(name)
    if (recorded === undefined) problems.push(`${name}: guarded entry not in ${guardFile}`)
    else if (recorded !== hash) problems.push(`${name}: changed (hash differs from ${guardFile})`)
  }
  for (const path of hashes.keys()) {
    if (!files.includes(path) && !virtual.has(path) && path !== legacyCoreEntry)
      problems.push(`${guardFile}: ${path} is listed but does not exist`)
  }
  return problems
}
