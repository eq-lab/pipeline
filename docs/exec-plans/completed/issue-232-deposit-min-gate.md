# Issue #232: Disable Approve/Convert buttons when amount < minDeposit on /deposit

Source: https://github.com/eq-lab/pipeline/issues/232

## Scope

Tighten the `/deposit` page state machine so the two action buttons — **Approve** (step 1) and **Convert** (step 2) — only become clickable when the entered amount is at least `minDeposit`. Sub-minimum inputs must keep both buttons disabled so the user never submits a `requestDeposit` tx that the contract would revert with `DepositManagerLessThanMinAmount`.

In scope (frontend only):

- `packages/frontend/src/routes/deposit.tsx`: introduce a derived `meetsMin` predicate and fold it into the existing `canApprove` and `canConvert` gates. While `minDeposit` is still `undefined` (loading) `meetsMin` is `false` — both buttons stay disabled by default.
- `packages/frontend/src/routes/-deposit.test.tsx`: extend the test suite with the five min-deposit cases listed in the Issue.

Explicitly out of scope (matches Issue):

- No new sub-min error banner or toast. The disabled buttons plus the existing `$X (Min)` quick-amount label are the affordance.
- No `amount <= balance` validation — already handled by the insufficient-balance banner from #227.
- No per-token gating — this change scopes to USDC / `DepositManager` only.
- No backend / smart-contract changes. The contract revert remains the ultimate safety net; this Issue just removes the bad UX of estimating an impossible tx.

## Assumptions and Risks

- #227 is already merged on `main` (verified: Issue #227 is closed, and `deposit.tsx` already imports `useDepositManagerMinDeposit`, exposes `hasBalance === false` low-balance branch, and uses the `$X (Min)` quick-amount chip). No rebase or "apply on top of whichever lands first" handling required — the new gates layer cleanly on the existing logic.
- `useDepositManagerMinDeposit()` already returns `minDeposit: bigint | undefined` (see `packages/frontend/src/wallet/useDepositManager.ts:192`). No hook changes needed.
- `parseUsdc(amountInput, decimals)` returns `0n` for empty or malformed input (verified at `packages/frontend/src/lib/usdc.ts:29-39`). So `amountBig > 0n && amountBig >= minDeposit` is the correct compound check — the `> 0n` clause prevents `0n >= 0n`-style false positives when `minDeposit` happens to be `0n`.
- Risk — chip semantics: pressing **Min** today calls `setAmountInput(formatUsdc(minDeposit, decimals).replace(/,/g, ""))`. `formatUsdc` rounds to two fraction digits, so for fractional-base-unit `minDeposit` values the displayed string could re-parse to a value strictly below `minDeposit` (e.g. `minDeposit = 1_000_000_001n` at 6 dp → input becomes `"1000.00"` → parses back to `1_000_000_000n < minDeposit`). For the realistic USDC values used today (`minDeposit` is whole dollars) this cannot occur, and the Issue accepts the disabled-button outcome as correct UX. We will not change chip rounding in this Issue. Flag in comments only.
- Risk — `minDeposit === 0n`: with the `amountBig > 0n` guard the gate still requires a positive amount, so a zero-minimum contract setting would not accidentally enable a zero-amount tx. Confirmed safe.
- Risk — the insufficient-balance branch (`hasBalance === false`) replaces the `StepsCard` entirely, so the new gate has no visible effect inside that branch. Tests must therefore use a balance large enough that `hasBalance === true` for the min-deposit cases.

## Open Questions

_None_

## Implementation Steps

1. **Edit `packages/frontend/src/routes/deposit.tsx`** in the "Derived state" block (around lines 79-104):
   - Add the new predicate immediately after `needsApproval` is computed:
     ```ts
     // Amount must be a positive value AND at least the on-chain minDeposit.
     // While minDeposit is undefined (loading), meetsMin is false → both action
     // buttons stay disabled. This prevents submitting a requestDeposit tx that
     // would revert with DepositManagerLessThanMinAmount and trip the wallet's
     // gas-estimation fallback (see Issue #232 for the underlying error chain).
     const meetsMin =
       minDeposit !== undefined && amountBig > 0n && amountBig >= minDeposit;
     ```
   - Update `canApprove` to fold in `meetsMin`. Drop the now-redundant `amountBig > 0n` clause (subsumed by `meetsMin`):
     ```ts
     const canApprove =
       isConnected &&
       hasBalance === true &&
       meetsMin &&
       needsApproval &&
       !isApprovePending;
     ```
   - Update `canConvert` the same way:
     ```ts
     const canConvert =
       isConnected &&
       hasBalance === true &&
       meetsMin &&
       !needsApproval &&
       !requestDeposit.isPending;
     ```
   - Leave the step 1 success badge condition (`!needsApproval && amountBig > 0n && isConnected`) unchanged — once allowance is granted, the badge should remain visible regardless of whether the new amount currently meets the minimum. This matches the existing Approve→Convert UX where the Approve check stays "Done" once allowance is sufficient.
   - Do NOT touch the `ConversionCard` `disabled` prop (`!isConnected || !isReady`) — the input must stay editable below the minimum so the user can correct their amount.

