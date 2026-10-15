# User story: #1525 — LoanBook financials: per-loan minted yield from CashRepaid

**Epic:** #1520
**Issue:** https://github.com/eq-lab/pipeline/issues/1525
**Status:** Initial

---

## Overview

`GET /v1/loan-book/{loan_id}/financials` computes `minted_yield` from legacy `YieldMinted` history plus Minter `CashRepaid` interest and fee PLUSD, net of `CashRepaymentReversed`. See `docs/references/backend.md` "Minted yield". No Figma reference.

---

## Story 1 — A booked minter repayment counts as minted

**Given** a loan on a chain with an indexed Minter `CashRepaid` row (and the `PaymentRecorded` row of the same repayment) and no reversal

**When** a trustee opens the loan's financials (`GET /v1/loan-book/{loan_id}/financials`)

**Then:**

- `minted_yield` equals `interest_minted` plus `mgmt_fee + perf_fee + oet_alloc` from the `PaymentRecorded` row, not `fee_shares`
- `not_minted_yield` is `0.000000`
- The trustee close gate "Nothing left to mint" is green

## Story 2 — A reversed repayment is excluded

**Given** a loan whose repayment was later reversed by `CashRepaymentReversed` with the same `(loan_id, repayment_id)`

**When** the financials are read

**Then:**

- That repayment contributes nothing to `minted_yield`
- Other live repayments of the same loan still count

## Story 3 — Legacy history is preserved

**Given** a loan with confirmed `yield_mint_outbox` rows and `YieldMinted` events from the pre-rework yield-minter

**When** the financials are read

**Then:**

- The legacy total is included in `minted_yield`, summed with any minter-era repayments and normalised once to 6 decimals
