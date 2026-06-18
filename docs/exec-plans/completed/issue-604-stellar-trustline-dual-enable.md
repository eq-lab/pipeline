# Issue #604: [FE] [Stellar] Show PLUSD + USDC trustline status with per-asset 'Enable' button

Source: https://github.com/eq-lab/pipeline/issues/604

## Scope

On the Stellar deposit/withdraw page (`/deposit`), surface the trustline status
for **both** protocol assets — PLUSD and USDC — for the connected account, and
show an **"Enable"** button for whichever trustline is missing. Both trustlines
must be visible and individually enableable in **both** directions
(`direction=deposit` AND `direction=withdraw`).

Today the trustline affordance is a single linear step ("step 1") that is
chain+direction-specific:

- deposit → step 1 "Enable PLUSD" (`useChangeTrust`)
- withdraw → step 1 "Enable USDC" (`useStellarChangeTrustUsdc`)

So a depositing user whose account lacks a USDC trustline has no UI affordance
to add it, and the deposit fails on-chain at Confirm (`request_deposit`
simulation `Error(Contract, #13)` → "trustline entry is missing"). The symmetric
gap exists on withdraw (no PLUSD trustline affordance). This issue makes both
trustline statuses always visible and individually enableable regardless of
direction.

**In scope (Stellar only):**

- Expose both PLUSD and USDC trustline statuses + per-asset enable actions from
  `useDepositFlow`, independent of direction.
- Render a dual trustline UI with per-asset "Enable" buttons in both directions
  in `routes/deposit.tsx`.
- Pending / error / post-enable reactive states for each asset.
- Keep the existing mock fast-path (`pipeline.mock.wallet.stellar.changeTrust`)
  working.
- Regression tests + a user-stories doc under `docs/user-stories/epic-498/`.

**Out of scope (carried from the Issue):**

- Funding the account with USDC (a trustline gives a 0 balance; obtaining USDC
  is separate).
- EVM path — no trustline concept; EVM step 1 (Approve) is unchanged.
- Changing the deposit/withdraw step 2/step 3 (Confirm/Claim) behavior beyond
  re-gating on the relevant trustline (see step 5 below).

## Assumptions and Risks

- **Both changeTrust hooks are already instantiated** unconditionally in
  `useDepositFlow` (`changeTrust` at `useDepositFlow.ts:283`, `changeTrustUsdc`
  at `:284`) and both expose `needsTrustline`/`submit`/`isPending`/`isSuccess`/
  `error`. No new hooks are needed; this is a wiring + UI change.
- **`needsTrustline` is reactive.** Each changeTrust hook derives
  `needsTrustline` from its own `useStellarSacToken(...).hasTrustline`
  (`useStellarDepositManager.ts:555`, `useStellarWithdrawalQueue.ts:559`). After
  a successful `changeTrust` submit the SAC query refetches (30s interval) and
  in mock mode the value is read reactively — so post-enable the status should
  flip and the Enable button should disappear. **Risk:** real-network refetch
  latency may briefly leave a stale `needsTrustline=true`; mitigate by having the
  enable action trigger a refetch where a refetch handle is available, and rely
  on `isSuccess` to mark the per-asset row complete optimistically.
- **Trustline ≠ balance, but the mock conflates them.** In mock mode
  `useStellarSacToken` derives `hasTrustline` purely from `mockVal > 0n`
  (`useStellarSacToken.ts:185`, `:245`). There is no mock key for "trustline
  exists, balance 0" or "balance > 0, no trustline." The SAC keys
  `pipeline.mock.wallet.stellar.balance.sac.usdc` and `...balance.sac.plusd`
  independently drive the two trustline statuses, so the four required test
  states are reachable, but a 0-balance-yet-trustlined case is not mock-able.
  See Open Questions.
- **Deposit USDC balance vs. USDC trustline come from different hooks.** The
  deposit input balance uses `useStellarToken()` (header parity, no
  `hasTrustline`), while the USDC trustline status must come from the SAC hook
  inside `changeTrustUsdc`. They can legitimately disagree (e.g. user holds USDC
  via `useStellarToken` mock key but `balance.sac.usdc` is unset). Tests must set
  both keys consistently.
- **Linear-step model vs. dual-trustline model.** The current `StepsCard` renders
  a single linear 3-step list where step 1 = one trustline. Showing two
  independent trustline rows breaks the "one step 1" assumption. The chosen
  approach (below) introduces an explicit dual-trustline status block ABOVE the
  StepsCard and demotes the StepsCard step 1 to a non-trustline gate — this is a
  visible UX restructuring and is the main design risk. Figma reference for the
  dual-trustline block is not yet known (see Open Questions).
