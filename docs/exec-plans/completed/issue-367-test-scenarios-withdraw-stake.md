# Issue #367: Test scenarios: missing coverage for /deposit?direction=withdraw and /stake

Source: https://github.com/eq-lab/pipeline/issues/367

## Scope

Expand the `/test` Mocks tab scenario registry at
`packages/frontend/src/routes/test/-scenarios.ts` so the recently added
withdraw direction (`/deposit?direction=withdraw`, also reachable via
`/withdraw`) and the stake/unstake flow (`/stake`) have parity with the
existing deposit-direction coverage.

In scope:

- Add 5 new withdraw-direction scenarios (`withdraw-connected-fresh`,
  `withdraw-connected-allowance-zero`, `withdraw-connected-allowance-ok`,
  `withdraw-request-pending-verification`,
  `withdraw-request-verification-failed`).
- Add 2 new stake/unstake scenarios (`stake-fresh`, `unstake-empty`).
- Extend `-scenarios.test.ts` so each new scenario's key contract is asserted.
- Optional polish: add `pipeline.mock.wallet.contract.depositManager.requestDeposit`
  to the existing `connected-allowance-ok` deposit scenario and
  `pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal` to the new
  `withdraw-connected-allowance-ok` scenario so Confirm settles synchronously
  inside the Mocks tab (avoids falling through to wagmi/RPC).
- Update the file-header JSDoc in `-scenarios.ts` to document the
  "every request-flow feature ships with full mock state" convention.

Out of scope:

- Any change to the request flows themselves (`/deposit`, `/withdraw`, `/stake`).
- The PendingClaim withdraw scenario (already covered by
  `withdrawal-pending-claim`).
- Adding `PendingVerification` / `PendingClaim` states for stake/unstake — they
  settle in a single tx and have no such states.
- Refactoring `WALLET_CONNECTED_BASE` or address constants.

## Assumptions and Risks

- Assumption: `WALLET_CONNECTED_BASE` already seeds PLUSD + sPLUSD token
  metadata and the `stakedPlusd.asset` alias, so withdraw and stake scenarios
  need only override balances / allowances / request lists. Confirmed by
  reading `-scenarios.ts:53-73`.
- Assumption: `useToken` / `useApproval` for the withdraw direction read
  PLUSD balance via `pipeline.mock.wallet.balance.<PLUSD>` and allowance via
  `pipeline.mock.wallet.allowance.<PLUSD>.<WQ>`, mirroring the deposit-side
  pattern already in use by `withdrawal-pending-claim`.
- Risk: the optional `requestDeposit` / `requestWithdrawal` mock keys must
  match the exact shape the wallet-mock layer expects (likely
  `{ hash, request_id }`). If the shape is wrong, Confirm will throw at
  runtime even though the scenario "loads". Mitigation: cross-check the
  existing `withdrawalQueue.claimWithdrawal` / `stakedPlusd.stake` mock entries
  for the canonical shape, and grep the wallet-mock implementation before
  finalising the value.
- Risk: `-scenarios.test.ts` currently asserts only generic contracts (unique
  ids, `pipeline.mock.*` prefix). Adding per-scenario assertions increases
  test surface; keep them narrow (presence of a few load-bearing keys) to
  avoid brittleness.
- No blocking dependency on other open Issues or unmerged PRs — feature #359
  (the route merge) is already landed on this branch's parent commits.

## Open Questions

_None_

## Implementation Steps

1. [x] Read the wallet-mock implementation for the deposit/withdraw write paths so
   the optional `requestDeposit` / `requestWithdrawal` mock-key shapes are
   correct. Search points:
   - `packages/frontend/src/` for
     `pipeline.mock.wallet.contract.depositManager.requestDeposit` and
     `pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal`.
   - Cross-reference with the existing `stakedPlusd.stake` /
     `withdrawalQueue.claimWithdrawal` mock-key consumers as a template.
