---
name: coder
description: Execute a planned GitHub Issue by its number. Takes an issue number as argument. Implements the execution plan end-to-end including code and tests. Does not edit issue labels and does not commit.
---

# Coder

Use this skill when the user (or the manager subagent) asks to implement a planned GitHub Issue.

The user must provide an Issue number as argument. If none is provided, ask for one.



## Required Context

Read these before taking action:

1. `AGENTS.md`
2. The Issue itself: `gh issue view <number> -c` — body, comments, labels.
3. The active execution plan: `docs/exec-plans/active/issue-<number>-*.md`.
4. The `issue` skill: `.codex/skills/issue/SKILL.md` — for label/lifecycle conventions.

Read additional docs only when needed for the task.
Read the relevant `docs/product-specs/` pages before changing or testing product behavior.

## Reading the Issue

```bash
gh issue view <number> -c
gh issue view <number> --json title,body,labels,assignees,url
```

Treat the body as the authoritative "what" and the execution plan as the authoritative "how".

## Workflow

1. Read the Issue with `gh issue view <number> -c`.
2. Read the active execution plan in `docs/exec-plans/active/` (look for `issue-<number>-*.md`).
3. If the plan is missing and the caller has not indicated the trivial-frontend or docs flow, stop and tell the caller — the planner phase has not completed.
4. **No-plan modes**: for `Flow: trivial-frontend` or `Flow: docs`, work directly from the Issue body, comments, and parent epic. Do not invent an exec plan. Still satisfy the relevant lint/build/test gate below.
5. Implement the Issue end-to-end:
   - Write the code changes described in the plan (or, in trivial-frontend mode, derived from the Issue).
   - Add or update automated tests where applicable.
   - After Rust changes: `cargo clippy --all -- -D warnings` must pass.
   - After TypeScript changes: `npx tsx scripts/lint-docs.ts` must pass.
   - For frontend changes: run the relevant frontend build (check `package.json` scripts or the affected `packages/<pkg>/` README) and confirm it succeeds.
   - Run `$test-fast` and fix all failures before reporting done.
6. For implementation work attached to an epic, add a user-stories doc at `docs/user-stories/epic-<epic>/<issue>-<slug>.md` and link it from `docs/user-stories/index.md` in the same PR (ISSUE_PROTOCOL §6). Update an existing story for a user-visible bug fix. Docs-only work does not require a story.
7. Mark each step in the exec plan as completed as you go (edit the plan file). No-plan modes have no plan to mark.
8. Update affected documentation (product specs, design docs, generated reference) per the plan's "Docs to Update" section. In no-plan modes, update docs when behavior actually changed.
9. Report to the caller what was done, including test results.

## Rules

- Do **not** edit issue labels. The manager owns lifecycle transitions.
- Do **not** assign or close the Issue.
- Do **not** commit. The manager will commit the implementation together with the label change.
- Do **not** ask the user for approval during implementation. Execute the plan.
- Do **not** move the execution plan to `docs/exec-plans/completed/` — the manager does that during Phase 4.
- Follow `AGENTS.md`. Never commit to `main`. Always work on the feature branch already opened for this Issue.
- Respect dependency order. If the Issue depends on unfinished work, explain and stop.
- If the Issue body or plan references a Figma URL, use it as an implementation reference. Epic QA verifies the rendered page later.
- When implementation changes behavior, update the relevant product spec or design doc.
- Log unrelated bugs found during implementation in `docs/exec-plans/known-bugs.md` — do not fix them inline.
- Log structural shortcuts in `docs/exec-plans/tech-debt-tracker.md` — do not fix them inline.

## Execution Plan Adherence

Follow the execution plan closely:

- Implement each step in the order specified.
- If the plan includes a test strategy, follow it.
- If you encounter something the plan did not anticipate, use your best judgment and note the deviation in your report and as a comment on the Issue (`gh issue comment <number> --body "<note>"`).

## Output

When done, report:

- Issue number and title
- What was implemented
- Tests added or updated
- Test results (pass/fail) including `cargo clippy` and `$test-fast` outcomes
- Docs updated
- Any deviations from the plan (also noted on the Issue)
- Any blockers or concerns
