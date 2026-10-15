# Issue #1523: LoanBook readers: read loan-event fields from params.event (watchlist, economics epochs)

Source: https://github.com/eq-lab/pipeline/issues/1523

Parent epic: #1520. Siblings: #1524, #1525, #1526. Follow-on epic #1521 (multi-chain) builds on these repositories.

## Scope

`LoanEventMapper::do_insert` (`packages/worker/src/indexer/loan_mapper.rs`, around lines 636-667) writes every LoanRegistry row on both chain arms as `{loan_id, event: {…parser fields minus loan_id…}, snapshot: {…}}`. Two LoanBook readers take event fields from the top level of `params` and always read NULL:

- `ContractLogsRepo::latest_watchlist_entry_by_chain` (`packages/shared/src/contract_logs_repo.rs`, around line 535) filters `params->>'status' = 'WatchList'`. It never matches, so `days_on_watchlist` and `watchlist_entered_at` on `GET /v1/loan-book` (`packages/api/src/routes/loan_book.rs:1126-1133, 1410-1419`) are always null.
- `ContractLogsRepo::list_loan_economics_events` (around lines 786-801) reads `params->>'new_rate'` and `params->>'new_maturity_timestamp'`, which `COALESCE` to 0. Every `LoanRolledOver` and `EconomicsAmended` epoch ends up with rate 0 and maturity 0. `GET /v1/loan-book/{loan_id}/waterfall` then fails `validate_epochs_for_accrual` with a 422, and `GET /v1/loan-book/{loan_id}/financials` shows APY 0 after a rollover.

In scope:

1. Read `status`, `new_rate` and `new_maturity_timestamp` from `params.event` in both readers. The ppm→bps conversion (`shared::loan_economics::economics_rate_to_bps`) stays as it is.
2. Add a pure seam so a unit test can run mapper-shaped params through the readers' row mapping without a database.
   - Move the mapper's params-enrichment into a shared pure function.
   - Map economics rows in Rust from the `event` JSON.
3. Remove the #930 / #928 start-date workaround in `loan_financials.rs` (`current_epoch_start_override`). It existed only because the folded event params were always 0.
4. Fix the stale doc comments:
   - `contract_logs_repo.rs`: the `EconomicsEventRow` doc (around lines 163-174), the watchlist doc (around lines 514-518) and the economics doc (around lines 770-781)
   - `loan_snapshot.rs:51-56` (`current_rate`)
   - `loan_mapper.rs:352-356`
5. Drop the dead `LoanCCRUpdated` and `LoanLocationUpdated` entries from `LOAN_LIFECYCLE_EVENT_NAMES`. No parser on either arm emits them. The only other references are in `routes/audit_log.rs` and its test, which #1532 owns.

Out of scope:

- Registry-address scoping of these queries, which #1526 owns.
- Outstanding and interest_adjustment, which #1524 owns.
- Minted yield, which #1525 owns.
- `audit_log.rs` usages of the dead event names (#1532).
- TD-126: `new_rate` stays in raw `ONE = 1_000_000` scale in storage, and readers keep converting it.
- Multi-chain work (#1521).

## Assumptions and Risks

- **Overlap with #1526, which is planned in parallel.** #1526 adds a LoanRegistry `contract_address` predicate to the WHERE clauses of these same two queries: watchlist around line 533 and economics around line 794.
  - This plan keeps the WHERE clauses of both queries unchanged, apart from the single watchlist status predicate line.
  - Economics changes only the SELECT list and the Rust row mapping.
  - Watchlist changes only the `params->>'status'` line.
  - Expect a small textual merge conflict on the watchlist WHERE block and on the economics function body, whichever branch lands second. Both edits are additive and independent, so resolution is mechanical: keep both the new path and the new address predicate.
  - The new pure mapping function (`EconomicsEventRow::from_event_json`) takes no address argument, so #1526 does not need to touch it.
- **No legacy flat rows.** No fallback to top-level `params->>'x'` is planned. Unlike `list_recorded_payments`, which has a `COALESCE(params->'event'->>…, params->>…)` legacy fallback, the snapshot readers already fail to deserialize a row that has no nested `snapshot`. A flat pre-#894 row therefore cannot coexist with a working LoanBook today, and the fallback would be dead code. If the reviewer wants parity with `list_recorded_payments`, adding the COALESCE fallback is a one-line change per field.
- **Event status vs snapshot status (watchlist).** We use `params->'event'->>'status'`, the status the `StatusUpdated` event carried, rather than `params->'snapshot'->>'status'`. The Stellar snapshot is read at the current ledger, not block-pinned (TD-19). The snapshot status of a `LoanStatusUpdated` row can therefore be later than the transition itself, while the event field is exact on both arms.
- **Encoding.** On EVM, `new_rate` (uint32) and `new_maturity_timestamp` (uint64) are JSON numbers (`parsers.rs:378-412`). On Stellar, `new_rate` is a JSON number and `new_maturity_timestamp` is a JSON string (`stellar/loan_registry_parsers.rs:366-420`). The Rust decoder must accept both forms, as the old `->>`-then-cast did.
- **Kept defensive behavior.** Missing or unparseable fields still decode to `0`, the same semantics as today's `COALESCE`. `validate_epochs_for_accrual` in `waterfall.rs`, the #930 hardening, stays: it still correctly rejects genuinely corrupt data. Only the financials start-date override is removed.
- **Financials maturity source.** `current_epoch` keeps `maturity_date = s.current_maturity_timestamp`, the #928 fix, because the latest snapshot is authoritative for "now". Only its comment, which references the COALESCE fallback, is removed. Removing `current_epoch_start_override` also removes one `get_loan_snapshot_as_of` DB round-trip per financials call.
- **No dependency blockers.** #1434 (EVM `current_rate`) has already landed: `loan_registry_reader.rs:99` uses `ppm_to_bps`. The `loan_snapshot.rs` comment is just stale.

## Open Questions

_None_

## Implementation Steps

1. **New shared module `packages/shared/src/loan_event_params.rs`.** Register it with `pub mod loan_event_params;` in `packages/shared/src/lib.rs`. It is pure (no DB) and contains:
   - `pub fn build_loan_event_params(loan_id: &BigDecimal, parser_params: &serde_json::Value, snapshot: &LoanSnapshot) -> serde_json::Value`. Lift this verbatim from `LoanEventMapper::do_insert`:
     - filter `loan_id` out of the parser params into the `event` map
     - emit `json!({"loan_id": loan_id.to_string(), "event": event_fields, "snapshot": snapshot})`
   - `pub fn event_field<'a>(params: &'a serde_json::Value, key: &str) -> Option<&'a serde_json::Value>`. Returns `params.get("event")?.get(key)`.
   - `pub fn json_i64(v: &serde_json::Value) -> Option<i64>`. Accepts a JSON number (`as_i64`, or `as_u64` that fits in i64) or a decimal string that parses as i64.
   - Add a one-line spec-pointer header to this plan. No other comments, per AGENTS.md "Comment-less code".
2. **Mapper uses the shared builder.** In `packages/worker/src/indexer/loan_mapper.rs::do_insert`, replace the inline `event_fields` and `enriched_params` construction with `shared::loan_event_params::build_loan_event_params(&loan_id, &self.event.params, &snapshot)`. Behavior is unchanged; `snapshot` is still used afterwards for `link_drawn`.
3. **Economics reader** (`packages/shared/src/contract_logs_repo.rs::list_loan_economics_events`):
   - Change only the SELECT list to `event_name, params->'event' AS event, block_timestamp`. Leave WHERE and ORDER BY untouched; see the #1526 overlap note.
   - Switch from `query_as::<_, EconomicsEventRow>` to `sqlx::query` plus manual mapping. Read `event` as `Option<serde_json::Value>` with `try_get`, following the pattern the snapshot readers use.
   - Add `impl EconomicsEventRow { pub fn from_event_json(event_name: String, event: Option<&serde_json::Value>, block_timestamp: i64) -> Self }`. It reads `new_rate` and `new_maturity_timestamp` via `json_i64`, with `unwrap_or(0)`.
   - Drop the `sqlx::FromRow` derive on `EconomicsEventRow` if it becomes unused. Keep the public fields unchanged so `packages/api/tests/{loan_financials,waterfall}.rs` keep compiling.
   - Rewrite the doc comments on `EconomicsEventRow` (around lines 163-174) and on `list_loan_economics_events` (around lines 770-781). They should say that the fields come from `params.event`, using the mapper's `{loan_id, event, snapshot}` shape, and stop describing params as top-level.
4. **Watchlist reader** (`latest_watchlist_entry_by_chain`):
   - Change exactly one predicate line, from `AND params->>'status' = 'WatchList'` to `AND params->'event'->>'status' = 'WatchList'`.
   - Rewrite the doc comment (around lines 514-518) so it no longer claims `LoanStatusUpdated.params` is FLAT.
   - Hoist the SQL text into `pub const LATEST_WATCHLIST_ENTRY_SQL: &str` next to the function, so a test can assert on it. Do the same for the economics SELECT (`pub const LOAN_ECONOMICS_EVENTS_SQL: &str`).
   - Tell #1526 about the hoisting in the PR description: its WHERE edits then go into these consts.
5. **Dead lifecycle names.**
   - Remove `"LoanCCRUpdated"` and `"LoanLocationUpdated"` from `LOAN_LIFECYCLE_EVENT_NAMES` (`contract_logs_repo.rs:15-30`).
   - Update the expected list in `packages/shared/tests/contract_logs_repo.rs`.
   - Remove the two names from the `LoanEventMapper` doc list (`loan_mapper.rs:352-356`) and correct its count ("all 9 emitted loan event types", around line 343) to match the actual list.
   - Leave `routes/audit_log.rs` and `packages/api/tests/audit_log.rs` alone (#1532).
6. **Financials workaround removal** (`packages/api/src/routes/loan_financials.rs`):
   - In the handler, delete the `current_epoch_start_override` block (around lines 175-197).
   - Drop the `current_epoch_start_override` / `start_override` parameter from `build_response` and `current_epoch`. `current_epoch` now uses `current.start` for every epoch.
   - Keep `maturity_date: iso_utc_from_unix(s.current_maturity_timestamp)`. Delete the comments that reference the possibly-malformed event params and the `COALESCE(…, 0)` guard.
   - Update all `build_response(...)` call sites in `packages/api/tests/loan_financials.rs` to drop the last argument.
7. **Remaining stale comments.**
   - `packages/shared/src/loan_snapshot.rs:51-56`: `current_rate` is stored in bps on both arms. The EVM reader converts with `ppm_to_bps` and the Stellar reader divides by 100. Replace the stale paragraph with an accurate one-liner, or remove it per the comment-less rule. Keep `#[serde(default)]`.
   - `packages/shared/src/loan_economics.rs` (around lines 94-99, the `InvalidEpoch` doc): drop the claim that the canonical cause is the COALESCE.
   - `packages/api/src/routes/waterfall.rs` (around lines 422-424): reword the comment to read only "fail loudly on a non-increasing epoch", without blaming the param path. Keep the guard.
8. Run `cargo fmt`, `cargo clippy --all -- -D warnings`, and `cargo test -p shared -p worker -p api`.

## Test Strategy

All tests are pure unit tests in external files. None read `DATABASE_URL`, `POSTGRES_URL` or any other env var.

- **New `packages/worker/tests/loan_event_params.rs`.** This is the round-trip test the issue asks for, using the real writer path.
  - **EVM rollover.** Build a `LoanRolledOver` log with the same byte-layout helper pattern as `packages/worker/tests/parsers.rs:655-710` (`new_rate = 50_000`, `new_maturity_timestamp = 1_900_000_000`). Pass it through `parse_loan_rolled_over`, then through `shared::loan_event_params::build_loan_event_params` with a `LoanSnapshot` fixture; copy `make_prior_snapshot` from `tests/loan_mapper.rs`. Assert:
    - `params.get("new_rate").is_none()`, which proves the old top-level read would miss
    - `EconomicsEventRow::from_event_json("LoanRolledOver", params.get("event"), ts)` yields `new_rate == 50_000` and `new_maturity_timestamp == 1_900_000_000`
    - `build_epochs` on that row gives a second epoch with `rate_bps == 500` and the expected maturity
  - **EVM `EconomicsAmended`.** Same pattern via `parse_economics_amended`.
  - **Stellar encoding.** Parser-shaped params with `new_rate` as a number and `new_maturity_timestamp` as a string. Use the existing fixture pattern from `tests/stellar_loan_parsers.rs` if a `RawEvent` builder is available; otherwise use a JSON literal that mirrors `stellar/loan_registry_parsers.rs:385-390`. Assert the same decoded values.
  - **Watchlist.** Build `LoanStatusUpdated` params via `parse_loan_status_updated` (status ordinal 2) and `build_loan_event_params`. Assert:
    - `event_field(&params, "status") == Some("WatchList")` and `params.get("status").is_none()`
    - `LATEST_WATCHLIST_ENTRY_SQL` contains `params->'event'->>'status' = 'WatchList'` and does not contain `params->>'status'`
  - **Economics SQL text.** `LOAN_ECONOMICS_EVENTS_SQL` contains `params->'event'` and does not contain `params->>'new_rate'`.
  - **Builder parity.** `build_loan_event_params` output has exactly the keys `loan_id`, `event` and `snapshot`; `event` has no `loan_id`; and `loan_id` is a string.
- **New `packages/shared/tests/loan_event_params.rs`.** Pure decoder edge cases:
  - `json_i64` accepts a number, a numeric string, and a u64 that fits in i64
  - `json_i64` rejects a non-numeric string, an out-of-range u64, and null
  - `from_event_json` with `event = None` or missing keys yields 0/0, matching the old COALESCE semantics
- **Updated `packages/shared/tests/contract_logs_repo.rs`.** Expected lifecycle list without the two dead names; the no-duplicates test is kept.
- **Updated `packages/api/tests/loan_financials.rs`.**
  - Drop the override argument everywhere.
  - Delete `epoch_start_date_uses_override_not_malformed_amendment` and its `econ_event` comment about the override.
  - Add `epoch_start_date_is_prior_epoch_maturity_after_rollover`: a rollover after an amendment yields `start_date` equal to the amended maturity.
  - Keep `epoch_maturity_date_uses_snapshot_not_malformed_event_param`, renamed if helpful, because the maturity source is unchanged.
- `packages/api/tests/waterfall.rs` and `packages/api/tests/loan_book.rs` should compile unchanged. The existing `days_on_watchlist` tests cover the route-side math.

## Docs to Update

- No product-spec change. The intended behavior of `days_on_watchlist`, `watchlist_entered_at`, `/waterfall` and `/financials` is already specified; this fix makes the endpoints match it.
- `docs/exec-plans/tech-debt-tracker.md`: none required. TD-126 still stands, because the readers keep converting ppm→bps.
- On completion, move this plan to `docs/exec-plans/completed/` according to the repo's usual flow.