2. [x] Edit `packages/frontend/src/routes/test/-scenarios.ts`:
   1. Append the 5 withdraw scenarios after the existing
      `withdrawal-pending-claim` entry, in this order so the Mocks tab reads
      naturally from "empty" to "in-flight":
      1. `withdraw-connected-fresh` — `balance.${PLUSD}=0`,
         `allowance.${PLUSD}.${WQ}=0`.
      2. `withdraw-connected-allowance-zero` —
         `balance.${PLUSD}=100000000000000000000`,
         `allowance.${PLUSD}.${WQ}=0`.
      3. `withdraw-connected-allowance-ok` —
         `balance.${PLUSD}=100000000000000000000`,
         `allowance.${PLUSD}.${WQ}=1000000000000000000000`. Optionally include
         the `withdrawalQueue.requestWithdrawal` mock (Step 1).
      4. `withdraw-request-pending-verification` — same balance/allowance as
         (iii) plus `pipeline.mock.api.GET./v1/requests` returning one
         `{ type: "Withdraw", amount: "10000000000000000000", request_id: "77",
         status: "PendingVerification", created_at: <now> }`.
      5. `withdraw-request-verification-failed` — same as (iv) with
         `status: "VerificationFailed"`.
   2. Append the 2 stake scenarios after the existing `unstake-ready` entry:
      1. `stake-fresh` — `balance.${PLUSD}=0`, `balance.${SPLUSD}=0`,
         `allowance.${PLUSD}.${SPLUSD}=0`.
      2. `unstake-empty` — `balance.${PLUSD}=100000000000000000000`,
         `balance.${SPLUSD}=0`. Keep the existing `convertToShares` /
         `convertToAssets` rate mocks for parity with neighbouring stake
         scenarios.
   3. (Optional polish) Add
      `pipeline.mock.wallet.contract.depositManager.requestDeposit` to the
      existing `connected-allowance-ok` scenario using the canonical shape
      from Step 1.
   4. Extend the file-header JSDoc with a short paragraph documenting that
      every request-flow feature should ship with full mock state in this
      registry (balance, allowance, write-side contract mocks where the
      Confirm CTA fires synchronously).
3. [x] Extend `packages/frontend/src/routes/test/-scenarios.test.ts` with a new
   `describe("withdraw + stake scenario contracts")` block:
   - For each of the 7 new ids, look up the scenario by id and assert that
     the load-bearing keys are present and have the expected values (PLUSD
     balance / allowance for withdraw scenarios; PLUSD + sPLUSD balance for
     stake scenarios; presence of `pipeline.mock.api.GET./v1/requests` for
     the two request-status scenarios).
   - Keep assertions narrow (one or two keys per scenario) to minimise
     brittleness.
4. [x] Run the frontend test suite (`yarn workspace @pipeline/frontend test`)
   plus `npx tsx scripts/lint-docs.ts` from the repo root. Fix any TS / lint
   issues before handing back.
5. Manually verify in the running app (handled by `ux-tester` post-implement,
   not by the coder): open `/test` → Mocks, click Enable on each new
   scenario, confirm the destination page renders the expected state
   (empty / Approve / Confirm / PendingVerification banner /
   VerificationFailed banner / stake-empty / unstake-empty).

## Test Strategy

- **Unit (`-scenarios.test.ts`)**: extend the existing suite with per-scenario
  assertions for the 7 new ids. Reuse the existing pattern of pulling a
  scenario via `SCENARIOS.find(s => s.id === "...")` and asserting on
  `scenario.keys`.
- **Generic contract**: the existing `every scenario id is unique` and
  `every key starts with pipeline.mock.` assertions automatically cover the
  new entries — no extra work needed there.
- **Edge cases to cover in tests**:
  - `withdraw-request-pending-verification` and
    `withdraw-request-verification-failed` have a valid JSON payload at
    `pipeline.mock.api.GET./v1/requests` containing exactly one `Withdraw`
    entry with the expected status.
  - `stake-fresh` sets both PLUSD and sPLUSD balances to `0`.
  - `unstake-empty` sets sPLUSD balance to `0` but a non-zero PLUSD balance.
- **Manual UX pass**: `ux-tester` covers the visual rendering pass after
  implementation. No new Playwright/E2E surface is needed — these are
  developer-tooling scenarios surfaced via the Mocks tab.

## Docs to Update

- File-header JSDoc in `packages/frontend/src/routes/test/-scenarios.ts` —
  document the "ship full mock state per feature" convention (per Issue's
  "Optional polish" bullet).
- No product spec, design doc, or `docs/STORIES.md` change required: this is
  test-tooling coverage, not user-facing behaviour.
- No update to `docs/exec-plans/known-bugs.md` or
  `docs/exec-plans/tech-debt-tracker.md` expected (none discovered during
  planning).
