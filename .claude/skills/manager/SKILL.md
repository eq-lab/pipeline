---
name: manager
description: Orchestrate the full task lifecycle — pick a GitHub Issue, delegate planning to planner, implementation to coder, manual testing to ux-tester, automated review to reviewer, handle critical bugs, and drive the Issue to completion.
argument-hint: "<issue-number> | issue <issue-number> | trivial [max-tasks]"
model: opus
effort: low
---

# Manager

Use this skill when the user asks to drive a GitHub Issue end-to-end, or to burn through the trivial-frontend backlog.

At the start of your response, output: MODEL: <your model name> | EFFORT: <your effort level>

## Modes & Arguments

The manager runs in one of two modes, picked from the invocation arguments.

### Single-issue mode (default)

Drive exactly one Issue, then stop. Triggered by:

- `/manager <n>` — e.g. `/manager 777`
- `/manager issue <n>` — e.g. `/manager issue 777`
- (Optional trailing free text the user may add, such as `… and review it` — used as a signal in Phase A5 / Flow A; see "User-direction signals" below.)

Pick the flow from the Issue's labels (see **Flow Detection**), run all phases of that flow once, then stop. Do not auto-pick another Issue.

### Trivial-loop mode

Burn through trivial-frontend Issues from the backlog. Triggered by the literal keyword `trivial`:

- `/manager trivial` — default cap is **20** Issues.
- `/manager trivial <max-tasks>` — e.g. `/manager trivial 43` caps the loop at 43.

In this mode the manager only considers Issues that carry **both** `frontend` and `trivial` labels. Each Issue runs Flow C end-to-end, then the manager picks the next trivial-frontend Issue from `backlog` and repeats until `max-tasks` is reached or no more candidates exist.

### Anything else

If the argument cannot be parsed as `<n>`, `issue <n>`, or `trivial [<n>]`, ask the user to clarify before doing anything. Do not guess.

### User-direction signals

Free text in the user's invocation can carry signals the manager respects:

- "review", "and review it", "with review" → in Flow A only, treat this as an **explicit ask** to run Phase A5 (Automated PR review) regardless of the new-feature / significant-change heuristics.

Capture these signals when parsing the invocation and apply them at the relevant phase.

## Required Context

Read these before taking action:

1. `AGENTS.md` — the canonical workflow this skill orchestrates.
2. The `issue` skill: `.claude/skills/issue/SKILL.md` — defines labels, lifecycle, and gh commands.
3. The target Issue itself: `gh issue view <number> -c`.

## Lifecycle (status labels on the Issue)

Each phase is a **status label** on the GitHub Issue:

`backlog` → `planning` → `planned` → `executing` → `executed` → `testing` → `tested` → *(closed)*

Only one status label is set at a time. A transition is always a remove-then-add pair:

```bash
gh issue edit <number> --remove-label <old> --add-label <new>
```

The manager owns these transitions. Subagents (`planner`, `coder`, `ux-tester`) must not edit labels or close Issues.

## Issue Selection

### Single-issue mode

The Issue number is given by the user — use it directly. Run flow detection on its labels and proceed.

### Trivial-loop mode

Pick the next trivial-frontend Issue:

1. First, resume any in-flight trivial-frontend Issue assigned to me:
   `gh issue list --assignee @me --state open --label frontend,trivial --json number,title,labels --jq 'map(select(.labels | map(.name) | any(. == "planning" or . == "planned" or . == "executing" or . == "executed" or . == "testing" or . == "tested")))'`

   Resume the furthest-along one (Flow C only uses `executing`/`executed`, so in practice that means resuming an `executing` Issue).
2. Otherwise pick a `backlog` Issue with both `frontend` and `trivial`:
   `gh issue list --state open --label backlog,frontend,trivial --json number,title,labels,assignees`

   Prefer `priority`-labelled Issues first, then by issue number ascending. Skip Issues assigned to another user. Skip `blocked` Issues.
