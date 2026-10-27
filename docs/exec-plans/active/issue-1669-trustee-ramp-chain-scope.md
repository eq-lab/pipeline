# Issue #1669: Trustee: RampEvent.chain_id, drop the dead review chain_id, ramp hooks follow the session chain (TD-153)

Source: https://github.com/eq-lab/pipeline/issues/1669

## Scope

Trustee app (`packages/trustee`) only. This is a follow-up to #1609 / PR #1668.

1. **`RampEvent.chain_id`.** Add `chain_id: number` to `RampEvent` in `api/useRampEvents.ts`, and add it to every fixture that builds a `RampEvent`.
2. **Dead review query.** `api/useReviewRampEvent.ts` posts to `/v1/ramp/events/{id}/review` with no query string, because the backend takes the chain from the event. Remove the `ENV` import.
3. **TD-153 decision: option (a), follow the session chain.** Reasoning:
   - `docs/frontend/trustee-flows.md` §Cash Management — Withdrawal Queue already states the product rule ("a page that aggregates across networks shows every chain; a per-network page follows the connected chain") and says explicitly: "**Cash Management is per-network**".
   - TD-153 (`docs/exec-plans/tech-debt-tracker.md`) records the same rule for the rest of the page.
   - `docs/design-docs/trustee-dashboard-v3-design-assignment.md` (S12 On/Off-ramp, S13, S14) treats ramp as a tab of the one Cash Management page. It does not call it cross-network, so nothing contradicts the rule.
   - Option (b) would put an all-chains ramp tab next to a session-scoped Withdrawal Queue tab on the same page. That is the inconsistency TD-153 describes.

   So `useRampEvents` and `useRampAddresses` read `useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID`, the same pattern as `useWithdrawalQueue` and `useCapitalAllocation`. The ramp section shows its scope the way the Withdrawal Queue tab does: a chain chip beside the heading, plus a sub-line.
4. **Custody balance (the other TD-153 item).** `api/useUsdcCustodyBalance.ts` reads the Stellar SAC balance unconditionally, and there is no EVM custody read. The `SwapDialog` "balance" (`usdcBalanceValue` / `usdcBalanceDisplay` in `-cash-management.ts`) shows it for any session.
   - **In scope (minimal):** gate it to the Stellar session in the presenter, as #1601's `useCapitalAllocationCard` does (`chainId === ENV.STELLAR_CHAIN_ID ? custody.data : undefined`). A non-Stellar session then shows `—`, never another chain's number.
   - **Out of scope:** a real EVM custody read. Log it as a new TD-155 so TD-153 can be marked resolved, as the issue asks.

