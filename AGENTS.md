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

Humans steer, agents execute. Follow this strict order for every task:

0. **Pick or add a task.** NEVER skip this step. Every piece of work MUST have a GitHub Issue before any other step begins. Use the `/issue` skill to create or pick up an issue. Do not write any code, create any files, or modify any documentation until an issue exists and you are on a feature branch.

1. **Specification first.** Before writing any code, create or update the relevant product spec in `docs/product-specs/`. A product spec describes **what the feature does and how it behaves** — not how to fix a bug or patch existing code. **Skip this step for purely technical tasks** (`chore/`, `fix/` branches) that don't change user- or agent-facing behavior — the exec plan is sufficient documentation for those. See [`docs/product-specs/index.md`](./docs/product-specs/index.md) for format guidelines and examples. If the change affects architecture, update `ARCHITECTURE.md` or add a design doc in `docs/design-docs/`.

2. **Execution plan.** Create a step-by-step plan in `docs/exec-plans/active/<feature>.md`. Break the work into numbered steps with dependencies, test criteria, and estimated complexity. **Every plan must include a dedicated testing step** — unit tests for pure logic, integration tests for repos and endpoints. Use existing completed plans as templates. The plan is the contract — do not deviate without updating it first.

3. **Documentation update.** Before writing implementation code, update all affected documentation: product specs, reliability docs, generated schema docs. Documentation leads, code follows. If docs are stale after the change, the task is not done.

4. **Review & approval.** Present the updated documentation and execution plan to the user. Get explicit approval before proceeding to implementation. Do not start coding until the user confirms the spec and plan are correct.

5. **Implementation.** Write code following the plan step by step. Mark each step as completed in the exec plan as you go. Write unit tests for new logic and integration tests for new repos/endpoints — tests are not optional. Never batch multiple unrelated changes into one step.

6. **Testing.** Run `/test-fast`. Fix all failures before moving on.

7. **Archive the exec plan.** Move it from `docs/exec-plans/active/` to `docs/exec-plans/completed/`.

8. **Commit and push.** Commit with a clear message explaining the "why". Push the feature branch.

9. **Open a PR.** Run the `/pr` skill. Ensure the body includes `Closes #<issue-number>` — this auto-closes the linked issue when the PR merges.

## Rules

### Git

- NEVER commit or push directly to `main`. All changes reach `main` only through a PR from a feature branch.
- Create a feature branch for every task: `feat/`, `fix/`, `docs/`, `chore/` prefixes.
- Push the branch, open a PR, and wait for review before merging.
- NEVER merge a PR unless the human explicitly asks to merge it.

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
