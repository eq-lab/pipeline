# Issue #401: Stake/Unstake rows in transaction history show zero values

Source: https://github.com/eq-lab/pipeline/issues/401

## Scope

Fix the home Activity card and `/transactions` page so that Stake and Unstake rows display the actual `assets` (PLUSD) and `shares` (sPLUSD) amounts instead of `0` on both lines.

Investigation must determine which layer is responsible for the zero values and apply the fix there. The most likely root cause locations, in order of suspicion:

1. **Backend query** (`packages/shared/src/kyc_repo.rs::get_all_requests`) — the JSONB extraction `(r.params->>'assets')::numeric` could be returning NULL for staking events if the indexer wrote those fields under different keys or if the contract_logs row for `StakingDeposit`/`StakingWithdrawal` does not contain `assets`/`shares` JSONB keys at the moment the analytics query runs.
2. **Indexer parser/mapper** (`packages/worker/src/indexer/parsers.rs::parse_staking_deposit` / `parse_staking_withdraw` and `packages/worker/src/indexer/mappers.rs::compute_position_fields`) — verify `params.assets` and `params.shares` are persisted as decimal strings and are not stripped or overwritten by `compute_position_fields` when it writes `shares_balance` / `avg_buy_share_price` back into the same JSONB column.
3. **Frontend renderer fallback** (`packages/frontend/src/components/activity/renderRequestRow.tsx:145-178`) — the `?? "0"` fallback for `shares` and `?? item.amount` fallback for `assets` masks missing fields. Once the data layer is fixed, the fallback should remain as a defensive guard but never be hit in practice.

In scope:
- Identify the layer that produces `assets:"0"` / `shares:"0"` (or omits them) in the `/v1/requests` response for a wallet with real Stake/Unstake history.
- Patch that layer.
- Add a regression test at the layer of the fix, plus a renderer-level test that asserts non-zero formatted output for a realistic Stake/Unstake `RequestItem`.

Out of scope:
- Visual redesign of the Stake/Unstake rows (Figma node `1497:94912` already defines the two-line amount block).
- New API fields or schema changes — `assets` and `shares` already exist on `RequestItem` (`packages/frontend/src/api/useRequests.ts:30-43`) and on the backend `RequestItem` (`packages/api/src/routes/analytics.rs:37-56`).
- The `Pending` Stake/Unstake state — the spec (`docs/product-specs/staking.md`) confirms stake/unstake are atomic on-chain transitions, so `StakingDeposit`/`StakingWithdrawal` events are always `Completed`.

## Assumptions and Risks

- Assumes the bug is reproducible from a real (or seeded local DB) wallet with at least one `StakingDeposit` and `StakingWithdrawal` row in `contract_logs`. If the issue cannot be reproduced from the current code on `main`, the bug may already be fixed by a recent commit (e.g. `6fa78f0 fix: staking events use assets/shares only, not legacy amount field`) — verify on `main` HEAD before writing code.
- The `activity-all-types` scenario in `packages/frontend/src/routes/test/-scenarios.ts:276-318` already seeds correct `assets`/`shares` for Stake/Unstake. The bug therefore is **not** reproducible from that mock scenario — repro requires either (a) a different scenario that omits the fields, (b) the live backend, or (c) a wallet whose indexed events lack the JSONB fields. The investigator must reproduce against the live backend or a freshly seeded DB.
- Risk: `compute_position_fields` mutates the same `params` JSONB column post-parse. If a downstream writer replaces (rather than merges) `params`, `assets`/`shares` could be dropped after the row is first written. Verify by inspecting an actual `contract_logs` row for a staking event.
- No backend Issue exists for this; if the root cause is backend, all changes land in this Issue's branch.

## Open Questions

- Has the reporter confirmed the bug on the current `main` HEAD, or only on an older deployment? (If only old, we may need to bisect rather than fix.)
- Should the renderer keep the `?? "0"` / `?? item.amount` fallbacks once the data path is fixed, or fail loudly (e.g. render `—`) so future regressions are visible? Default in the plan: keep fallbacks but make them visible via a follow-up tech-debt note.

## Implementation Steps

1. **Reproduce.** Start the local stack (`yarn dev` per `docs/FRONTEND.md`), connect a wallet that has a `StakingDeposit` and `StakingWithdrawal` in the indexed DB. If no such wallet exists locally, insert two synthetic `contract_logs` rows mirroring `parse_staking_deposit` / `parse_staking_withdraw` output, then call `GET /v1/requests?wallet=<addr>` directly with `curl` and inspect the raw JSON. Confirm whether `assets` and `shares` are present and non-zero, or `"0"`, or omitted.
2. **Classify the failure.** Based on step 1:
   - If the API JSON has `"assets":"0"` / `"shares":"0"` or these keys are missing → bug is backend.
   - If the API JSON has correct values but the frontend still renders zeros → bug is frontend.
