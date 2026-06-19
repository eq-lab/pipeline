# Issue #672: [FE] [Stellar] Disable the Claim button while the PLUSD trustline is unauthorized

Source: https://github.com/eq-lab/pipeline/issues/672

## Scope

Defensive UI guard on the Stellar `/deposit` flow. Today the Claim button (step 3 of
the Stellar `StepsCard`) is enabled as soon as the PLUSD trustline *exists*. But PLUSD's
issuer has `auth_required=true`, so a freshly-created trustline starts **unauthorized**
(`is_authorized=false` on Horizon). Clicking Claim in that window submits a
`claim_request` mint that traps with `Error(Contract, #11)` / "balance is deauthorized".

This change makes `useStellarSacToken` expose the Horizon `is_authorized` flag, and gates
the deposit Claim button on it so the user cannot trigger a guaranteed-to-fail claim. A
short affordance ("Awaiting authorization") explains why the button is disabled instead
of silently disabling it.

In scope:
- `packages/frontend/src/wallet/stellar/useStellarSacToken.ts` — read and expose
  `isAuthorized: boolean` from the matched `BalanceLineAsset`.
- `packages/frontend/src/wallet/useDepositFlow.ts` — feed `plusdSac.isAuthorized` into the
  deposit Claim gate (`canStellarStep3Deposit`) and surface an "awaiting authorization"
  state for the step. (The Claim button's `disabled` prop is wired through
  `flow.step3.disabled`, which is computed here — NOT inline in `deposit.tsx`.)
- `packages/frontend/src/routes/deposit.tsx` — render the "Awaiting authorization"
  affordance for the Claim step when the new state is active.

Out of scope (per issue):
- Actually authorizing the trustline — relayer `access_manager.set_authorized` whitelist (#562).
- Reworking the "Enable PLUSD" step semantics or the claim error-message mapping.
- The withdraw Claim button (the withdraw claim mints USDC, not gated by PLUSD auth here).
  Note: USDC issuer likely also has `auth_required`; if confirmed later, an analogous
  guard for USDC/withdraw can be a follow-up — see Open Questions.

## Assumptions and Risks

- Horizon's `BalanceLineAsset` already types `is_authorized: boolean`
  (verified in `@stellar/stellar-sdk/lib/horizon/horizon_api.d.ts` lines 80/94). No SDK
  bump needed.
- A trustline that exists but is unauthorized still appears as a balance line, so the
  existing `for` loop in `useStellarSacToken` already matches it — we only need to read one
  more field. `hasTrustline` stays `true` in this window (the Enable step is still
  "complete"), and the new `isAuthorized` carries the additional signal.
- The deposit flow's `plusdSac` (`useStellarSacToken` for PLUSD) is already instantiated in
  `useDepositFlow.ts` (line ~304) and used for the withdraw input balance. We reuse it; no
  new hook instance is needed.
- Mock fast-path: the localStorage mock has no authorization concept. We default
  `isAuthorized` to `hasTrustline` (i.e. `mockRaw > 0n`) so dev/test mock flows are not
  newly blocked. Documented in the hook.
- Risk: gating Claim on `isAuthorized` could wedge a user if authorization never arrives
  (because #562 is unmerged). That is the intended behavior — Claim is *supposed* to be
  unavailable until authorized, and previously it produced a hard contract error instead.
  The affordance text communicates the wait. Acceptable for a defensive guard.
- Risk: if Horizon briefly returns `is_authorized=false` during the same poll where the
  trustline first appears, the Claim button stays disabled until the next 30s refetch
  picks up authorization. Acceptable; the existing `refetchInterval: 30_000` already
  governs freshness, and `refetchBalance` fires on step success.
- `StepRow`/`StepsCard` (`@pipeline/ui`) currently have **no** helper-text/tooltip slot —
  only a `label`. The chosen approach (see Open Questions) avoids a cross-package UI
  component change by reflecting the awaiting state in the step **label** text computed in
  `deposit.tsx`.

## Open Questions

- Affordance mechanism: `StepRow`/`StepsCard` have no helper/tooltip prop today. Plan
  assumes we surface "Awaiting authorization" by swapping the Claim step's **label** (e.g.
  "Claim your PLUSD — awaiting authorization") in `deposit.tsx` rather than adding a new
  `helperText`/tooltip prop to the shared `@pipeline/ui` StepRow. Confirm this is
  acceptable, or whether a proper tooltip slot on `StepRow` is preferred (larger,
  cross-package change). Defaulting to the label approach.
- Should the symmetric guard be added for the **withdraw** Claim (USDC trustline
  `is_authorized`)? The issue scopes only the PLUSD/deposit path. Assuming deposit-only for
  this issue; withdraw guard would be a follow-up if USDC issuer also enforces auth.

## Implementation Steps

1. **[DONE] `useStellarSacToken.ts` — expose `isAuthorized`.**
   - Extend the `queryFn` return type from `{ balance; hasTrustline }` to
     `{ balance; hasTrustline; isAuthorized }`.
   - In the asset-match branch (lines ~211-214) return
     `isAuthorized: (b as Horizon.HorizonApi.BalanceLineAsset).is_authorized` alongside
     `balance` and `hasTrustline: true`.
   - In every no-trustline / 404 / disconnected return, set `isAuthorized: false`.
   - Mock query-time branch (lines ~182-187) and mock fast-path (lines ~242-251): set
     `isAuthorized: mockVal > 0n` / `isAuthorized: mockRaw > 0n` (default to trustline
     presence so mock flows are not newly blocked).
   - Add `isAuthorized: boolean` to `UseStellarSacTokenResult` (after `hasTrustline`) with a
     doc comment: "Whether the trustline is authorized by the issuer (Horizon
     `is_authorized`). `false` when disconnected, loading, no trustline, or the issuer has
     not yet authorized (PLUSD issuer has `auth_required=true`)."
   - Real-path return (lines ~266-273): `isAuthorized: query.data?.isAuthorized ?? false`.
   - Update the file-header JSDoc bullet list ("Exposes …") to mention `isAuthorized`.

