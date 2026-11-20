# User story: #2145 — Waterfall checks the loan's latest state for a backdated as-of

**Epic:** #2129
**Issue:** https://github.com/eq-lab/pipeline/issues/2145
**Status:** Initial

---

## Overview

`GET /v1/loan-book/{loan_id}/waterfall` accrues interest to `as_of`, but every running counter `recordPayment` validates at execution (recorded totals, interest adjustment, offtaker received, status, repaid plus written down against disbursed) comes from the loan's latest indexed state. A loan whose latest status is not Performing, WatchList or Default is a `400`. Spec: `docs/product-specs/yield.md` (Waterfall components, Offtaker-price ceiling).

Persona: Trustee on Record Repayment, or an API caller of `GET /v1/loan-book/{loan_id}/waterfall`.

---

## Story 1 — Backdated payment after a later one

**Given** a loan with offtaker price 1,000,000 and a recorded payment B of 600,000

**When** the Trustee records payment A with an as-of date before B and an amount of 500,000

**Then:**

- `/waterfall` answers `400` ("exceeds the loan's outstanding offtaker balance") and the page shows the "amount is too high" copy
- An amount of 400,000 gives a `200` split that `recordPayment` accepts, with `offtaker_fully_received = true`

---

## Story 2 — Backdated payment after a principal repayment

**Given** payment B returned 900,000 of 1,000,000 senior principal

**When** the Trustee asks for a backdated split with an amount of 1,000,000

**Then:**

- Senior principal returned is at most 100,000 and the rest goes to equity

---

## Story 3 — Backdated payment after interest was paid

**Given** payment B paid all interest and fees through its date

**When** the Trustee asks for a backdated split before B

**Then:**

- Interest, fees and OET are 0, so `recordPayment` does not revert with `InterestExceedsMax`

---

## Story 4 — Loan status no longer accepts repayments

**Given** a loan whose latest status is Approved or Closed

**When** the Trustee asks for a waterfall, with or without an as-of date

**Then:**

- `/waterfall` answers `400` ("loan status is Closed: a repayment can only be recorded while the loan is Performing, WatchList or Default"), the same condition on which `recordPayment` reverts with `WrongCurrentStatus`
- Record Repayment shows "This loan can't take a repayment in its current status. Repayments are recorded only while the loan is Performing, Watchlist or Default." and offers nothing to record

---

## Story 5 — Current as-of

**Given** no as-of date, or today's date

**When** the Trustee asks for a waterfall on a Performing loan

**Then:**

- The split is the same as before this change
