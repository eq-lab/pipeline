---
name: manager
description: Orchestrate Pipeline GitHub Issues end-to-end. Use when Codex is asked to run the manager workflow for one Issue or the trivial frontend backlog, claim the Issue, choose backend/frontend/trivial flow from labels, create or reuse a branch and draft PR, delegate planning/coding/UX testing/review, manage lifecycle labels, commits, pushes, and completion rules.
---

# Manager

Drive GitHub Issues through the Pipeline workflow. The manager owns lifecycle labels, branch/PR setup, commits, pushes, and final workflow reporting. Invoking this skill explicitly authorizes the manager to delegate phase work to Codex subagents when available.

Start with:

```text
MODEL: <model> | EFFORT: <effort>
```

## Arguments

Single Issue mode:

- `<number>`
- `issue <number>`
- optional free text such as `and review it`

Trivial loop mode:

- `trivial`
- `trivial <max-tasks>`

If the argument cannot be parsed, ask for clarification.

## Required Context

Read before taking action:

1. `AGENTS.md`
2. `.codex/skills/issue/SKILL.md`
3. The target Issue: `gh issue view <number> -c`

## Claim And Classify

1. Assign the Issue to yourself:

   ```bash
   gh issue edit <number> --add-assignee @me
   ```

2. Verify it is not assigned to someone else.
3. Read labels:

   ```bash
   gh issue view <number> --json labels --jq '.labels[].name'
   ```

4. Choose the flow:
   - `frontend` + `trivial`: Flow C, trivial frontend.
   - `frontend` without `trivial`: Flow B, frontend.
   - `backend`: Flow A, backend.
   - neither `backend` nor `frontend`: stop; not dev work.
   - both `backend` and `frontend`: stop, comment on the conflict, and ask the user.

## Common Prelude

For a fresh Issue:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b <prefix>/<slug>
git commit --allow-empty -m "chore: start work on #<number>"
git push -u origin <branch>
gh pr create --draft --title "<issue title>" --body "Closes #<number>"
```

If resuming an existing branch/PR, check it out and pull it fast-forward only. Never force-reset `main`.

## Delegation

Prefer Codex `spawn_agent` with `agent_type: "worker"` for planner, coder, UX tester, and reviewer phases. Use `fork_context: true` when the subagent needs the same repo and issue context. Give each subagent a bounded prompt:

```text
Use $planner to plan issue <number>.
```

```text
Use $coder to implement issue <number>.
```

```text
Use $ux-tester to test issue:<number>.
```

For automated PR review, ask a worker to review the PR in code-review stance, post a PR comment, and not approve or merge.

If subagents are unavailable, run the phase locally while preserving the same boundaries: planner does not implement, coder does not edit labels or commit, UX tester files bugs and updates quality docs, manager commits and pushes.

## Flow A: Backend

Use for Rust crates, contracts, workers, scripts, docs-only work, and anything uncertain.

Planning:

1. `backlog` to `planning`.
2. Run `$planner <number>`.
3. `planning` to `planned`.
4. Commit and push planning artifacts: `Plan #<number>: <short title>`.
5. Comment with plan summary and stop for human approval.

Implementation after approval:

1. `planned` to `executing`.
2. Run `$coder <number>`.
3. `executing` to `executed`.
4. Commit and push: `Implement #<number>: <short title>`.

Completion:

1. Move the plan from `docs/exec-plans/active/` to `docs/exec-plans/completed/`.
2. Mark the draft PR ready.
3. Commit and push: `Complete #<number>: <short title>`.
4. Remove the final status label.
5. Do not merge. Backend PRs are human-merge only.

Automated review is optional after completion when the Issue is an enhancement, the diff is significant, or the user explicitly asked for review. If review finds a blocker, comment and stop.

## Flow B: Frontend

Planning:

1. `backlog` to `planning`.
2. Run `$planner <number>`.
3. Read `## Open Questions` in the plan.
4. `planning` to `planned`.
5. Commit and push planning artifacts.
6. If open questions are not `_None_`, comment with them and stop. Otherwise continue.

Implementation:

1. `planned` to `executing`.
2. Run `$coder <number>`.
3. `executing` to `executed`.
4. Commit and push implementation.

UX testing:

Run `$ux-tester issue:<number>` only when the Issue or plan references Figma and the diff touches frontend code. Transition `executed` to `testing`, then `testing` to `tested`, and commit testing artifacts. Critical bug Issues must be addressed before completion.

Completion:

Move the plan to completed, mark the PR ready, commit/push the plan move, remove the current status label, and stop. Frontend PRs are human-merge only.

## Flow C: Trivial Frontend

Use only for `frontend` + `trivial`.

1. `backlog` to `executing`.
2. Run `$coder <number>` with this prompt included:

   ```text
   Flow: trivial-frontend.
   There is no execution plan. Work from the Issue body and comments directly. Verify lint, frontend build, and relevant tests are green.
   ```

3. From the manager, rerun frontend lint/build/test checks appropriate for the diff.
4. If checks fail, comment on the Issue and stop.
5. `executing` to `executed`.
6. Commit and push: `Implement #<number>: <short title>`.
7. Mark PR ready and remove `executed`.
8. Poll PR checks until every check is `SUCCESS`. Red checks, conflicts, or unresolved checks within the cap stop the flow.
9. Only after checks are green, admin-merge with squash and branch deletion:

   ```bash
   gh pr merge <pr-number> --admin --squash --delete-branch
   ```

Flow C is the only manager-owned merge path. Do not admin-merge backend or non-trivial frontend PRs.

## Trivial Loop

When invoked as `trivial [max-tasks]`, repeatedly pick open `backlog,frontend,trivial` Issues that are unassigned or assigned to you. Prefer `priority`, then lower issue number. Stop when the cap is reached, no candidates remain, or a task fails verification.

## Rules

- Only one lifecycle status label may be present at a time.
- The manager is the only phase owner that edits lifecycle labels.
- The manager commits phase artifacts after subagents return.
- Do not close Issues manually when the PR body contains `Closes #<number>`.
- Do not merge Flow A or Flow B PRs.
- Never bypass red CI checks or merge conflicts.
- If a subagent fails or work is blocked, comment on the Issue and ask the user how to proceed.

## Output

Report:

- Issue number, title, branch, and PR URL
- Flow and phases completed
- Commits pushed
- Tests/checks run and results
- Bugs filed or blockers found
- Whether merge was left to a human or completed under Flow C