3. **Backend path (if step 2 picks backend):**
   - Inspect `contract_logs.params` for the offending row(s). Confirm whether `assets`/`shares` JSONB keys exist.
   - If the JSONB lacks the keys, fix the writer:
     - `packages/worker/src/indexer/parsers.rs::parse_staking_deposit` and `parse_staking_withdraw` already serialise both fields — verify the codepath actually runs on the affected logs (chain id filter, contract address allowlist).
     - `packages/worker/src/indexer/mappers.rs::compute_position_fields` writes `shares_balance` / `avg_buy_share_price` back into `params`. Verify it **merges** rather than replaces the JSONB object, preserving `assets` and `shares`. If it replaces, change to a JSONB merge.
   - If the JSONB has the keys but the SQL coerces them to `0`, fix the cast in `packages/shared/src/kyc_repo.rs::get_all_requests` — current SQL is:
     ```sql
     (r.params->>'assets')::numeric AS assets,
     (r.params->>'shares')::numeric AS shares,
     ```
     Confirm `(r.params->>'assets')` returns the decimal-string form and not e.g. a quoted scientific notation. If needed, add COALESCE or fallback to legacy keys.
   - Add a Rust integration test under `packages/shared` (or `packages/api`) that inserts a synthetic `StakingDeposit` row with non-zero `assets`/`shares` and asserts `get_all_requests` returns those values.
4. **Frontend path (if step 2 picks frontend, or as belt-and-suspenders):**
   - In `packages/frontend/src/components/activity/renderRequestRow.tsx:145-178`, keep the existing logic but tighten the fallback story. Specifically: remove the `?? item.amount` for `assets` because the contract guarantees both `assets` and `shares` are present for `Stake`/`Unstake` (`docs/product-specs/staking.md`, `packages/api/src/routes/analytics.rs:46-51`). Treat their absence as a data bug — render `—` for the missing line so the regression is loud next time. Optional: add a `console.warn` in dev mode.
   - Verify `formatTokenAmount("1000000000000000000000", 18) === "1,000.00"` (already covered by `packages/frontend/src/lib/format.test.ts`) — no change needed there.
5. **Regression coverage.**
   - Add or extend a renderer test in `packages/frontend/src/routes/-transactions.test.tsx` (already has Stake/Unstake fixtures at lines 96-104 and 445-453) that explicitly asserts the rendered text contains the non-zero PLUSD and sPLUSD numerals — currently the tests assert structure only.
   - Add a scenario in `packages/frontend/src/routes/test/-scenarios.ts` (or extend `activity-all-types`) that exercises Stake/Unstake **with the realistic post-fix payload** so QA can eyeball it on `/test`.
6. **Doc touch-ups.**
   - If the bug was backend, add a one-line note to `docs/product-specs/staking.md` reaffirming that the `/v1/requests` payload for Stake/Unstake always carries `assets` and `shares` (it is already documented in the OpenAPI schema, but a cross-link helps).
   - No spec change required if the bug is purely frontend renderer behaviour.
7. **Lint and test gates.**
   - `cargo clippy --all -- -D warnings` after any Rust change.
   - `npx tsx scripts/lint-docs.ts` after any TS or docs change.
   - `yarn workspace @pipeline/frontend test` for the touched frontend modules.
   - `cargo test -p pipeline-shared -p pipeline-api` for the touched backend modules.

## Test Strategy

- **Unit (frontend).** Extend `packages/frontend/src/routes/-transactions.test.tsx` and/or `packages/frontend/src/components/RecentActivityCard.test.tsx`: render a Stake item with `assets:"1000000000000000000000"`, `shares:"999500000000000000000"` and assert the row text contains `−1,000.00 PLUSD` and `+999.50 sPLUSD`. Mirror for Unstake.
- **Unit (frontend renderer).** Add a direct unit test for `renderRequestRow` covering the "missing fields" branch — once the fallback is tightened to `—`, the test asserts that behaviour.
- **Backend integration.** If the fix touches `kyc_repo.rs`, add a sqlx test that inserts a synthetic `StakingDeposit` row in `contract_logs` with `params = { owner, assets:"1000…", shares:"999…" }` and asserts `get_all_requests(wallet, false, false)` returns a `GroupedRequest` with the same string values (not zero, not empty).
- **Indexer test.** If `compute_position_fields` is the culprit, add a worker test that runs the mapper end-to-end on a synthetic `StakingDeposit` log and asserts `contract_logs.params` retains `assets` and `shares` alongside the newly added `shares_balance`/`avg_buy_share_price`.
- **Manual.** After implementation, run the `activity-all-types` scenario from `/test` and visually confirm both rows on `/transactions` and the home Activity card. Then exercise the live flow: connect a fresh wallet on devnet, perform a small Stake then Unstake via `/stake`, refresh `/transactions`, and confirm non-zero amounts.
- **Figma verification.** Figma node `1497-94912` (transactions page) and `1497:95119` (home activity card) define the two-line `−amount / +amount` block — visually confirm the rendered output matches.

## Docs to Update

- `docs/product-specs/staking.md` — add a cross-reference note that the `/v1/requests` payload always carries `assets` and `shares` for Stake/Unstake events (only if the fix touches the contract docs; otherwise leave untouched).
- `docs/exec-plans/known-bugs.md` — no entry needed (this Issue tracks the fix).
- This exec plan will be moved from `docs/exec-plans/active/` to `docs/exec-plans/completed/` when the Issue closes (manager handles).
- If `renderRequestRow` fallback behaviour changes (step 4), update the JSDoc at the top of `renderRequestRow.tsx` so the new contract is documented in the file.