2. **[DONE] `useDepositFlow.ts` — gate the deposit Claim on PLUSD authorization.**
   - The PLUSD SAC read is already available as `plusdSac` (line ~304). Derive a guard:
     `const plusdTrustlineUnauthorized = isStellarConnected && !depositNeedsTrustline &&
     plusdSac.isAuthorized === false;` (i.e. trustline exists but not yet authorized).
   - Add `&& !plusdTrustlineUnauthorized` to `canStellarStep3Deposit` (line ~1017) so the
     deposit Claim button is disabled while unauthorized.
   - Surface the awaiting state to the component. Preferred: add an optional field to the
     returned `step3` object only when on the deposit Stellar path — e.g. extend the
     deposit-path `step3.label` to "Claim your PLUSD — awaiting authorization" when
     `plusdTrustlineUnauthorized` is true, keeping "Claim your PLUSD" otherwise. (If a
     dedicated prop is chosen per Open Questions, thread it through `StepInfo` instead.)
   - Confirm withdraw path (`canStellarStep3Withdraw`) is untouched.

3. **[DONE] `deposit.tsx` — render the affordance.**
   - The Stellar 4-step `StepsCard` already maps `flow.step3.label` into the Claim row
     (lines ~588-595). If the awaiting label is produced in `useDepositFlow`
     (step 2 above), `deposit.tsx` needs **no** change beyond what already renders
     `flow.step3.label`/`disabled`. Verify the disabled + dynamic label render correctly.
   - If, per Open Questions, a tooltip prop is chosen instead, add the prop pass-through on
     the Claim `StepItem` here.

4. **[DONE] Lint.** Run `npx tsx scripts/lint-docs.ts` (TS change) and the frontend typecheck/lint
   per the package's scripts.

## Test Strategy

- **`useStellarSacToken.test.tsx`** (extend existing suite):
  - Update `makeBalances` to accept an `isAuthorized` flag (default `true`) and include
    `is_authorized` on the credit balance line; keep existing call sites green.
  - New case: trustline present + `is_authorized: false` → `hasTrustline === true`,
    `isAuthorized === false`, balance string still returned.
  - New case: trustline present + `is_authorized: true` → `isAuthorized === true`.
  - Existing no-trustline / issuer-mismatch / 404 cases → assert `isAuthorized === false`.
  - Mock-key case → assert `isAuthorized === true` when mock balance > 0.
- **`useDepositFlow`** (if a hook-level test harness exists; otherwise cover via the route
  test): assert deposit `step3.disabled === true` when `plusdSac.isAuthorized` is false but
  the trustline exists and a claimable request/voucher is ready, and `false` once
  authorized — all other gates satisfied.
- **`routes/-deposit.test.tsx`**: render the Stellar 4-step card in a state where the
  deposit is claimable but the PLUSD trustline is unauthorized; assert the Claim action
  button (`step-row-4-action`) is disabled and the awaiting-authorization label is shown;
  then flip `isAuthorized` true and assert Claim becomes enabled.
- Edge cases: disconnected (no regression), withdraw path (Claim unaffected by PLUSD auth),
  mock flow (Claim not newly blocked).

## Docs to Update

- No product-spec/design-doc change required — this is a defensive UI guard with no new
  user-facing capability, only a clearer "not ready yet" state.
- Code-level JSDoc updates only: the `useStellarSacToken.ts` file header and the
  `UseStellarSacTokenResult.isAuthorized` doc comment (covered in Step 1).