3. If neither query returns anything, the trivial-loop is done — report the count completed this session and stop.
4. Proceed immediately with the chosen Issue — do not ask the user for confirmation.

## Claim the Issue (mandatory first step)

Before any other action on an Issue:

1. **Assign the Issue to me**: `gh issue edit <number> --add-assignee @me`. Idempotent — do it even when resuming an in-flight Issue already assigned to you.
2. Verify nobody else owns it: if `gh issue view <number> --json assignees` shows a non-`@me` assignee, stop and ask the user before proceeding.

## Task Loop

### Single-issue mode

After completing the requested Issue, **stop**. Report the result and exit — do not auto-pick another Issue. If the user wants more, they can re-invoke the manager.

### Trivial-loop mode

After completing each Issue, automatically pick the next trivial-frontend Issue (see **Issue Selection → Trivial-loop mode**) and continue — do not pause between Issues. Stop when:

1. The number of Issues completed this session reaches `max-tasks` (default **20** for trivial-loop mode).
2. There are no more open `backlog,frontend,trivial` Issues nor in-flight trivial-frontend Issues assigned to me.
3. Any Issue fails Flow C's lint/build/test gate — surface the failure to the user and stop the loop. Do not retry automatically.

When the loop ends (limit reached or candidates exhausted), report how many Issues were completed and how many remain in the trivial backlog, then exit.

## How to Launch Subagents

Use the **Agent tool** with `subagent_type: "planner" | "coder" | "ux-tester" | "reviewer"`. Read the `effort` field from the corresponding skill's SKILL.md frontmatter (or use the value documented in the agent's `.claude/agents/<name>.md`) and pass it in the prompt prefix.

```
Agent({
  description: "Plan issue {n}",
  subagent_type: "planner",
  prompt: "EFFORT: high\nRun /planner {n}"
})
```

```
Agent({
  description: "Implement issue {n}",
  subagent_type: "coder",
  prompt: "EFFORT: high\nRun /coder {n}"
})
```

```
Agent({
  description: "UX-test issue {n}",
  subagent_type: "ux-tester",
  prompt: "EFFORT: medium\nRun /ux-tester issue:{n}"
})
```

```
Agent({
  description: "Review PR for issue {n}",
  subagent_type: "reviewer",
  prompt: "EFFORT: high\nReview PR #<pr> for Issue #{n}. Run /review on the PR, then post the review summary as a PR comment. Do not approve or merge."
})
```

**Never use the Skill tool to delegate to planner, coder, ux-tester, or reviewer** — that runs inline on the manager's model. Always use the Agent tool.

## Flow Detection

After claiming the Issue, pick a flow from its labels:

```bash
gh issue view <number> --json labels --jq '.labels[].name'
```

- Labels include both `frontend` **and** `trivial` → **Trivial-frontend flow**.
- Label `frontend` (without `trivial`) → **Frontend flow**.
- Label `backend` → **Backend flow**.
- **Neither `backend` nor `frontend`** → not dev work; stop and tell the user. The Issue is for discussion / tracking / questions and the manager should not pick it up. Do not assume a flow.
- Both `backend` **and** `frontend` set → inconsistent; stop, post a comment on the Issue flagging the conflict, and ask the user which flow applies.

`trivial` on a `backend` Issue has no meaning — ignore it.

**Trivial-loop mode guard.** When the manager was invoked as `/manager trivial [...]`, it must reach the trivial-frontend flow for every Issue it picks. The Issue selection query already filters on `frontend,trivial`, so detection should always land on Flow C — but if it doesn't (e.g. labels changed mid-flight), abort the loop and tell the user.

**Single-issue mode classification mismatch.** If the user invoked `/manager <n>` against an Issue whose flow detection lands on a flow the user clearly didn't expect (e.g. they appended "review it" to a frontend-trivial Issue, which has no Phase A5), follow the flow the labels dictate and note the inert signal in the final report — do not silently change flows.

