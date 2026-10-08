# Issue #1029: Backend: remove the bank_transactions ledger (POST /v1/bank-transactions + bank_operator role)

Source: https://github.com/eq-lab/pipeline/issues/1029

## Scope

Fully remove the manually-entered bank-transaction ledger, which #1027 (merged via
PR #1028) left with no consumer — `GET /v1/capital-allocation` now computes
`trust_account` from the per-loan `loan_capital_transfers` table, not this ledger.

**In scope — delete:**

- `POST /v1/bank-transactions` route module: `packages/api/src/routes/bank_transactions.rs`.
- `BankTransactionRepo` + `BankTransactionType`: `packages/shared/src/bank_transaction_repo.rs`.
- Both unit-test files for the above: `packages/api/tests/bank_transactions.rs` and
  `packages/shared/tests/bank_transaction_repo.rs`.

**In scope — edit (unwire):**

- `packages/api/src/routes/mod.rs` — drop `pub mod bank_transactions;`.
- `packages/shared/src/lib.rs` — drop `pub mod bank_transaction_repo;`.
- `packages/api/src/auth.rs` — drop `BANK_OPERATOR_ROLE` const + its doc comment.
- `packages/api/src/lib.rs` — drop the `use` import, the `AppState.bank_transaction_repo`
  field, and its doc comment.
- `packages/api/src/main.rs` — drop the import, the `let` binding, the struct-literal
  field, the OpenAPI `.merge(...BankTransactionsDoc...)`, and the `.nest(...router())`.
- `packages/api/tests/voucher_signing.rs` — drop the `bank_transaction_repo:` field from
  the `make_test_state` `AppState` literal.
- `packages/api/src/routes/capital_allocation.rs` — reword the `trust_account` module-doc
  note that references the now-removed ledger and the "removal is #1029" forward-reference.

**In scope — new migration:**

- Forward-only `DROP TABLE bank_transactions;` migration.

**In scope — docs:**

- `docs/product-specs/dashboards.md` — drop the stale trailing clause about the ledger.

**Out of scope:**

- Historical exec-plan decision logs (`docs/exec-plans/active/issue-924-*.md`,
  `issue-1027-*.md`) — these are dated records of past decisions and are not rewritten.
- The existing create migration `20260724000001_bank_transactions.sql` — it is **not**
  deleted or edited (sqlx tracks applied migrations by checksum; removing an
  already-applied migration file breaks the migrator). Forward-only: add a new drop.
- Any change to `capital-allocation`'s runtime behavior — it already ignores this ledger.

## Assumptions and Risks

- **Destructive migration.** `DROP TABLE bank_transactions` is irreversible and drops all
  rows. The Issue states the table holds only dev/test data today. **Risk mitigation:** the
  human plan-approval gate (backend flow) is the point to confirm no environment holds
  real trust-account data before this ships; the migration's header comment records the
  data-safety assumption and the reference inverse SQL.
- **No CI coverage for the migration.** `tests.yml` runs `cargo test --all` with no live
  Postgres, and `sqlx::migrate!` embeds migration files at compile time without executing
  their SQL. So the `DROP TABLE` is exercised only when the API/worker boots against a real
  DB. The coder must apply the migration against a local dev Postgres to confirm it runs
  cleanly (see Test Strategy) — this is a manual verification step, not an automated test.
- **No hidden consumers.** Verified during planning: `trust_account_balance()` has zero
  code callers; `bank_transaction_repo` is constructed only in `main.rs` and the
  `voucher_signing.rs` test helper; `BANK_OPERATOR_ROLE` is referenced only inside the
  route module being deleted; no `auth_users` seed grants `bank_operator` (the column
  defaults to `'{}'`); no frontend/TypeScript code references the endpoint or role.
- **Fresh-DB ordering is safe.** On a new database the create (20260724) runs before the
  drop (20260810); net effect is a table created then dropped, which is standard.
- The `bank_transactions` table has no foreign keys or views depending on it, so a plain
  `DROP TABLE` (its index drops with it) needs no `CASCADE`.

## Open Questions

_None_

## Progress

**Implemented** (all steps 1–11 complete). Deviation from plan: three additional
dangling doc-comment cross-references to the now-deleted modules were found and cleaned
(`loan_transfers.rs` ×2 — amount-convention and OpenAPI-tag precedent notes;
`loan_capital_transfers_repo.rs` ×1 — amount-scaling rationale note). Each kept its
substantive explanation inline; only the dead `bank_transactions`/`bank_transaction_repo`
reference was removed. Migrations `20260724000001` (create) and `20260806000001`
(loan_capital_transfers, which mentions `bank_transactions` in a comment) are left
untouched — both are already-applied, checksum-tracked by sqlx.

Verification: `cargo clippy --all -- -D warnings` clean; `cargo test --all` all green
(0 failed); `npx tsx scripts/lint-docs.ts` 0 errors. `DROP TABLE` migration validated by
inspection (no CI Postgres); a live-DB apply is the remaining manual check before merge.

## Implementation Steps

1. **Delete the route module.** `rm packages/api/src/routes/bank_transactions.rs`.

2. **Delete the repo module.** `rm packages/shared/src/bank_transaction_repo.rs`.

3. **Delete the two unit-test files.** `rm packages/api/tests/bank_transactions.rs` and
   `rm packages/shared/tests/bank_transaction_repo.rs`.

4. **Unregister modules.**
   - `packages/api/src/routes/mod.rs`: remove the `pub mod bank_transactions;` line.
   - `packages/shared/src/lib.rs`: remove the `pub mod bank_transaction_repo;` line.

5. **Remove the role.** In `packages/api/src/auth.rs`, delete the `BANK_OPERATOR_ROLE`
   const (`pub const BANK_OPERATOR_ROLE: &str = "bank_operator";`) together with its
   three-line doc comment directly above it.

