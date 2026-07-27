# Issue #936: Add /v1/ramp API group: addresses, on-ramp events, Trustee approval

Source: https://github.com/eq-lab/pipeline/issues/936

## Scope

New `/v1/ramp` route group (`packages/api/src/routes/ramp.rs`) with three endpoints:

1. `GET /v1/ramp/addresses` — the chain's configured custody/ramp Stellar addresses (from `TransferAddressSets`).
2. `GET /v1/ramp/on-ramp` — lists **pending** (not yet approved) on-ramp (`ramp → custody`) `AssetTransfer` events: `id`, `to`, `from`, `amount`, `created_at`.
3. `POST /v1/ramp/on-ramp/{id}/approve` — Trustee-only, records approval for one event by its `contract_logs.id`.

New table `on_ramp_approvals` records approvals, keyed by `contract_logs.id`. `ContractLogsRepo::list_asset_transfers` is extended to return `id`/`block_timestamp`/`approved_at` (via `LEFT JOIN`), and `capital_allocation.rs`'s `in_transit` computation is updated so the on-ramp leg (`ramp→custody`, subtracted) only counts approved transfers; the off-ramp leg (`custody→ramp`, added) is untouched.

Out of scope (per the Issue): EVM ramp/custody tracking, any frontend/UI work, off-ramp approval.

## Assumptions and Risks

