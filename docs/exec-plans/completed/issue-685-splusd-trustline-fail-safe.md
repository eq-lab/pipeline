# Issue #685: [FE] [Stellar] sPLUSD trustline step shows OK when the user has no trustline (fails open)

Source: https://github.com/eq-lab/pipeline/issues/685

## Scope

Fix the Stellar Stake page's sPLUSD trustline step, which "fails open": the step is rendered
complete (green check) and staking is allowed even when the account has no sPLUSD trustline,
because the underlying `needsTrustline` signal is `false` whenever the share asset is still
loading or fails to resolve — not only when a trustline actually exists.

In scope:

1. **Fail-safe gating (primary fix).** Make the sPLUSD trustline step treat an
   unresolved / loading / errored share asset as "trustline NOT satisfied" (never silently
   "OK"). This must propagate to BOTH consumers of the signal in `useStakeFlow.ts`:
   - the step's visual `state` (`stellarSplusdTrustlineState`), and
   - the staking gate (`canStellarStake`), so a deposit cannot proceed on an unverified trustline.
2. **Resilient share-asset resolution.** Align the `name()` → `{ code, issuer }` parse in
   `useStellarChangeTrustStakedPlusd` with the established, more resilient sibling parser used
   for PLUSD/USDC (`parseClassicAsset` in `useStellarDepositManagerAddresses.ts`), and confirm
   the `"CODE:ISSUER"` `name()` convention is the dependable in-repo source (it is — see
   Assumptions).
3. **Tests** covering loading, error, no-trustline, and has-trustline cases, plus correcting the
   existing test that currently encodes the bug as expected behavior.

Out of scope:

- The PLUSD-balance / `assetIssuer: ""` issue tracked separately in #677 (the body flags it as a
  sibling, but it is a distinct hook path — `useStellarToken` / PLUSD trustline — and a separate Issue).