6. **Remove the AppState field (`packages/api/src/lib.rs`).**
   - Delete the `use shared::bank_transaction_repo::BankTransactionRepo;` import.
   - Delete the `pub bank_transaction_repo: BankTransactionRepo,` field and its two-line
     doc comment.

7. **Unwire the composition root (`packages/api/src/main.rs`).** Remove all five sites:
   - the `use shared::bank_transaction_repo::BankTransactionRepo;` import;
   - the `let bank_transaction_repo = BankTransactionRepo::new(pool.clone());` binding;
   - the `bank_transaction_repo,` field in the `AppState { ... }` literal;
   - the `api_docs.merge(pipeline_api::routes::bank_transactions::BankTransactionsDoc::openapi());` line;
   - the `.nest("/v1", pipeline_api::routes::bank_transactions::router())` line.

8. **Fix the test helper.** In `packages/api/tests/voucher_signing.rs`, remove the
   `bank_transaction_repo: shared::bank_transaction_repo::BankTransactionRepo::new(pool.clone()),`
   field from the `AppState` literal in `make_test_state` (keep the surrounding
   `loan_capital_transfers_repo` field and its use of `pool`).

9. **Reword the capital-allocation module doc.** In
   `packages/api/src/routes/capital_allocation.rs`, the `trust_account` bullet currently
   reads "Chain-scoped (#1027 decision 6; previously global via the `bank_transactions`
   ledger, which is no longer read — its removal is #1029)." Replace the parenthetical so
   it no longer references a table that no longer exists nor a now-closed issue — e.g.
   "Chain-scoped (#1027 decision 6)." Keep the rest of the bullet intact.

10. **Add the forward-only drop migration.** Create
    `packages/shared/migrations/20260810000001_drop_bank_transactions.sql` (timestamp is
    greater than the current latest, `20260806000001`), matching the header-comment +
    reference-inverse-SQL style of `20260720000002_drop_loan_parameters.sql`:

    ```sql
    -- Migration: drop bank_transactions.
    --
    -- The manually-entered bank-account ledger (#924) originally backed `trust_account`
    -- on GET /v1/capital-allocation. #1027 (merged in PR #1028) reworked that endpoint to
    -- source `trust_account` from the per-loan `loan_capital_transfers` table, leaving this
    -- ledger with no consumer. Its endpoint (POST /v1/bank-transactions), repo, and the
    -- `bank_operator` role are removed in the same change (#1029); the table is dropped here.
    --
    -- Holds dev/test data only at the time of removal — no production trust-account data
    -- lives here (that now lives in loan_capital_transfers).
    --
    -- Inverse (rollback) SQL — forward-only migrations, provided for reference only.
    -- Recreates the table shape only; rows are not restorable:
    --   CREATE TABLE bank_transactions (
    --       id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    --       transaction_type  TEXT        NOT NULL CHECK (transaction_type IN ('Deposit', 'Withdrawal', 'Fee')),
    --       amount            NUMERIC     NOT NULL CHECK (amount >= 0),
    --       payment_reference TEXT,
    --       occurred_at       TIMESTAMPTZ NOT NULL,
    --       recorded_by       TEXT        NOT NULL,
    --       created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    --   );
    --   CREATE INDEX bank_transactions_occurred_at_idx ON bank_transactions (occurred_at DESC);

    DROP TABLE bank_transactions;
    ```

11. **Update the product spec.** In `docs/product-specs/dashboards.md` (the
    capital-allocation bullet, ~line 86), remove the trailing clause
    "; the former `bank_transactions` ledger no longer feeds this endpoint (removal
    tracked in #1029)" so the sentence ends after the `POST /v1/loan-book/{loan_id}/transfers`
    description. The described behavior (trust_account from `loan_capital_transfers`) is
    unchanged — this only drops a now-obsolete parenthetical.

## Test Strategy

This Issue removes a feature end-to-end; it adds no new behavior, so it adds no new tests.
The two existing unit-test files (validator tests, type round-trip tests) are deleted with
the code they cover. Verification is that everything still compiles, lints, and the
remaining suite stays green after the deletions:

- `cargo build --all` — proves every wiring site (mod registration, AppState field,
  composition root, test helper) was removed cleanly with no dangling references.
- `cargo clippy --all -- -D warnings` — catches any now-unused imports or dead code left
  behind (e.g. a stray `use` after the field removal). Must pass with zero warnings.
- `cargo test --all` — the remaining suite (notably `voucher_signing.rs`, which still
  builds an `AppState`) must compile and pass.
- `npx tsx scripts/lint-docs.ts` — validates the `dashboards.md` edit keeps docs structure
  valid.
- **Manual migration check (local dev DB only, never in automated tests per the project's
  no-DB-in-tests rule):** apply the new migration against a local Postgres that has the
  `bank_transactions` table (`sqlx::migrate!` runs on API/worker startup) and confirm
  `DROP TABLE bank_transactions;` succeeds and the app boots. Also confirm a from-scratch
  migration run (create then drop) applies cleanly in order.

## Docs to Update

- `docs/product-specs/dashboards.md` — remove the stale `bank_transactions` clause from the
  capital-allocation bullet (Step 11). No behavioral spec change.
- `packages/api/src/routes/capital_allocation.rs` module doc — reword the `trust_account`
  note (Step 9). (In-code doc, not a separate doc file, but tracked here for completeness.)
- No `docs/generated/` changes: the OpenAPI JSON is generated at runtime from code, not
  checked in, and no generated schema dump references the endpoint.
- Historical exec-plan logs (`issue-924`, `issue-1027`) are intentionally left as-is.
