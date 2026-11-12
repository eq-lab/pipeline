# Trustee Risk & Watchlist

## Overview

Where the Trustee manages loan risk. The Trustee works loans from two entry points — the Overview page's **Needs Attention** block and the **Loans** page — but changes status in exactly one place: the loan card's **Update lifecycle** form, which carries the status and the supporting document together.

This spec is the source of truth for the risk/watchlist behavior below. Figma governs only the visual styling (fonts, colors, tokens, layout language); where Figma and this doc differ, this doc wins on behavior and structure.

## What the loans table and loan card show

1. **Status** — the loan's lifecycle status.
2. **LTV** (Stellar loans only) — the served loan-to-value from the SecurityRegistry and its margin-call state (below). EVM loans show none.
3. **Nearest payment** — the next payment's date, or, when overdue, how many days late. Served by the backend as `next_payment_timestamp` (the next scheduled payment — the current rollover-adjusted maturity for today's bullet loans) and `days_overdue` (whole days past it; `null` until then) on `GET /v1/loan-book` and `.../financials` — the frontend renders these directly and never derives the day count client-side. `days_overdue` here is pure date math off `next_payment_timestamp`; the cross-rollover *"a coupon was missed while maturity has not yet passed"* case below is tracked separately in #961.

## LTV and margin-call state

The Trustee reads the loan's LTV, margin-call state and price staleness from the Stellar SecurityRegistry (served by the backend, see [loan-security-state.md](./loan-security-state.md)); it does not compute them and no CCR is shown. There are no fixed percentage bands: the thresholds are the loan's own terms.

- **LTV above the loan's advance ratio** — attention (amber). A reason to place the loan on Watchlist and surface it in Needs Attention.
- **Margin call open, or LTV above the loan's margin-call ratio with no on-chain call yet** — **red**. Margin call to the borrower, issued via the originator.
- **Price stale** — a "Price stale" flag: the valuation price has expired and must be refreshed.
- **No security value** — a debt with no counted value (the `u32::MAX` sentinel) shows "No security value", not a percentage.
- **EVM loans** show no LTV, no margin-call state and no placeholder.

## When the Trustee places a loan on Watchlist (manual)

1. A margin call opened, or the LTV rose above the loan's margin-call ratio.
2. A coupon was missed while maturity has not yet passed — surfaced in Needs Attention with an overdue counter.

## Past Due — an attention state, not a settable status

When a loan's maturity date passes, it shows as **Past Due**. This is a **derived** display status (`now > maturity`), not something the Trustee sets: there is no on-chain "Past Due" status, and the label does not lock the loan. It exists to draw the Trustee's attention that the loan needs a decision.

Past Due is not Watchlist, and it is not Default — it points the Trustee to one of two existing actions:

- **Record the payment** — if the money arrived and simply has not been recorded yet, go record the coupon / repayment. Recording is still allowed; the on-chain status is unchanged.
- **Escalate to default** — if the money genuinely did not arrive, escalate the loan to Default via the Risk Council. This is the destructive, hard-to-reverse path, and it carries its own confirmation on the escalation flow.

The Trustee never flips a status to "lock" a Past Due loan; the response is always one of those two actions. The loan card surfaces both directly so the choice is obvious.

## Return to Performing

Moving a loan from Watchlist back to Performing uses the same Update lifecycle form — one button, instant, no timelock. The exit is as prominent in the UI as the entry; otherwise loans accumulate in Watchlist and are never cleared.

## Escalation (Default, write-down and close)

The Trustee cannot declare Default, cure a default, write a loan down or close it with a loss — ever. The Trustee **escalates off-chain**: the loan card's **Escalate to Risk Council** action opens the evidence page (ledger, LTV and margin-call state, portfolio impact, on-chain status).

The **Risk Council** acts through the access manager. It declares Default on the loan registry at once (scheduled while #1756 is open), and every other Risk Council action (amend economics, write down, close a defaulted loan, cure) waits 24 hours, which the Guardian or the Admin can cancel. The console shows the Risk Council's action pages, enabled only for a wallet whose on-chain `can_call` allows them; a Trustee-only wallet sees them read-only. See the Type 3 flows in the Trustee Dashboard spec and [Trustee flows](../frontend/trustee-flows.md#risk-council-actions) for the calls and gates.