Each flow has its own phase ordering. The lifecycle labels (`planning`/`planned`/`executing`/`executed`/`testing`/`tested`) are still used; flows differ in which phases run and which gates fire.

## Common Prelude (all flows)

Before any flow-specific phase:

1. **Sync `main` and branch off it.** Before creating (or reusing) a feature branch for a fresh Issue, make sure the local `main` is up to date:

   ```bash
   git fetch origin
   git checkout main
   git pull --ff-only origin main
   ```

   Then either create the feature branch off `main` (`git checkout -b <prefix>/<slug>`, prefixes `feat/`, `fix/`, `docs/`, `chore/`), or — if you are resuming an Issue and its branch already exists locally and on the remote — `git checkout <branch>` and `git pull --ff-only` it. Never start a fresh branch from a stale `main`.

   If `git pull --ff-only` fails because `main` has diverged locally, stop and tell the user — do not force-reset.
2. Ensure a draft PR exists for this Issue. If missing: make an empty commit, push the branch, and open a draft PR with `Closes #<number>` in the body. See the `issue` skill for the exact commands.
3. Resume from whatever status label is currently set. Skip phases the Issue has already passed.

---

## Flow A — Backend (default)

Strict spec-first workflow with a hard human-approval gate. Use this for Rust crates, smart contracts, relayer internals, scripts, docs-only changes, and any Issue you cannot confidently classify as frontend.

### A1. Planning (`backlog` | `planning` → `planned`)

1. If `backlog`: transition to `planning`.
2. Launch the planner — prompt: `EFFORT: high\nRun /planner <issue-number>`. The planner writes the exec plan into `docs/exec-plans/active/`, updates the product spec (`docs/product-specs/`) if user/agent-facing behavior changes, and may touch `ARCHITECTURE.md` or `docs/design-docs/` if architecture shifts.
3. After planner returns, transition `planning` → `planned`.
4. Commit planning artifacts: `Plan #<number>: <short title>`. Push.
5. **Hard approval gate.** Post a comment on the Issue summarising the plan and the docs touched, then stop until the user resumes. Do not auto-proceed even if invoked autonomously — backend flow is the strict workflow.
6. Report: `Issue #{n} planned (backend). Model: {model} Effort: {effort}`.

### A2. Implementation (`planned` | `executing` → `executed`)

1. If `planned`: transition to `executing`.
2. Launch the coder — prompt: `EFFORT: high\nRun /coder <issue-number>`. The coder follows the plan, adds tests, runs `cargo clippy --all -- -D warnings`, runs `npx tsx scripts/lint-docs.ts` if TS changed, and runs `/test-fast`.
3. After coder returns, transition `executing` → `executed`.
4. Commit implementation: `Implement #<number>: <short title>`. Push.
5. Report: `Issue #{n} implemented (backend). Model: {model} Effort: {effort}`.

### A3. Testing (`executed` → `tested`)

Backend flow skips `ux-tester`. Treat `executed` as the end of testing and go straight to A4.

### A4. Completion

1. Move exec plan from `docs/exec-plans/active/` to `docs/exec-plans/completed/`.
2. Run `/pr` (or `gh pr ready <pr-number>`) to mark the draft PR ready. **Do not merge** — backend PRs are human-merge only.
3. Commit the plan move: `Complete #<number>: <short title>`. Push.
4. Strip the final status label: `gh issue edit <number> --remove-label executed`.
5. The Issue closes automatically when the human merges the PR.

### A5. Automated PR review (conditional)

After A4, decide whether to run an automated PR review. Trigger the reviewer when **any** of these signals is present:

- The Issue carries the `enhancement` label, or its body/title makes clear it introduces a new feature.
- The change is significant in scope: roughly more than ~300 lines or ~10 files changed (`git diff main...HEAD --stat | tail -1` for a quick gauge). Use judgement at the edges.
- The user explicitly asked for a review when invoking the manager — see "Modes & Arguments → User-direction signals". Examples: `/manager 777 and review it`, `/manager issue 777 with review`.

