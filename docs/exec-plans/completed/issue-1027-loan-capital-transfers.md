# Issue #1027: Backend: per-loan capital transfers (Trustee GET/POST /v1/loan-book/{loan_id}/transfers) + rework capital-allocation in_transit / trust_account / deployed

Source: https://github.com/eq-lab/pipeline/issues/1027

## Scope

Introduce a Trustee-maintained per-loan capital-transfers record and rework three
`GET /v1/capital-allocation` buckets on top of it.

**In scope**

1. New table `loan_capital_transfers`, keyed `(chain_id, loan_id)`, holding
   `is_loan_deployed`, `on_ramp_transferred`, `off_ramp_transferred`,
   `trust_account_deposit`, `trust_account_withdrawal` (+ audit columns).
2. New repo `packages/shared/src/loan_capital_transfers_repo.rs` (get / full-upsert /
   list-for-chain).
3. New Trustee-only endpoints `GET` and `POST /v1/loan-book/{loan_id}/transfers`
   (new route module `packages/api/src/routes/loan_transfers.rs`).
4. Rework of `compute_capital_allocation` in
   `packages/api/src/routes/capital_allocation.rs`:
   - `in_transit` = gross approved ramp flow (both legs, absolute) **minus** the
     per-loan confirmed transfers; **no longer clamped at 0**.
   - `trust_account` = `Σ(trust_account_deposit) − Σ(trust_account_withdrawal)` over
     `loan_capital_transfers`; the `bank_transactions` ledger is no longer read.
   - `deployed` = Σ senior tranche over loans that are **both** inside the active
     window (`origination_date ≤ now < effective_end`) **and** have
     `is_loan_deployed = TRUE`.
5. Test updates (`packages/api/tests/capital_allocation.rs`, new
   `packages/api/tests/loan_transfers.rs`) and doc updates (product specs, module
   docs, tech-debt entry).

**Out of scope**

- Removing `POST /v1/bank-transactions`, `BankTransactionRepo`, the
  `bank_transactions` table, and the `bank_operator` role. They stay functional
  during this Issue; only the capital-allocation read is decoupled. Their removal is
  **Issue #1029** (blocked until this Issue merges).
- Any Trustee frontend work (`packages/trustee` — `useCapitalAllocation.ts`,
  `CapitalAllocationCard.tsx`): the response *shape* is unchanged. The entry UI for
  the new POST endpoint and negative-value display are **Issue #1030** (frontend,
  blocked until this Issue merges).
- Worker/indexer changes. Absence of a `loan_capital_transfers` row means
  "defaults" (flag false, all amounts 0) — no seeding on `LoanDrawn` (unlike
  `loan_disbursement.mark_drawn`), so the indexer is untouched.
