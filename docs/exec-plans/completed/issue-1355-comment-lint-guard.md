# Issue #1355: Add a lint guard against spec-style comments in frontend source

Source: https://github.com/eq-lab/pipeline/issues/1355 (TD-54, epic #991 follow-up).
Branch: `feat/1355-comment-lint-guard`.

**Status: implemented (2026-10-20)** — all steps done; `lint-comments` green on the branch (0 errors, 1 debt warning), planted violations and a stale baseline entry each fail as designed, `lint-docs` green. See PR #1590.

## Scope

- `scripts/lint-comments.ts` (run with `npx tsx`, like `lint-docs.ts`) over `packages/frontend/src`,
  `packages/trustee/src`, `packages/ui/src` (`.ts`/`.tsx`, excluding `*.gen.ts` / `*.d.ts`),
  using the TypeScript scanner so only real comments are inspected (never string literals or JSX
  attributes such as `data-node-id="…"`). Two rules:
  1. **Header docblock** — the contiguous comment run before the first statement — longer than
     3 lines must contain a `spec:` pointer (`AGENTS.md`: one 2–3-line spec-pointer header).
  2. **Figma node ids** (`\d{3,}[:-]\d{3,}` as a standalone token) in any comment, except on
     `spec:` lines (doc anchors legitimately embed node ids).
- **Ratchet, not a flag day.** A survey of `main` found 211 files with a long spec-less header
  and many node-id comments (the pre-#991 style). `scripts/lint-comments.baseline.json` records
  today's offenders per file (header length without `spec:`, node-id comment count). The linter
  **errors** only on a file that is not in the baseline or that got worse than its entry; baseline
  files that improved shrink the baseline (`--update-baseline` rewrites it, and the lint fails when
  the baseline lists a file that is now clean or missing, so the debt can only go down).
- Wiring: root `yarn lint:comments`, `.husky/pre-commit` step after doc lint, `lint.yml` job,
  `AGENTS.md` lint rule, `docs/FRONTEND.md` rule 6 (the guard + how to pay the debt down),
  TD-54 resolved.

Out of scope: cleaning the existing 211 headers (tracked by the baseline itself; every touch of a
baselined file is expected to shrink or clear its entry), body-comment length rules.

## Assumptions and Risks

- Thresholds: header > 3 lines (the AGENTS rule's "2–3 lines"); node ids = zero tolerance for new
  ones. Both are constants at the top of the script.
- The scanner approach (`ts.getLeadingCommentRanges` / `getTrailingCommentRanges` over every node)
  is what ESLint would see; no new dependency (`typescript` is already a root dev dependency).
- The baseline is keyed by repo-relative path; a renamed file must re-earn a clean header (that is
  the intended ratchet, and `--update-baseline` makes an exception explicit in the diff).

## Open Questions

_None._

## Implementation Steps

1. `scripts/lint-comments.ts` with `--update-baseline`; generate `scripts/lint-comments.baseline.json`.
2. Wire `package.json`, `.husky/pre-commit`, `.github/workflows/lint.yml`.
3. Docs: `AGENTS.md`, `docs/FRONTEND.md` rule 6, TD-54.

## Test Strategy

`npx tsx scripts/lint-comments.ts` passes on the branch; a scratch violation (new file with a
7-line header, a `// Figma 1234:5678` comment) is reported and exits 1, then removed;
`npx tsx scripts/lint-docs.ts` green.

## Docs to Update

`AGENTS.md`, `docs/FRONTEND.md`, `docs/exec-plans/tech-debt-tracker.md` (TD-54).
