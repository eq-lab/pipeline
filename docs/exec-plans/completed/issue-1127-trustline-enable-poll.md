# Issue #1127: Trustline enable: UI flips to "enabled" only on the next poll, not right after the transaction succeeds

Source: https://github.com/eq-lab/pipeline/issues/1127

## Scope

After a successful `changeTrust` submit, replace the single fire-and-forget trustline refetch
(the #662 fix) with a bounded poll-until-flipped, so the flow UI shows the trustline as enabled
within seconds instead of waiting for the next 30s background poll.

Root cause (confirmed by code reading): all three changeTrust hooks submit via Horizon
`submitTransaction` (which waits for ledger inclusion) and then call the trustline query's
`refetchBalance()` exactly once. Horizon's `/accounts/{id}` endpoint can lag its own
transaction-submission response (ingestion race), so that single refetch often still returns
"no trustline"; the UI then waits for the next `refetchInterval: 30_000` tick — the reported
"second turn".

Affected hooks (identical pattern in each):

- PLUSD: `useChangeTrust` — `packages/frontend/src/wallet/stellar/useStellarDepositManager.ts`
  (real-path success at ~line 657: `setIsSuccess(true); refetchPlusdTrustline();`).
- USDC: `useStellarChangeTrustUsdc` — `packages/frontend/src/wallet/stellar/useStellarWithdrawalQueue.ts`
  (same shape, `refetchUsdcTrustline()`).
- sPLUSD: `useStellarChangeTrustStakedPlusd` — `packages/frontend/src/wallet/stellar/useStellarStakedPlusd.ts`
  (same shape; stake flow's "Enable sPLUSD" step).

Out of scope: the 30s background `refetchInterval` (unchanged), unauthorized-trustline
handling (#671/#685 behavior unchanged), EVM flows, trustee app.

## Assumptions and Risks

- `useStellarSacToken.refetchBalance` is currently typed `() => void` but is
  `query.refetch` (react-query), which actually returns `Promise<QueryObserverResult>`.
  The poll needs the refetched value, so the exposed type changes to a promise that resolves
  with the fresh snapshot — all existing call sites use it fire-and-forget, so the signature
  change is call-compatible.
- The poll must live in the REAL submit path only. The mock fast-paths keep their single
  refetch call: in mock mode `refetchBalance` is a no-op returning nothing, and a poll loop
  would spin to its attempt cap on every mock run.
- The poll runs after `setIsSuccess(true)` — the step UI completes immediately on tx success;
  only the needs-trustline banner/CTA waits for the flipped query data. Polling before
  `setIsSuccess` would hold the whole step spinner for up to the poll budget.
- react-query `refetch()` on an unmounted consumer is cache-safe; the loop sets no React
  state itself, so no unmount guard is needed beyond the attempt cap.
- Risk: if Horizon lags longer than the poll budget (~12s), the UI falls back to today's
  behavior (next 30s tick) — acceptable degradation, no error surfaced.
- Risk: `useStellarStakedPlusd`'s trustline read may not come from `useStellarSacToken`
  (verify at implementation time); whatever query it uses, poll via that query's refetch and
  apply the same promise-returning tweak if needed.

## Open Questions

_None_ — poll cadence/budget (1.5s × 8 attempts ≈ 12s) is an implementation constant the
issue already suggested; no product-visible decision is open.

## Implementation Steps

1. ✅ **`packages/frontend/src/wallet/stellar/useStellarSacToken.ts`** — expose the refetch
   result: change `refetchBalance` from `() => void` to
   `() => Promise<{ hasTrustline: boolean } | undefined>` (implementation:
   `async () => (await query.refetch()).data`; mock/unconfigured branches return
   `async () => undefined`). Update the result interface accordingly.
2. ✅ **New shared helper** (small, one export) — e.g.
   `packages/frontend/src/wallet/stellar/pollTrustline.ts`:
   `pollTrustlineUntilPresent(refetch, { attempts = 8, intervalMs = 1500 })` — awaits
   `refetch()`, resolves early when `hasTrustline` is true, sleeps `intervalMs` between
   attempts, resolves (without error) when the attempt cap is reached. One 2–3-line header
   comment with the spec pointer, per the comment-minimal rule.
3. ✅ **`useChangeTrust` (PLUSD)** — in the real-path success block, replace
   `refetchPlusdTrustline()` with `void pollTrustlineUntilPresent(refetchPlusdTrustline)`.
   Mock fast-path keeps the single `refetchPlusdTrustline()` call.
4. ✅ **`useStellarChangeTrustUsdc` (USDC)** — same replacement with `refetchUsdcTrustline`.
5. ✅ **`useStellarChangeTrustStakedPlusd` (sPLUSD)** — same replacement with its trustline
   query's refetch (verify which hook serves it; apply step-1's promise tweak there too if it
   is not `useStellarSacToken`).
6. ✅ **Gate**: `npx tsx scripts/lint-docs.ts`; `yarn build` + `npx tsc --noEmit` in
   `packages/frontend`; targeted vitest files below; `/test-fast`.

## Test Strategy

(✅ implemented as below; sPLUSD gained a real-path poll test — its hook previously had NO post-success refetch at all, worse than the issue described.)

- `pollTrustline` unit tests (new file, co-located `-pollTrustline.test.ts` or matching the
  package's test-naming convention):
  - resolves after the first attempt when `hasTrustline` is already true (no sleep);
  - stale-then-fresh: first refetch resolves `{ hasTrustline: false }`, second
    `{ hasTrustline: true }` → exactly 2 refetch calls (fake timers for the 1.5s sleeps);
  - never flips → stops at the attempt cap (8 calls), resolves without throwing;
  - refetch resolving `undefined` (mock/unconfigured) counts as "not present".
- `useStellarDepositManager.test.tsx` + `useStellarWithdrawalQueue.test.tsx` +
  `useStellarStakedPlusd.test.tsx`: these mock the trustline hook module, so drive the mocked
  `refetchBalance` (`vi.fn()` resolving stale-then-fresh) and assert the real submit path
  keeps calling it until the flip; assert the mock fast-path still calls it exactly once.
- Regression guard: no change to unauthorized-trustline expectations (#671/#685 tests stay
  green).
- Note: the frontend vitest environment has the pre-existing #1003 `localStorage` breakage in
  some files — if an affected suite can't run, verify the failure is the known one on a clean
  tree before touching anything, and don't fix #1003 inline.

## Docs to Update

- `docs/frontend/hooks.md` — the `useStellarSacToken` row (line ~35): `refetchBalance` now
  returns a promise resolving with the fresh snapshot; note the post-changeTrust bounded poll
  behavior.
- `docs/frontend/wallet-flows.md` — wherever the #662 immediate-refetch behavior is implied
  by the trustline step description, state the new poll-until-flipped behavior (bounded,
  ~12s budget, falls back to the 30s background poll).
