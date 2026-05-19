# Issue #312: Fix /withdraw confirm gate while allowance is loading

Source: https://github.com/eq-lab/pipeline/issues/312

## Scope

The `/withdraw` route currently derives `needsApproval` and step gates from `allowance` in a way that treats the loading state (`allowance === undefined`) as "no approval needed". That lets Step 2 (Confirm) be enabled and `requestWithdrawal` be called before we know whether the PLUSD allowance is sufficient, and lets Step 1 show its success badge while allowance is still loading.

In scope:

- Introduce a positive "allowance is known and sufficient" predicate in `packages/frontend/src/routes/withdraw.tsx`.
- Rewrite the gates that currently bind on `!needsApproval`:
  - `canConfirm` — must require known-sufficient allowance, not just "no known shortfall".
  - `step1State` — only "success" when allowance is known to cover the amount, or when an active request already exists (existing override).
  - `isInputFaded` — same gate as `canConfirm`'s allowance check, so the input does not fade purely because allowance is still loading.
- Keep `needsApproval` semantics for the Approve button enablement; the Approve button is already correctly gated (it requires `needsApproval === true`, which is only true when allowance is known and short).
- Add one new test scenario: balance and decimals loaded, allowance still `undefined`. Confirm button must stay disabled, step 1 must not show "success", input must not fade.

Out of scope:

- Any change to `/deposit`. Issue is /withdraw-specific.
- Touching `useApproval` / `useToken` semantics. The hooks already return `undefined` for an unknown allowance — the bug is in how `/withdraw` consumes that.
- Changing `formatUsdc`, `parseUsdc`, `WalletProvider`, or any wagmi mocks.
- Visual / Figma changes — the disabled state already exists; we're only correcting *when* it applies.

## Assumptions and Risks

Assumptions:

- `useToken({ token, spender })` returns `allowance: undefined` while the ERC-20 `allowance(owner, spender)` read is in flight (verified in `packages/frontend/src/wallet/useApproval.ts`).
- In the route test harness, omitting the `pipeline.mock.wallet.allowance.<token>.<spender>` localStorage key plus leaving `mockUseReadContract` at its default (`data: undefined`) yields the production "allowance loading" state — `useToken` falls through to `allowanceRead.data` which is `undefined` (verified against `useApproval.ts` lines 139–170 and the existing route test setup at `packages/frontend/src/routes/-withdraw.test.tsx:32-37`).
- `requestIsConfirmed` already correctly stays `false` while the API/local request data is loading, so the existing override on `step1State` (`|| requestIsConfirmed`) is still safe.
- Withdraw is the only route with this bug. (Deposit page is out of scope by issue framing; not auditing it here.)

Risks:

- A purely "negative-only" rewrite (changing `!needsApproval` to `allowance !== undefined && allowance >= amountBig`) could subtly change disabled/enabled behavior in places we didn't intend if `amountBig === 0n`. Existing tests cover the "no amount yet" cases; we must keep those green. The proposed predicate `hasSufficientAllowance = allowance !== undefined && amountBig > 0n && allowance >= amountBig` mirrors the shape of the existing `needsApproval` predicate (also requires `amountBig > 0n`) so the "before amount entered" semantics stay the same.
- The "PendingVerification with allowance known-sufficient" test scenario must continue to pass — `requestIsConfirmed` is `true` in that state, so `step1State` falls back to the existing override branch. Confirmed via inspection of `-withdraw.test.tsx:386-454`.
- The bug only manifests in real-RPC sessions where the allowance read genuinely takes a tick to resolve. In E2E it may have been masked by the mock layer always seeding allowance. The fix is small enough that this is acceptable risk.

## Open Questions

_None_

## Implementation Steps

All file paths are relative to the repo root unless absolute.

1. Edit `packages/frontend/src/routes/withdraw.tsx`:
   1. After the existing `needsApproval` line (currently line 120–121), introduce:
      ```ts
      // Positive "allowance is known and sufficient" gate. Distinct from
      // !needsApproval, which is true both when allowance covers the amount AND
      // when allowance is still undefined (loading). Step 2 / Confirm must only
      // unlock once we know the allowance covers amountBig.
      const hasSufficientAllowance =
        allowance !== undefined && amountBig > 0n && allowance >= amountBig;
      ```
   2. Change `canConfirm` (currently lines 178–183) so it requires the positive gate instead of `!needsApproval`:
      ```ts
      const canConfirm =
        isConnected &&
        canDeposit &&
        hasSufficientAllowance &&
        !requestWithdrawal.isPending &&
        !requestIsConfirmed;
      ```
   3. Change `step1State` (currently lines 195–198) to use the positive gate, preserving the existing `|| requestIsConfirmed` override:
      ```ts
      const step1State =
        (hasSufficientAllowance && isConnected) || requestIsConfirmed
          ? "success"
          : "idle";
      ```
      Note: `amountBig > 0n` is already baked into `hasSufficientAllowance`, so the existing `amountBig > 0n` clause becomes implicit.
   4. Change `isInputFaded` (currently lines 165–166) so it does not fade while allowance is still loading:
      ```ts
      const isInputFaded =
        isConnected && hasSufficientAllowance && !requestIsConfirmed;
      ```
      (The `amountBig > 0n` clause is again implicit in `hasSufficientAllowance`.)
   5. Update the route's JSDoc header block (lines 16–72) where it describes the gates. Specifically refresh the "Step 2 Enabled when" sentence at line 25 to read: "Enabled when allowance is known to cover amountBig (hasSufficientAllowance) && canDeposit && !requestIsConfirmed." Keep the rest of the JSDoc intact.

