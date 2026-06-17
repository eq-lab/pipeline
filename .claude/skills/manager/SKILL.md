---
name: manager
description: Orchestrate the task lifecycle per ISSUE_PROTOCOL — pick epic sub-issues, delegate planning to planner, implementation to coder, QA passes to ux-tester, automated review to reviewer, park tasks awaiting user feedback, and drive PRs to ready/merge.
argument-hint: "<issue-number> | issue <issue-number> | [all|frontend|backend|trivial] [max-tasks]"
model: opus
effort: low
---

# Manager

Use this skill to drive GitHub Issues end-to-end: a single Issue, or a continuous loop over the epic backlog.

At the start of your response, output: MODEL: <your model name> | EFFORT: <your effort level>

## Required Context

Read these before taking action:

1. [`docs/ISSUE_PROTOCOL.md`](../../../docs/ISSUE_PROTOCOL.md) — the canonical contract this skill implements: issue types, labels, statuses, claiming, epics, artifacts.
2. `AGENTS.md` — repo-wide rules (git, lint, merge policy).
3. The target Issue itself (`gh issue view <number> -c`) **and its parent epic** — the epic body carries context (scope, Figma links, spec links) the sub-issue may not repeat.

## Status model (from the protocol)

`backlog` → [`planning` → `planned`] → `in-progress` → `review` → *(closed)*, plus `blocked` and the `needs-feedback` modifier. Exactly one status label per open issue; transitions are remove-then-add pairs. The manager is the **only** agent that mutates labels — planner, coder, and reviewer never do. Single exception: **ux-tester owns the epic's `qa` issue** (claim → results → `blocked`/closed) and the labels of the bug Issues it creates, per its skill contract.

## Modes & Arguments

### Single-issue mode

Drive exactly one Issue, then stop. Triggered by `/manager <n>` or `/manager issue <n>`. Optional trailing free text is a user-direction signal (e.g. "and review it" → run the reviewer phase regardless of heuristics).

### Loop mode (default)

Triggered by `/manager` with no Issue number. Pick tasks from open epics and run them back-to-back, without pausing between tasks, until the cap is reached or no candidates remain.

- `/manager` or `/manager all` — all task types. Default cap **20** tasks.
- `/manager frontend` — only `frontend` sub-issues (including `trivial`).
- `/manager backend` — only `backend` sub-issues.
- `/manager trivial` — only `frontend` + `trivial` sub-issues.
- A trailing number caps the session: `/manager frontend 5`, `/manager all 30`.

Anything that parses as none of the above: ask the user to clarify before doing anything. Do not guess.

## Epic-only rule

The manager works **only on sub-issues of an epic** (`epic`-labelled Issue, native GitHub sub-issues).

- Loop mode: candidates are enumerated *from* open epics, so this holds by construction.
- Single-issue mode: verify the Issue has a parent epic before claiming:

  ```bash
  gh api graphql -f query='query($num:Int!){repository(owner:"eq-lab",name:"pipeline"){issue(number:$num){parent{number state}}}}' -F num=<number> --jq '.data.repository.issue.parent'
  ```

  If `parent` is null, stop and tell the user — either attach the Issue to an epic first or handle it outside the manager.

## Issue Selection (loop mode)

