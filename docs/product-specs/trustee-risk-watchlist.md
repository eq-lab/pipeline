# Trustee Risk & Watchlist

## Overview

Where the Trustee manages loan risk. The Trustee works loans from two entry points — the Overview page's **Needs Attention** block and the **Loans** page — but changes status in exactly one place: the loan card's **Update lifecycle** form, which carries status, CCR, location, and the supporting document together.

This spec is the source of truth for the risk/watchlist behavior below. Figma governs only the visual styling (fonts, colors, tokens, layout language); where Figma and this doc differ, this doc wins on behavior and structure.

## What the loans table and loan card show

1. **Status** — the loan's lifecycle status.
2. **CCR** — the value and its color band (below).
3. **Nearest payment** — the next payment's date, or, when overdue, how many days late. Served by the backend as `next_payment_timestamp` (the next scheduled payment — the current rollover-adjusted maturity for today's bullet loans) and `days_overdue` (whole days past it; `null` until then) on `GET /v1/loan-book` and `.../financials` — the frontend renders these directly and never derives the day count client-side. `days_overdue` here is pure date math off `next_payment_timestamp`; the cross-rollover *"a coupon was missed while maturity has not yet passed"* case below is tracked separately in #961.

## CCR color bands

- **≥ 130%** — normal.
- **below 130%** — **yellow**. A reason to place the loan on Watchlist and surface it in Needs Attention.
- **below 120%** — **orange**. Margin call to the borrower, issued via the originator.
- **below 110%** — **red**. Hard margin call.
- **stale** — **gray**. The CCR value has expired and must be refreshed.

## When the Trustee places a loan on Watchlist (manual)

1. CCR fell below 130%.
2. A coupon was missed while maturity has not yet passed — surfaced in Needs Attention with an overdue counter.

## Past Due — an attention state, not a settable status

When a loan's maturity date passes, it shows as **Past Due**. This is a **derived** display status (`now > maturity`), not something the Trustee sets: there is no on-chain "Past Due" status, and the label does not lock the loan. It exists to draw the Trustee's attention that the loan needs a decision.

Past Due is not Watchlist, and it is not Default — it points the Trustee to one of two existing actions:

- **Record the payment** — if the money arrived and simply has not been recorded yet, go record the coupon / repayment. Recording is still allowed; the on-chain status is unchanged.
- **Escalate to default** — if the money genuinely did not arrive, escalate the loan to Default via the Risk Council (24h timelock). This is the destructive, hard-to-reverse path, and it carries its own confirmation on the escalation flow.

The Trustee never flips a status to "lock" a Past Due loan; the response is always one of those two actions. The loan card surfaces both directly so the choice is obvious.

## Return to Performing

Moving a loan from Watchlist back to Performing uses the same Update lifecycle form — one button, instant, no timelock. The exit is as prominent in the UI as the entry; otherwise loans accumulate in Watchlist and are never cleared.

## Escalation (Default and write-down close)

The Trustee cannot set Default or close a loan with a loss directly — ever. Both are **RISK_COUNCIL** proposals: a 3-of-5 Safe, a 24h timelock, GUARDIAN-cancelable. The Trustee only **assembles** the proposal:

1. From the loan card, an **Escalate to council** action.
2. A **Proposal builder** — a form where the Trustee enters the proposal's **name** and **text**.
3. A **timer** — the 24h timelock countdown once submitted.
4. Display in the **Risk Council** section, styled per the Figma mockups.

The proposal the Trustee raises drives the council's on-chain action (`setDefault`, `amendEconomics`, or a write-down `closeLoan`); the Trustee never executes it. See the Type 3 flows in the Trustee Dashboard spec for the underlying calls and guardrails.
