# Issue #1786: Retire CCR figures on all chains (valuations, ccr-history, ccr_bps, initial_ccr) — keep valuation tables, collector and waterfall

Source: https://github.com/eq-lab/pipeline/issues/1786

## Scope

The work ships as **two PRs** (expand, then contract), each safe on pipeline-test on its own.

### Phase 1 — expand (PR 1, can merge before #1906)

Add three additive, nullable fields to every `GET /v1/loan-book` `loans[]` entry, read from the SecurityRegistry projection tables (#1779/#1780). The API makes no RPC call. The Trustee loans table (#1906, option (c)) reads them instead of `ccr_bps`. The names and null semantics below were agreed with the #1906 planner.

| Field | Type | Source | `null` when |
|---|---|---|---|
| `ltv_bps` | `u32 \| null` | `security_loan_valuations.ltv_bps`, verbatim (the same value as `/security` `valuation.ltv_bps`, `clamp_u32`); `4294967295` (u32::MAX sentinel) is passed through | no valuation snapshot yet |
| `margin_call_open` | `bool \| null` | `security_terms.margin_call_at != 0` (the same rule as `/security` `margin_call.open`, decoded with `dec_to_u64`) | no terms row, or `margin_call_at` cannot be decoded |
| `price_stale` | `bool \| null` | `security_loan_valuations.price_stale`, verbatim (the same as `/security` `valuation.price_stale`, the contract's flag at `detail_ledger`; not the API-clock `prices.price_stale`) | no valuation snapshot yet |

- The keys are **always present**, never omitted. All three are `null` on EVM rows and on Stellar chains without `CHAIN_<id>_STELLAR_API_SECURITY_REGISTRY_ADDRESS` (`AppState.security_registry_addresses`, which `config.rs` fills for Stellar only). No new env key.
- Flat fields on `LoanBookEntry`, not a nested object (agreed with #1906). They sit next to the legacy off-chain `ltv`, which Phase 2 removes.
- No other change: no removals, no migration, `summary` unchanged, and no change to `compute_loan_book`'s signature. The fields are attached after the compute step, like `pocket`.

### Phase 2 — contract (PR 2, only after #1906 **and** the LP follow-up are merged and deployed to pipeline-test)

Remove:
- `GET /v1/loan-book/{loan_id}/valuations`: `get_collateral_valuation` and its GET-only helpers and DTOs in `routes/collateral_valuation.rs`.
- `GET /v1/loan-book/{loan_id}/ccr-history`: the whole `routes/ccr_history.rs` module.
- From `LoanBookEntry`: `ccr_bps`, the off-chain `collateral`, `ltv` and `spot_price`, plus **`spot_change_7d`**. `spot_change_7d` is the paired 7-day change of the same anchor price series. The Trustee drops it in #1906 and the LP app never reads it. See Open Questions.
- `initial_ccr` from `SubmitLoanRequest`. Requests that still send it are accepted, and the key is dropped (serde ignores unknown fields; there is no `deny_unknown_fields`). Old `submitted_loans.loan_data` rows keep their keys; no data migration.
- The CCR-only code in `shared::collateral_valuation` (`ccr_bps`, `ConcentrateValuation::ccr_bps`), and the CCR-history-only and spot-only price reads in `shared::loan_asset_price_repo` (`price_at_or_before`, `prices_in_window`, `prices_as_of`), once unused.
- CCR wording in comments and docs (see Docs to Update).

Keep (What stays, from the Issue):
- The tables `loan_collateral_valuations`, `loan_assays`, `loan_offtake_terms` and `loan_asset_prices`. No table drops in this issue.
- `POST /v1/loan-book/{id}/assay` and `/offtake`, with their validators and DTOs. `collateral_valuation::router()` keeps serving them.
- The waterfall pricing basis (`waterfall.rs` `from_valuation_mode`), and loan submission (`CollateralValuationRepo::insert_pending`; `collateral_valuation` stays required).
- The asset price collector job (`asset_for_metal`), and `security_marks` (`nsr_per_dmt`, `to_pct`, `asset_for_metal`).
- The historical `LoanCCRUpdated` rows and their renderer (`audit_log.rs` "CCR written on-chain"), and the legacy `LoanDefaulted` `ccr_bps` passthrough (historical rows, #1433).
- The `LoanBookSummary` aggregates `total_collateral`, `senior_debt_coverage` and `at_risk_wl_and_default_pct`, which still use `compute_collateral` (kept). See Open Questions.

Out of scope: EVM SecurityRegistry indexing; table drops; frontend changes (#1906 for the Trustee, the LP follow-up for `packages/frontend`); contracts (frozen); making `data_room_id` required (#1792 step 2); `to` and `initial_location` (#1792).

## Assumptions and Risks

- **Dependency order.** Phase 2 must not merge until all of these are merged **and deployed to pipeline-test**:
  - #1906 (the Trustee stops reading `/valuations`, `/ccr-history`, `ccr_bps`, `collateral`, `ltv`, `spot_price`, `spot_change_7d` and `initial_ccr`; it reads Phase 1's `ltv_bps`, `margin_call_open` and `price_stale`). #1906 in turn needs Phase 1 deployed first.
  - **The LP frontend follow-up, filed as #1907.** `packages/frontend` Deployment Monitor (`components/dashboard/useDeploymentMonitorPanel.ts:73-95,185-205`, `api/useLoanBook.ts`) reads `loans[].collateral` and `loans[].ltv`. It also reads `summary.total_collateral` and `summary.senior_debt_coverage`, which stay in this plan. `api/useLoanSubmissions.ts:89` types `initial_ccr`. The frontends have no runtime validation, so removing `ltv` and `collateral` silently renders "—" or `0` LTV aggregates.
- **Rollout safety.** Neither phase adds a migration, and neither adds or requires an env key. A rollback to the previous image works for both phases: Phase 1 reads only tables created by `20261106000001_security_registry.sql` (already merged). The worker is untouched in both phases, so the indexer's best-effort RPC rule is unaffected. EVM: Phase 1 leaves EVM rows unchanged apart from three new `null` keys (regression test). Phase 2 removes the CCR fields on EVM too, which the Issue explicitly accepts.
- **Consistency with `/security`.** The list values are read from the same rows as `/security`, in one SQL statement (one snapshot). The list does not carry `refresh_pending`, so it can lag a SecurityRegistry write by one or two fold cycles, the same as `/security`'s `valuation`. If the projection's `loan_registry` differs from the configured one, the list still joins on `(chain_id, loan_id)`, as `/security` does.
- **Phase 1 DB errors.** The security read uses `?` like `pockets_by_loan`. A database error is a `500` for the whole loan book, consistent with every other read in `handle_loan_book`.
- **Acceptance `rg`.** After Phase 2, `rg -iw 'ccr|ccr_bps|initial_ccr'` and `rg 'ccr_'` over `packages/api`, `packages/shared` and `packages/worker` are expected to hit only these:
  - historical migrations;
  - `LoanCCRUpdated` (the `audit_log.rs` renderer, `contract_logs_repo.rs`, and their tests in `tests/audit_log_security_registry.rs` and `tests/dashboard_auditlog_chain.rs`);
  - the legacy `LoanDefaulted` `ccr_bps` passthrough (`audit_log.rs`), which is historical audit history like `LoanCCRUpdated`;
  - the legacy-payload regression fixtures that prove `initial_ccr` is still tolerated (`tests/loan_submission.rs`, `tests/draw_loan_args.rs`). A test of "accepts a body containing `initial_ccr`" must contain the literal key.

  `packages/worker` has no CCR code today (no `LoanCCRUpdated` decoder); the name lives only in `shared::contract_logs_repo` and its test. The coder lists every remaining hit in the PR body.
- **`spot_change_7d`** goes slightly beyond the Issue's literal list. The rationale and the confirmation question are in Open Questions.
- **`initial_ccr` stored verbatim today.** #1792 made it "accepted and stored verbatim". Phase 2 changes that to "accepted and dropped": new `loan_data` rows no longer carry it. The Trustee stops showing it (#1906). The LP app only types it.
- **Golden JSON.** `tests/loan_book.rs` holds a full-response JSON string (around line 1092). Phase 1 adds three `null` keys per entry; Phase 2 removes five keys per entry. Both must update it.

## Open Questions

All answered in the latest Issue comment.

1. [x] **Spot pair removal.** Resolved: `spot_change_7d` is removed in Phase 2 together with `spot_price`.
2. [x] **LP follow-up and replacement.** Resolved: option (c), flat fields, confirmed. The LP frontend follow-up is filed as #1907 and is a prerequisite of Phase 2 together with #1906.
3. [x] **Summary aggregates.** Resolved: `summary.total_collateral`, `senior_debt_coverage` and `at_risk_wl_and_default_pct` are kept.
4. [x] **Per-loan thresholds in the list.** Resolved: no per-loan `advance_ratio_bps` or `margin_call_ratio_bps` in the list.

## Implementation Steps

### Phase 1 — PR 1 (`chore/1786-retire-ccr`, expand only) — done

1. **Repo read** (`packages/shared/src/security_registry_repo.rs`):
   - Add `pub const LIST_LOAN_BOOK_SECURITY_SQL`, one statement over the two projection tables of one `(chain_id, contract_address)`:
     ```sql
     SELECT COALESCE(t.loan_id, v.loan_id) AS loan_id,
            t.margin_call_at, v.ltv_bps, v.price_stale
     FROM (SELECT loan_id, margin_call_at FROM security_terms
           WHERE chain_id = $1 AND contract_address = $2) t
     FULL OUTER JOIN (SELECT loan_id, ltv_bps, price_stale FROM security_loan_valuations
           WHERE chain_id = $1 AND contract_address = $2) v ON v.loan_id = t.loan_id
     ```
     The FULL JOIN keeps the valuation independent of terms, exactly as `/security` serves `valuation` regardless of `terms`.
   - Add `#[derive(Debug, Clone, PartialEq, sqlx::FromRow)] pub struct LoanBookSecurityRow { loan_id: i64, margin_call_at: Option<BigDecimal>, ltv_bps: Option<i64>, price_stale: Option<bool> }`.
   - Add `SecurityRegistryRepo::list_loan_book_security(&self, chain_id: i64, contract: &str) -> anyhow::Result<Vec<LoanBookSecurityRow>>`.
2. **Pure mapper** (`packages/api/src/security_state.rs`, next to `valuation_dto` / `margin_call_dto`, so it reuses `clamp_u32` and `dec_to_u64`):
   - `pub struct LoanBookSecurityFields { pub ltv_bps: Option<u32>, pub margin_call_open: Option<bool>, pub price_stale: Option<bool> }` (plain struct, `Default` = all `None`).
   - `pub fn loan_book_security_fields(row: &LoanBookSecurityRow) -> LoanBookSecurityFields`:
     - `ltv_bps = row.ltv_bps.map(clamp_u32)`;
     - `margin_call_open = row.margin_call_at.as_ref().and_then(dec_to_u64).map(|m| m != 0)`;
     - `price_stale = row.price_stale`.
   - Optionally refactor `margin_call_dto`'s `open` and `valuation_dto`'s `ltv_bps` to share one helper with this mapper, so the two endpoints cannot drift. Keep `/security` output byte-identical; its tests must stay green.
3. **DTO** (`packages/api/src/routes/loan_book.rs`, `LoanBookEntry`): add `pub ltv_bps: Option<u32>`, `pub margin_call_open: Option<bool>`, `pub price_stale: Option<bool>` after `pocket`, without `skip_serializing_if`, so the keys serialize as `null`. Give each one short `///` line for the OpenAPI description, following the `security_state.rs` DTO style (Stellar SecurityRegistry, `null` on EVM / unconfigured / no snapshot, the u32::MAX sentinel on `ltv_bps`). `build_loan_entry` sets all three to `None`.
4. **Attach** (`loan_book.rs`):
   - `async fn security_by_loan(state, chain_ids) -> Result<HashMap<LoanRef, LoanBookSecurityFields>, ApiError>`: for each `chain_id` in scope that has `state.security_registry_addresses.get(&chain_id)`, call `SecurityRegistryRepo::new(state.pool.clone()).list_loan_book_security(chain_id, contract)`. Map each row to `((chain_id, loan_id.to_string()), loan_book_security_fields(&row))`; `loan_id.to_string()` matches `loan_key` for integer ids. Chains without the key are skipped. This is the same shape as `pockets_by_loan`.
   - `pub fn attach_security<S: BuildHasher>(resp: &mut LoanBookResponse, by_loan: &HashMap<LoanRef, LoanBookSecurityFields, S>)`: set the three fields from the map, or leave `None`.
   - In `handle_loan_book`, after `attach_pockets`, call `security_by_loan` then `attach_security`. `compute_loan_book` is not changed, so `dashboard.rs` and the 20 test call sites stay as they are.
5. [x] **OpenAPI.** No new schema (flat primitives); `LoanBookEntry` is already registered in `LoanBookDoc`. Check that the served `/api-docs/openapi.json` lists the three properties as nullable.
6. [x] **Docs (Phase 1):** see Docs to Update. Add the user-stories doc.
7. [x] Run `cargo clippy --all -- -D warnings` and `cargo test -p pipeline-api -p shared`, then `npx tsx scripts/lint-docs.ts`.

### Phase 2 — PR 2 — pending (new branch, e.g. `chore/1786-retire-ccr-contract`, after #1906 and the LP follow-up are deployed)

8. [ ] **`/ccr-history`:**
   - Delete `packages/api/src/routes/ccr_history.rs` and `packages/api/tests/ccr_history.rs`.
   - Remove `pub mod ccr_history;` (`routes/mod.rs:7`) and the `CcrHistoryDoc` merge and router nest (`main.rs:222,252`).
   - In `shared::loan_asset_price_repo`, remove `price_at_or_before` and `prices_in_window` (now unused) and the CCR-history wording in their neighbours' docs.
9. [ ] **`/valuations`** (`packages/api/src/routes/collateral_valuation.rs`):
   - Remove the GET route (`:288-291`) and `get_collateral_valuation`.
   - Remove the GET-only items: `loan_snapshot_senior_usd`, `outstanding_senior_usd`, the USDC-scale const if unused, `CollateralValuationResponse`, `CollateralValuationInputs`, `MetalInput`, `PenaltyInput`, `Waterfall`, `Ccr`, `usd`, `build_response`, `build_metals`, `build_penalties`, `pct_display`, `waterfall_dto`, and the imports they alone used (`ccr_bps`, `compute_collateral`, `ConcentrateValuation`, `to_pct`, `asset_for_metal` if unused, `loan_registry_address`).
   - Narrow `CollateralValuationDoc` to `paths(submit_assay, submit_offtake)` and their schemas.
   - Rewrite the module header to a 2–3-line spec pointer for the assay/offtake writes.
   - Keep `validate_assay`, `validate_offtake`, `parse_dec` and the POST handlers unchanged.
10. [ ] **Loan book** (`routes/loan_book.rs`):
    - Remove `spot_price`, `spot_change_7d`, `collateral`, `ltv` and `ccr_bps` from `LoanBookEntry`, with their computation in `build_loan_entry`. Keep `collateral_raw`, which feeds `EntryComputation.collateral` for the kept summary aggregates.
    - Remove `LoanSpot`, `spot_by_loan` and the `spot_by_loan` parameter of `build_loan_entry` / `compute_loan_book`. Update `routes/dashboard.rs:67,543-552` and every test call site (`tests/loan_book.rs`, `loan_status_timeline.rs`, `pocket_loan_book.rs`, `book_rate_weighting.rs`).
    - Remove `shared::loan_asset_price_repo::prices_as_of` (its only caller was `spot_by_loan`).
    - Remove the `ccr_bps` import and the CCR comments. Rewrite the `compute_loan_book` doc so it names only the kept aggregates.
11. [ ] **Submission:** remove `initial_ccr` from `SubmitLoanRequest` (`loan_book.rs:419-422`). Update the `SubmissionView.loan_data` doc line (`:651`) to say that legacy rows may still carry `initial_ccr`, and that it is accepted and dropped on input.
12. [ ] **Shared CCR-only code** (`packages/shared/src/collateral_valuation/mod.rs`):
    - Remove `pub fn ccr_bps` and `ConcentrateValuation::ccr_bps`.
    - Reword the module doc and the `collateral_value` doc so they no longer mention CCR. Keep `compute_collateral`, `valuate`, `nsr_per_dmt`, `to_pct` and `asset_for_metal`.
    - Reword the CCR mentions in `collateral_valuation_repo.rs:16`, `submitted_loan_repo.rs:198`, `loan_asset_price_repo.rs` and `waterfall.rs:446`.
13. [ ] Run the acceptance `rg` (Assumptions) and list the remaining hits in the PR body. Then run clippy and the tests.

## Test Strategy

All tests are pure unit tests in `packages/<pkg>/tests/<topic>.rs`: no inline `#[cfg(test)]`, no `DATABASE_URL` / `POSTGRES_URL`, no Postgres.

### Phase 1 — new `packages/api/tests/loan_book_security.rs`

- `loan_book_security_fields`:
  - a row with terms and a valuation gives `ltv_bps` and `price_stale` verbatim, and `margin_call_open: true` when `margin_call_at > 0` and `false` when it is `0`;
  - `ltv_bps = 4294967295` passes through, and an `i64` above u32 clamps exactly as `/security` does;
  - terms with no valuation give `ltv_bps: None`, `price_stale: None` and a boolean `margin_call_open`;
  - a valuation with no terms gives `margin_call_open: None`;
  - an undecodable `margin_call_at` (for example `1e999999999`, a negative value, or a fraction) gives `margin_call_open: None`.
- **Parity with `/security`:** for the same `TermsRow` / `ValuationRow` (reuse the `tests/loan_security.rs` builders, or copy minimal ones), the mapper's three values equal `build_security_response(...)`'s `valuation.ltv_bps`, `margin_call.open` and `valuation.price_stale` (serialized to JSON and compared).
- `attach_security`:
  - a Stellar entry whose `(chain_id, loan_id)` is in the map gets the values;
  - an entry not in the map stays `null`;
  - **EVM regression:** an EVM-chain entry (for example chain 560048) with the same `loan_id` as a Stellar map entry stays `null`. The map is keyed by chain, and `security_by_loan` never builds entries for chains without the API key;
  - two chains with overlapping loan ids each get their own values.
- **Serialization:** an entry serializes `"ltv_bps":null,"margin_call_open":null,"price_stale":null` (keys present). Update the golden JSON in `tests/loan_book.rs` to include them, with no other change to the string.
- **OpenAPI:** `LoanBookDoc::openapi()` JSON lists `ltv_bps`, `margin_call_open` and `price_stale` on `LoanBookEntry`, nullable and not required (extend an existing OpenAPI test, or add one to the new file).
- Unchanged: the whole existing `tests/loan_book.rs`, `tests/loan_security.rs` and `tests/pocket_loan_book.rs` suites stay green. They are the regression for EVM rows and for `/security` output.

### Phase 2

- Delete `tests/ccr_history.rs`. In `tests/collateral_valuation.rs`, delete the `/valuations` `build_response` tests (`:343-430`, `outstanding_usd`, `*_ccr_*`) and **keep** every `validate_assay` / `validate_offtake` test, which is the `/assay` and `/offtake` regression.
- `tests/loan_chain_required.rs`:
  - drop `valuations` and `ccr-history` from `public_routers()` and from `nine_operations()`, and rename the latter to match the new count;
  - drop the two `ccr_history_*` tests, and reduce `ccr_history_and_waterfall_keep_their_own_params` to waterfall only;
  - add `removed_ccr_routes_are_gone`: a oneshot `GET /loan-book/7/valuations?chain_id=<configured>` on `collateral_valuation::router()` returns `404` (no route), the same for `/ccr-history` on the merged per-loan routers, and the OpenAPI docs no longer contain either path;
  - keep the assay/offtake 401-before-chain cases.
- `tests/loan_book.rs`:
  - remove or rewrite the `ccr_bps`, `collateral`, `ltv` and `spot_*` assertions (`:416-424`, `:994-1013`, `:1209-1219`) and update the golden JSON;
  - add assertions that `summary.total_collateral`, `senior_debt_coverage` and `at_risk_wl_and_default_pct` are unchanged for the same inputs. This is the regression that per-entry removal does not change the aggregates.
- `tests/loan_submission.rs`:
  - a body that still carries `initial_ccr` (and `to` / `initial_location`) deserializes and validates;
  - the re-serialized `loan_data` has no `initial_ccr` key;
  - remove the field from the struct-literal fixture (`:39`, `:122`).
- `tests/draw_loan_args.rs`: the legacy-row case with `initial_ccr` in `loan_data` still produces correct args (keep).
- `packages/shared/tests/collateral_valuation.rs`: remove `concentrate_ccr_is_137_percent` and `ccr_guards_non_positive_inputs`; keep the valuation, `compute_collateral`, `nsr_per_dmt` and `asset_for_metal` tests (collector and marks regression).
- Waterfall regression: the existing `tests/waterfall.rs` and `waterfall_accrual.rs` stay green. The asset price collector regression is `packages/worker/tests/asset_price_collector.rs`, which stays green.
- Run `cargo clippy --all -- -D warnings`, `cargo test --workspace` and `npx tsx scripts/lint-docs.ts`.

## Docs to Update

### Phase 1

- `docs/product-specs/loan-security-state.md`: new section **Loan book fields**. It covers the three fields, their sources (the Behavior table rows), null semantics (EVM, no key, no terms, no snapshot), the sentinel, and that the values come from the same rows as `/security` without `refresh_pending`.
- `docs/references/backend.md`: under "Stellar SecurityRegistry indexing", an **API** bullet for `GET /v1/loan-book` (`ltv_bps`, `margin_call_open`, `price_stale`), like the pocket bullet at `:439`.
- `docs/product-specs/trustee-dashboard.md:173` (Loans page row): mention the per-loan LTV fields.
- New `docs/user-stories/epic-1775/1786-retire-ccr.md`, linked from `docs/user-stories/index.md`:
  - Phase 1 stories: a Stellar loan with a snapshot shows the values equal to `/security`; EVM and no-key rows show `null`; a loan without terms shows `null`.
  - Phase 2 stories: `/valuations` and `/ccr-history` return 404; loan-book entries have no CCR, `collateral`, `ltv` or `spot_*` keys; a submission with `initial_ccr` is accepted; `/assay`, `/offtake`, the waterfall and the loan book summary work as before.

### Phase 2

- `docs/product-specs/collateral-valuation.md`:
  - drop the CCR parts: the overview sentence, the worked-example CCR line, the "How it feeds CCR" section, and the `ccr_bps` / `last_onchain_ccr` rows of the record table (`:113-114`);
  - restate that the record feeds the waterfall pricing basis, mark suggestions and the summary aggregates;
  - replace the "This CCR flow is unchanged (#1786)" line (`:118`) with a pointer to the SecurityRegistry LTV.
- `docs/product-specs/price-feed.md`: remove the CCR computation, the CCR thresholds and the on-chain CCR write. Point to SecurityRegistry LTV margin calls and risk alerts (#1784). Keep the feed loop.
- `docs/product-specs/loan-security-state.md:123`: the Security sentence must no longer cite `/valuations` as an existing exposure. Say that the assay/offtake inputs are public through this route only.
- `docs/product-specs/api-authorization-loan-submission.md:64`: `initial_ccr` is accepted and dropped (no longer stored); `to` and `initial_location` stay as #1792 left them.
- `docs/references/backend.md`: remove the `/valuations` and `/ccr-history` mentions and the CCR alert rows (`:265`, `:828`) where they describe current behaviour. The `loan_mirror.ccr_bps` box at `:641` is the historical design diagram: drop the field.
- `docs/exec-plans/known-bugs.md` BUG-32: the reads are now the loan book summary and the mark suggestions, not `/valuations` or `ccr-history`.
- `docs/exec-plans/tech-debt-tracker.md`: add an entry. The four valuation tables and `compute_collateral` remain for the waterfall, marks and summary aggregates; a later issue decides on retiring the summary aggregates and dropping any tables that become unused.
- `docs/frontend/trustee-flows.md` is updated by #1906, and `docs/frontend/dashboard-components.md` by the LP follow-up. Neither changes in this issue.
