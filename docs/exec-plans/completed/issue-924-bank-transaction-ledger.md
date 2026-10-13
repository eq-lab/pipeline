# Issue #924: Add bank-transaction ledger endpoint(s) to populate capital-allocation's trust_account

Source: https://github.com/eq-lab/pipeline/issues/924

## Scope

Add a manually-entered bank-transaction ledger (`deposit` / `withdrawal` / `fee`) and wire `GET /v1/capital-allocation`'s `trust_account` bucket to compute `sum(deposits) − sum(withdrawals) − sum(fees)` from it, replacing the current hardcoded `None`.

**In scope:**
- New table `bank_transactions` — a **global, non-chain-scoped** ledger (see Assumptions).
- `BankTransactionRepo` (new file, `packages/shared/src/bank_transaction_repo.rs`): `insert(...)` and `trust_account_balance()` (a single `SUM(...) FILTER (...)`-style query).
- `POST /v1/bank-transactions` — new route file `packages/api/src/routes/bank_transactions.rs`, trustee-gated, append-only (mirrors #914's `loan_assays`/`loan_offtake_terms` design: a correction is a new entry, never an edit).
- Wire `trust_account_balance()` into `capital_allocation.rs`'s handler and fold it into `total` (no longer `None` once this ships — a fresh ledger with zero rows returns `"0.000000"`, matching how `deployed` already behaves for an empty loan book).
- **Cleanup, motivated by this change**: centralize `TRUSTEE_ROLE`/`ORIGINATOR_ROLE` into `crate::auth` (currently duplicated in `loan_book.rs` and `collateral_valuation.rs` — flagged as tech debt during #914's code review; this issue would be the *third* file needing `TRUSTEE_ROLE`, so fix it now instead of copying it a third time).

**Out of scope (explicitly):**
- Wiring `financial_position.rs`'s `off_chain_usd` to the same ledger — see Open Questions, this is a real but separate decision.
- A `GET` endpoint to list/browse past bank-transaction entries — see Open Questions.
- Any live bank API integration — the product spec (`docs/product-specs/trustee-dashboard.md:53`) explicitly excludes this from MVP; this ledger *is* the MVP mechanism, not a stopgap for it.
- A "Team" role distinct from `trustee` — same scope decision #914 already made; carried forward here for consistency, not re-litigated.

## Assumptions and Risks

- **`bank_transactions` has no `chain_id` column.** The trust account is one real-world bank account backing the whole protocol, not a per-chain concept. Precedent: `loan_asset_prices` (`packages/shared/migrations/...loan_asset_prices...`) is genuinely global with no `chain_id` column, for the same reason (assets/providers aren't chain-scoped). `capital_allocation.rs`'s handler is per-`chain_id`, but `trust_account_balance()` returns the same protocol-wide figure regardless of which `chain_id` the caller queried — this mirrors how a multi-chain deployment's *actual* bank balance is singular no matter how many chains are configured.
- **Append-only, no UPDATE/DELETE at the API layer** (DB-level `REVOKE` deferred, same as #914's TD-45) — a bookkeeping mistake is corrected with an offsetting entry, not an edit, matching real accounting practice and the audit-trail requirement implicit in tracking real money movements.
- **`trust_account` is not clamped at zero.** Unlike `in_transit` (a legitimate approximation that can slightly overshoot), a negative `sum(deposits) − sum(withdrawals) − sum(fees)` would mean a genuine data-entry error (withdrawals/fees exceeding recorded deposits) — that should surface as a visible red flag, not be silently hidden by clamping.
- **Field naming**: the issue's wording ("type, created_at, amount, payment_reference") is renamed for the *transaction's own date* to `occurred_at` (caller-supplied) to avoid colliding with the row's own `created_at` audit timestamp (DB-generated, `DEFAULT now()`) — mirrors the `effective_at` vs. `created_at` split #914 established for `loan_assays`/`loan_offtake_terms`.
- ~~**Amount convention**: base-6 USDC decimal-string~~ **Corrected post-implementation (twice)**: `amount` is a **plain dollar decimal string** (e.g. `"50000.00"`) end-to-end — request, DB storage, and `trust_account_balance()`'s return value are all plain dollars, never base-6 scaled. A bank transaction has no on-chain native scale to stay "consistent" with, so forcing the base-6 integer convention onto it (first onto the human operator, then attempted as an internal-only conversion) was unjustified complexity neither the operator nor the storage layer needed. `routes::capital_allocation` is the **sole** place that scales this figure — by `10^CANONICAL_AMOUNT_DECIMALS` — and only when folding it into `total` alongside the base-6 `deployed`/`in_transit` buckets; `buckets.trust_account` itself is formatted directly from the plain value. Resolves the issue's Open Question 4.
- **No new migration conflicts**: next migration file should date after `20260722000001` (the last one currently in `packages/shared/migrations/`).

## Open Questions

1. **`financial_position.rs`'s `off_chain_usd` looks like the same underlying concept, discovered during planning — not resolved here.** Its doc comment reads *"Off-chain / in-transit USD"* and it's explicitly a **protocol-level (aggregate)** field (`financial_position.rs:3-4`), unlike `capital_allocation.rs`'s per-`chain_id` response. It's ambiguous whether it should equal `trust_account` alone, or `trust_account + in_transit` combined — the doc comment's wording ("off-chain / in-transit") suggests it may be intended as the latter. Wiring it is *not* included in this plan's scope; flagging so a human can decide whether a follow-up issue is warranted once this ledger exists. (Logged as a comment on #924 as well.)
2. **Read/list endpoint for the ledger** — the issue itself asks whether trustees need to browse past entries for reconciliation, versus the aggregate `trust_account` figure being sufficient for v1. Recommend deferring (YAGNI until someone actually needs to audit individual entries) but flagging since it's a real, cheap-to-add gap if the answer is "yes, immediately."
3. ~~**Authz**~~ Resolved (post-implementation): a new, narrower `bank_operator` role (`crate::auth::BANK_OPERATOR_ROLE`) gates `POST /v1/bank-transactions`, distinct from `trustee` — not the #914-consistent `trustee`-only choice originally planned.

## Implementation Steps

1. ✅ **Migration** — `packages/shared/migrations/20260724000001_bank_transactions.sql`:
   ```sql
   CREATE TABLE bank_transactions (
       id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       transaction_type   TEXT    NOT NULL CHECK (transaction_type IN ('Deposit', 'Withdrawal', 'Fee')),
       amount             NUMERIC NOT NULL CHECK (amount >= 0),
       payment_reference  TEXT,
       occurred_at        TIMESTAMPTZ NOT NULL,
       recorded_by        TEXT    NOT NULL,
       created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE INDEX bank_transactions_occurred_at_idx ON bank_transactions (occurred_at DESC);
   ```
   No `chain_id`/`loan_id` — see Assumptions. `amount` is always non-negative; sign is implied entirely by `transaction_type` (matches the issue's own formula).

2. ✅ **`crate::auth` role centralization** (`packages/api/src/auth.rs`):
   - Add `pub const TRUSTEE_ROLE: &str = "trustee";` and `pub const ORIGINATOR_ROLE: &str = "originator";` near `Claims`.
   - Update `packages/api/src/routes/loan_book.rs` and `packages/api/src/routes/collateral_valuation.rs` to `use crate::auth::{TRUSTEE_ROLE, ORIGINATOR_ROLE}` (or just `TRUSTEE_ROLE` in the latter) instead of their local `const` definitions; delete the local consts.

3. ✅ **`packages/shared/src/bank_transaction_repo.rs`** (new file):
   - `pub enum BankTransactionType { Deposit, Withdrawal, Fee }` with `as_str()`/`TryFrom<String>`, mirroring `ValuationMode`'s exact pattern in `collateral_valuation_repo.rs` (`as_str` + `TryFrom<String>` + a named `Unknown*` error type).
   - `pub struct BankTransactionRepo { pool: PgPool }` with:
     - `insert(&self, transaction_type: BankTransactionType, amount: &BigDecimal, payment_reference: Option<&str>, occurred_at: DateTime<Utc>, recorded_by: &str) -> Result<i64, sqlx::Error>` — plain `INSERT ... RETURNING id`.
     - `trust_account_balance(&self) -> Result<BigDecimal, sqlx::Error>` — one query:
       ```sql
       SELECT
           COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'Deposit'), 0)
         - COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'Withdrawal'), 0)
         - COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'Fee'), 0)
       FROM bank_transactions
       ```
       (`COALESCE` so an empty table returns `0`, not `NULL`.)

4. ✅ **`packages/api/src/routes/bank_transactions.rs`** (new file), following #914's `collateral_valuation.rs` submission-endpoint pattern closely:
   - `SubmitBankTransactionRequest { transaction_type: String, amount: String, payment_reference: Option<String>, occurred_at: u64 }`, `SubmitBankTransactionResponse { id: i64 }`.
   - `pub fn validate_bank_transaction(req: &SubmitBankTransactionRequest) -> Result<(), String>` (pure): `transaction_type` ∈ `{"Deposit","Withdrawal","Fee"}`; `amount` parses as `BigDecimal` and is `>= 0`; if `payment_reference` is `Some`, must not be empty/whitespace-only (a blank reference on a real bank transaction is a red flag, unlike optional fields elsewhere).
   - `async fn submit_bank_transaction(AuthClaims(claims), State(state), Json(payload)) -> Result<(StatusCode, Json<SubmitBankTransactionResponse>), ApiError>`:
     1. `claims.has_role(TRUSTEE_ROLE)` else `403`.
     2. `validate_bank_transaction(&payload)` else `400`.
     3. Parse `amount` → `BigDecimal`, `transaction_type` → `BankTransactionType`, `occurred_at: u64` → `DateTime<Utc>` (reuse the **fixed** conversion — i.e. `i64::try_from(unix_secs)` then `DateTime::from_timestamp`, NOT the `as i64` cast #914's review flagged as a silent-wraparound bug; write this one correctly from the start).
     4. `repo.insert(...)` with `recorded_by: &claims.sub`.
     5. `201` + `Json(SubmitBankTransactionResponse { id })`.
   - `pub fn router() -> Router<Arc<AppState>>` — `.route("/bank-transactions", post(submit_bank_transaction))`.
   - `#[utoipa::path(...)]` + a `BankTransactionsDoc` `OpenApi` bundle, same shape as `CollateralValuationDoc`.
   - Register in `packages/api/src/routes/mod.rs` (`pub mod bank_transactions;`) and `packages/api/src/main.rs` (`.nest("/v1", pipeline_api::routes::bank_transactions::router())`, and merge `BankTransactionsDoc::openapi()` into `api_docs`).

5. ✅ **Wire into `AppState`**:
   - `packages/api/src/lib.rs`: add `pub bank_transaction_repo: BankTransactionRepo,` field.
   - `packages/api/src/main.rs`: construct `let bank_transaction_repo = BankTransactionRepo::new(pool.clone());` and include it in the `AppState { ... }` literal.

6. ✅ **Wire into `capital_allocation.rs`**:
   - In `get_capital_allocation`, fetch `let trust_account = state.bank_transaction_repo.trust_account_balance().await?;` (one extra `await`, independent of the existing loan/event/transfer fetches — fine to run sequentially, it's a single cheap aggregate query, not worth `tokio::join!` ceremony).
   - Pass into `compute_capital_allocation` as a new `&BigDecimal` parameter (update its signature and the one test file that calls it directly).
   - In the response assembly: `trust_account: Some(base6_to_decimal_string(&trust_account))` (no longer always `None`), and fold it into `total` alongside `deployed`/`in_transit`.
   - Update the module doc comment (lines 8-25) to remove `trust_account`'s "null / TODO" bullet and describe the new source instead.

## Test Strategy

- **New file `packages/api/tests/bank_transactions.rs`**: `validate_bank_transaction` unit tests — happy path; unknown `transaction_type`; negative `amount`; non-decimal `amount`; empty/whitespace `payment_reference` when present; missing `payment_reference` allowed. Pure, no DB — matches this repo's testing convention.
- **`packages/shared/tests/bank_transaction_repo.rs`** (if a pure helper is extractable) or inline: unit-test `BankTransactionType::as_str`/`TryFrom` round-trip, mirroring `ValuationMode`'s existing test coverage style.
- **`packages/api/tests/capital_allocation.rs`**: update the existing `compute_capital_allocation` call sites for the new `trust_account: &BigDecimal` parameter; add cases: zero ledger → `trust_account: "0.000000"`; deposits > withdrawals+fees → positive; withdrawals+fees > deposits → **negative, unclamped** (regression guard for the "don't clamp" decision in Assumptions); confirm `total` includes `trust_account`.
- `cargo test -p pipeline-api -p shared`, `cargo clippy --all -- -D warnings`, `cargo fmt --all --check` — all must pass before marking done.
- Manual/human step (per this repo's no-DB-in-tests convention): `POST` a few real entries against a local dev DB, then confirm `GET /v1/capital-allocation` reflects the expected running balance.

## Docs to Update

- `docs/product-specs/dashboards.md` (the `capital-allocation` section, near line 86) — add a `trust_account` bullet describing the new bank-transaction-ledger source, mirroring the existing `in_transit` bullet's style.
- `packages/api/src/routes/capital_allocation.rs` module doc comment — update per Implementation Step 6.
- `docs/exec-plans/tech-debt-tracker.md` — remove or mark resolved the `TRUSTEE_ROLE` duplication concern once centralized (it was raised in #914's code review, not yet formally logged as its own tracker entry — if it isn't already there, no new entry is needed since this plan fixes it directly rather than deferring it).
- On completion, move this plan to `docs/exec-plans/completed/` (manager step).
