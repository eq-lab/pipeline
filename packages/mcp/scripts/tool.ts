// Spec and guard commands of packages/mcp (specs/README.md, "Runner"): guard
// and tests:allow on the package, spec:approve and spec:ratchet on specs/.
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fileHash,
  guardFile,
  guardProblems,
  guardRule,
  isGuarded,
  readAllowlist,
  virtualEntries,
  writeAllowlist,
} from "./guard/files.js";
import { check } from "./specs/bindings.js";
import { approveRefusal } from "./specs/classes.js";
import {
  listSpecFiles,
  readApproved,
  readSpec,
  repoPath,
  repoRoot,
  setStatus,
  specHash,
  writeApproved,
} from "./specs/files.js";
import { fixtureExists } from "./specs/fixtures.js";
import { fixturePaths, parseBlocks } from "./specs/parse.js";
import {
  passingFile,
  ratchet,
  readPassing,
  runAll,
  writePassing,
} from "./specs/ratchet.js";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const guard = (root: string): number => {
  const problems = guardProblems(root, virtualEntries(root));
  if (problems.length > 0) {
    console.error(
      [
        `${guardFile}: guarded files differ.`,
        ...problems.map((p) => `  ${p}`),
        guardRule,
      ].join("\n"),
    );
    return 1;
  }
  console.log(`${guardFile}: guarded files match`);
  return 0;
};

const allow = (root: string, args: ReadonlyArray<string>): number => {
  if (args.length === 0) {
    console.error("usage: yarn workspace @pipeline/mcp tests:allow <path>...");
    return 2;
  }
  const hashes = new Map(readAllowlist(root).hashes);
  const virtual = virtualEntries(root);
  let failed = false;
  for (const arg of args) {
    const entry = virtual.get(arg);
    if (entry !== undefined) {
      hashes.set(arg, entry);
      console.log(`allowed ${arg}`);
      continue;
    }
    const path = repoPath(root, resolve(root, arg));
    if (!existsSync(resolve(root, path))) {
      if (hashes.delete(path)) console.log(`removed ${path}`);
      else {
        console.error(`${arg}: no such file`);
        failed = true;
      }
    } else if (!isGuarded(path)) {
      console.error(`${path}: not a guarded file, nothing to allow`);
      failed = true;
    } else {
      hashes.set(path, fileHash(root, path));
      console.log(`allowed ${path}`);
    }
  }
  writeAllowlist(root, hashes);
  return failed ? 1 : 0;
};

const approve = (root: string, args: ReadonlyArray<string>): number => {
  if (args.length === 0) {
    console.error("usage: yarn spec:approve specs/<area>/<topic>.md ...");
    return 2;
  }
  const files = listSpecFiles(root);
  const hashes = new Map(readApproved(root).hashes);
  let failed = false;
  for (const arg of args) {
    const path = repoPath(root, resolve(root, arg));
    if (approveRefusal(path) !== null) {
      console.error(
        `${path}: class B (specs/flex/), no approval needed: the agent edits it`,
      );
      failed = true;
      continue;
    }
    if (!files.includes(path)) {
      console.error(`${arg}: not a spec file under specs/`);
      failed = true;
      continue;
    }
    const blocks = parseBlocks(readSpec(root, path));
    const invalid = [
      ...blocks.flatMap((b) =>
        "error" in b.scenario
          ? [`  line ${String(b.line)}: ${b.scenario.error}`]
          : [],
      ),
      ...fixturePaths(blocks)
        .filter((f) => !fixtureExists(root, f))
        .map((f) => `  fixture ${f} not found`),
    ];
    if (invalid.length > 0 || blocks.length === 0) {
      console.error(
        `${path}: not approved, fix it first:\n${invalid.join("\n") || "  no spec blocks"}`,
      );
      failed = true;
      continue;
    }
    const text = setStatus(readSpec(root, path), "approved");
    writeFileSync(resolve(root, path), text);
    hashes.set(path, specHash(root, path, text));
    const red = blocks.filter((b) => check(b, root) !== null).length;
    console.log(
      `approved ${path}${red > 0 ? ` (${String(red)} of ${String(blocks.length)} scenarios red: backlog until green)` : ""}`,
    );
  }
  writeApproved(root, hashes);
  return failed ? 1 : 0;
};

const ratchetPassing = (root: string, flexOnly = false): number => {
  const passing = readPassing(root);
  const next = ratchet(runAll(root, check), passing, flexOnly);
  writePassing(root, next);
  const added = next.filter((id) => !passing.has(id));
  console.log(
    added.length === 0
      ? `${passingFile}: nothing to add (${String(next.length)} scenarios recorded)`
      : [
          `${passingFile}: added ${String(added.length)}`,
          ...added.map((id) => `  ${id}`),
        ].join("\n"),
  );
  return 0;
};

const main = (argv: ReadonlyArray<string>): number => {
  const [command, ...args] = argv;
  switch (command) {
    case "guard":
      return guard(packageRoot);
    case "allow":
      return allow(packageRoot, args);
    case "approve":
      return approve(repoRoot, args);
    case "ratchet":
      return ratchetPassing(repoRoot);
    case "ratchet-flex":
      return ratchetPassing(repoRoot, true);
    default:
      console.error(
        "usage: tool.ts guard | allow <path>... | approve <spec>... | ratchet | ratchet-flex",
      );
      return 2;
  }
};

process.exitCode = main(process.argv.slice(2));
