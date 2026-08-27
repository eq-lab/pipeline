# Issue #1003: frontend vitest suite broken (Node webstorage vs jsdom) — and not run in CI

Source: https://github.com/eq-lab/pipeline/issues/1003

## Scope

1. **Neutralize the Node experimental WebStorage global** that shadows jsdom's `localStorage` (Node 20.19+/22+): bake `NODE_OPTIONS=--no-experimental-webstorage` into the `test` / `test:watch` scripts of all three jsdom workspaces (`frontend`, `wallet-connect`, `trustee`). Verified 2026-08-27: with the flag the full frontend suite runs 1530/1532.
2. **Fix the 2 remaining failures** — not flakes: `-deposit.test.tsx` "toast emissions" tests still assert the pre-#1142 title "Deposit submitted"; since #1142 a non-empty amount renders "Deposited {amount} USDC". Stale-while-broken — exactly the zero-signal cost this issue describes.
3. **Add a JS unit-test job to CI** (`.github/workflows/tests.yml`): Node 22 + corepack yarn, `yarn install --immutable`, then the three workspace `test` scripts.
4. **Resolve the duplicate known-bugs entries** (BUG-18, and the BUG-6/BUG-8 remnants already consolidated into this issue) once green.

## Assumptions and Risks

- `--no-experimental-webstorage` requires Node ≥20.19 (where the flag exists); older Nodes reject unknown NODE_OPTIONS. CI pins Node 22; the repo has no `engines` pin — noted, not added here.
- `wallet-connect` and `trustee` suites have not been run recently on this machine; the CI job will surface their true state — any real failures found get fixed here if small, or logged and the job scoped accordingly (no silently-skipped suites).

## Open Questions

_None_

## Implementation Steps

1. `packages/{frontend,wallet-connect,trustee}/package.json`: prefix `test`/`test:watch` with `NODE_OPTIONS=--no-experimental-webstorage`.
2. `packages/frontend/src/routes/-deposit.test.tsx`: update the two toast assertions to the #1142 titles ("Deposited 2000 USDC" + View), including the StrictMode dedup test.
3. `.github/workflows/tests.yml`: add `js-unit-tests` job (checkout, setup-node 22, corepack enable, `yarn install --immutable`, run the three workspace tests).
4. Run all three suites locally via the new scripts; fix or log anything real that surfaces.
5. `docs/exec-plans/known-bugs.md`: resolve BUG-18 (both halves) and the BUG-6/BUG-8 localStorage entries with pointers to this issue.

## Test Strategy

The change IS the test infrastructure: all three suites green via `yarn workspace <pkg> test` locally, and the new CI job green on this PR (it runs the suites on a clean runner — the real proof).

## Docs to Update

`docs/exec-plans/known-bugs.md`; CI workflow is self-documenting.
