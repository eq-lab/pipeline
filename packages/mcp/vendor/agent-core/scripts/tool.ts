import { existsSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  fileHash,
  guardFile,
  guardProblems,
  guardRule,
  isGuarded,
  readAllowlist,
  virtualEntries,
  writeAllowlist
} from "./guard/files"
import { coreProblems } from "./guard/core"
import {
  listSpecFiles,
  readApproved,
  readSpec,
  repoPath,
  setStatus,
  specHash,
  writeApproved
} from "./specs/files"
import { approveRefusal } from "./specs/classes"
import { fixtureExists } from "./specs/fixtures"
import { fixturePaths, parseBlocks } from "./specs/parse"
import { passingFile, ratchet, readPassing, runAll, writePassing } from "./specs/ratchet"
import type { Check } from "./specs/run"

// The spec and guard tooling of every agent (specs/README.md, AGENTS.md "Tests"), one copy
// in the core. An agent's package.json runs it from the installed core:
//
//   tsx node_modules/agent-core/scripts/tool.ts guard            pnpm guard
//   tsx node_modules/agent-core/scripts/tool.ts approve <spec>   pnpm spec:approve (human)
//   tsx node_modules/agent-core/scripts/tool.ts ratchet          pnpm spec:ratchet
//   tsx node_modules/agent-core/scripts/tool.ts ratchet-flex     pnpm spec:ratchet-flex
//   tsx node_modules/agent-core/scripts/tool.ts allow <path>     pnpm tests:allow (human)
//
// The repo is the working directory. What the specs run against is the repo's
// scripts/specs/bindings.ts (`export const check = makeCheck({...})`), a guarded file.

const bindingsFile = "scripts/specs/bindings.ts"

const loadCheck = async (root: string): Promise<Check> => {
  const file = join(root, bindingsFile)
  if (!existsSync(file)) throw new Error(`${bindingsFile}: not found in ${root}`)
  const module = (await import(pathToFileURL(file).href)) as { readonly check?: Check }
  if (typeof module.check !== "function") throw new Error(`${bindingsFile}: no exported check`)
  return module.check
}

// The tooling itself, when it runs from an installed core: the core's guarded files under
// scripts/ must match the hashes the core ships (an edited node_modules copy fails).
const coreRoot = fileURLToPath(new URL("..", import.meta.url))
const installedCore = (root: string) => (resolve(coreRoot) === resolve(root) ? null : coreRoot)
const installedProblems = (root: string): ReadonlyArray<string> => {
  if (installedCore(root) === null) return []
  const { hashes } = readAllowlist(coreRoot)
  return [...hashes]
    .filter(([path]) => path.startsWith("scripts/"))
    .flatMap(([path, hash]) =>
      !existsSync(join(coreRoot, path))
        ? [`agent-core/${path}: missing from the installed core`]
        : fileHash(coreRoot, path) !== hash
          ? [`agent-core/${path}: differs from the core's ${guardFile}; reinstall the core`]
          : []
    )
}

// pnpm guard  The first step of pnpm check: tests and the spec tooling match the hashes a
// human recorded in guarded.sha256.
const guard = (root: string): number => {
  const problems = [
    ...installedProblems(root),
    ...(installedCore(root) === null ? [] : coreProblems(root)),
    ...guardProblems(root, virtualEntries(root))
  ]
  if (problems.length > 0) {
    console.error(
      [`${guardFile}: guarded files differ.`, ...problems.map((p) => `  ${p}`), guardRule].join(
        "\n"
      )
    )
    return 1
  }
  console.log(`${guardFile}: guarded files match`)
  return 0
}

