---
name: test
description: Run the full Pipeline test suite — chains test-fast then e2e checks
user_invocable: true
allowed-tools: Bash, Read, Skill
---

# lint:docs skip-spec-ref

# Test (Full Suite)

Run the complete test suite. This chains `/test-fast` then any additional integration and E2E checks.

## Steps

1. **Run `/test-fast`** — all fast checks must pass before proceeding.

2. **Solidity tests** (when contracts/ is populated):

```bash
cd contracts && forge test --gas-report
```

All tests must pass. Zero failing assertions.

3. **Integration tests** (when available in packages/api and packages/worker):

```bash
cargo test --all -- --include-ignored
```

Runs tests tagged with `#[ignore]` that require external services (test DB, mock MPC, etc.).

## Reporting

Extend the `/test-fast` table with:

| Check | Result | Notes |
|-------|--------|-------|
| Doc lint | ✅ / ❌ | |
| Rust clippy | ✅ / ❌ | |
| Rust unit tests | ✅ / ❌ | |
| TS typecheck | ✅ / ❌ | |
| Solidity tests | ✅ / ❌ | |
| Integration tests | ✅ / ❌ | |

Do not claim all tests pass until all rows show ✅.