- **No dependency on unmerged work.** Branch `feat/604-stellar-trustline-dual-enable`
  is already checked out off the current Stellar wiring (#552 merged at
  `f090034`/`b736af0`). No blocking open Issues identified.

## Open Questions

1. **Figma / visual design for the dual-trustline block.** The Issue references
   no Figma node for the new "both trustlines with per-asset Enable" UI. Should
   the coder (a) place a compact two-row "Trustlines" status block above the
   StepsCard, (b) render both Enable rows inside the StepsCard as steps 1a/1b, or
   (c) follow a specific Figma frame? A Figma node id (or a green light to design
   it to match the existing `StepsCard`/`Card` styling) is needed before the
   final layout is locked.
2. **StepsCard "step 1" after trustlines move out.** Once both trustline enables
   live in the new block, what should StepsCard step 1 show on Stellar — drop it
   to a two-step (Confirm/Claim) card, or keep a "step 1" placeholder that is
   always-complete once both trustlines exist? This affects the step-numbering and
   the existing toast ids (`stellar-deposit-trust-tx` etc.).
3. **Confirm gating across directions.** Should Confirm (step 2) on `deposit`
   now be blocked until BOTH trustlines exist (since deposit fails without USDC
   trustline), or only until the asset strictly required by `request_deposit`
   (USDC) exists? The Issue's root cause implies deposit Confirm needs the USDC
   trustline; confirm whether PLUSD-missing should also block deposit Confirm or
   merely show the Enable affordance.

## Implementation Steps

<!-- Steps 1–8 completed in feat/604-stellar-trustline-dual-enable -->

1. **Extend `FlowState` with a direction-independent trustline model.** In
   `packages/frontend/src/wallet/useDepositFlow.ts`, add an array (or a
   `{ plusd, usdc }` object) of per-asset trustline descriptors to the returned
   state, e.g.:
   ```ts
   export interface TrustlineInfo {
     asset: "PLUSD" | "USDC";
     needsTrustline: boolean;   // status: missing → true
     isEnabled: boolean;        // !needsTrustline (status known + present)
     enabling: boolean;         // submit in flight (isPending)
     error: Error | null;
     onEnable: () => void;      // submit()
   }
   // FlowState additions:
   trustlines: TrustlineInfo[]; // empty on EVM; [PLUSD, USDC] on Stellar
   ```
   Populate it from the already-instantiated `changeTrust` (PLUSD) and
   `changeTrustUsdc` (USDC) hooks. Crucially, populate it **the same way
   regardless of `isDeposit`** — drop the `isDeposit ? ... : ...` selection for
   the trustline status. On the EVM path return `trustlines: []`.

2. **Wire per-asset enable + refetch.** For each `TrustlineInfo.onEnable`, call
   the corresponding hook's `submit()`. Where the underlying SAC hook exposes a
   `refetchBalance`, trigger a refetch on `isSuccess` so the status flips without
   waiting for the 30s poll (the PLUSD/USDC SAC hooks live inside the changeTrust
   hooks; if no refetch handle is surfaced, rely on the hook's own
   refetch/poll + `isSuccess` for optimistic completion — note this in the hook
   if a follow-up is needed and log to tech-debt-tracker if a refetch handle must
   be plumbed through).

3. **Reconcile the StepsCard step-1 gate (depends on Open Questions 2 & 3).**
   Update the Stellar step gates in `useDepositFlow.ts` so that:
   - the StepsCard no longer presents the trustline as "step 1" (or presents an
     always-complete placeholder, per the resolved design);
   - Confirm (step 2) is gated on the trustline(s) required for the direction —
     at minimum deposit Confirm requires the USDC trustline (root cause of
     `Error(Contract,#13)`), withdraw Confirm requires the USDC trustline for
     payout and PLUSD to burn. Resolve exact gating with Open Question 3 before
     finalizing the boolean expressions at `useDepositFlow.ts:947-995`.