2. Update `packages/frontend/src/routes/-withdraw.test.tsx`:
   1. Add a new `describe` block named `"Withdraw page — allowance is still loading"` after the existing `"approved state"` block (after line 384). Use the existing `seedBaseMocks` helper but call it with a custom variant that does NOT write the `pipeline.mock.wallet.allowance.<plusd>.<wq>` key. Two options — pick one:
      - Option A (preferred, minimal surface area): add an optional `seedAllowance` flag to `seedBaseMocks` (default `true`) and skip the `setItem` call when `false`. Then call `seedBaseMocks({ seedAllowance: false })` in the new block's `beforeEach`.
      - Option B: inline the seeding for this block instead of calling the helper.
   2. The new block contains three assertions, all run after typing `10` into the PLUSD amount input:
      - `screen.getByRole("button", { name: "Confirm" })` is `toBeDisabled()`.
      - `screen.queryByLabelText("Approve complete")` is either `null` or its `data-state` is not `"success"` (i.e. step 1 is not shown done).
      - The input element's `className` does NOT contain `opacity-30` (i.e. `isInputFaded` is false). Read the element via `screen.findByRole("textbox", { name: /PLUSD amount/i })` and `expect((input as HTMLInputElement).className).not.toContain("opacity-30")`.
   3. The block's `beforeEach` mirrors the existing pattern: `localStorage.clear()`, reset mocks, set `mockRequestsData = undefined` etc., then `seedBaseMocks({ seedAllowance: false })`.
   4. Verify existing tests at `-withdraw.test.tsx` still pass — especially:
      - `"step 1 shows success badge when allowance covers the entered amount"` (lines 339–351) — still passes because allowance is seeded as `1000…0`.
      - `"Confirm button stays disabled when approve is needed"` (lines 290–301) — still passes because allowance is seeded as `0` (known short → `needsApproval = true` → `hasSufficientAllowance = false`).
      - `"PendingVerification"` block (lines 386–454) — still passes because `requestIsConfirmed === true` overrides the step1 state.

3. Lint / typecheck:
   - Run `yarn workspace @pipeline/frontend lint` (or the repo-level fast test command via `/test-fast`) and fix any reports.
   - Run `npx tsx scripts/lint-docs.ts` per `AGENTS.md`.

4. Manual sanity check (optional but recommended): start the dev server, open `/withdraw` while not connected to any mock and observe the Confirm button stays disabled until allowance resolves. (E2E / ux-tester will cover this anyway.)

## Test Strategy

Automated:

- Add the new `describe` block above in `packages/frontend/src/routes/-withdraw.test.tsx` ("Withdraw page — allowance is still loading"). Three assertions: Confirm stays disabled, step 1 not success, input not faded. This is the test the Issue explicitly calls for.
- All existing scenarios in `-withdraw.test.tsx` (10 describe blocks, ~25 tests) must still pass unchanged. They exercise:
  - allowance = 0 (approve-needed) — `needsApproval = true`, `hasSufficientAllowance = false`. Confirm disabled (unchanged).
  - allowance ≥ amount (approved) — `needsApproval = false`, `hasSufficientAllowance = true`. Confirm enabled, step 1 success (unchanged).
  - PendingVerification — `requestIsConfirmed = true` overrides step1; canConfirm gated by `!requestIsConfirmed` so stays disabled (unchanged).
  - PendingClaim — same as PendingVerification for step 1; step 2 success driven by `isPendingClaim` (unchanged).
  - Zero balance — `canDeposit = false` short-circuits both Approve and Confirm (unchanged).
  - Disconnected — `isConnected = false` short-circuits everything (unchanged).
  - Quick-amount chips — purely local input state, no allowance dependency.

Edge cases worth thinking through (covered by the matrix above, called out explicitly):

- `amountBig === 0n` and `allowance === undefined` — `hasSufficientAllowance = false`, `needsApproval = false`. Step 1 idle, Confirm disabled. Matches the "before amount entered" tests already in the file.
- `amountBig > 0n` and `allowance === undefined` (the bug case) — `hasSufficientAllowance = false`, `needsApproval = false`, `requestIsConfirmed = false`. Step 1 idle, Confirm disabled, input not faded. Covered by the new test.
- `amountBig > 0n` and `allowance >= amountBig` — `hasSufficientAllowance = true`. Step 1 success, Confirm enabled, input faded. Covered by the existing "approved state" block.
- `amountBig > 0n` and `allowance < amountBig` — `hasSufficientAllowance = false`, `needsApproval = true`. Step 1 idle, Approve enabled, Confirm disabled, input not faded. Covered by the existing "approve needed" block.

Run command:

- `yarn workspace @pipeline/frontend test -- routes/-withdraw.test.tsx` for fast iteration.
- Full fast-test gate via `/test-fast` before opening the PR.

## Docs to Update

- The JSDoc block at the top of `packages/frontend/src/routes/withdraw.tsx` — update the Step 2 enablement description to reflect the positive `hasSufficientAllowance` gate (step 1.5 in Implementation Steps).
- No product spec change required: this is a behavior-preserving bug fix. The intended behavior ("Confirm is disabled until approval is complete") was already documented; the bug is that the implementation gated on the negation of an unknown.
- No `docs/design-docs/` change. No Figma reference involved beyond the existing link already in the file header (kept).
- No entry in `docs/exec-plans/known-bugs.md` — the bug is being fixed here.