// pnpm tests:allow <path>...  A human command: records the current hash of a guarded file
// (a test or spec tooling) or entry (package.json#scripts) in
// guarded.sha256, or drops the line of a file that no longer exists. Agents never run it.
const allow = (root: string, args: ReadonlyArray<string>): number => {
  if (args.length === 0) {
    console.error("usage: pnpm tests:allow <path>...")
    return 2
  }
  const hashes = new Map(readAllowlist(root).hashes)
  const virtual = virtualEntries(root)
  let failed = false
  for (const arg of args) {
    const entry = virtual.get(arg)
    if (entry !== undefined) {
      hashes.set(arg, entry)
      console.log(`allowed ${arg}`)
      continue
    }
    const path = repoPath(root, resolve(root, arg))
    if (!existsSync(resolve(root, path))) {
      if (hashes.delete(path)) console.log(`removed ${path}`)
      else {
        console.error(`${arg}: no such file`)
        failed = true
      }
    } else if (!isGuarded(path)) {
      console.error(`${path}: not a guarded file, nothing to allow`)
      failed = true
    } else {
      hashes.set(path, fileHash(root, path))
      console.log(`allowed ${path}`)
    }
  }
  writeAllowlist(root, hashes)
  return failed ? 1 : 0
}

// pnpm spec:approve <path>...  A human command: marks the specs approved and records their
// hashes in specs/approved. Agents never run it.
const approve = (root: string, args: ReadonlyArray<string>, check: Check): number => {
  if (args.length === 0) {
    console.error("usage: pnpm spec:approve specs/<area>/<topic>.md ...")
    return 2
  }
  const files = listSpecFiles(root)
  const hashes = new Map(readApproved(root).hashes)
  let failed = false
  for (const arg of args) {
    const path = repoPath(root, resolve(root, arg))
    if (approveRefusal(path) !== null) {
      console.error(`${path}: class B (specs/flex/), no approval needed: the agent edits it`)
      failed = true
      continue
    }
    if (!files.includes(path)) {
      console.error(`${arg}: not a spec file under specs/`)
      failed = true
      continue
    }
    const blocks = parseBlocks(readSpec(root, path))
    const invalid = [
      ...blocks.flatMap((b) =>
        "error" in b.scenario ? [`  line ${b.line}: ${b.scenario.error}`] : []
      ),
      ...fixturePaths(blocks)
        .filter((f) => !fixtureExists(root, f))
        .map((f) => `  fixture ${f} not found`)
    ]
    if (invalid.length > 0 || blocks.length === 0) {
      console.error(
        `${path}: not approved, fix it first:\n${invalid.join("\n") || "  no spec blocks"}`
      )
      failed = true
      continue
    }
    const text = setStatus(readSpec(root, path), "approved")
    writeFileSync(resolve(root, path), text)
    hashes.set(path, specHash(root, path, text))
    const red = blocks.filter((b) => check(b, root) !== null).length
    console.log(
      `approved ${path}${red > 0 ? ` (${red} of ${blocks.length} scenarios red: backlog until green)` : ""}`
    )
  }
  writeApproved(root, hashes)
  return failed ? 1 : 0
}

// pnpm spec:ratchet  Records every green approved scenario in specs/passing. Idempotent;
// never removes lines. Agents run it after making scenarios green and commit specs/passing.
// pnpm spec:ratchet-flex  The same for specs/flex/ only (class B), which agents may run: adds
// green flex scenarios, prunes flex lines without a scenario, leaves every class A line as is.
const ratchetPassing = (root: string, check: Check, flexOnly = false): number => {
  const passing = readPassing(root)
  const next = ratchet(runAll(root, check), passing, flexOnly)
  writePassing(root, next)
  const added = next.filter((id) => !passing.has(id))
  console.log(
    added.length === 0
      ? `${passingFile}: nothing to add (${next.length} scenarios recorded)`
      : [`${passingFile}: added ${added.length}`, ...added.map((id) => `  ${id}`)].join("\n")
  )
  return 0
}

const main = async (argv: ReadonlyArray<string>): Promise<number> => {
  const root = process.cwd()
  const [command, ...args] = argv
  switch (command) {
    case "guard":
      return guard(root)
    case "allow":
      return allow(root, args)
    case "ratchet-flex":
      return ratchetPassing(root, await loadCheck(root), true)
    case "approve":
      return approve(root, args, await loadCheck(root))
    case "ratchet":
      return ratchetPassing(root, await loadCheck(root))
    default:
      console.error(
        "usage: tool.ts guard | allow <path>... | approve <spec>... | ratchet | ratchet-flex"
      )
      return 2
  }
}

// Always the command line (never imported): an installed core is reached through a symlink,
// so a "run as main" test on the path would silently skip the guard.
process.exitCode = await main(process.argv.slice(2))
