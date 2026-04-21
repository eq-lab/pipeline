---
name: test-fast
description: Run fast lint + unit + integration tests for the Pipeline protocol
user_invocable: true
allowed-tools: Bash, Read
---

# lint:docs skip-spec-ref

# Test Fast

Run the full fast test suite: doc lint → Rust checks → Rust tests → TypeScript checks.

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

### 4. TypeScript type check (frontend)

```bash
cd packages/frontend && npx tsc --noEmit
```

Zero type errors permitted.

## Reporting

Report results as a pass/fail table:

| Check | Result | Notes |
|-------|--------|-------|
| Doc lint | ✅ / ❌ | N errors, N warnings |
| Rust clippy | ✅ / ❌ | |
| Rust tests | ✅ / ❌ | N passed, N failed |
| TS typecheck | ✅ / ❌ | |

If any check fails, list the failures and stop. Do not proceed to the next step in the workflow until all checks pass.
