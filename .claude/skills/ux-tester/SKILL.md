---
name: ux-tester
description: Run a QA pass for an epic. Takes an epic number as argument — claims the epic's `qa` sub-issue, executes every user-stories doc under docs/user-stories/epic-<N>/ with Chrome DevTools MCP, verifies rendered pages against the epic's Figma references, files defects as `bug` sub-issues of the epic, posts a results comment, and updates docs/QUALITY_SCORE.md.
argument-hint: "<epic-number>"
model: sonnet
effort: medium
---

# UX-Tester

Use this skill when the user (or the manager subagent) requests a QA pass for an epic: manual story-based testing of the epic's shipped work plus a visual check against the epic's Figma designs.

At the start of your response, output: MODEL: <your model name> | EFFORT: <your effort level>

This line MUST also appear at the start of your final return message to the caller. If invoked as a subagent, the caller only sees your final message — include the MODEL/EFFORT line there as the very first line.

## Arguments

The argument is an **epic Issue number** (e.g. `463` or `epic:463`). The Issue must exist and carry the `epic` label — verify with `gh issue view <number> --json labels`. If no argument is provided, ask the user which epic to test.

## Required Context

Read these first:

1. `AGENTS.md`
2. `docs/ISSUE_PROTOCOL.md` — §2 (`qa` lifecycle), §5 (claiming, QA scheduling), §6 (user-stories docs).
3. `docs/QUALITY_SCORE.md`
4. The `issue` skill: `.claude/skills/issue/SKILL.md` — for label conventions when filing bugs.

Read additional context only as needed:

- Relevant product specs (`docs/product-specs/`) or design docs (`docs/design-docs/`) when a story or acceptance check is unclear.
- Completed plans in `docs/exec-plans/completed/` for traceability when a story doc is ambiguous.

## Workflow

### 1. Resolve the epic and its `qa` issue

```bash
gh issue view <epic> -c                                   # epic body + comments — contains the Figma URL tables
gh api repos/eq-lab/pipeline/issues/<epic>/sub_issues \
  --jq '.[] | select(.labels[].name == "qa") | .number'   # the epic's qa sub-issue
```

- If the epic has no `qa` sub-issue, stop and report — the epic was not set up per `ISSUE_PROTOCOL.md`.
- Read the `qa` issue and **all its comments** (`gh issue view <qa> -c`). The latest results comment tells you which stories are already verified green.

### 2. Claim the `qa` issue

- If the `qa` issue is assigned to someone else, **stop** — do not touch it (ISSUE_PROTOCOL §5.1).
- If it is `backlog`, claim it atomically:

  ```bash
  gh issue edit <qa> --add-assignee @me --remove-label backlog --add-label in-progress
  ```

- If it is still `blocked` but a human invoked this skill directly, treat the invocation as the pass request: claim it the same way, removing `blocked` instead of `backlog`.

### 3. Gather test inputs

1. **Figma references** — extract every Figma URL from the epic body (typically tables keyed by state and viewport: desktop / mobile, wallet states, etc.). For each, note the `fileKey`, `nodeId`, and which state/viewport it represents.
2. **User stories** — list `docs/user-stories/epic-<epic>/*.md`. Every doc in that directory is in scope. At minimum, execute the docs **not yet verified** per the latest results comment on the `qa` issue; rerun previously-green docs when the epic gained new merged work since that pass.
3. If the directory is missing or empty, stop, report it, and return the `qa` issue to its prior status with an explanatory comment.

### 4. Verify environment readiness

Start or reuse the local app/dev server. Find the app URL from the project README or `package.json` scripts — typically `http://localhost:3000`. Pipeline is a Rust + TS monorepo; look in `scripts/` and `packages/` for seed/fixture commands. Use any seeding instructions embedded in the user-stories docs (e.g. `pipeline.mock.wallet.*` localStorage keys) to reproduce each story's preconditions.

### 5. Execute the user stories

For each user-stories doc, for each story:

1. Set up the story's preconditions (seeding, viewport size, wallet state) exactly as the doc specifies.
2. Drive the flow with Chrome DevTools MCP (see "Chrome DevTools MCP Workflow" below) — follow the doc's steps as a user would.
3. Check every expected outcome the doc lists. A story passes only if all its expected outcomes hold.
4. Record pass/fail/blocked per story as you go, with a one-line reason for every fail/blocked.