- `capital_wallet` / `tbills` buckets (still `null`, other Issues: #981).

## Decisions already made (Issue comment, 2026-08-06)

1. `in_transit` gross flow = **Approved** custody↔ramp `AssetTransfer` legs (#936),
   both legs summed as **absolute** amounts; Pending/Rejected excluded.
2. `deployed` gating = flag **AND** active window.
3. POST = **full upsert** (body always carries all five fields, create-or-replace).
4. Amounts are **plain dollar figures** (like `bank_transactions`); scaled to base-6
   only where combined with on-chain buckets (`in_transit` subtraction, `total`).
5. **No clamping anywhere** — `in_transit` and `trust_account` may go negative
   (behavior change: `in_transit` is clamped at 0 today).
6. **`trust_account` becomes chain-scoped** — summed over the resolved chain's
   `loan_capital_transfers` rows (was protocol-global via `bank_transactions`).
   Only observable once a second chain launches.
7. **Bank ledger removal is follow-up #1029** — `POST /v1/bank-transactions`, the
   `bank_operator` role, and the table are removed once this Issue merges.
8. **Frontend follow-up is #1030** — Trustee entry UI for the new endpoints and
   negative-value display in `CapitalAllocationCard`.

## Assumptions and Risks

- **`in_transit` can drift upward.** Gross approved ramp flow grows monotonically;
  the subtraction depends on Trustees recording per-loan confirmed transfers
  promptly. Under-recording inflates `in_transit`; the unclamped negative case
  surfaces over-recording. This is the accepted product model per decisions 1/5.
- **Signature change of a public compute fn.** `compute_capital_allocation` is
  `pub` and exercised by `packages/api/tests/capital_allocation.rs` (557 lines,
  ~20 tests) — several tests assert the old netting/clamping semantics and must be
  rewritten, not just recompiled (notably `in_transit_clamps_negative_to_zero`,
  `in_transit_nets_custody_to_ramp_flow`, all `trust_account_*` tests).
- **404 semantics need an indexed loan.** Both new endpoints 404 when the loan has
  no indexed events on the chain (mirrors `complete_disbursement`'s
  `latest_status_by_loans` check). A drawn-but-not-yet-indexed loan briefly 404s —
  same accepted behavior as disbursement-complete.
- No blocking dependency: #936 (ramp reviews) and #924 (bank ledger) are merged;
  `AssetTransferRow::is_approved()` and the trustee-gated loan-book POST pattern
  already exist. Draft PR #1028 tracks the branch `feat/1027-loan-capital-transfers`.

## Open Questions

_None_ — the three planning questions (trust_account chain scope, bank-ledger fate,
frontend follow-up) were resolved with the user on 2026-08-06; see decisions 6–8
above and follow-up Issues #1029 / #1030.

## Implementation Steps

1. **Migration** — `packages/shared/migrations/20260806000001_loan_capital_transfers.sql`:

   ```sql
   CREATE TABLE loan_capital_transfers (
       chain_id                 BIGINT        NOT NULL,
       loan_id                  NUMERIC(78,0) NOT NULL,
       is_loan_deployed         BOOLEAN       NOT NULL DEFAULT FALSE,
       on_ramp_transferred      NUMERIC       NOT NULL DEFAULT 0 CHECK (on_ramp_transferred >= 0),
       off_ramp_transferred     NUMERIC       NOT NULL DEFAULT 0 CHECK (off_ramp_transferred >= 0),
       trust_account_deposit    NUMERIC       NOT NULL DEFAULT 0 CHECK (trust_account_deposit >= 0),
       trust_account_withdrawal NUMERIC       NOT NULL DEFAULT 0 CHECK (trust_account_withdrawal >= 0),
       recorded_by              TEXT          NOT NULL,
       created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
       updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
       PRIMARY KEY (chain_id, loan_id)
   );
   ```

   Header comment follows the `loan_disbursement` / `bank_transactions` migration
   style (purpose, absence semantics, plain-dollar note, inverse SQL comment).
   Amounts are stored as entered (plain dollars); individual fields are
   non-negative (sign is implied by the field name), while derived bucket values may
   go negative. No backfill — absence of a row is the legitimate initial state.

2. **Repo** — new `packages/shared/src/loan_capital_transfers_repo.rs` (+ `pub mod`
   in `packages/shared/src/lib.rs`, alphabetical order):
   - `pub struct LoanCapitalTransfersRow { chain_id, loan_id: BigDecimal, is_loan_deployed: bool, on_ramp_transferred: BigDecimal, off_ramp_transferred: BigDecimal, trust_account_deposit: BigDecimal, trust_account_withdrawal: BigDecimal, recorded_by: String, updated_at: DateTime<Utc> }`.
   - `upsert(&self, chain_id, loan_id: &BigDecimal, values…, recorded_by: &str)` —
     `INSERT … ON CONFLICT (chain_id, loan_id) DO UPDATE SET` all five fields +
     `recorded_by` + `updated_at = now()` (full replace, mirrors
     `LoanDisbursementRepo::mark_complete`).
   - `get(&self, chain_id, loan_id: &BigDecimal) -> Result<Option<LoanCapitalTransfersRow>>`.
   - `list_for_chain(&self, chain_id) -> Result<Vec<LoanCapitalTransfersRow>>` — the
     capital-allocation handler passes the rows into the pure compute fn (keeps
     summing logic pure/testable; row counts are small — one per drawn loan).
   - Module docs mirror `bank_transaction_repo.rs` (plain-dollar note, audit note:
     `recorded_by` is always the authenticated JWT `sub`, never client-supplied).

3. **Route module** — new `packages/api/src/routes/loan_transfers.rs` (+ `pub mod`
   in `routes/mod.rs`):
   - `router()` with `.route("/loan-book/{loan_id}/transfers", get(get_loan_transfers).post(upsert_loan_transfers))`.
   - Both handlers: `AuthClaims` extractor, `TRUSTEE_ROLE` check (import from
     `crate::auth`, same 403 message pattern as `complete_disbursement`),
     `resolve_chain` + `ChainQuery`, `loan_id` parsed via
     `BigDecimal::from_str(loan_id.trim())` → 400 on parse failure, then the
     `latest_status_by_loans` indexed-loan check → 404 `loan {id} not indexed on
     chain {chain_id}` (copy `complete_disbursement`, `loan_book.rs:894`).
   - `GET` → 200 `LoanCapitalTransfersResponse`; absent row serves defaults
     (`is_loan_deployed: false`, all amounts `"0"`, `recorded_by`/`updated_at`
     null) — absence-as-default mirrors `loan_disbursement`.
   - `POST` → body `UpsertLoanTransfersRequest { is_loan_deployed: bool,
     on_ramp_transferred: String, off_ramp_transferred: String,
     trust_account_deposit: String, trust_account_withdrawal: String }` (all
     required — decision 3). Pure `validate_loan_transfers(&req) -> Result<(), String>`
     (each amount a valid non-negative decimal; `pub` for the unit test, mirroring
     `validate_bank_transaction`). On success upsert with `recorded_by =
     claims.sub`, return 200 with the stored record (same response DTO as GET).
   - utoipa: `LoanTransfersDoc` with `SecurityAddon`, `security(("bearer_auth" = []))`,
     tag `CapitalAllocation` (precedent: `bank_transactions.rs` — these records back
     capital-allocation buckets). Responses documented: 200/400/401/403/404.

4. **Wiring** — `packages/api/src/lib.rs`: add
   `pub loan_capital_transfers_repo: LoanCapitalTransfersRepo` to `AppState`.
   `packages/api/src/main.rs`: construct the repo (next to `bank_transaction_repo`,
   ~line 134), `api_docs.merge(routes::loan_transfers::LoanTransfersDoc::openapi())`
   (~line 146), `.nest("/v1", routes::loan_transfers::router())` (~line 169).

5. **Rework `capital_allocation.rs`**:
   - Handler: fetch `loan_capital_transfers_repo.list_for_chain(chain_id)`; **drop**
     the `bank_transaction_repo.trust_account_balance()` call.
   - `compute_capital_allocation` signature: remove `trust_account_balance:
     &BigDecimal`, add `capital_transfers: &[LoanCapitalTransfersRow]`.
   - `deployed`: build a `HashSet` of loan_ids with `is_loan_deployed`; a loan adds
     `original_senior_tranche` only when active-window AND in the set.
   - `in_transit` (still `Some` only when `addr` is configured):
     `gross = Σ amount` over approved transfers where (custody→ramp) OR
     (ramp→custody) — both legs **added** (absolute), replacing today's netting;
     normalize to canonical base-6; then subtract
     `Σ(on_ramp_transferred + off_ramp_transferred) × 10^CANONICAL_AMOUNT_DECIMALS`
     (plain dollars → base-6). **Remove the `.max(0)` clamp.**
   - `trust_account`: `Σ trust_account_deposit − Σ trust_account_withdrawal` over
     `capital_transfers` (plain dollars, displayed via the existing
     `with_scale_round(6, Down)`, scaled ×10^6 into `total` — unchanged fold-in).
   - Rewrite module docs (lines 8–43) and doc comments on `CapitalBuckets` /
     `compute_capital_allocation` for the new formulas, the no-clamp rule, and the
     chain-scoped `trust_account`.

6. **Lint** — `cargo clippy --all -- -D warnings`; `npx tsx scripts/lint-docs.ts`
   after doc edits.

## Test Strategy

All tests are pure (no DB, no env vars), in external files per project convention.

1. **Update `packages/api/tests/capital_allocation.rs`** (compute-layer, extend the
   existing fixture helpers with a `capital_transfers(...)` row builder):
   - `deployed`: active loan **with** flag counts; active loan **without** flag/row
     does not; inactive (matured/closed) loan with flag does not.
   - `in_transit`: both legs gross — custody→ramp 100 + ramp→custody 40 (both
     approved) → 140, not 60; unapproved/rejected legs still excluded; subtraction
     of per-loan `on_ramp_transferred + off_ramp_transferred` (×10^6); result may
     go **negative** (replaces `in_transit_clamps_negative_to_zero`); still `null`
     when address sets unconfigured (and per-loan sums alone don't create it).
   - `trust_account`: 0 with no rows; `Σdeposit − Σwithdrawal` across multiple rows;
     negative not clamped; folds into `total` ×10^6 (rework the existing
     `trust_account_*` tests to build rows instead of passing a balance).
   - `total`: negative `in_transit` reduces `total`.
2. **New `packages/api/tests/loan_transfers.rs`** — unit tests for
   `validate_loan_transfers`: valid payload; non-decimal amount; negative amount;
   each of the four amount fields exercised (mirrors the
   `validate_bank_transaction` test style).
3. Full suite via the `test-fast` skill (lint + unit + integration) before PR-ready.

## Docs to Update

- `docs/product-specs/dashboards.md` (~line 86): rewrite the `in_transit` /
  `trust_account` bullet — new formulas, unclamped, chain-scoped trust_account,
  sourced from Trustee-entered `loan_capital_transfers`
  (`POST /v1/loan-book/{loan_id}/transfers`) instead of the bank ledger.
- `docs/product-specs/trustee-dashboard.md` (Flow 2 row, ~line 53): extend the ramp
  approve/reject note — approved legs feed *gross* `in_transit`, which is reduced by
  per-loan confirmed transfers; document the new Trustee write (record per-loan
  transfers / deployment flag) alongside disbursement-complete.
- Module docs in `capital_allocation.rs`, `loan_transfers.rs`,
  `loan_capital_transfers_repo.rs` (written as part of steps 2/3/5).
- No tech-debt entry needed for the decoupled bank ledger — its removal is tracked
  as Issue #1029 (blocked on this Issue).