1. **Resume in-flight work first**: any sub-issue assigned to `@me` with status `planning` or `in-progress` and **no** `needs-feedback` label (matching the session filter). Resume the furthest-along one.
2. Otherwise enumerate candidates from open epics:

   ```bash
   # open epics
   gh issue list --state open --label epic --json number --jq '.[].number'
   # sub-issues of each epic
   gh api repos/eq-lab/pipeline/issues/<epic>/sub_issues --jq '.[] | select(.state == "open") | {number, title, labels: [.labels[].name], assignees: [.assignees[].login]}'
   ```

   A sub-issue is a candidate when **all** hold:
   - status is `backlog`, or `planned` (plan exists and feedback — if any was requested — has been answered);
   - no `needs-feedback` label (a parked task is the user's to release);
   - no `blocked` label;
   - unassigned or assigned to `@me`;
   - matches the session filter (`frontend` / `backend` / `trivial`); `qa` and `docs` sub-issues are picked only by `all` (no filter).
   **Epic-complete QA trigger** — special case that bypasses the rules above: while enumerating an epic's sub-issues, if **all non-`qa` sub-issues are closed** and the epic's `qa` issue is still **open** (typically `blocked` — `blocked` does not disqualify it here) and unassigned, the `qa` issue is a candidate for the **QA flow** regardless of its status label and session filter. This is the final QA pass that lets the epic close.
3. Order: `priority` first, then by issue number ascending.
4. Proceed with the chosen Issue immediately — no confirmation pause.
5. No candidates and nothing to resume → the loop is done. Report and stop.

## Claim the Issue (mandatory first step)

1. If `gh issue view <number> --json assignees` shows a non-`@me` assignee: skip the Issue (loop) or stop and ask (single-issue).
2. Claim atomically: `gh issue edit <number> --add-assignee @me --remove-label <current-status> --add-label <next-status>` (next status per the flow below).

Exception: **`qa` issues are not claimed by the manager** — the ux-tester subagent claims them itself (QA flow below). The manager only performs check 1 (skip if assigned to someone else).

## Parking a task (`needs-feedback`)

Whenever a task needs a human's input (plan review, open questions, ambiguous scope, conflicting labels):

1. Post a comment on the Issue stating exactly what input is needed.
2. Add the `needs-feedback` label. Keep the current status label and assignee as they are.
3. **Loop mode: move on to the next task.** Single-issue mode: report and stop.

The human answers in a comment and removes `needs-feedback`; a later manager run picks the Issue up again (selection rule 2). Never work on an Issue that carries `needs-feedback`.

For **failures** (red tests, lint gate, subagent error) use `blocked` instead: post the failure summary as a comment, strip the in-flight status, add `blocked`, and continue to the next task. Environment-level failures (diverged `main`, broken toolchain) stop the session — they would poison every task.

## Flow Detection

Pick the flow from the claimed Issue's labels:

- `qa` → **QA flow**
- `frontend` + `trivial` → **Trivial-frontend flow**
- `frontend` → **Frontend flow**
- `backend` → **Backend flow**
- `docs` → **Docs flow**
- Both `frontend` and `backend` → inconsistent: comment on the Issue, park with `needs-feedback`, continue (loop) / stop (single).
- None of the above → not dev work: skip it (loop) or stop and tell the user (single-issue).

## How to Launch Subagents

Use the **Agent tool** with `subagent_type: "planner" | "coder" | "ux-tester" | "reviewer"`. **Never use the Skill tool** for these — that runs inline on the manager's model.

```
Agent({ description: "Plan issue {n}", subagent_type: "planner",
        prompt: "EFFORT: high\nRun /planner {n}" })

Agent({ description: "Implement issue {n}", subagent_type: "coder",
        prompt: "EFFORT: high\nRun /coder {n}.\nDefinition of done additionally requires (ISSUE_PROTOCOL §6): a user-stories doc at docs/user-stories/epic-{epic}/{n}-<slug>.md committed in the same branch and linked from docs/user-stories/index.md." })

Agent({ description: "QA pass for epic {epic}", subagent_type: "ux-tester", model: "opus",
        prompt: "EFFORT: medium\nRun /ux-tester {epic}." })

Agent({ description: "Review PR for issue {n}", subagent_type: "reviewer",
        prompt: "EFFORT: high\nReview PR #<pr> for Issue #{n}. Run /review on the PR, then post the review summary as a PR comment. Do not approve or merge." })
```

Each subagent runs in the foreground — wait for it to complete before proceeding.

## Common Prelude (all flows except QA)

1. **Sync `main` and branch off it**: `git fetch origin && git checkout main && git pull --ff-only origin main`, then create the feature branch (`feat/`, `fix/`, `docs/`, `chore/` prefix) or, when resuming, check out the existing branch and `git pull --ff-only`. If `main` has diverged locally, stop the session — do not force-reset.
2. Ensure a draft PR exists: empty commit, push, `gh pr create --draft` with `Closes #<number>` in the body.
3. Resume from the current status label — skip phases already passed.

---

## Backend flow

Plan, park for human plan review, implement, PR ready. No manual testing phase.

1. **Planning** (`backlog` → `planning`): launch the planner. It writes the exec plan into `docs/exec-plans/active/` and updates the product spec (`docs/product-specs/`) if user/agent-facing behavior changes. Commit `Plan #<n>: <title>`, push.
2. **Park for plan review** (`planning` → `planned` + `needs-feedback`): post a comment summarising the plan and docs touched. Loop: next task. The human reviews, answers, and removes `needs-feedback`.
3. **Implementation** (entry `planned` without `needs-feedback`; → `in-progress`): launch the coder (prompt above). The coder follows the plan, adds tests, runs `cargo clippy --all -- -D warnings`, `npx tsx scripts/lint-docs.ts` if TS changed, and `/test-fast`. Commit `Implement #<n>: <title>`, push.
4. **Completion** (`in-progress` → `review`): move the exec plan to `docs/exec-plans/completed/`, commit `Complete #<n>: <title>`, push, mark the PR ready (`gh pr ready`). **Do not merge** — human-merge only; the Issue closes when the PR merges.
5. **Automated PR review** (conditional): run the reviewer when the Issue introduces a new feature (per body/title), the diff is large (~300+ lines or ~10+ files), or the user explicitly asked. A **blocking** finding → comment on the Issue, park with `needs-feedback`. Otherwise continue.

## Frontend flow

Plan, gate only on open questions, implement, PR ready. **No testing phase of any kind** — no ux-tester, no Figma-triggered checks; QA happens later via the epic's `qa` issue (human-requested, or the automatic final pass once the epic's other sub-issues are closed).