2. **Extend `packages/frontend/src/routes/-deposit.test.tsx`** with a new describe block, e.g. `describe("Deposit page — minDeposit gating", () => { ... })`. Seed using the existing `seedBaseMocks` helper. All cases use `balance = BALANCE_5000_RAW` so the `hasBalance === true` branch renders the `StepsCard`.

   Cases to add (one `it(...)` per case):

   1. **Amount = 0** (no typing) → both `Approve` and `Convert` buttons disabled. Use `allowance: "10000000000"` so the only thing keeping the buttons off is the amount gate.
   2. **Amount below minDeposit** with sufficient allowance → both buttons disabled. Seed `allowance: "10000000000"`, type `"500"` (< 1,000 min). Verify `Approve` AND `Convert` are both disabled (allowance covers it, so without the gate Convert would be enabled — this proves `meetsMin` blocks Convert independently). Verify the step 1 success badge ("Done") is NOT shown for the sub-min amount path? — actually leave that out; the badge depends on `amountBig > 0n && !needsApproval`, which is independent of `meetsMin`. Asserting only the disabled state of the two buttons is sufficient and matches the Issue.
   3. **Amount below minDeposit** with zero allowance → both buttons disabled. Seed `allowance: "0"`, type `"500"`. This proves the gate independent of approval state.
   4. **Amount equal to minDeposit** with zero allowance → `Approve` enabled, `Convert` disabled (because `needsApproval` is true). Type `"1000"`. This is the boundary case showing `amountBig >= minDeposit` (not strictly `>`).
   5. **Amount equal to minDeposit** with sufficient allowance → `Convert` enabled. Seed `allowance: "10000000000"`, type `"1000"`.
   6. **Amount greater than minDeposit** with sufficient allowance → `Convert` enabled. Type `"2000"`.
   7. **`minDeposit === undefined`** → both buttons disabled regardless of amount. Achieve by calling `seedBaseMocks(...)` and then `localStorage.removeItem("pipeline.mock.wallet.contract.depositManager.minDeposit")` in the test body before render. Type `"5000"`. Both buttons must stay disabled.

   In every case, wait for the relevant element with `findByRole`/`waitFor` because the `isReady`/`useToken` hooks settle asynchronously.

3. **Run the local checks** before declaring complete:
   - `npm run -w @pipeline/frontend test -- routes/-deposit` (or whatever the project script is — `coder` will pick the canonical command).
   - `npm run -w @pipeline/frontend build` to confirm types still hold.
   - `npx tsx scripts/lint-docs.ts` per AGENTS.md (even though no docs change, the lint may inspect related files).

## Test Strategy

Pure integration tests at the route level via the existing mock-wallet harness in `packages/frontend/src/routes/-deposit.test.tsx`. No new test file is needed.

Edge-case coverage:

- Empty input (`amountBig === 0n`) → covered by case 1.
- Sub-min input with both allowance states → covered by cases 2 and 3 (ensures `meetsMin` blocks `Convert` even when `needsApproval` is false).
- Exact equality boundary (`amountBig === minDeposit`) → covered by cases 4 and 5; pinpoints whether the predicate is `>=` (correct) vs `>` (incorrect).
- Amount above minimum → covered by case 6 (positive control).
- `minDeposit` not yet loaded → covered by case 7 (verifies the loading default is "disabled," not "enabled").

Regression guards (already in the file — must keep passing unmodified):

- "Approve button is disabled before amount is entered" — still passes because `meetsMin === false` when `amountBig === 0n`.
- "Approve button becomes enabled after entering an amount" — passes because the typed amount (`"2000"`) is above the seeded 1,000 USDC minimum.
- "Convert button is enabled when allowance covers the entered amount" — passes because the typed `"2000"` clears the new gate.

Manual / ux-tester verification (the manager will run `ux-tester` after coder if a Figma reference is present):

- Open `/deposit` with mock balance set to 5,000 USDC and minDeposit 1,000 USDC. Type `500` → both Approve and Convert remain greyed out. Type `1000` → Approve becomes clickable. After approving, Convert becomes clickable.
- Open the page with minDeposit still loading (slow RPC simulation) → both buttons start disabled, then enable once minDeposit resolves and amount is sufficient.
- Figma reference cited in the Issue is the existing `/deposit` design (`https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100130&m=dev`). The visual contract for sub-min is "no special banner — only the `$X (Min)` quick-amount chip remains visible," which is already the page's layout. ux-tester should confirm: (a) no extra error toast appears in the sub-min state, (b) the existing `$1,000.00 (Min)` chip is still readable, (c) buttons render in their disabled visual style.

## Docs to Update

- None. This is a UI-only behavioural tightening with no public API, no hook contract change, and no user-visible copy change. The existing `docs/frontend/hooks.md` entry for `useDepositManagerMinDeposit` already documents the source of the floor value. No product-spec change required (the contract revert is unchanged; this is purely a client-side guard).