- Any change to the EVM stake flow or to the trustline submission (`changeTrust`) transaction itself.
- Adding a new `error` visual state to the shared `StepRow`/`StepsCard` UI primitives (a richer
  per-step error pill is a nice-to-have; the minimal, sufficient fix keeps the step "idle/needs
  action" while resolution is pending or failed, which already shows the actionable "Enable" button).

## Assumptions and Risks

- **The `"CODE:ISSUER"` `name()` convention IS the dependable in-repo source.** Confirmed: the
  protocol's PLUSD and USDC SAC classic `{ code, issuer }` are resolved by exactly this convention
  in `packages/frontend/src/wallet/stellar/useStellarDepositManagerAddresses.ts` (`fetchAddresses`
  reads each SAC's `name()` and parses it via `parseClassicAsset`, lines ~141-175). The sPLUSD
  vault is the same FungibleVault/SAC family and its client doc
  (`packages/frontend/src/wallet/stellar/contracts/stakedPlusd.ts:170-178`) documents `name()` as
  returning `"sPLUSD:GISSUER"`. The issue body's hypothetical (a human-readable `name()`) is
  therefore not the observed contract; the real defect is fail-open behavior, not a wrong source.
  There is no `.env` / config / constant alternative for sPLUSD `{ code, issuer }` — only the vault
  contract ID (`VITE_STELLAR_STAKED_PLUSD_ID`) is configured, so `name()` is the correct source.
- Risk: a fail-safe that blocks staking until the share asset resolves means a transient RPC error
  on the `name()` view leaves the user on the "Enable sPLUSD" step. This is acceptable and correct
  per the issue: worst case is an extra change-trust attempt or a retry, never a silently-failed
  stake. The query already uses `retry: false`; consider whether to leave it (fail fast, user
  re-triggers by reconnect/refetch) or allow a small retry — see step 5.
- Risk: the existing unit test at `useStellarStakedPlusd.test.tsx:585` asserts
  `needsTrustline === false` "because shareAsset not yet loaded" — it codifies the bug. It must be
  updated, not preserved.
- The mock path (`STELLAR_MOCK_KEYS.stakedPlusdShareBalance`) bypasses `name()` parsing; the
  fail-safe must not regress mock/dev flows (mock returns a resolved trustline state synchronously,
  so it should remain "satisfied" when the mock balance > 0).

## Open Questions

_None_

## Implementation Steps

1. **Enrich the hook's returned trustline signal** in
   `packages/frontend/src/wallet/stellar/useStellarStakedPlusd.ts`
   (`useStellarChangeTrustStakedPlusd`, ~690-833):
   - Add an explicit, fail-safe status to `UseStellarChangeTrustStakedPlusdResult`
     (interface ~137-146). Recommended: a single discriminator
     `trustlineStatus: "loading" | "needed" | "satisfied" | "error"` derived as:
     - `"loading"` when `shareAssetQuery.isLoading` OR `sPlusdToken.isLoading` (and connected),
     - `"error"` when `shareAssetQuery.error` is set (or `sPlusdToken.error`),
     - `"satisfied"` when `shareAsset` resolved AND `sPlusdToken.hasTrustline`,
     - `"needed"` when `shareAsset` resolved AND NOT `hasTrustline`.
   - Keep `needsTrustline` for backward-compat but redefine it to be `true` for the actionable
     "needed" case only (so the existing gate that enables the submit button stays correct), and add
     the richer status for the "is the step OK / can we proceed to stake" decisions. Alternatively,
     expose `shareAssetResolved: boolean` + `shareAssetError: Error | null` + reuse
     `sPlusdToken.isLoading`; the discriminator is cleaner. Pick one and document it in the hook's
     JSDoc (currently ~680-689).
   - Crucial: ensure the disconnected case maps to a non-"satisfied" status so a disconnected user
     never shows a green check (today `state` is gated on `isStellarConnected` in `useStakeFlow`, so
     keep that gate too).

2. **Make the share-asset parse resilient** (same file, `shareAssetQuery.queryFn` ~700-721):
   - Replace the throw-on-unexpected-name behavior with the sibling pattern in
     `useStellarDepositManagerAddresses.ts:166-175` (`parseClassicAsset`): on the happy
     `"CODE:ISSUER"` shape return `{ code, issuer }`; otherwise `console.warn` and decide between
     (a) treating it as an error that yields `trustlineStatus: "error"` (fail safe) or
     (b) falling back as the sibling does. Prefer fail-safe error here over a fabricated issuer,
     because building a `changeTrust` against a wrong asset is worse than blocking. Consider
     extracting the existing `parseClassicAsset` into a shared helper (e.g. a small util in
     `packages/frontend/src/wallet/stellar/`) and using it in both call sites to avoid drift.

3. **Fix the fail-open in `useStakeFlow.ts`**
   (`packages/frontend/src/wallet/useStakeFlow.ts`):
   - `stellarSplusdNeedsTrustline` (~420) and the derived
     `stellarSplusdTrustlineState` (~457-458): change so the step is `"success"` ONLY when the
     hook reports `trustlineStatus === "satisfied"` (and connected). Loading/needed/error must
     NOT render "success" — they remain `"idle"` (actionable "Enable" button) or, if the optional
     error UI from step 6 is adopted, an error state.
   - `canStellarStake` (~440-446): change the `!stellarSplusdNeedsTrustline` term so staking is
     permitted ONLY when `trustlineStatus === "satisfied"` (i.e. block while loading/needed/error).
     This is the core safety fix — the mint can no longer land on a non-existent trustline.
   - `canStellarEnableSplusd` (~425-430): keep enabling the "Enable" button when status is
     `"needed"`; while `"loading"` the button should be disabled (no asset to changeTrust against yet);
     for `"error"` allow the button (lets the user retry) but verify `submit()`'s existing
     "share asset not loaded" guard (~774-778) still rejects cleanly.

4. **Verify the submit guard path** (same hook, `submit` ~746-831): confirm that when
   `shareAsset` is undefined the early guard already sets a clear error (it does, ~775-778) and that
   the new status wiring does not allow `submit()` to be reached in a way that builds an invalid
   `changeTrust`. No functional change expected here beyond the gate adjustments in step 3.

5. **Decide retry/refresh ergonomics** (low-effort): the `shareAssetQuery` currently has
   `retry: false`, `staleTime: Infinity`. Confirm there is a path for the user to recover from a
   transient `name()` error (e.g. it refetches on reconnect or on a manual refetch). If not, allow a
   small `retry` (e.g. 1-2) or expose `refetch` so the step can self-heal without a full reload.
   Keep this minimal; document the choice in the hook JSDoc.

6. **(Optional, only if cheap) richer step error UI**: if a distinct error visual is desired,
   extend `StakeStepInfo` (`useStakeFlow.ts` ~72-81) and `StepRow`/`StepsCard`
   (`packages/ui/src/components/StepRow/StepRow.tsx`,
   `packages/ui/src/components/StepsCard/StepsCard.tsx`) with an `error` field and a red pill,
   matching the existing success-pill structure. This is OUT of the minimal scope; only do it if the
   reviewer/manager asks. The minimal fix (keep step actionable, never "success") is sufficient to
   close the bug.

## Test Strategy

Update `packages/frontend/src/wallet/stellar/useStellarStakedPlusd.test.tsx`
(`describe("useStellarChangeTrustStakedPlusd")`, ~540-631):

- **Correct the bug-codifying test** (~578-586): rename/rewrite "needsTrustline is true when
  connected with no trustline". With the share asset still loading, the step must NOT be
  "satisfied" — assert `trustlineStatus === "loading"` (or `needsTrustline`/derived signal is not
  "OK"), not the current `expect(...).toBe(false) // shareAsset not yet loaded`.
- **Add: share asset resolved + no trustline** → `trustlineStatus === "needed"`,
  `needsTrustline === true`, enable button available.
- **Add: share asset resolved + has trustline** (mock `useStellarSacToken.hasTrustline = true`) →
  `trustlineStatus === "satisfied"`; this is the only state that allows staking.
- **Add: `name()` returns an unexpected (non-`CODE:ISSUER`) string or rejects** → the step is NOT
  "satisfied" (`trustlineStatus === "error"`), staking is blocked. This is the regression test for
  the exact fail-open in the issue.
- **Mock fast-path** (~558-576) must still pass unchanged (mock returns a resolved/satisfied state).

Add/adjust `useStakeFlow` coverage (search for an existing
`packages/frontend/src/wallet/useStakeFlow.test.ts(x)`; if present, extend it, else add focused
assertions): when the sPLUSD share asset is loading or errored, `stellarSplusdTrustlineState` is NOT
`"success"` and `canStellarStake` is `false`. This locks in the cross-file safety property.

Run the frontend unit tests and lint:

- `npx tsx scripts/lint-docs.ts` (per AGENTS.md, after TS changes).
- The package's vitest suite for the affected files.

## Docs to Update

- Update the JSDoc in `useStellarStakedPlusd.ts` (hook header ~680-689 and the result interface
  ~137-146) to document the new fail-safe `trustlineStatus` semantics and that the share asset is
  resolved from the vault `name()` (`"CODE:ISSUER"`), matching the PLUSD/USDC resolution pattern.
- No product-spec change required: this is a `fix/` with no new user-facing behavior beyond
  correctly blocking an invalid action (the spec already requires a real trustline before staking).
- If the optional error-pill UI (step 6) is implemented, note the new `StepRow` error state in the
  relevant frontend docs (`docs/frontend/` / `docs/FRONTEND.md`); otherwise no docs change there.
