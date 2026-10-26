# Issue #1623: Trustee: coupon covering principal goes to equity while the screen says it repays senior; loan can't be closed

Source: https://github.com/eq-lab/pipeline/issues/1623

Parent epic: #1521. Branch: `fix/1623-coupon-principal-hint` (based on main at 4785073a, which includes #1622, #1624 and #1626).

## Scope

### Decision: option (a), block the coupon and send the trustee to Record Repayment

The specs settle this.

- `docs/frontend/trustee-flows.md` §"Record Coupon — interest-only, context-dependent third row" defines Record Coupon as the **interest-only coupon** flow: `senior_principal_repaid = "0"`, "principal stays deployed". §"Record Repayment — Principal (#884)" makes Record Repayment the only flow that carries `senior_principal_returned` into `senior_principal_repaid`, and it always pays the full remaining balance.
- The issue says the same thing: "The coupon behaviour itself (interest-only) is spec-sanctioned. The misleading hint and the dead end are the bug."
- Option (b) would send waterfall principal from the coupon page. That merges the two flows, contradicts the frontend spec, and would allow partial principal repayments, which the #884 section rules out ("there are no partial principal repayments").

So the coupon stays interest-only. A coupon whose waterfall would put any amount into senior principal is **not recordable** on this page. The page tells the trustee so and links to Record Repayment.

### Why "any principal" is the trigger

The current spec text says the waterfall's `senior_principal_returned` is "a principal-first `min(amount, outstanding)` figure". That is stale. The shipped backend (`packages/api/src/routes/waterfall.rs`, module docs stage 4) cascades **interest tier, then OET, then senior principal, then equity**. It does this deliberately, as a departure from `yield.md`. So:

- `senior_principal_returned > 0` exactly when the entered amount exceeds the interest and OET due and senior principal is still outstanding. In that case the current payload sends the excess to `equity_distributed` instead. That is the bug.
- `senior_principal_returned == 0` means the amount is fully absorbed by interest and OET (equity residual 0). Or senior is already fully repaid (outstanding 0), and the residual legitimately goes to equity. Both are true interest-only coupons.