Out of scope:
- Backend changes.
- An EVM custody balance read.
- Ramp execution and quotes (#781).
- A Chain column (this is a per-network page, so there is none).

## Assumptions and Risks

- Since #1609 the backend serves `chain_id` on events and accepts an EVM `chain_id` on both ramp GETs. An unconfigured chain returns `200 {"events":[]}`, and the page shows the empty queue.
  - For addresses, an EVM chain with no configured ramp may return an empty list (shown as `—`) or a 4xx. Verify against the #1609 spec (`docs/user-stories/epic-1521/1609-ramp-kyc-chain.md`) while implementing. The presenter already falls back to `—` when there is no data.
- EVM ramp addresses are 0x hex, not Strkeys. `truncateStrkey` is a generic first-4/last-4 truncation, so it still renders fine. Only update the comments and JSDoc wording.
- The presenter tests (`routes/-cash-management.test.ts`, `-cash-management-page.test.tsx`) mock the hooks. The added chain label needs `useSessionState` mocked there.
- Query keys already include `chainId`, so switching sessions refetches. Review invalidation uses the `["ramp-events"]` prefix and still matches.
- There are no existing hook-level tests for the ramp hooks. New test files need the `-` prefix, which the TanStack routes dir requires. The api dir also uses it (`api/-useWithdrawalQueue.test.tsx`), so follow that.

## Open Questions

_None_ — the docs settle option (a), Cash Management being per-network. Treat the custody-balance gate and the new TD-155 as recommendations the coder applies. If the reviewer prefers to leave the custody balance untouched, keep TD-153 open for the custody part instead.

## Implementation Steps

1. `packages/trustee/src/api/useRampEvents.ts`:
   - Add `chain_id: number` to `RampEvent`.
   - Import `useSessionState` from `@/auth/sessionStore`, and set `const chainId = useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID`.
   - Keep `?chain_id=${chainId}` and the key `["ramp-events", chainId]`.
   - Return `chainId` in `UseRampEventsResult`, as `useWithdrawalQueue` does.
   - Replace the TD-153 JSDoc with a one-line spec-pointer header, per the comment-minimal rule.
2. `packages/trustee/src/api/useRampAddresses.ts`: same session-chain change, with the key `["ramp-addresses", chainId]`. Update the header comment to drop "Stellar-hardcoded, TD-153", and fix the "Strkeys" wording.
3. `packages/trustee/src/api/useReviewRampEvent.ts`: URL `/v1/ramp/events/${input.id}/review`. Remove the `chainId` const and the `ENV` import.
4. `packages/trustee/src/routes/-cash-management.ts`:
   - Add `chainLabel: string` (`targetChainLabel(rampEvents.chainId)` from `@/lib/targetChains`) to `CashManagementView`.
   - Gate the custody balance: `usdcBalanceValue` is `null` unless `rampEvents.chainId === ENV.STELLAR_CHAIN_ID`.
   - `mapEvent` is unchanged; no per-row chain is needed on a per-network page.
5. `packages/trustee/src/routes/cash-management.tsx`, On/Off-ramp tab heading area: add a chip `data-testid="cash-management-ramp-chain"` showing `{view.chainLabel}`, plus the sub-line "{chainLabel} ramp — the network you signed in with." Mirror the Withdrawal Queue chip markup at lines ~915-940, using the same tokens.
6. Fixtures: add `chain_id` to every `RampEvent` literal in `routes/-cash-management.test.ts` and `routes/-cash-management-page.test.tsx`. Find them with `grep -rn "OnRamp\|OffRamp" packages/trustee/src`.

## Test Strategy

- New `packages/trustee/src/api/-useRampHooks.test.tsx`, which mocks `apiFetch` and `useSessionState`:
  - `useRampEvents` requests `/v1/ramp/events?chain_id=560048` for an EVM session, `?chain_id=99000001` for Stellar, and Stellar for a null session.
  - `useRampAddresses` follows the same three cases.
  - `useReviewRampEvent` POSTs exactly `/v1/ramp/events/7/review`, with no `?`, and the right body for Approved and for Rejected with a reason.
- `routes/-cash-management.test.ts`:
  - `chainLabel` is "Stellar" or "Hoodi" depending on the session chain.
  - The custody balance becomes `null` / `—` under an EVM session.
- `routes/-cash-management-page.test.tsx`: the ramp chain chip renders.
- Run trustee `yarn typecheck`, `vitest`, and the comment lint (`/test-fast`).
- User-stories doc `docs/user-stories/epic-1521/1669-trustee-ramp-chain-scope.md`, with a Stellar session and an EVM session (Network tab request URLs, the chip, the balance `—` on EVM) and an approve or reject that sends a POST with no query string.

## Docs to Update

- `docs/frontend/trustee-flows.md`:
  - §On/Off-ramp tab: the ramp hooks follow the session chain, the chip and sub-line show the scope, `RampEvent` now includes `chain_id`, review takes the chain from the event (no query), and the custody balance shows only on a Stellar session.
  - Update the data-sourcing field list to include `chain_id`.
  - Remove the "still hardcoded to Stellar (TD-153)" sentences at ~line 176 and ~line 1642.
- `docs/exec-plans/tech-debt-tracker.md`:
  - Mark TD-153 resolved (#1669).
  - Add TD-155: Cash Management's EVM custody USDC balance read is missing, so the balance shows `—` on an EVM session.
- `docs/user-stories/epic-1521/1600-trustee-withdrawal-queue-chain-scope.md`: drop or adjust the "Known gap (TD-153)" line.
- New user-stories doc, as above.
