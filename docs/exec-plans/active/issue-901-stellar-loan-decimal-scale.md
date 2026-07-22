# Issue #901: Stellar loan-registry amounts likely decoded at native 7-decimal SAC scale, not canonical 6-decimal

Source: https://github.com/eq-lab/pipeline/issues/901

**Revision note 1:** this plan's architecture changed mid-implementation. The first pass normalized at Stellar indexer **decode/write time** (dividing raw values before they were written to `contract_logs`). User feedback correctly rejected this: `contract_logs` must always hold the raw, unmodified on-chain value — normalization belongs only at **read time**, in `ContractLogsRepo`'s API-facing methods, never in the worker's decode or carry-forward paths. The worker changes were fully reverted; this document describes the corrected architecture.

**Revision note 2:** after moving normalization to read time, `get_loan_snapshot_as_of` was initially included (it's `LoanSnapshot`-returning, like the other two). User feedback caught that its sole caller, `routes::waterfall`, deliberately needs **raw** on-chain-scale values — its output is handed straight to the on-chain `recordPayment` call. Reverted that one method; see Scope below.

## Scope

Add read-time USDC-scale normalization to `packages/shared/src/contract_logs_repo.rs`: every `ContractLogsRepo` method consumed by an **API route** (never the worker) that returns a USDC-denominated `BigDecimal` now normalizes it from the chain's native scale to the canonical 6-decimal scale before returning. `contract_logs` itself, and the worker's Stellar decode/parse functions, are completely unchanged — they store and pass through the raw on-chain value exactly as emitted by the contract.

**In scope — normalized at read time:**
- `list_latest_loan_snapshots`, `list_latest_loan_snapshots_for_chain` — via `LoanSnapshot::normalize_usdc_for_display` (new method), covering `ImmutableLoanData`'s 4 monetary fields + `RepaymentSnapshot`'s 7 fields.
- `list_withdrawal_queue_rows` (`WithdrawalQueueRow.amount`), `list_flow_events` (`FlowEventRow.amount`), `list_yield_mints` (`YieldMintRow.s_plusd_amount`), `minted_yield_for_loan` (scalar return) — via the new `shared::chains::normalize_usdc_amount` free function.

**Explicitly NOT touched, with reasons:**
- **`get_latest_loan_snapshot`** — used exclusively by the worker's carry-forward mechanism (`loan_mapper.rs:392`) to build the *next* row before inserting it into `contract_logs`. Normalizing here would write already-scaled data back into raw storage — exactly the bug this plan fixes, reintroduced through the write path. Confirmed via a full-repo grep of its only caller before making this call.
- **`get_loan_snapshot_as_of`** — sole caller is `routes::waterfall` (`GET /v1/loan-book/{loan_id}/waterfall`), whose own module doc comment states its output is **deliberately raw on-chain base units** (7-decimal on Soroban) meant to be handed straight to the on-chain `recordPayment` call. Normalizing this snapshot would have halved a real on-chain transaction argument, not just a display figure — caught and reverted after initially normalizing it (see Revision note 2). Confirmed via `grep -n "base6_to_decimal_string" packages/api/src/routes/waterfall.rs` returning zero hits, consistent with the module doc's stated design.
- **`list_asset_transfers`/`AssetTransferRow`** — already has a working, established normalization pattern one layer up, in `packages/api/src/routes/capital_allocation.rs::normalize_to_canonical` (uses configurable `CHAIN_<id>_API_STELLAR_ASSET_DECIMALS`, not a hardcoded `/10`). Left as-is; not worth converging two working patterns into one in this pass.
- **`list_loan_economics_events`/`EconomicsEventRow.new_rate`** — a *rate* (Soroban `ONE = 1_000_000` fixed-point fraction), not a currency amount. Orthogonal scale concern, already handled elsewhere by existing bps conversions; out of scope.
- **Worker's Stellar decode functions** (`loan_registry_reader.rs`, `parsers.rs`) — fully reverted to raw decode, zero scale logic. This is the whole point of the corrected architecture.

## Assumptions and Risks

- **`shared::chains::parse_chain_type(chain_id)` reads `CHAIN_<id>_TYPE` from the process environment on every call.** This is the codebase's existing, established mechanism for chain-kind classification (already used in `packages/api/src/config.rs`); using it inside `contract_logs_repo.rs` is consistent, not a new pattern. It defaults to `ChainKind::Evm` when unset (safe-by-default: a misconfigured/missing `CHAIN_<id>_TYPE` for a real Stellar chain silently skips normalization rather than crashing — same behavior as everywhere else this function is already used). An explicitly-set-but-invalid value (e.g. a typo) returns `Err`, which repo methods now propagate via `?`.
- **The actual division logic is a pure, unit-tested function** (`normalize_usdc_amount(ChainKind, &BigDecimal) -> BigDecimal` in `shared::chains`; `LoanSnapshot`/`RepaymentSnapshot::normalize_usdc_for_display` wrapping it for the 11-field struct case) — no DB, no env access in the tested core. The env-dependent `parse_chain_type` call happens once per repo method invocation (chain_id is a single-value parameter on every affected method — none of these methods mix chains in one call), not per row.
- **Per-project rule:** tests must not read `DATABASE_URL`/`POSTGRES_URL` or touch a live Postgres — pure unit tests only. Since the actual `ContractLogsRepo` methods require a live DB connection to exercise end-to-end, they are **not** unit-tested directly (consistent with the rest of this file — no existing tests call these methods either). Coverage instead targets the pure normalization functions directly.
- **No mainnet Stellar `LoanRegistry` deployment exists yet** (testnet-only, confirmed against `pipeline-stellar-contracts/deployments/`) — no real-money data affected today, but the fix should land before any mainnet Stellar loan draw.
- **No backfill needed.** Since `contract_logs` was never modified (raw storage, unchanged from day one), there is nothing to backfill — every existing row, old or new, is already in the correct (raw) state. This resolves the original plan's backfill question entirely differently than first drafted: not "skip because testnet data is disposable," but "moot, because storage was never touched."

## Open Questions

_None._ Both of the original plan's open questions (proceed on evidence vs. confirm live; backfill needed) were resolved during the first implementation pass and logged on the issue. The subsequent architecture correction (read-time vs. write-time normalization) was directed explicitly by the user, not left ambiguous.

## Implementation Steps

_All steps complete._

1. ✅ **Revert the worker's Stellar decode functions to raw, unmodified output** — `packages/worker/src/indexer/stellar/loan_registry_reader.rs` and `parsers.rs` restored via `git checkout` to their pre-#901 state (plus the 3 associated worker test files: `stellar_loan_reader.rs`, `stellar_parsers.rs`, `stellar_loan_parsers.rs`). Confirmed zero `STELLAR_USDC_SCALE_ADJUSTMENT`/division logic remains in `packages/worker/`.

2. ✅ **Add `shared::chains::normalize_usdc_amount(kind: ChainKind, amount: &BigDecimal) -> BigDecimal`** (`packages/shared/src/chains.rs`) — the pure, single source of truth for the `/10` (Stellar) vs. no-op (EVM) conversion. Doc comment explicitly states: never applied at indexer write/carry-forward time, only at API-facing read time.

3. ✅ **Add `LoanSnapshot::normalize_usdc_for_display(&mut self, kind: ChainKind)`** and `RepaymentSnapshot::normalize_usdc_for_display` (`packages/shared/src/loan_snapshot.rs`) — applies `normalize_usdc_amount` to all 11 monetary fields (4 `ImmutableLoanData`-equivalent + 7 `RepaymentSnapshot`). Non-monetary fields (rates, timestamps, counters, status) untouched.

4. ✅ **Wire normalization into 6 API-facing `ContractLogsRepo` methods** (`packages/shared/src/contract_logs_repo.rs`), immediately after the raw SQL fetch/deserialization, using the method's own `chain_id` parameter (resolved once per call via `parse_chain_type`, not once per row):
   - `list_latest_loan_snapshots`, `list_latest_loan_snapshots_for_chain` — call `snapshot.normalize_usdc_for_display(chain_kind)` on the deserialized `LoanSnapshot` before pushing into the result.
   - `list_withdrawal_queue_rows`, `list_flow_events`, `list_yield_mints` — map over the fetched rows, replacing the monetary field with `normalize_usdc_amount(chain_kind, &r.amount)` (or `.s_plusd_amount`).
   - `minted_yield_for_loan` — normalize the single scalar return value.
   - `get_latest_loan_snapshot`, `get_loan_snapshot_as_of`, `list_asset_transfers`, `list_loan_economics_events` — deliberately left untouched (see Scope and Revision note 2).

5. ✅ **Tests** — added `packages/shared/tests/loan_snapshot.rs` (new file; 3 tests: EVM no-op, Stellar divides all 11 fields, non-monetary fields untouched) and extended `packages/shared/tests/chains.rs` (3 new tests for `normalize_usdc_amount`: EVM no-op, Stellar `/10`, zero stays zero). No DB, no env vars — pure function tests.

**Revision note 3 (post-implementation code review):** a high-effort code review (8 finder angles + verification) of this diff found a real, confirmed bug — `normalize_usdc_amount`'s Stellar branch (`amount / BigDecimal::from(10)`) does **non-truncating** division: `BigDecimal::from(123456789) / BigDecimal::from(10) = 12345678.9`, not the whole-integer `12345678` every raw on-chain amount actually is at its native scale. Fixed by appending `.with_scale_round(0, RoundingMode::Down)`, matching `base6_to_decimal_string`'s own truncation convention. Added `normalize_usdc_amount_stellar_truncates_not_rounds` (a non-divisible-by-10 fixture, `123_456_789`) to `packages/shared/tests/chains.rs` to catch this class of regression — the original test (`..._divides_by_ten`, using `10_000_000`) was evenly divisible by 10 and never exercised the bug. The review also surfaced (not fixed, tracked separately): the hardcoded `/10` diverges from the existing configurable `capital_allocation.rs::normalize_to_canonical` pattern; 3 duplicated normalize-and-collect blocks in `contract_logs_repo.rs`; `RepaymentSnapshot::normalize_usdc_for_display`'s unnecessarily-`pub` visibility; and — as a byproduct — that the **pre-existing**, untouched `normalize_to_canonical` has the identical non-truncating-division defect (out of scope for #901, flagged for a follow-up).

## Test Strategy

- `packages/shared/tests/chains.rs` — `normalize_usdc_amount` pure-function coverage (EVM no-op, Stellar divides by 10, zero edge case).
- `packages/shared/tests/loan_snapshot.rs` — `LoanSnapshot`/`RepaymentSnapshot::normalize_usdc_for_display` coverage (EVM no-op via full-struct equality, Stellar divides all 11 monetary fields, non-monetary fields — rate/ratio/timestamp/status — explicitly asserted untouched).
- `cargo test -p pipeline-worker` — confirms the worker revert introduced no regressions (all Stellar decode tests pass unchanged from their pre-#901 state).
- `cargo build -p shared -p pipeline-api -p pipeline-worker` + `cargo clippy --all -- -D warnings` — confirms `contract_logs_repo.rs`'s new `?`-propagating `parse_chain_type` calls type-check across every caller (8+ API route files consuming the 3 `LoanSnapshot`-returning methods).
- Full `cargo test --all` — all 56 test binaries green, 0 failures.
- No integration/live-DB test added for the repo methods themselves, consistent with this file's existing convention (no prior test exercises these methods against a real Postgres either) and the project's no-`DATABASE_URL`-in-tests rule.

## Docs to Update

- `docs/product-specs/loans-data.md` (line 76) — ✅ corrected to state `contract_logs` keeps the raw 7-decimal value and `ContractLogsRepo` normalizes only on read (not "the indexer normalizes... at decode time", which described the reverted approach).
- `docs/product-specs/dashboards.md` (line 70) — ✅ corrected similarly for the `YieldMinted` multi-chain note.
- On completion, move this plan to `docs/exec-plans/completed/` (manager step).
