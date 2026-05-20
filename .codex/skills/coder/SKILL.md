---
name: coder
description: Implement a planned Pipeline GitHub Issue by number. Use when Codex is asked to execute an active plan end-to-end, update code/tests/docs, mark plan steps complete, run the relevant verification commands, and report results without editing issue labels, closing the Issue, moving the plan, or committing.
---

# Coder

Implement exactly one GitHub Issue. The manager owns lifecycle labels, commits, pushes, and plan archival.

Start and finish with:

```text
MODEL: <model> | EFFORT: <effort>
```

## Required Context

1. Read `AGENTS.md`.
2. Read the Issue and comments:

   ```bash
   gh issue view <number> -c
   gh issue view <number> --json title,body,labels,assignees,url
   ```

3. Read `.codex/skills/issue/SKILL.md`.
4. Read the active execution plan: `docs/exec-plans/active/issue-<number>-*.md`.

If the caller explicitly says `Flow: trivial-frontend`, there may be no plan. In that case, work directly from the Issue body and comments.

## Workflow

1. Confirm the user supplied an Issue number.
2. Read the Issue, comments, labels, and active plan.
3. If no active plan exists and this is not `Flow: trivial-frontend`, stop and report that planning is missing.
4. Implement the Issue end-to-end:
   - Follow plan steps in order.
   - Add or update tests where useful.
   - Update docs listed in `Docs to Update`.
   - If the Issue or plan references Figma, use it as an implementation reference.
5. Mark completed plan steps as you go. Do not create a plan for trivial frontend mode.
6. Run verification scaled to the changes:
   - Rust changes: `cargo clippy --all -- -D warnings`.
   - TypeScript or docs changes: `npx tsx scripts/lint-docs.ts`.
   - Frontend changes: run the relevant frontend lint/build scripts from `package.json` or package docs.
   - Run the repo's fast test workflow when available.
7. Fix failures before reporting done. If blocked by environment or dependency failures, report exact commands and errors.

## Rules

- Do not edit Issue labels, assign, close, commit, push, or move the plan to completed.
- Do not ask for approval during implementation; execute the plan.
- Respect existing code patterns and architecture boundaries.
- Do not fix unrelated bugs inline. Log them in `docs/exec-plans/known-bugs.md` with date, location, symptom, root cause if known, and workaround.
- Log intentional shortcuts or structural gaps in `docs/exec-plans/tech-debt-tracker.md`.
- If the plan is wrong or incomplete, use judgement, note the deviation in the final report, and comment on the Issue.
- Never revert user changes or unrelated worktree changes.

## Trivial Frontend Mode

When the caller says `Flow: trivial-frontend`:

- Work from the Issue body and comments.
- Do not invent an execution plan.
- Keep changes self-contained to the frontend.
- Leave lint, build, and relevant tests green.
- Touch product docs only when behavior visibly changes.

## Output

Report:

- Issue number and title
- What changed
- Tests added or updated
- Verification commands and pass/fail results
- Docs updated
- Plan deviations, blockers, or concerns
