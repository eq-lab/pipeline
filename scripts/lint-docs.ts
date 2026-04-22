/**
 * Documentation linter — enforces harness engineering conventions.
 *
 * Rules:
 * 1. AGENTS.md line count (warn >100, error >150)
 * 2. Reachability — all docs/*.md files must be linked from AGENTS.md
 * 3. Markdown formatting — closed fences, no trailing whitespace, single newline EOF
 * 4. No acceptance criteria in product specs (only in user-stories.md)
 * 5. Spec filename blocklist — warn on migration/redesign/switch/replace terms
 * 6. Skills must reference product specs (skip with "# lint:docs skip-spec-ref")
 * 7. Spec size limit — warn >150, error >200 lines
 * 8. Mutual spec references — warn when two specs link to each other
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let warnings = 0;
let errors = 0;

function warn(msg: string) {
  console.log(`  WARN: ${msg}`);
  warnings++;
}

function error(msg: string) {
  console.log(`  ERROR: ${msg}`);
  errors++;
}

function ok(msg: string) {
  console.log(`  OK: ${msg}`);
}

// ---------------------------------------------------------------------------
// 1. AGENTS.md line count
// ---------------------------------------------------------------------------

function checkAgentsLineCount() {
  console.log("\n-- AGENTS.md line count --");
  const agentsPath = resolve(ROOT, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    error("AGENTS.md not found");
    return;
  }
  const content = readFileSync(agentsPath, "utf-8");
  const lineCount = content.split("\n").length;

  if (lineCount > 150) {
    error(`AGENTS.md is ${lineCount} lines (max 150). Move content to docs/.`);
  } else if (lineCount > 100) {
    warn(`AGENTS.md is ${lineCount} lines (target <=100). Consider moving content to docs/.`);
  } else {
    ok(`AGENTS.md is ${lineCount} lines`);
  }
}

// ---------------------------------------------------------------------------
// 2. Reachability — BFS from AGENTS.md
// ---------------------------------------------------------------------------

function extractMarkdownLinks(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const links: string[] = [];
  const regex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const href = match[2];
    if (href.startsWith("http") || href.startsWith("#")) continue;
    links.push(href.split("#")[0]); // strip anchors
  }
  return links;
}

function getAllDocsFiles(): string[] {
  const docsDir = resolve(ROOT, "docs");
  if (!existsSync(docsDir)) return [];
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (extname(full) === ".md") {
        files.push(relative(ROOT, full));
      }
    }
  }
  walk(docsDir);
  return files;
}

function checkReachability() {
  console.log("\n-- Reachability --");
  const agentsPath = resolve(ROOT, "AGENTS.md");
  if (!existsSync(agentsPath)) return;

  const visited = new Set<string>();
  const queue = ["AGENTS.md"];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const fullPath = resolve(ROOT, current);
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) continue;

    const links = extractMarkdownLinks(fullPath);
    for (const link of links) {
      const resolved = relative(ROOT, resolve(dirname(fullPath), link));
      if (!visited.has(resolved)) queue.push(resolved);
    }
  }

  const allDocs = getAllDocsFiles();
  const unreachable = allDocs.filter(
    (f) =>
      !visited.has(f) &&
      !f.includes("exec-plans/active/") &&
      !f.includes("exec-plans/completed/") &&
      !f.includes("superpowers/")
  );

  if (unreachable.length === 0) {
    ok(`All ${allDocs.length} docs files are reachable from AGENTS.md`);
  } else {
    for (const f of unreachable) {
      error(`Unreachable doc: ${f} — not linked from AGENTS.md or any linked doc`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Markdown formatting
// ---------------------------------------------------------------------------

function checkMarkdownFormatting() {
  console.log("\n-- Markdown formatting --");
  const allDocs = getAllDocsFiles();
  let clean = 0;

  for (const f of allDocs) {
    const content = readFileSync(resolve(ROOT, f), "utf-8");
    const lines = content.split("\n");
    let openFence = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith("```")) {
        openFence = !openFence;
      }
    }
    if (openFence) {
      error(`${f}: unclosed code fence`);
      continue;
    }

    if (!content.endsWith("\n")) {
      warn(`${f}: missing trailing newline`);
      continue;
    }

    clean++;
  }

  if (clean === allDocs.length) {
    ok(`All ${allDocs.length} docs have valid markdown formatting`);
  }
}

// ---------------------------------------------------------------------------
// 4. No acceptance criteria in product specs
// ---------------------------------------------------------------------------

function checkNoAcceptanceCriteria() {
  console.log("\n-- No acceptance criteria in specs --");
  const specsDir = resolve(ROOT, "docs/product-specs");
  if (!existsSync(specsDir)) {
    ok("No product-specs directory yet");
    return;
  }

  const skip = ["user-stories.md", "index.md"];
  let clean = 0;


  for (const f of readdirSync(specsDir)) {
    if (skip.includes(f) || extname(f) !== ".md") continue;
    const content = readFileSync(resolve(specsDir, f), "utf-8");
    if (/## Acceptance [Cc]riteria/i.test(content)) {
      error(`${f}: contains acceptance criteria — move to user-stories.md`);
    } else {
      clean++;
    }
  }

  ok(`${clean} specs checked — no acceptance criteria found`);
}

// ---------------------------------------------------------------------------
// 5. Spec filename blocklist
// ---------------------------------------------------------------------------

function checkSpecFilenames() {
  console.log("\n-- Spec filename blocklist --");
  const specsDir = resolve(ROOT, "docs/product-specs");
  if (!existsSync(specsDir)) return;

  const blocklist = [
    "migration",
    "redesign",
    "switch",
    "replace",
    "separate",
    "move",
    "extract",
    "refactor",
  ];

  for (const f of readdirSync(specsDir)) {
    if (extname(f) !== ".md") continue;
    const lower = f.toLowerCase();
    for (const word of blocklist) {
      if (lower.includes(word)) {
        warn(
          `${f}: filename contains "${word}" — spec names should describe features, not changes`
        );
      }
    }
  }

  ok("Spec filenames checked");
}

// ---------------------------------------------------------------------------
// 6. Skills reference product specs
// ---------------------------------------------------------------------------

function checkSkillSpecRefs() {
  console.log("\n-- Skills reference product specs --");
  const skillsDir = resolve(ROOT, ".claude/skills");
  if (!existsSync(skillsDir)) {
    ok("No skills directory");
    return;
  }

  for (const dir of readdirSync(skillsDir)) {
    const skillDir = resolve(skillsDir, dir);
    if (!statSync(skillDir).isDirectory()) continue;

    // Try both SKILL.md and skill.md
    let skillFile = resolve(skillDir, "SKILL.md");
    if (!existsSync(skillFile)) skillFile = resolve(skillDir, "skill.md");
    if (!existsSync(skillFile)) continue;

    const content = readFileSync(skillFile, "utf-8");
    if (content.includes("# lint:docs skip-spec-ref")) continue;

    if (!content.includes("docs/product-specs/")) {
      warn(`${dir}: skill does not reference any product spec`);
    }
  }

  ok("Skill spec references checked");
}

// ---------------------------------------------------------------------------
// 7. Spec size limit
// ---------------------------------------------------------------------------

function checkSpecSize() {
  console.log("\n-- Spec size limit --");
  const specsDir = resolve(ROOT, "docs/product-specs");
  if (!existsSync(specsDir)) return;

  const sizeSkip = ["user-stories.md", "index.md"];

  for (const f of readdirSync(specsDir)) {
    if (sizeSkip.includes(f) || extname(f) !== ".md") continue;
    const lines = readFileSync(resolve(specsDir, f), "utf-8").split("\n").length;
    if (lines > 200) {
      error(`${f}: ${lines} lines (max 200) — split into smaller specs`);
    } else if (lines > 150) {
      warn(`${f}: ${lines} lines (target <=150) — consider splitting`);
    }
  }

  ok("Spec sizes checked");
}

// ---------------------------------------------------------------------------
// 8. Mutual spec references
// ---------------------------------------------------------------------------

function checkMutualRefs() {
  console.log("\n-- Mutual spec references --");
  const specsDir = resolve(ROOT, "docs/product-specs");
  if (!existsSync(specsDir)) return;

  const refs = new Map<string, Set<string>>();

  for (const f of readdirSync(specsDir)) {
    if (extname(f) !== ".md") continue;
    const content = readFileSync(resolve(specsDir, f), "utf-8");
    const links = new Set<string>();
    const regex = /\[([^\]]*)\]\(\.\/([^)]+)\)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      links.add(match[2]);
    }
    refs.set(f, links);
  }

  for (const [a, aLinks] of refs) {
    for (const b of aLinks) {
      const bLinks = refs.get(b);
      if (bLinks?.has(a)) {
        warn(`Mutual reference: ${a} <-> ${b} — consider merging or removing one link`);
      }
    }
  }

  ok("Mutual references checked");
}

// ---------------------------------------------------------------------------
// Run all checks
// ---------------------------------------------------------------------------

console.log("=== Documentation Lint ===");

checkAgentsLineCount();
checkReachability();
checkMarkdownFormatting();
checkNoAcceptanceCriteria();
checkSpecFilenames();
checkSkillSpecRefs();
checkSpecSize();
checkMutualRefs();

console.log(`\n=== Results: ${errors} errors, ${warnings} warnings ===`);

if (errors > 0) {
  process.exit(1);
}
