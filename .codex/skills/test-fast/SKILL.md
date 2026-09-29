---
name: test-fast
description: Run Pipeline's fast documentation, Rust, and frontend verification checks. Use for a requested fast test pass or as the coding workflow's broad verification gate.
---

# lint:docs skip-spec-ref

# Test Fast

Run the fast suite: doc lint → Rust lint and tests → frontend lint, build, and tests.

## Steps

Run all steps. Report failures immediately — do not skip ahead.

### 1. Documentation lint

```bash
npx tsx scripts/lint-docs.ts
```

Fix any errors before proceeding. Warnings are informational.

### 2. Rust lint (all packages)

```bash
cargo clippy --all -- -D warnings
```

Zero warnings permitted. Fix all before proceeding.

### 3. Rust tests

```bash
cargo test --all
```

All tests must pass.

### 4. Frontend lint, build, and tests

```bash
yarn workspace @pipeline/frontend lint
yarn workspace @pipeline/frontend build
yarn workspace @pipeline/frontend test
```

The build includes the TypeScript project check. Stop at the first failure and report the exact command.

## Reporting

Report results as a pass/fail table:

| Check | Result | Notes |
|-------|--------|-------|
| Doc lint | ✅ / ❌ | N errors, N warnings |
| Rust clippy | ✅ / ❌ | |
| Rust tests | ✅ / ❌ | N passed, N failed |
| Frontend lint | ✅ / ❌ | |
| Frontend build/typecheck | ✅ / ❌ | |
| Frontend tests | ✅ / ❌ | |

If any check fails, list the failures and stop. Do not proceed to the next step in the workflow until all checks pass.