- **List endpoint returns pending events only, no status field.** The Issue's requested response shape is exactly `id, to, from, amount, created_at` — no approval-status field. Read literally as a Trustee work-queue: once approved, an event drops off the list. This is a product-behavior assumption, not stated explicitly in the Issue; flagged for review at plan-approval time rather than left as an open question, since the field list makes it the more natural reading.
- **No pagination.** Every existing `/v1` list endpoint (`loan_book`, `withdrawal_queue`, `capital_allocation`) returns an unpaginated full list; matched here. Risk: if on-ramp transfer volume grows large, this endpoint becomes slow — acceptable for v1, same risk profile as its siblings.
- **`on_ramp_approvals.contract_log_id` is the primary key** (not a separate surrogate id) — directly matches the Issue's "key = contract_logs.id, approved_at" wording. A row's mere existence means "approved"; there is no pre-populated pending row. Approving twice hits a PK conflict, mapped to `409 Conflict`.
- **Approve validates the target event server-side**: the id must reference an existing `contract_logs` row with `event_name = 'AssetTransfer'` whose direction (per that chain's `TransferAddressSets`) is `from ∈ ramp` and `to ∈ custody` — otherwise `404`/`400`. This prevents a Trustee from "approving" an off-ramp transfer or an unrelated log id.
- Depends on #789 (Stellar `AssetTransfer` indexing) and the existing `TransferAddressSets`/`in_transit` machinery from `capital_allocation.rs` — both already merged, no blocking dependency.
- `AssetTransferRow` currently has no `id`/`block_timestamp` fields; widening it and its backing query is a shared change consumed by both `capital_allocation.rs` and the new `ramp.rs` — must keep both call sites compiling.

## Open Questions

1. Should `GET /v1/ramp/on-ramp` require authentication at all? Every existing `/v1` GET in this codebase (`capital-allocation`, `loan-book`, `withdrawal-queue`) is unauthenticated — no `AuthClaims` extractor. But this endpoint exposes pending counterparty addresses/amounts for money not yet inside custody, which is more sensitive than the other GETs. Recommend requiring a valid JWT (any role, not necessarily `trustee`) rather than following the fully-open precedent, but this changes the established pattern and should be confirmed rather than assumed.

## Implementation Steps

### 1. Migration — `on_ramp_approvals` table — ✅ Done

New file `packages/shared/migrations/20260727000001_on_ramp_approvals.sql`, modeled on `20260724000001_bank_transactions.sql` (header comment naming this issue, forward-only, rollback SQL in a comment):

```sql
CREATE TABLE on_ramp_approvals (
    contract_log_id BIGINT      NOT NULL PRIMARY KEY REFERENCES contract_logs(id),
    approved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by     TEXT        NOT NULL
);
```

No `chain_id` column — `contract_log_id` already uniquely identifies the chain via `contract_logs`, same rationale `bank_transactions` used to omit chain scoping where it wasn't needed.

### 2. Extend `AssetTransferRow` and `list_asset_transfers` — ✅ Done

`packages/shared/src/contract_logs_repo.rs`:

- Add `id: i64`, `block_timestamp: i64`, `approved_at: Option<chrono::DateTime<chrono::Utc>>` to `AssetTransferRow` (currently only `from_addr`/`to_addr`/`amount`, lines ~91-99).
- Update the query in `list_asset_transfers` (lines ~741-767) to select `contract_logs.id`, `contract_logs.block_timestamp`, and `LEFT JOIN on_ramp_approvals ON on_ramp_approvals.contract_log_id = contract_logs.id` to project `approved_at`.
- Add `pub async fn approve_on_ramp_transfer(&self, contract_log_id: i64, approved_by: &str) -> Result<(), sqlx::Error>` — `INSERT INTO on_ramp_approvals (contract_log_id, approved_by) VALUES ($1, $2)`; a PK-violation error (`sqlx::Error::Database` with Postgres code `23505`) is mapped to `ApiError::Conflict` in the route handler, not swallowed here.
- Add `pub async fn get_asset_transfer_by_id(&self, id: i64) -> Result<Option<AssetTransferRow>, sqlx::Error>` (or extend the existing row shape) — used by the approve handler to fetch `chain_id`/`from_addr`/`to_addr` for the id before validating direction. Simplest: `SELECT chain_id, params->>'from' AS from_addr, params->>'to' AS to_addr, ... FROM contract_logs WHERE id = $1 AND event_name = 'AssetTransfer'`.

**Deviation:** also added a `chain_id: i64` field to `AssetTransferRow` (not called out in the plan). The approve handler needs the *correct* chain's `TransferAddressSets` to validate an event's direction, and a bare `contract_logs.id` doesn't imply which chain it belongs to — `resolve_chain(&state, None)` would have silently used the wrong chain's address sets for any non-default chain. Both `list_asset_transfers` and `get_asset_transfer_by_id` now select `contract_logs.chain_id` alongside the other columns; `approve_on_ramp_transfer` also now returns the inserted `approved_at` (via `RETURNING`) instead of `()`, since the approve response needs a real timestamp and `utoipa`'s lack of a `chrono` feature ruled out putting `DateTime<Utc>` straight into the response DTO. Noted on the Issue as a comment.

### 3. Update `capital_allocation.rs`'s `in_transit` computation — ✅ Done

`packages/api/src/routes/capital_allocation.rs`, `compute_capital_allocation` (lines ~222-237):

- The `back` branch (`ramp→custody`, subtracted) must additionally require `t.approved_at.is_some()`.
- The `out` branch (`custody→ramp`, added) is unchanged.
- Update the module doc comment (lines ~17-22) to state that `in_transit`'s on-ramp leg only counts Trustee-approved transfers.

### 4. New route module `packages/api/src/routes/ramp.rs` — ✅ Done

Follow the `capital_allocation.rs` structure (module doc, DTOs, `#[derive(OpenApi)]` doc bundle, `router()` fn, handlers):

- `pub fn router() -> Router<Arc<AppState>>` registering:
  - `GET /ramp/addresses`
  - `GET /ramp/on-ramp`
  - `POST /ramp/on-ramp/:id/approve`
- **`GET /v1/ramp/addresses`**: `chain_id?` query param (`ChainQuery`/`resolve_chain`, same as `capital_allocation`). Looks up `state.transfer_addresses.get(&chain_id)`; returns `{ "ramp_addresses": [...] }` (empty array when unconfigured — matches the existing "not configured → null/empty" convention, no 404).
- **`GET /v1/ramp/on-ramp`**: `chain_id?` query param. Calls `contract_logs_repo.list_asset_transfers(&pool, chain_id, now)`, then a pure helper `filter_pending_on_ramp_events(transfers: &[AssetTransferRow], addr: &TransferAddressSets) -> Vec<OnRampEvent>` that keeps rows where `from_addr ∈ ramp && to_addr ∈ custody && approved_at.is_none()`, mapped to the response DTO `{ id, to, from, amount, created_at }` (`created_at` = `block_timestamp` as Unix seconds, matching the rest of the API's timestamp convention). When the chain has no configured address sets, return an empty list (not an error).
- **`POST /v1/ramp/on-ramp/{id}/approve`**: takes `AuthClaims`, checks `claims.has_role(TRUSTEE_ROLE)` (else `403`, exact pattern from `collateral_valuation.rs:396-407`). Fetches the transfer by id; `404` if absent or not an `AssetTransfer` event; `400` if its direction isn't `ramp→custody` for its chain's configured address sets. Calls `approve_on_ramp_transfer(id, &claims.sub)`; maps a PK conflict to `409 Conflict` ("already approved"). Returns `201`/`200` with `{ "contract_log_id": id, "approved_at": ... }`.
- Add `pub mod ramp;` to `packages/api/src/routes/mod.rs`.

### 5. Wire into `main.rs` — ✅ Done

`packages/api/src/main.rs`:
- `.nest("/v1", pipeline_api::routes::ramp::router())` alongside the other `/v1` nests (~line 168).
- `api_docs.merge(pipeline_api::routes::ramp::RampDoc::openapi());` alongside the other doc merges (~line 148).

### 6. AppState — ✅ Done (no change needed)

No new repo struct needed — everything is served through the existing `contract_logs_repo` and `transfer_addresses` fields already on `AppState`/`ChainsConfig`. Confirmed at implementation time: kept everything on `ContractLogsRepo` rather than introducing a `RampApprovalRepo`, since `on_ramp_approvals` has no meaning independent of `contract_logs`.

## Test Strategy — ✅ Done

Per this codebase's convention (no DB-backed tests; pure compute functions are unit-tested in `packages/api/tests/`, `packages/shared` tests, etc. — no `#[cfg(test)]` modules in `src/`, no env-var DB gating):

- `packages/api/tests/ramp.rs` (new):
  - Unit-test `filter_pending_on_ramp_events` (pure, no DB): fixtures covering custody→ramp (excluded, wrong direction), ramp→custody unapproved (included), ramp→custody approved (excluded), ramp↔ramp / custody↔custody shuffles (excluded), and an empty/unconfigured `TransferAddressSets` case (empty result, no panic).
  - Unit-test any pure direction/role validation helper used by the approve handler (e.g. "id belongs to a ramp→custody transfer") with fixture `AssetTransferRow`s.
- `packages/api/tests/capital_allocation.rs` (extend existing): add cases to the `compute_capital_allocation` fixtures where some `AssetTransferRow`s carry `approved_at: Some(...)` and others `None`, asserting the on-ramp (`back`) leg only nets out approved ones while the off-ramp (`out`) leg is unaffected by approval state.
- No new test touches a live Postgres connection or reads `DATABASE_URL`/`POSTGRES_URL` — matches the project's pure-unit-test convention for DB-adjacent code.
- Manual/integration verification (documented for the coder, not automated): run the API locally against a seeded DB, hit `GET /v1/ramp/addresses`, insert a synthetic on-ramp `AssetTransfer` row, confirm it appears in `GET /v1/ramp/on-ramp`, approve it as a `trustee`-role token, confirm it disappears from the list and `capital_allocation`'s `in_transit` picks it up. **Not run** — left for manual/QA verification against a live DB; automated coverage is the pure-function tests above, per this codebase's no-DB-tests convention.

Actual test files: `packages/api/tests/ramp.rs` (3 new tests: direction/approval filtering, empty input, 7-decimal normalization) and `packages/api/tests/capital_allocation.rs` (1 new test `in_transit_ignores_unapproved_on_ramp`, plus the 2 pre-existing `in_transit_*` tests updated to mark their on-ramp leg approved so their original intent still holds under the new gating). `cargo test --all`, `cargo clippy --all -- -D warnings`, `npx tsx scripts/lint-docs.ts`, and `packages/frontend`'s `npx tsc --noEmit` all pass.

## Docs to Update — ✅ Done

- `docs/product-specs/trustee-dashboard.md`: add a short row/note describing the new Trustee on-ramp approval action (near the existing "Repayment intake" flow note at line 53, which already references the manual USD→USDC on-ramp step) — this is new Trustee-facing behavior, not pure plumbing.
- `packages/api/src/routes/capital_allocation.rs`: update the module doc comment's `in_transit` description (lines ~17-22) to mention the approval gate, so the doc stays accurate to the new behavior.
- OpenAPI/Swagger docs are generated from `#[utoipa::path]` annotations — no separate manual doc file to update beyond the `RampDoc` bundle itself.