The gate is therefore the backend-served `senior_principal_returned` alone. There is no client-side threshold arithmetic ([[no-frontend-computed-metrics]]). Once a coupon is recordable, its payload has principal 0 and the waterfall also has principal 0, so the hint, the rows and the payload always agree. Principal is never moved into equity, so a later Record Repayment (prefilled to the full `offtaker_outstanding`) can still amortise the senior. The loan stays closable through the existing close checklist (#1624).

### What changes

1. `-record-coupon.ts`
   - `buildRepaymentInput` returns `null` when `waterfall.senior_principal_returned` is not `"0"`.
   - A new `coversPrincipal` view flag replaces `isTerminal`. `isTerminalRepayment` is deleted.
   - When `coversPrincipal` is true, the summary is hidden.
   - A notice view field carries the principal figure, displayed as served and converted with the chain's decimals.
2. `loans.$id_.record-coupon.tsx`
   - The misleading "This coupon fully repays senior principal — next stage: principal repayment closes the loan." hint is removed.
   - A blocking notice takes its place: the amount includes $X of senior principal, a coupon records interest only, and a link goes to Record Repayment (`/loans/$id/record-repayment`, keeping `chain`).
   - "Record on the ledger" stays disabled through the existing `recordPaymentInput == null` gate.
3. Spec and user-story docs, listed under Docs to Update.

### Out of scope

- Backend and contract changes. The waterfall response shape and the cascade order are used as-is.
- The Record Repayment flow's own payload logic.
- Partial principal repayments. The spec has none.
- Any change to the "Offtaker still owed after coupon" row or `amountWarning` (#1048).
- EVM write gating (TD-152).
- Remediating loans already stuck in the dead-end state (see Open Questions).

## Assumptions and Risks

- **Interest-first cascade is the contract of the deployed API.** If the backend ever went back to principal-first (`min(amount, outstanding)` first, as `yield.md` / `trustee-dashboard.md` flow note A still describe), every coupon would show `senior_principal_returned > 0` and be blocked. That failure is loud, not silent. The coder should confirm on staging that a small coupon returns `senior_principal_returned: "0"` before relying on the gate (Network tab check, [[no-localstorage-mocks-verify-real-data]]). The existing page-test fixture `WATERFALL_INTEREST_ONLY` already models this (`"0"`).
- **Trustee holding an excess wire.** If the wire received is more than interest + OET but less than the full `offtaker_outstanding`, neither page can record it: Record Coupon blocks it, and Record Repayment requires the full balance. This matches the current spec (no partial principal repayments). The notice copy must not promise that Record Repayment accepts an arbitrary amount.
- **Senior already fully repaid** (`senior_outstanding` = 0, offtaker still owes): the waterfall returns principal 0 and the residual goes to equity. The coupon stays recordable. A test covers this so the gate does not over-block.
- `lint-comments.baseline.json` lists all four record-* test files and both `.tsx` routes. Do not add comments. If a touched file's count drops (for example, the `{/* Terminal-close hint ONLY … */}` JSX comment is deleted together with the hint), shrink its baseline entry.
- `trustee-dashboard.md` flow note A and `yield.md` still describe principal-first ordering. They are backend/product specs and are not edited here. Only the frontend spec's stale description is corrected.

## Open Questions

- **Loans already stuck** (an earlier over-sized coupon left `offtaker_outstanding` = 0 with `senior_outstanding` > 0): Record Repayment shows "Offtaker fully repaid — nothing left to record" while the close checklist's senior gate stays red. No app path exists to close them, because write-down close (flow 12) is read-only. Should this issue add anything for them? **Recommended default:** no new remediation path, since that needs a Risk Council write-down or a backend/contract decision. Add only an informational line to the Record Repayment fully-paid notice when `senior_outstanding` > 0, so the dead end is explained rather than silent: "Senior principal of $X is still outstanding on-chain, so this loan can't be closed from the app. Escalate to the Risk Council." (Step 4, include unless told otherwise.)

## Implementation Steps

1. `packages/trustee/src/routes/-record-coupon.ts`
   - `buildRepaymentInput(amountBaseUnits, waterfall)`: after the existing `null` guards, return `null` when `BigInt(waterfall.senior_principal_returned) > 0n`. Keep `senior_principal_repaid: "0"` and the equity residual logic, which still applies when senior is already fully repaid.
   - Add an exported pure helper `coversSeniorPrincipal(waterfall: { senior_principal_returned: string } | undefined): boolean`, which is `waterfall != null && BigInt(waterfall.senior_principal_returned) > 0n`. Use it both in `buildRepaymentInput` and in the hook so there is a single source.
   - Delete `isTerminalRepayment` and the `isTerminal` computation and view field.
   - Add these view fields to `RecordCouponView`:
     - `coversPrincipal: boolean`. True only when `amountSettled && coversSeniorPrincipal(waterfall.data)`, so it is masked during the debounce window like the summary (#1622).
     - `principalInAmount: string`. This is `usdFull(seniorPrincipalReturnedUsd)`, already computed via `toUsd`, so it uses the chain decimals. It shows `"—"` when absent.
   - `summaryText`: additionally require `!coversPrincipal`. The listed components would not sum to the entered amount, and nothing will be recorded.
   - Leave the `Senior principal returned` row as is: `$0`, disabled, sub "Interest-only coupon — principal stays deployed". It describes what a recordable coupon sends.
   - Update the file header spec pointer only if the anchor changes. Add no other comments.
2. `packages/trustee/src/routes/loans.$id_.record-coupon.tsx`
   - Remove the `view.isTerminal` block (`data-testid="record-coupon-terminal-hint"`) and its JSX comment.
   - Add, in the same position, a notice rendered when `view.coversPrincipal`. Use `data-testid="record-coupon-principal-block"` and `aria-live="polite"`. Reuse the warning styling of `record-coupon-amount-warning` (same token `--color-pipeline-warning` and icon), with no new design tokens. Copy: `This amount includes {view.principalInAmount} of senior principal. A coupon records interest only. Record principal on the Record Repayment page, which pays the full remaining balance.` Make "Record Repayment" a `<Link to="/loans/$id/record-repayment" params={{ id }} search={{ chain }}>`, styled like the page's other inline links (`text-[#000080] underline`).
   - The submit `disabled` expression is unchanged. `recordPaymentInput` is already `null` in this case.
3. Run the verification commands: `yarn workspace @pipeline/trustee test` (vitest), `yarn workspace @pipeline/trustee build` (tsc + vite; no new route, so routeTree regeneration is not needed), `npx tsx scripts/lint-docs.ts`, `npx tsx scripts/lint-comments.ts`, and the repo's eslint/prettier for the trustee package. Shrink `scripts/lint-comments.baseline.json` entries for touched files whose counts dropped.
4. (Open Question default) `packages/trustee/src/routes/-record-repayment.ts` and `loans.$id_.record-repayment.tsx`
   - Expose `seniorStillOutstanding: string | null` on the view. It is `usdFull(outstandingSeniorUsd)` when `offtakerFullyPaid && outstandingSeniorUsd != null && outstandingSeniorUsd > 0`, else `null`.
   - In the `record-repayment-fully-paid` branch, render one extra muted line (`data-testid="record-repayment-senior-outstanding"`) with the copy from Open Questions when it is non-null.
   - Do not change any gating. Drop this step if the human answers the question differently.

## Test Strategy

`packages/trustee/src/routes/-record-coupon.test.ts` (pure helpers):

- Delete the `isTerminalRepayment` describe block.
- `coversSeniorPrincipal`: `undefined` gives false; `"0"` gives false; `"1"` gives true; `"18400000000000"` gives true.
- `buildRepaymentInput`:
  - Returns `null` when `senior_principal_returned > 0`.
  - With principal `"0"` and amount = carve-outs, returns `senior_principal_repaid: "0"` and `equity_distributed: "0"`.
  - With principal `"0"` and amount > carve-outs (the senior-already-repaid case), returns `senior_principal_repaid: "0"` and equity = residual.
  - The six components sum to `offtaker_received` whenever a payload is returned.

`packages/trustee/src/routes/-record-coupon-page.test.tsx` (acceptance: coupon ≥ interest + senior):

- Replace the two terminal-hint tests and keep the "no Next stage hint for a normal coupon" test, retargeted to the new testid.
- **Coupon covering principal is blocked and the screen matches.** Mock the issue's example shape. Use a waterfall with `senior_principal_returned` = senior outstanding ($1,840,000 in the existing fixture, `WATERFALL_TERMINAL`, renamed to e.g. `WATERFALL_COVERS_PRINCIPAL`) and enter `1900000`. After settling:
  - `record-coupon-principal-block` shows `$1,840,000`.
  - The Record Repayment link points at `/loans/$id/record-repayment` with the `chain` search param (assert via the router mock's `Link` props).
  - `record-coupon-summary` is absent.
  - Submit stays disabled, and clicking it does not call `mockRecord.mutateAsync`.
  - Neither `record-coupon-terminal-hint` nor the text "fully repays senior principal" is anywhere in the document.
- **Partial principal is blocked too.** Use a waterfall with `senior_principal_returned` = `"10000000"` ($1) and the interest fixture's carve-outs. The notice renders and submit is disabled.
- **Interest-only coupon still records.** Use `WATERFALL_INTEREST_ONLY` at $45,000. There is no block notice, submit is enabled, and the payload has `senior_principal_repaid: "0"`, `equity_distributed: "0"`, and components that sum to `offtaker_received`. Extend the existing "records the payment on-chain…" test if it already covers this.
- **Senior already repaid.** Use a loan-book row with `senior_outstanding` `"0.000000"`, a waterfall with principal `"0"`, and an amount above the carve-outs. Submit is enabled and the payload sends the residual to equity.
- **Debounce masking (#1622 parity).** With an amount-keyed waterfall mock, change from a blocked amount to an interest-only amount. The notice disappears immediately, while the input is still unsettled, and does not flash back.

`packages/trustee/src/routes/-record-repayment-page.test.tsx` (closability; Step 4):

- **Closable after an interest-only coupon.** Use financials with `offtaker_outstanding` ≥ `senior_outstanding` (the post-coupon state the gate guarantees). The form renders (not the fully-paid notice), the prefill settles, and the payload's `senior_principal_repaid` equals the waterfall's principal. After the mocked refetch sets `senior_outstanding` to `0` and `not_minted_yield` to `0`, the Close loan button enables. Reuse the existing #1624 checklist fixtures.
- **Stuck-loan notice (Step 4).** With `offtaker_outstanding` `"0.000000"` and `senior_outstanding` > 0, `record-repayment-senior-outstanding` renders the amount. With both at 0 it is absent.

Manual (staging, user-driven; do not drive the user's browser): open Record Coupon on a Stellar loan.

- Enter an amount around the scheduled coupon. The Network tab should show `senior_principal_returned: "0"`, and the coupon should be recordable.
- Enter an amount of at least interest + senior. The block notice and link should appear, and Record should be disabled.

## Docs to Update

- `docs/frontend/trustee-flows.md`
  - §"Record Coupon — interest-only, context-dependent third row":
    - Correct the waterfall description: the backend cascades interest, then OET, then principal, then equity (`waterfall.rs` stage 4), so `senior_principal_returned` is non-zero only when the amount exceeds interest + OET.
    - State the #1623 rule: a coupon whose waterfall returns any senior principal is not recordable (`recordPaymentInput` `null`, summary hidden). The page shows the principal amount and links to Record Repayment.
    - Replace the "Terminal-close detection" bullet.
  - §"Suppressed 'Next stage: principal repayment' button": the button stays suppressed. The terminal hint is replaced by the principal-block notice.
  - §"Record action gating (#1622)": "the Record Coupon terminal hint" becomes "the principal-block notice".
  - §"Record Repayment … Offtaker fully paid (#1090)": add the stuck-loan informational line (Step 4 default).
- `docs/user-stories/epic-1521/1623-coupon-principal-block.md` (new, same format as `1622-record-coupon-stale-amount.md`). Stories:
  1. An interest-only coupon records with principal 0.
  2. A coupon of at least interest + senior is blocked, the notice and link are shown, and Record is disabled.
  3. After an interest-only coupon, Record Repayment still shows the form and the loan closes.
  4. (Step 4) A stuck loan shows the senior-outstanding line.
- `docs/user-stories/index.md`: add the #1623 row next to #1622/#1626.
- On completion, move this plan to `docs/exec-plans/completed/`.