4. **Render the dual-trustline UI in `routes/deposit.tsx`** (depends on Open
   Question 1). When `isStellar && flow.isConnected && flow.trustlines.length`,
   render a status block (above the StepsCard, in the same `main` column as the
   other banners around `deposit.tsx:479`) that for each asset shows:
   - asset code + a status indicator ("Enabled" / "Not enabled");
   - an **"Enable"** button when `needsTrustline`, disabled with a spinner while
     `enabling`, hidden once enabled;
   - inline error surface on `error`.
   Add stable `data-testid`s, e.g. `trustline-status-plusd`,
   `trustline-status-usdc`, `trustline-enable-plusd`, `trustline-enable-usdc`,
   and a status text testid per asset. Match the existing `Card`/`StepsCard`
   styling. Render identically for both `direction=deposit` and
   `direction=withdraw`.

5. **Update step-1 toast handling.** The existing step-1 toast logic
   (`deposit.tsx:157-190`) assumes step 1 = the active-direction trustline. After
   the restructuring, drive per-asset enable toasts from the new
   `flow.trustlines[*]` pending/success/error transitions (or remove the step-1
   trustline toast if the trustline block surfaces its own inline state). Keep
   toast ids scoped per asset to avoid collisions
   (e.g. `stellar-trust-plusd-tx`, `stellar-trust-usdc-tx`).

6. **Update the route header docstring** (`deposit.tsx:46-54`) to describe the
   new dual-trustline behavior instead of the per-direction single trustline
   step.

7. **Keep the mock fast-path intact.** No changes to `mock.ts`; both Enable
   actions already route through `readMockStellarChangeTrust()`. Verify the mock
   path still drives `isPending → isSuccess` for each asset row.

8. **Run lint/build gates** per AGENTS.md: TypeScript build/typecheck for the
   frontend package and `npx tsx scripts/lint-docs.ts` for the docs.

## Test Strategy

Add/extend tests for both the hook and the route. Use the existing patterns in
`src/routes/-deposit.test.tsx` (testid + RTL queries) and the Stellar mock keys
(`pipeline.mock.wallet.stellar.address`, `.isConnected`, `.balance.sac.usdc`,
`.balance.sac.plusd`, `.balance.usdc`, `.changeTrust`).

Cover the acceptance criteria explicitly, **each verified in both
`direction=deposit` and `direction=withdraw`**:

1. **Both trustlines missing** — `balance.sac.usdc` and `balance.sac.plusd`
   unset/0: both status rows show "Not enabled" and both show an enabled
   "Enable" button.
2. **One trustline missing** — set `balance.sac.plusd > 0` (PLUSD enabled),
   `balance.sac.usdc` unset: PLUSD row shows "Enabled" (no button), USDC row
   shows "Not enabled" + "Enable" button. Then the mirror case.
3. **Both present** — both SAC balances > 0: both rows "Enabled", no Enable
   buttons, and Confirm (step 2) is reachable per the resolved gating.
4. **Post-enable transition** — set `pipeline.mock.wallet.stellar.changeTrust`
   to a mock hash; click "Enable" for the missing asset; assert the button shows
   pending then the row flips to "Enabled" and the button disappears (drive the
   reactive flip by updating the corresponding `balance.sac.*` key, since mock
   `hasTrustline` is derived from balance — see Open Questions).
5. **Pending / error states** — button disabled + spinner while submitting;
   error surfaced inline.
6. **EVM regression** — `flow.trustlines` is empty; no trustline block renders;
   EVM step 1 (Approve) is unchanged in both directions.
7. **Mock fast-path** — the existing changeTrust mock key still drives the Enable
   action to success.

Hook-level: extend `src/wallet/stellar/useStellarDepositManager.test.tsx` /
`useStellarWithdrawalQueue.test.tsx` only if new exported behavior is added;
otherwise rely on the route-level tests against `useDepositFlow`.

## Docs to Update

- **New user-stories doc:** `docs/user-stories/epic-498/604-stellar-trustline-dual-enable.md`,
  following the format of `docs/user-stories/epic-498/552-stellar-deposit-withdraw-wiring.md`
  — Given/When/Then stories for the four trustline states in both directions,
  with the exact mock keys.
- **Product spec:** check `docs/product-specs/index.md` for the Stellar
  deposit/withdraw spec; update the trustline section to state that both PLUSD
  and USDC trustlines are shown and individually enableable in both directions
  (behavior change → spec must lead per AGENTS.md docs-first rule).
- **Route docstring** in `packages/frontend/src/routes/deposit.tsx` (covered by
  Implementation step 6).
- No `known-bugs.md` change needed — this Issue *is* the fix for the trustline
  gap; if any unrelated bug surfaces during implementation, log it there per
  AGENTS.md.
