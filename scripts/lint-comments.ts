/**
 * Comment linter — guards docs/FRONTEND.md rule 6 ("comments describe code;
 * specs describe behavior") in the three UI packages. Ratchets against
 * scripts/lint-comments.baseline.json: errors only on new or worsened files.
 */

import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BASELINE_PATH = resolve(__dirname, "lint-comments.baseline.json");
const PACKAGES = [
  "packages/frontend/src",
  "packages/trustee/src",
  "packages/ui/src",
];
const MAX_HEADER_LINES_WITHOUT_SPEC = 3;
const SPEC_POINTER = /\bspec:/i;
const FIGMA_NODE_ID = /(^|[\s(\[`'"])(\d{3,}[:-]\d{3,})(?=$|[\s)\]`'".,;])/g;

interface FileFinding {
  header: number;
  nodeIds: number;
}

type Baseline = Record<string, FileFinding>;

let errors = 0;
let warnings = 0;

function error(msg: string) {
  console.log(`  ERROR: ${msg}`);
  errors++;
}

function warn(msg: string) {
  console.log(`  WARN: ${msg}`);
  warnings++;
}

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(gen|d)\.ts$/.test(entry))
      out.push(path);
  }
}

interface Comment {
  pos: number;
  end: number;
  text: string;
  line: number;
}

function collectComments(sourceFile: ts.SourceFile, text: string): Comment[] {
  const seen = new Set<number>();
  const comments: Comment[] = [];
  const push = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      comments.push({
        pos: range.pos,
        end: range.end,
        text: text.slice(range.pos, range.end),
        line: sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1,
      });
    }
  };
  const visit = (node: ts.Node) => {
    push(ts.getLeadingCommentRanges(text, node.getFullStart()));
    push(ts.getTrailingCommentRanges(text, node.getEnd()));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  push(
    ts.getLeadingCommentRanges(text, sourceFile.endOfFileToken.getFullStart()),
  );
  return comments.sort((a, b) => a.pos - b.pos);
}

interface Analysis extends FileFinding {
  nodeIdLines: Array<{ line: number; id: string }>;
}

function analyse(path: string): Analysis {
  const text = readFileSync(path, "utf-8");
  const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const comments = collectComments(sourceFile, text);
  const firstStatement = sourceFile.statements[0];
  const firstStart = firstStatement
    ? firstStatement.getStart(sourceFile)
    : text.length;
  const header = comments.filter((comment) => comment.end <= firstStart);
  const headerLines = header.reduce(
    (n, comment) => n + comment.text.split("\n").length,
    0,
  );
  const headerHasSpec = header.some((comment) =>
    SPEC_POINTER.test(comment.text),
  );
  const nodeIdLines: Array<{ line: number; id: string }> = [];
  for (const comment of comments) {
    comment.text.split("\n").forEach((lineText, offset) => {
      if (SPEC_POINTER.test(lineText)) return;
      for (const match of lineText.matchAll(FIGMA_NODE_ID)) {
        nodeIdLines.push({ line: comment.line + offset, id: match[2]! });
      }
    });
  }
  return {
    header:
      !headerHasSpec && headerLines > MAX_HEADER_LINES_WITHOUT_SPEC
        ? headerLines
        : 0,
    nodeIds: nodeIdLines.length,
    nodeIdLines,
  };
}

function readBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) return {};
  return JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as Baseline;
}

function run() {
  const updateBaseline = process.argv.includes("--update-baseline");
  const files: string[] = [];
  for (const pkg of PACKAGES) {
    const dir = resolve(ROOT, pkg);
    if (existsSync(dir)) walk(dir, files);
  }
  const baseline = readBaseline();
  const next: Baseline = {};
  let debtHeaders = 0;
  let debtNodeIds = 0;

  console.log("=== Comment Lint ===");
  console.log(`\n-- ${files.length} files in ${PACKAGES.join(", ")} --`);

  for (const path of files.sort()) {
    const rel = relative(ROOT, path);
    const found = analyse(path);
    if (found.header === 0 && found.nodeIds === 0) continue;
    next[rel] = { header: found.header, nodeIds: found.nodeIds };
    const known = baseline[rel];
    const headerWorse =
      found.header > 0 && (!known || found.header > known.header);
    const nodeIdsWorse =
      found.nodeIds > 0 && (!known || found.nodeIds > known.nodeIds);
    if (headerWorse && !updateBaseline) {
      error(
        `${rel}: header docblock is ${found.header} lines with no \`spec:\` pointer (max ${MAX_HEADER_LINES_WITHOUT_SPEC} without one${known ? `; baseline ${known.header}` : ""}). Move the description into docs/frontend/ and leave a one-line \`// spec: docs/frontend/<doc>.md#<section>\`.`,
      );
    }
    if (nodeIdsWorse && !updateBaseline) {
      const fresh = found.nodeIdLines.slice(known ? known.nodeIds : 0);
      for (const hit of fresh) {
        error(
          `${rel}:${hit.line}: Figma node id ${hit.id} in a comment. Figma bindings belong in the spec (docs/frontend/*.md); reference them from code only via a \`spec:\` pointer.`,
        );
      }
    }
    if (found.header > 0 && !headerWorse) debtHeaders++;
    if (found.nodeIds > 0 && !nodeIdsWorse) debtNodeIds += found.nodeIds;
  }

  for (const rel of Object.keys(baseline)) {
    const known = baseline[rel]!;
    const now = next[rel];
    const stale =
      !now ||
      (known.header > 0 && now.header < known.header) ||
      (known.nodeIds > 0 && now.nodeIds < known.nodeIds);
    if (stale && !updateBaseline) {
      error(
        `${rel}: baseline entry is stale (file improved or moved). Run \`npx tsx scripts/lint-comments.ts --update-baseline\` and commit the shrunken baseline.`,
      );
    }
  }

  if (updateBaseline) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`  OK: baseline written (${Object.keys(next).length} files)`);
  } else {
    if (debtHeaders > 0 || debtNodeIds > 0) {
      warn(
        `baseline debt: ${debtHeaders} spec-less header docblocks, ${debtNodeIds} Figma node-id comments (see scripts/lint-comments.baseline.json; shrink it when you touch those files)`,
      );
    }
    if (errors === 0) console.log("  OK: no new spec-style comments");
  }

  console.log(`\n=== Results: ${errors} errors, ${warnings} warnings ===`);
  if (errors > 0) process.exit(1);
}

run();
