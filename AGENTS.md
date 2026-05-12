# AGENTS

This file is the map, not the encyclopedia. It defines the harness engineering process — the strict workflow that all coding agents follow.

## Start here

Before doing anything, orient yourself:

1. Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) for domain boundaries, allowed dependency directions, and provider entry points.
2. Check [GitHub Issues](https://github.com/eq-lab/pipeline/issues) for existing work — your task may already be defined.
3. Check [`docs/exec-plans/active/`](./docs/exec-plans/active/) for in-flight plans — your task may already have a plan.
4. Treat `docs/` as the source of truth for product, design, planning, and operational knowledge.
5. Prefer progressive disclosure: open only the documents needed for the current task.

## Navigation

Planning & tracking:

- [GitHub Issues](https://github.com/eq-lab/pipeline/issues) — team backlog and task board (use `/issue` skill to manage)
- [`docs/exec-plans/active/`](./docs/exec-plans/active/) — in-flight work with progress and decision logs
- [`docs/exec-plans/completed/`](./docs/exec-plans/completed/) — archived execution plans
- [`docs/exec-plans/known-bugs.md`](./docs/exec-plans/known-bugs.md) — bugs found during development, not yet fixed
- [`docs/exec-plans/tech-debt-tracker.md`](./docs/exec-plans/tech-debt-tracker.md) — known gaps and cleanup work

Product & design:

- [`docs/user-docs/index.md`](./docs/user-docs/index.md) — user-facing documentation (lenders, borrowers, security)
- [`docs/product-specs/index.md`](./docs/product-specs/index.md) — product intent and feature specs
- [`docs/design-docs/index.md`](./docs/design-docs/index.md) — design catalog and verification status
- [`docs/design-docs/core-beliefs.md`](./docs/design-docs/core-beliefs.md) — agent-first operating principles
- [`docs/product-specs/user-stories.md`](./docs/product-specs/user-stories.md) — testable user stories (E2E/QA acceptance criteria)

Operational:

- [`docs/PLANS.md`](./docs/PLANS.md) | [`docs/PRODUCT_SENSE.md`](./docs/PRODUCT_SENSE.md) | [`docs/QUALITY_SCORE.md`](./docs/QUALITY_SCORE.md) | [`docs/RELIABILITY.md`](./docs/RELIABILITY.md) | [`docs/SECURITY.md`](./docs/SECURITY.md) | [`docs/FRONTEND.md`](./docs/FRONTEND.md)

Reference:

- [`docs/references/index.md`](./docs/references/index.md) — external references and vendor documentation pointers
- [`docs/generated/`](./docs/generated/) — generated reference material (schema dumps, codegen output)

## Workflow

Every piece of dev work starts with a GitHub Issue and runs end-to-end through the [`manager`](./.claude/skills/manager/SKILL.md) skill. Any Issue ready for development MUST carry exactly one flow label (`backend` or `frontend`). Issues without a flow label are not dev work (discussion, questions, tracking) and the manager will skip them.

- **Backend** (`backend` label) — strict spec-first / plan / human approval / implement / test / archive / PR. The full belt-and-suspenders flow.
- **Frontend** (`frontend` label) — plan, but the human approval gate fires only if the planner has Open Questions. Implement, then `ux-tester` if a Figma reference exists.
- **Trivial frontend** (`frontend` + `trivial` labels) — no planning, no approval gate, no ux-tester. `coder` runs at `model: opus` / `effort: high` and must leave the working tree linting, building, and green on tests.

When uncertain about frontend vs. backend, label it `backend`. The full step-by-step contract for each flow lives in [`.claude/skills/manager/SKILL.md`](./.claude/skills/manager/SKILL.md).

## Rules

### Git

- NEVER commit or push directly to `main`. All changes reach `main` only through a PR from a feature branch.
- Create a feature branch for every task: `feat/`, `fix/`, `docs/`, `chore/` prefixes.
- Push the branch, open a PR, and wait for review before merging.
- **Merge policy.** Backend (Flow A) and frontend (Flow B) PRs are human-merge only. Trivial-frontend (Flow C) PRs are the single exception: the `manager` skill is authorized to enable GitHub auto-merge (`gh pr merge --auto`) on its own Flow C PRs, so GitHub completes the merge once required checks pass. The manager itself never performs an unconditional merge. See [`manager/SKILL.md`](./.claude/skills/manager/SKILL.md) for the polling procedure. Outside Flow C, never enable auto-merge or otherwise merge a PR without explicit human direction.

### Lint & style

- After any Rust change, run `cargo clippy --all -- -D warnings` and verify it passes.
- After any TypeScript change, run `npx tsx scripts/lint-docs.ts` to validate documentation structure.
- Never commit code that fails linting. Fix all errors before committing.

### Docs-first

- Skills that inspect or test product behavior must read the relevant product spec before executing.
- Documentation leads, code follows.

### Bug tracking

- If you discover a bug unrelated to the current task, log it in [`docs/exec-plans/known-bugs.md`](./docs/exec-plans/known-bugs.md) with date, location, symptom, root cause, and any workaround. Do not fix it inline.

### Tech debt

- If you take a shortcut or notice a structural gap, log it in [`docs/exec-plans/tech-debt-tracker.md`](./docs/exec-plans/tech-debt-tracker.md). Don't fix inline.

## Meta

- Keep this file under 100 lines. Put detailed guidance in the relevant `docs/` file.
- Update docs when behavior, product decisions, or architectural rules change.