If none of these apply (small bugfix, doc-only tweak, mechanical refactor, no explicit ask), **skip A5** and continue to the next Issue.

If triggered:

1. Resolve the PR number for the current branch: `gh pr list --head <branch> --state open --json number,url --jq '.[0]'`.
2. Launch the `reviewer` subagent via the **Agent tool** (never the Skill tool — see the global rule below):

   ```
   Agent({
     description: "Review PR for issue {n}",
     subagent_type: "reviewer",
     prompt: "EFFORT: high\nReview PR #<pr-number> for Issue #<issue-number>. Run /review on the PR, then post the review summary as a PR comment. Do not approve or merge."
   })
   ```

3. Wait for the reviewer to return. It will post the review summary to the PR itself via `gh pr comment` and may file follow-up Issues for non-blocking concerns.
4. Read the reviewer's return message. If it flagged any **blocking** issue (severity that should not ship), do NOT advance to the next Issue — post a comment on the parent Issue summarising the blocker and stop. The user decides whether to address it now or defer.
5. If the review is clean or only raised follow-ups (filed as new Issues), continue to the next Issue.
6. Report: `Issue #{n} reviewed. Model: {model} Effort: {effort}` (extract from the reviewer's `MODEL: ... | EFFORT: ...` header).

The reviewer never closes the parent Issue, never merges the PR, and never approves via `gh pr review --approve`. Merge remains a human decision.

---

## Flow B — Frontend (non-trivial)

Plan first, but only pause for human input when the planner has Open Questions. Run `ux-tester` after implementation if the Issue carries a Figma reference.

### B1. Planning (`backlog` | `planning` → `planned`)

1. If `backlog`: transition to `planning`.
2. Launch the planner — prompt: `EFFORT: high\nRun /planner <issue-number>`. The planner writes the exec plan and **must** include an `## Open Questions` section (with `_None_` when nothing is unclear).
3. After planner returns, read the `## Open Questions` section of the generated plan file.
4. Transition `planning` → `planned`.
5. Commit planning artifacts: `Plan #<number>: <short title>`. Push.
6. **Conditional approval gate:**
   - If `## Open Questions` lists any items: post them as a comment on the Issue and stop until the user answers. Do not guess.
   - If empty (`_None_`): proceed immediately to B2. No blanket approval gate.
7. Report: `Issue #{n} planned (frontend). Model: {model} Effort: {effort}`.

### B2. Implementation (`planned` | `executing` → `executed`)

Identical to A2 but report tag `(frontend)`.

### B3. UX Testing (`executed` → `tested`)

Invoke `ux-tester` only when **both** conditions hold:

- The Issue (or its plan) references a Figma URL.
- The implementation diff touches frontend code. Check with `git diff main...HEAD --stat` if unsure.

If conditions met:

1. Transition `executed` → `testing`.
2. Launch `ux-tester` — prompt: `EFFORT: medium\nRun /ux-tester issue:<issue-number>`. The ux-tester files bugs as new GitHub Issues (`bug,backlog`) and updates `docs/QUALITY_SCORE.md`.
3. Bring any **critical** bug Issues to completion before continuing (recurse on each with full flow detection on that bug Issue).
4. Transition `testing` → `tested`.
5. Commit testing artifacts: `Test #<number>: <short title>`. Push.

If conditions not met, skip directly to B4.

### B4. Completion

Same as A4 (including "do not merge — frontend PRs are human-merge only"), but the final label to strip is whichever in-flight label is currently set (`tested` if you ran ux-tester, `executed` otherwise).

---

## Flow C — Trivial frontend

No planning, no approval gate, no ux-tester. Coder runs on `opus` at `effort: high`. The only quality bar is: lint clean, build clean, tests green.

### C1. Implementation (`backlog` → `executing` → `executed`)

1. Transition `backlog` → `executing` (skip `planning`/`planned` entirely).
2. Launch the coder via the Agent tool with an explicit model override:

   ```
   Agent({
     description: "Implement issue {n} (trivial frontend)",
     subagent_type: "coder",
     model: "opus",
     prompt: "EFFORT: high\nFlow: trivial-frontend.\nRun /coder {n}.\nThere is no execution plan — work from the Issue body and comments directly. After implementation, verify: lint passes, the frontend build succeeds, tests are green."
   })
   ```

3. After the coder returns, verify the working tree is green. Run from the manager:
   - `cargo clippy --all -- -D warnings` if Rust changed.
   - `npx tsx scripts/lint-docs.ts` if TS/docs changed.
   - The frontend build command appropriate for the changes (inspect `package.json` scripts or the relevant `packages/<frontend-pkg>/` README).
   - `/test-fast`.

   If any of these fail, post the failure summary as a comment on the Issue and stop — do not auto-recover; ask the user how to proceed.
4. Transition `executing` → `executed`.
5. Commit implementation: `Implement #<number>: <short title>`. Push.
6. Report: `Issue #{n} implemented (trivial-frontend). Model: opus Effort: high`.

### C2. Completion & admin merge

Flow C is the **only** flow where the manager merges its own PR. Backend (Flow A) and Frontend (Flow B) remain human-merge.

Branch protection on this repo requires an approval review before a normal merge can proceed, so GitHub's `--auto` flag would queue indefinitely waiting for that review. The repo admin (the user running this manager) can bypass branch protection via `gh pr merge --admin`. The manager uses that bypass **only after CI/CD checks have explicitly turned green** — `--admin` would also skip the checks-required gate, so the manager replaces that gate with an explicit poll-and-confirm loop. Red checks are never bypassed.

1. Mark the PR ready: `gh pr ready <pr-number>`.
2. Strip the final status label: `gh issue edit <number> --remove-label executed`.
3. **Initial wait — 10 minutes** to let CI/CD start and finish on a clean run:

   ```bash
   sleep 600
   ```

4. **Poll the PR's check status** every 10 minutes until checks resolve:

   ```bash
   gh pr view <pr-number> --json state,mergeable,mergeStateStatus,statusCheckRollup
   ```

   Interpret:

   | Result                                                                  | Action                                                                                  |
   |-------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
   | All checks `SUCCESS` in `statusCheckRollup`                              | Go to step 6 (admin merge).                                                             |
   | Any check `IN_PROGRESS` / `PENDING` / `QUEUED` and time elapsed < 60 min | Wait another 10 minutes (`sleep 600`) and re-poll.                                      |
   | Any check `FAILURE` / `CANCELLED` / `TIMED_OUT`                          | Stop. Post the failing-check summary to the PR and the parent Issue. Hand back to the user. Do NOT admin-merge with red checks. |
   | `mergeStateStatus` = `DIRTY`                                             | Stop. The PR has merge conflicts with `main` — needs manual rebase. Tell the user.       |
   | `state: "CLOSED"` and `merged: false`                                    | Abnormal — PR was closed without merging. Stop and tell the user.                       |

   Note: `mergeStateStatus = BLOCKED` is expected on this repo — it's the branch-protection "needs approval" signal, which `--admin` will bypass at merge time. Treat `BLOCKED` as "ok to proceed if checks are green". Do NOT bypass `DIRTY` (merge conflicts) — those require a human.

5. **Cap total wait at 60 minutes.** Track elapsed time from the start of step 3. If checks are still running after the initial 10-minute sleep plus five additional 10-minute polls (= 60 minutes total), stop and tell the user. Do not merge a PR whose checks have not landed.
6. **Admin-merge** the PR with squash strategy and branch deletion. The `--admin` flag bypasses the approval-required branch-protection rule (which is why this is authorized only for Flow C and only after checks are explicitly green):

   ```bash
   gh pr merge <pr-number> --admin --squash --delete-branch
   ```

   The `Closes #<number>` in the PR body closes the Issue automatically.
7. After merge, sync local `main` for the next Issue:

   ```bash
   git fetch origin
   git checkout main
   git pull --ff-only origin main
   ```

8. Increment the session counter and continue to the next Issue (per the trivial-loop's **Task Loop** rules).

---

## After every flow

- The Issue closes automatically when the PR merges (PR body contains `Closes #<number>`). Do **not** close the Issue manually.
  - Flows A and B: a human performs the merge, so closure happens at human-pace.
  - Flow C: the manager admin-merges the PR itself once checks pass per C2, so closure happens as soon as the merge command returns.
- Single-issue mode: report the final summary and stop. No automatic next-Issue pick.
- Trivial-loop mode: increment the session counter. If the counter has reached `max-tasks` (default 20) or there are no remaining trivial-frontend candidates, report the final summary and stop. Otherwise loop back to **Issue Selection → Trivial-loop mode** (the C2 step already syncs `main` for you).

## Per-flow phase map

| Flow              | Planning | Approval gate                | Implementation       | UX testing         | PR ready | Automated PR review | Merge      |
|-------------------|----------|------------------------------|----------------------|--------------------|----------|---------------------|------------|
| Backend           | ✅       | Always (hard gate after plan)| coder (sonnet/high)  | ❌                  | ✅       | reviewer (opus/high) on new features / significant changes / explicit user ask | Human      |
| Frontend          | ✅       | Only if Open Questions exist | coder (sonnet/high)  | If Figma + FE diff | ✅       | ❌                  | Human      |
| Trivial frontend  | ❌       | Never                        | coder (opus/high)    | ❌                  | ✅       | ❌                  | Manager admin-merge (`gh pr merge --admin --squash --delete-branch`) after CI green, 10-min poll, 60-min cap |

## Rules

- The manager does **not** write code, tests, plans, specs, or reviews itself. It delegates to planner, coder, ux-tester, and reviewer.
- The manager is the **only** agent that mutates lifecycle labels on Issues. Planner, coder, ux-tester, and reviewer never edit labels.
- The manager assigns the Issue to `@me` before any other action.
- The manager sets the next in-progress label (`planning`, `executing`, `testing`) **before** invoking each subagent and the done label (`planned`, `executed`, `tested`) **after** the subagent returns.
- The manager owns all commits and pushes related to lifecycle artifacts (plan, implementation, testing, plan archive).
- The manager **does** file critical bug Issues via `gh issue create` (or relies on `ux-tester` having filed them) and recurses on them.
- **Always launch planner/coder/ux-tester/reviewer via the Agent tool with the matching `subagent_type`** (`"planner"`, `"coder"`, `"ux-tester"`, `"reviewer"`). Read each skill's frontmatter only to extract `effort`.
- **Never use the Skill tool** for planner, coder, ux-tester, or reviewer delegation.
- Always verify the status label after each subagent completes before moving to the next phase.
- If a subagent fails or the Issue gets stuck, post a comment on the Issue and ask the user how to proceed.
- Follow `AGENTS.md`. In particular: never commit directly to `main`; always work on a feature branch. **Merge policy:** backend (Flow A) and frontend (Flow B) PRs are human-merge only — the manager never merges them. **Trivial-frontend (Flow C) PRs are the single exception**, expressly authorized by the user — the manager admin-merges them (`gh pr merge --admin --squash --delete-branch`) per the C2 procedure. The `--admin` flag bypasses the repo's approval-required branch protection; CI/CD checks are NOT bypassed — the manager polls explicitly and only merges after every check reports `SUCCESS` within the 60-minute cap. Red checks, merge conflicts (`DIRTY`), or unresolved within cap → stop and hand back to the user.
- Each subagent runs in the foreground — wait for it to complete before proceeding.

## Output

After an Issue reaches the PR-ready state, report:

- Issue number, title, and PR URL
- Phases completed
- Tests run and results
- Bug Issues filed (if any), with severity and current state
- Branch name and head commit
