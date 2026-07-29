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

## Past Due is not Watchlist

If the maturity date has passed and the money has not arrived, the status is **Past Due**. A Past Due loan is effectively locked: recording payments and minting against it are not allowed.

Past Due is set **only when the money genuinely did not arrive**. If the money came in but the Trustee simply has not recorded the payment yet, the correct action is to go record the payment — not to change the status.

Because Past Due is destructive and hard to reverse, selecting it opens a **confirmation dialog** that shows:

- A warning that recording and mints will be locked once the loan is Past Due.
- The list of incoming transfers matched to this loan (so the Trustee can confirm nothing is unrecorded).
- The text: *"WARNING! Past Due Loans are effectively locked for any changes and interest intakes. Make sure there are no unrecorded payments related to this Loan before changing its status to Past Due."*

## Return to Performing

Moving a loan from Watchlist back to Performing uses the same Update lifecycle form — one button, instant, no timelock. The exit is as prominent in the UI as the entry; otherwise loans accumulate in Watchlist and are never cleared.

## Escalation (Default and write-down close)

The Trustee cannot set Default or close a loan with a loss directly — ever. Both are **RISK_COUNCIL** proposals: a 3-of-5 Safe, a 24h timelock, GUARDIAN-cancelable. The Trustee only **assembles** the proposal:

1. From the loan card, an **Escalate to council** action.
2. A **Proposal builder** — a form where the Trustee enters the proposal's **name** and **text**.
3. A **timer** — the 24h timelock countdown once submitted.
4. Display in the **Risk Council** section, styled per the Figma mockups.

The proposal the Trustee raises drives the council's on-chain action (`setDefault`, `amendEconomics`, or a write-down `closeLoan`); the Trustee never executes it. See the Type 3 flows in the Trustee Dashboard spec for the underlying calls and guardrails.
