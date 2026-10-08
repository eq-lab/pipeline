# User story: #1432 — Shared loan-data model realigned to the reworked contracts

**Epic:** #1431 — Realign the indexer to the reworked LoanRegistry contracts
**Issue:** https://github.com/eq-lab/pipeline/issues/1432
**Status:** Initial

---

## Overview

This change is primarily an internal data-model realignment (ordinal maps, shared
view/snapshot structs) with no Figma reference.

**Scope note:** epic #1431 is backend-only. This Issue changes the API response shape
and leaves the Trustee app untouched; the matching frontend cleanup is standalone
Issue #1441, outside the epic. So the two user-visible surfaces below describe a
**degraded intermediate state**, not the final one — both UI elements remain present
but can no longer populate, because the contract stopped reporting a CCR, a CCR
timestamp, and a collateral location. #1441 removes them outright.

Nothing crashes in this intermediate state: both consumers already guard for an
absent value (`formatCcrAge` accepts `null | undefined`; `buildFinancials` guards
`data.location` with a truthiness check), and `npx tsc -b` in `packages/trustee`
exits 0 against the changed API because the TypeScript mirrors are hand-written
rather than generated.

No `DATABASE_URL`/`POSTGRES_URL` is used anywhere in this change's own test suite —
all Rust coverage is pure unit tests over structs and serde (see
`packages/shared/tests/loan_snapshot.rs`, `packages/worker/tests/loan_mapper.rs`).

---

## Story 1 — Loans table CCR cell keeps its percent; the staleness age reads "—"

**Given** the Trustee Loans page is open with a connected session
**And** the loan book API returns at least one loan with a non-null `ccr_bps`

**When** the page renders the Loans table

**Then:**

- The CCR cell shows the percent (e.g. `"114%"`) and its color band, exactly as
  before (#888/#939 — off-chain computed, unaffected by this change)
- The staleness-age sub-value reads `"—"` for **every** loan, regardless of data,
  because `ccr_reported_at` is no longer served and `formatCcrAge` returns `"—"`
  for an absent value
- No console error, and no `ccr_reported_at` or `reported_ccr_bps` key in the
  network response for `GET /v1/loan-book`

Removing the chip itself is #1441.

---

## Story 2 — Loan detail Registry row value drops its location suffix

**Given** the Trustee Loan detail page is open for a loan with a drawn snapshot
**And** `GET /v1/loan-book/{loan_id}/financials` returns a response with no
`location` key (the field no longer exists on the response)

**When** the page renders the "Registry state & derived" card

**Then:**

- The first row's label still reads **"Status / location"** — relabelling it to
  "Status" is #1441
- The row's value is the served `status` alone (e.g. `"Performing"`), with no
  trailing `"· Vessel MV Andes"` or similar location suffix, because
  `buildFinancials` falls through its `data.location` guard
- The origination-review page's own **Location** row (sourced from the
  submission's `initial_location`, a different field entirely) is unaffected —
  it still renders normally, since that data never came from the contract

---

## Story 3 — Loan status and closure-reason labels match the current contract variants

**Given** a loan indexed from a post-rework contract deployment reports
`LoanStatusUpdated` with the on-chain `newStatus` ordinal `2` (the contract's
`WatchList`)

**When** the worker indexes the event

**Then:**

- The persisted `contract_logs.params.status` (EVM) reads `"WatchList"`, not
  `"Default"` — the off-by-one ordinal bug this Issue fixes
- Ordinal `0` reads `"Approved"` and ordinal `4` reads `"Closed"` (the two
  ordinals the pre-fix map could not represent at all)
- A `LoanClosed` event with `closure_reason` ordinal `3` reads `"Cancelled"`
  (new in this Issue), and ordinal `5` reads `"OtherWriteDown"` (shifted from
  the old scheme's `4`)

This story is verified by automated test, not manual UI inspection — see
`packages/worker/tests/loan_mapper.rs` (`loan_status_name_all_variants`,
`closure_reason_name_all_variants`) and `packages/worker/tests/parsers.rs`
(`loan_status_updated_decodes`).

---

## Notes

- No Figma reference exists for this Issue or its parent epic #1431 — both
  frontend stories are text-content removals on existing rows, confirmed by
  reading the rendered page, not by visual diff.
- `LoanBookEntry.ccr_bps` (off-chain computed CCR) and the origination-review
  Location row are explicitly **unaffected** — only the two on-chain-reported
  fields (`reported_ccr_bps`, `ccr_reported_at`) and the on-chain location are
  gone.
- `packages/worker/src/indexer/loan_registry_reader.rs` and
  `packages/worker/src/indexer/stellar/loan_registry_reader.rs` now return
  placeholder zero values for `current_rate`/`carved_out`/`disbursed`/`repaid`/
  `written_down`/`interest_adjustment` (marked `// #1434:` / `// #1433:`) until
  the per-arm issues land — no product surface reads these yet, so there is
  nothing to verify here until #1433/#1434 ship a consumer.