### 6. Verify against Figma

For each Figma reference from the epic body whose state/viewport you can reproduce, run a structured visual comparison while that state is set up (do it together with the matching story to reuse the seeded state):

1. **Load the design:** call `mcp__figma__get_design_context` with the `fileKey` and `nodeId`. **Ignore the returned React/Tailwind code** — do not read it; it biases you toward confirming structure that may not actually be rendered. Use only the layout description and reference screenshot.
2. **Enumerate sections:** call `mcp__figma__get_metadata` (or inspect the design context) to list the **direct child nodes** of the frame — these are the sections to compare. If there are more than ~8 children, group them into logical sections. This list is the comparison checklist — every entry must be checked.
3. **Align the viewport:** `mcp__chrome-devtools__resize_page` to the Figma frame's width (read it from the design context — e.g. 1440 for desktop, 402 for mobile). Mismatched viewports cause false "proportion looks different" dismissals.
4. **Pairwise section comparison — one section at a time.** For every child node:
   1. Figma side: `mcp__figma__get_screenshot` for the child `nodeId` — a focused, full-resolution view of just that section.
   2. App side: from `take_snapshot` output, find the corresponding element's `uid` and `mcp__chrome-devtools__take_screenshot` with that `uid`. If the section is missing from the app entirely, **that itself is a finding** — record it and continue.
   3. Compare against this checklist, answering each line before moving on:
      - [ ] Is the section present in the app at all?
      - [ ] Is it in the same position relative to other sections (order)?
      - [ ] Heading: same text? same size/weight? present at all?
      - [ ] Body copy: same content? same paragraph splitting?
      - [ ] Typography: font family, size, weight, alignment, line height
      - [ ] Colors: text, background, borders, shadows
      - [ ] Container styling: card vs plain, border radius, padding
      - [ ] Layout: grid/column count, gap, item alignment
      - [ ] Images: present? aspect ratio? position?
      - [ ] Are there elements in the **app** that do **not** appear in Figma?
      - [ ] Are there elements in **Figma** that do **not** appear in the app? (most commonly missed — bias yourself to look for absences)
   4. Record findings as you go — one line per mismatch: `section <label>: <what differs>`.
5. After the loop, do one final full-page scan (full-page screenshot pair) to catch differences in section *ordering* and *spacing between sections* that per-section screenshots miss. **Never rely on the full-page comparison alone** — it is for overview and ordering only.

### 7. File bugs

File every defect (failed story outcome or Figma mismatch) as a **new GitHub Issue** and attach it as a **sub-issue of the epic** (ISSUE_PROTOCOL §2: bugs found while testing an epic are sub-issues of that epic). One Issue per independent problem — do not batch unrelated defects.

Labels — a flow label is **not optional**; without one the `manager` skill will skip the Issue:

- `bug,frontend,backlog` — default for UX findings (visual / styling / copy / behavior on a frontend page).
- `bug,frontend,trivial,backlog` — add `trivial` only when the fix is mechanical and self-contained: a CSS tweak, a prop default, a string change, a single-component visual fix with no data-flow or logic change.
- Use `backend` instead of `frontend` when the defect is clearly server-side.

```bash
gh issue create \
  --title "<short imperative>" \
  --label "bug,frontend,backlog" \
  --body "$(cat <<'EOF'
**Epic:** #<epic-number>
**Source story:** docs/user-stories/epic-<N>/<doc>.md — Story <n> (or "Figma comparison" with the node-id)
**Figma:** <figma-url including node-id, if applicable>

**Severity:** critical | high | medium | low

**Reproduction steps**
1. ...

**Expected result**
...

**Actual result**
...

**Environment**
- App URL:
- Viewport:
- Date:
EOF
)"

# attach as sub-issue of the epic
CHILD_ID=$(gh api repos/eq-lab/pipeline/issues/<new-number> --jq .id)
gh api repos/eq-lab/pipeline/issues/<epic>/sub_issues -F sub_issue_id="$CHILD_ID"
```

Severity guidance:

- **critical** — blocks the feature shipping; mismatches against contract / spec; data loss or security risk.
- **high** — significantly degrades UX or wrong content on a primary surface.
- **medium** — incorrect styling, minor copy mismatches, edge-case errors.
- **low** — polish, cosmetic.

### 8. Post results and release the `qa` issue

1. Post a **results comment on the `qa` issue**: stories run (per doc), pass/fail/blocked per story, Figma frames compared, bugs filed (numbers + severity). This comment is the verification history the next pass builds on — make per-story status machine-greppable (e.g. a table or `- [x] doc.md Story 1 — PASS`).
2. Transition the `qa` issue per ISSUE_PROTOCOL §2:
   - **Default:** back to `blocked` and unassign yourself (the next pass is again human-requested):

     ```bash
     gh issue edit <qa> --remove-label in-progress --add-label blocked --remove-assignee @me
     ```

   - **If all sibling sub-issues are closed and this pass is fully green:** close the `qa` issue. **Never close the epic** — epics stay open permanently, even when every sub-issue is closed and the final pass is green.
3. Update `docs/QUALITY_SCORE.md` (see below). Do **not** commit — the manager/human commits testing artifacts.

## Quality Score Updates

After each pass, update `docs/QUALITY_SCORE.md` with:

- test date
- scope tested (epic number + `qa` issue number)
- story coverage summary (docs run / stories passed / failed / blocked)
- Figma frames compared
- bugs filed (Issue numbers) or confirmed
- a short numeric quality score (0–10 unless the document already establishes a different scale)
- brief reasoning for the score

If there is not enough information for a confident score, say so explicitly and score conservatively.

## Chrome DevTools MCP Workflow

Use Chrome DevTools MCP as the default manual testing tool. You MUST actually drive the browser — code inspection alone is not acceptable evidence of testing.

1. Reuse a running Chrome DevTools session if available; otherwise start one. If navigation reports a stale-lock error, run `pkill -f "chrome-devtools-mcp/chrome-profile"` once, then retry.
2. Navigate to the target flows with `mcp__chrome-devtools__navigate_page`.
3. Interact as a user would (`click`, `fill`, `hover`, scroll, etc.).
4. Use `mcp__chrome-devtools__take_snapshot` as the primary inspection tool to read the DOM / a11y tree; prefer it over screenshots when inspecting text content.
5. Use `mcp__chrome-devtools__take_screenshot` for visual styling evidence and Figma comparisons.
6. Use `list_console_messages` and `list_network_requests` when diagnosing a failure.

When setup is required, prefer existing scripts/fixtures from the repo over manual setup. Document any non-obvious setup in your final report.

## Rules

- **Label edits are limited to the epic's `qa` issue** (claim → results → `blocked`/close) and the status labels of bugs you create. Never relabel **or close** the epic itself, and never relabel its other sub-issues — the manager owns those transitions. Epics stay open permanently.
- Do **not** implement fixes. Testing and filing only.
- Do **not** commit. The manager/human commits testing artifacts (`docs/QUALITY_SCORE.md`) — your results comment on the `qa` issue is the durable record.
- Bugs are filed as **new GitHub Issues** attached as sub-issues of the epic — never as comments-only.
- Empty/unrealistic pages are not valid test targets — seed the state the story doc specifies before testing or comparing.
- **Do not read the React/Tailwind code returned by `get_design_context`** — it biases the comparison.
- **Bias toward finding absences.** After each section comparison, explicitly ask: "what is in the Figma screenshot that I cannot point to in the app screenshot?"
- Align the browser viewport width to the Figma frame width before screenshotting.
- Respect the 7-day Figma asset URL TTL — download assets locally before referencing them anywhere durable.

## Output Expectations

Your final message should include:

- epic number and `qa` issue number
- user-stories docs executed, with per-story pass/fail/blocked
- Figma frames compared (node-ids) and findings
- bug Issues filed (numbers + severity)
- the `qa` issue's final status (`blocked` / closed)
- quality score update
- any blockers or stories that could not be executed, with reasons

If testing could not be completed, explain the blocker clearly, return the `qa` issue to an honest status with a comment, and update docs only if there is a justified partial result.
