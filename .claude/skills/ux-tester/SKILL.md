---
name: ux-tester
description: Manually UX-test the application with Chrome DevTools MCP. Maintain story-based test cases in docs/STORIES.md, run issue-scoped or regression test passes, log bugs as GitHub Issues (label `bug,backlog`), and update docs/QUALITY_SCORE.md.
argument-hint: "[update cases | issue:<number> | regression]"
model: sonnet
effort: medium
---

# UX-Tester

Use this skill when the user (or the manager subagent) asks to manually UX-test the application, run regression checks, test a specific completed Issue, update story-based test cases, or record bugs and quality scores from manual QA.

At the start of your response, output: MODEL: <your model name> | EFFORT: <your effort level>

This line MUST also appear at the start of your final return message to the caller. If invoked as a subagent, the caller only sees your final message — include the MODEL/EFFORT line there as the very first line.

## Required Context

Read these first:

1. `AGENTS.md`
2. `docs/STORIES.md` (create it if missing — see "Story And Test Case Maintenance" below)
3. `docs/QUALITY_SCORE.md`
4. The `issue` skill: `.claude/skills/issue/SKILL.md` — for label conventions when filing bugs.

Read additional context only as needed:

- The target Issue: `gh issue view <number> -c` when the caller passes `issue:<number>`.
- The matching completed plan in `docs/exec-plans/completed/` (or active plan if still in flight) for traceability.
- Relevant product specs (`docs/product-specs/`) or design docs (`docs/design-docs/`) when a story or acceptance check is unclear.

## Reading the Issue

```bash
gh issue view <number> -c                                           # body + comments
gh issue view <number> --json title,body,labels,assignees,url
```

## Core Responsibilities

This skill supports four primary modes:

1. `ux-tester update cases` — refresh `docs/STORIES.md` against completed Issues.
2. `ux-tester issue:<number>` — issue-scoped manual testing for one Issue.
3. `ux-tester regression` — full regression across documented test cases.
4. Bug logging (as GitHub Issues) and quality-score updates after every meaningful pass.

Always use Chrome DevTools MCP for manual browser validation when UI behavior is in scope.

## Story And Test Case Maintenance

When the caller passes `update cases`:

1. Read `docs/STORIES.md` (create it as an empty test-oriented document if it does not yet exist).
2. List recently closed Issues: `gh issue list --state closed --limit 50 --json number,title,labels,closedAt`.
3. Inspect completed plans in `docs/exec-plans/completed/` for tasks represented in the current product surface.
4. Add missing story coverage for completed Issues that lack usable manual test cases.
5. Ensure each testable section in `docs/STORIES.md` includes traceability:
   - Issue number (and URL)
   - Completed execution plan path
6. Prefer concrete test cases over abstract statements:
   - actor
   - setup or preconditions
   - steps
   - expected result
7. Do not invent coverage for backlog or incomplete Issues unless explicitly asked.

Keep `docs/STORIES.md` lean and test-oriented — do not duplicate the product spec.

## Issue-Scoped Testing (`issue:<number>`)

When the caller passes an Issue number:

1. Resolve scope:
   - `gh issue view <number> -c` for body + comments + labels.
   - Open the referenced execution plan (active or completed).
   - Identify matching stories in `docs/STORIES.md`.
2. Build a focused test list from those stories.
3. Verify environment readiness — start or reuse the local app/dev server. Find the app URL from the project README, `package.json` scripts, or by asking the user if unclear. Pipeline is a Rust + TS monorepo — the frontend dev server URL is typically `http://localhost:3000` or the value configured in the user-docs Jekyll site (`docs/user-docs/_config.yml`).
4. Use Chrome DevTools MCP to exercise the relevant flows manually.
5. Record pass/fail/blocked status for each tested case.
6. File any new defects as GitHub Issues (see "Bug Logging" below).
7. Update `docs/QUALITY_SCORE.md` with the scoped results.

## Regression Testing (`regression`)

When the caller asks to run regressions:

1. Read all currently testable cases from `docs/STORIES.md`.
2. Group them into a practical execution order:
   - auth / access
   - core shell / navigation
   - feature-specific flows
3. Use Chrome DevTools MCP to drive the browser-based checks.
4. Reuse terminal commands for setup, fixtures, or bootstrap actions.
5. Mark each case pass/fail/blocked in working notes.
6. File new defects as GitHub Issues.
7. Update `docs/QUALITY_SCORE.md` after the run.

Prefer meaningful regressions over superficial page visits — exercise the acceptance checks, not just route loads.

## Rules

- Do **not** edit issue labels on the parent Issue. The manager owns lifecycle transitions.
- Do **not** commit. The manager will commit testing artifacts (`docs/STORIES.md`, `docs/QUALITY_SCORE.md`) together with its lifecycle commit.
- Bugs are filed as **new GitHub Issues** with the `bug,backlog` labels — never as comments-only.
- Always run Chrome DevTools MCP for manual browser validation. Code inspection alone is not acceptable evidence of testing.

## Bug Logging

When a defect is found, create a new GitHub Issue:

```bash
gh issue create \
  --title "<short imperative>" \
  --label "bug,backlog" \
  --body "$(cat <<'EOF'
**Linked issue:** #<parent-number>
**Source story:** <story id from docs/STORIES.md, if applicable>
**Plan:** <docs/exec-plans/.../path.md, if applicable>

**Severity:** critical | high | medium | low

**Reproduction steps**
1. ...
2. ...

**Expected result**
...

**Actual result**
...

**Environment**
- App URL:
- Browser:
- Date:
EOF
)"
```

Capture the new Issue number and add it as a comment on the parent Issue:

```bash
gh issue comment <parent-number> --body "Filed bug #<new-number> (<severity>) during UX testing: <title>"
```

Severity guidance (used by the manager for critical-bug handling):

- **critical** — blocks the feature shipping; mismatches against contract / spec; data loss or security risk.
- **high** — significantly degrades UX or wrong content on a primary surface.
- **medium** — incorrect styling, minor copy mismatches, edge-case errors.
- **low** — polish, cosmetic.

## Quality Score Updates

After each scoped or regression pass, update `docs/QUALITY_SCORE.md`. Every update should include:

- test date
- scope tested (Issue number or "regression")
- story coverage summary
- bugs filed (Issue numbers) or confirmed
- a short numeric quality score (0–10 unless the document already establishes a different scale)
- brief reasoning for the score

If there is not enough information for a confident score, say so explicitly and score conservatively.

## Chrome DevTools MCP Workflow

Use Chrome DevTools MCP as the default manual testing tool. You MUST actually drive the browser.

1. Resolve the app URL from project config (README, `package.json`, `docs/user-docs/_config.yml`). Ask the user if unclear.
2. Navigate to the target flows with `mcp__chrome-devtools__navigate_page`.
3. Interact as a user would (`click`, `fill`, `hover`, `scroll`, etc.).
4. Use `mcp__chrome-devtools__take_snapshot` as the primary inspection tool to read the DOM / a11y tree.
5. Use `mcp__chrome-devtools__take_screenshot` when visual evidence is useful.
6. Use `list_console_messages` and `list_network_requests` when diagnosing a failure.

When setup is required, prefer existing scripts/fixtures from the repo over manual setup. Document any non-obvious setup in your final report.

## Output Expectations

When running tests, report:

- scope tested (Issue number or "regression")
- cases executed
- passes
- failures
- blocked items
- bug Issues filed (numbers + severity)
- quality score updates

If testing could not be completed, explain the blocker clearly and update docs only if there is a justified partial result.