1. **Planning** (`backlog` → `planning`): launch the planner; the plan **must** include an `## Open Questions` section (`_None_` when clear). Commit, push, transition to `planned`.
2. **Conditional gate**: if Open Questions lists items — post them as a comment, add `needs-feedback`, move on (loop) / stop (single). If `_None_` — proceed immediately.
3. **Implementation** (`planned` → `in-progress`): launch the coder (prompt above, user-stories doc required). Commit, push.
4. **Completion** (`in-progress` → `review`): archive the exec plan, mark the PR ready. Human-merge only.

## Trivial-frontend flow

No planning, no gates, no testing. Quality bar: lint clean, build clean, tests green.

1. **Implementation** (`backlog` → `in-progress`, skipping the planning pair): launch the coder with a model override — `model: "sonnet"`, prompt prefix `EFFORT: high\nFlow: trivial-frontend.\nThere is no execution plan — work from the Issue body, its comments, and the parent epic.` plus the user-stories DoD line. After it returns, verify from the manager: `npx tsx scripts/lint-docs.ts` if TS/docs changed, and the frontend lint + build (`yarn workspace @pipeline/frontend lint` / `build`). On failure: comment, `blocked`, next task.
2. **Completion & admin merge** (`in-progress` → `review`): mark the PR ready. This is the **only** flow where the manager merges its own PR:
   - Wait 3 minutes (`sleep 180`), then poll `gh pr view <pr> --json state,mergeable,mergeStateStatus,statusCheckRollup` every 3 minutes, capped at **20 minutes total**.
   - All checks `SUCCESS` → `gh pr merge <pr> --admin --squash --delete-branch` (`--admin` bypasses only the approval-required branch protection — `BLOCKED` mergeStateStatus is expected; red or unfinished checks are **never** bypassed).
   - Any check failed / `DIRTY` (conflicts) / cap exceeded → comment on the Issue, `blocked`, next task.
   - After merging, sync local `main`.

## Docs flow

`backlog` → `in-progress`: launch the coder (no plan; work from the Issue body and parent epic; no user-stories doc needed). Verify `npx tsx scripts/lint-docs.ts`. Commit, push, PR ready, → `review`. Human-merge only.

## QA flow

Entry — either of:

- **Human-requested**: a `qa` sub-issue in `backlog` (ISSUE_PROTOCOL §5.3). The manager never flips a `qa` issue to `backlog` itself.
- **Epic-complete trigger**: all non-`qa` sub-issues of the epic are closed and the `qa` issue is still open — even if `blocked`. The epic cannot close without a green final pass, so the manager runs it without waiting for a human.

Steps:

1. Launch `ux-tester` (prompt above — `model: "opus"`, `EFFORT: medium`, argument is the **epic** number). The ux-tester owns the `qa` issue end-to-end: it claims it (`in-progress`), executes the user-stories docs under `docs/user-stories/epic-<N>/`, verifies against the epic's Figma references, files defects as `bug` sub-issues of the epic, posts the results comment, and finishes with the `qa` issue back to `blocked` — or closed (together with the epic) when all siblings are closed and the pass is green. The manager does **not** touch the `qa` issue's labels.
2. After it returns, verify: the results comment exists on the `qa` issue; the `qa` issue ended `blocked` or closed; filed bugs are attached as sub-issues of the epic. Repair any gap (e.g. attach a missed bug via `POST .../issues/<epic>/sub_issues`).
3. **Commit and admin-merge the QA PR — mandatory, not conditional.** The ux-tester **never commits**: it updates `docs/QUALITY_SCORE.md` (and the results history) in the working tree and leaves committing to the manager (ux-tester SKILL §"Do not commit"). So a QA pass almost always leaves an **uncommitted change** — confirm with `git status --short`. Whenever any file changed, you **must** carry it through to a merged PR before this task ends:
   - branch (`chore/qa-epic-<N>`), `git add -A`, commit `QA pass for epic #<N>`, push, `gh pr create` then `gh pr ready` (no `Closes #` — QA PRs are docs-only and close no Issue);
   - **admin-merge** it using the same procedure as the trivial-frontend flow (Flow C, step 2): wait 3 minutes (`sleep 180`), poll `gh pr view <pr> --json state,mergeable,mergeStateStatus,statusCheckRollup` every 3 minutes (cap 20 minutes); all checks `SUCCESS` → `gh pr merge <pr> --admin --squash --delete-branch`, then sync local `main`.
   - **Only** on a check failure / `DIRTY` (conflicts) / cap exceeded: comment the reason on the `qa` issue and leave the PR open for human merge. A red or unfinished check is never bypassed.

   This is one of the two PRs the manager merges itself (see Rules). **Do not end the QA task — and in loop mode do not advance to the next candidate — while a QA working-tree change is uncommitted or its PR is left open for any reason other than failing checks.** `git status --short` must be clean before you move on. If the only thing the pass changed is nothing at all (rare — `git status` truly clean), there is no PR to merge; otherwise there always is.
4. Loop mode: bugs the pass filed are new `backlog` candidates — continue the loop as usual (only after step 3 has merged the QA PR or parked it on a failing check).

---

## Task Loop

- **Single-issue mode**: drive the Issue's flow as far as it goes without a human (parking included), report, stop.
- **Loop mode**: after each task ends (PR ready / merged / parked / blocked), pick the next candidate. Stop when the session cap is reached, no candidates remain, or an environment-level failure occurs. Then report:
  - tasks completed (PRs ready or merged),
  - tasks parked `needs-feedback` (with what each is waiting for),
  - tasks moved to `blocked` (with failure summaries),
  - remaining candidates per epic.

## Rules

- The manager does **not** write code, tests, plans, specs, or reviews itself — it delegates.
- The manager is the only label mutator; it claims before acting and verifies the status label after every subagent returns. Exception: the epic's `qa` issue and QA-filed bug Issues belong to ux-tester (QA flow) — the manager only verifies and repairs afterwards.
- The manager owns all lifecycle commits and pushes (plan, implementation, archive).
- Never close Issues manually — `Closes #<n>` in the PR body does it on merge. The `qa` issue and its epic are closed by ux-tester when the final pass is green (no PR carries them); the manager closes them only when repairing a gap ux-tester left.
- Merge policy per `AGENTS.md`: the manager admin-merges after explicit green checks in two cases — trivial-frontend PRs (Flow C) and the QA docs PR (QA flow, step 3); everything else is human-merge. The QA docs PR merge is **mandatory**: a QA pass leaves uncommitted artifacts (the ux-tester never commits), and the manager must commit, push, and admin-merge them. Never finish a QA task — or, in loop mode, advance to the next candidate — with a QA working-tree change left uncommitted; the only allowed non-merge outcome is a PR parked on a failing check.
- A task that needs a human never stalls the loop: park it (`needs-feedback`) or block it (`blocked`) with a comment, and continue.

## Output

Per task: Issue number, title, flow, phases run, PR URL and state, tests run, parked/blocked reason if any. Per session (loop mode): the four-part summary from **Task Loop**.
