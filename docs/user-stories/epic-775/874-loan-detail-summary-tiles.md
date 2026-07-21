# Issue #874 — Trustee loan detail summary tiles use backend data

## Story 1 — Performing loan shows live summary figures

**Persona:** A Trustee reviewing a Performing loan detail page.

**Steps:**
1. Open `/loans/:id` for a loan returned by `GET /v1/loan-book` with `status = "Performing"`, `principal`, `repaid_to_date`, and `disbursed = true`.
2. Let `/v1/loan-book/:id/financials` load with `not_minted_yield`.
3. Inspect the three summary tiles below the status stepper.

**Expected outcome:** The tiles show `Facility / disbursed`, `Repaid to date`, and `Interest to distribute` from the backend fields. No old fixture values such as batch numbers or coupon dates appear.

## Story 2 — Watchlist loan shows backend watchlist age

**Persona:** A Trustee triaging a Watchlist loan.

**Steps:**
1. Open `/loans/:id` for a loan whose loan-book row has `status = "WatchList"`, `days_on_watchlist`, and `watchlist_entered_at`.
2. Inspect the Watchlist summary tiles.

**Expected outcome:** The page shows `Days on watchlist` from `days_on_watchlist` and the exact `since <day month>` sub-label from `watchlist_entered_at`. Missing watchlist fields render `—`.

## Story 3 — Matured loan shows senior and epoch data

**Persona:** A Trustee reviewing a matured loan before rollover.

**Steps:**
1. Open `/loans/:id` for a loan rendered as the Matured variant.
2. Let `/v1/loan-book/:id/financials` load with an `epoch`.
3. Inspect the summary tiles.

**Expected outcome:** `Facility / senior` uses loan-book `principal` and `original_senior_tranche`, `Repaid to date` uses `repaid_to_date`, and `Rate · epochs` uses the financials epoch APY and epoch number. Missing fields render `—`.
