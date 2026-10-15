# User story: #1523 — Loan Book reads loan-event fields from `params.event`

**Epic:** #1520 — Loan Book readers follow the indexed params shape
**Issue:** https://github.com/eq-lab/pipeline/issues/1523
**Status:** Initial

---

## Overview

Backend-only change; no Figma reference. Two Loan Book readers took loan-event fields from the top level of
`contract_logs.params`, but the indexer writes them under `params.event` (`{loan_id, event, snapshot}`).
They now read the nested path. Coverage is pure unit tests
(`packages/worker/tests/loan_event_params.rs`, `packages/shared/tests/loan_event_params.rs`,
`packages/api/tests/loan_financials.rs`) with no DB and no env vars. Behavior is specified in
`docs/product-specs/trustee-dashboard.md` (Loans page, `days_on_watchlist`) and `docs/product-specs/loans.md` ("Economics epochs").

---

## Story 1 — A loan that entered WatchList shows days on watchlist

**Given** a loan whose latest `LoanStatusUpdated` transition was into `WatchList`

**When** the Trustee opens the Loan Book (`GET /v1/loan-book`)

**Then:**

- `watchlist_entered_at` is that event's block timestamp and `days_on_watchlist` counts whole days since.
- Both stay `null` for a loan that is not currently on WatchList.
- Run: `cargo test -p pipeline-worker --test loan_event_params`.

---

## Story 2 — A rolled-over or amended loan keeps its real rate and maturity

**Given** a loan with a `LoanRolledOver` or `EconomicsAmended` event (EVM number or Stellar string maturity)

**When** the Trustee opens `GET /v1/loan-book/{loan_id}/waterfall` or `/financials`

**Then:**

- The waterfall no longer fails with a 422 for a zero-maturity epoch.
- The current epoch shows the amended APY (ppm converted to bps) and starts at the prior epoch's maturity.
- Run: `cargo test -p pipeline-api --test loan_financials` and `cargo test -p shared --test loan_event_params`.
