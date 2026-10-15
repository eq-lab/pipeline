# Issue #1500: Relayer: EVM wire-in matching — join PipelineMinter WireIn events on ref_hash to flip is_minted (TD-133)

Source: https://github.com/eq-lab/pipeline/issues/1500 (sub-issue of epic #1494)

## Scope

Research finding: the core of this Issue already landed on `main` with the EVM relayer rework (`docs/exec-plans/active/evm-relayer-v5.md`, D3/D4):

- `packages/worker/src/relayer/wire_in_match.rs` — chain-generic `phase_match_wire_ins`, called by both jobs.
- `packages/worker/src/relayer/evm/job.rs` — phase 5 runs `phase_match_wire_ins(&LpBankDepositRepo, chain_id, minter_id)` when `EvmRelayerSettings::minter_id()` is `Some`; errors are logged and the cycle continues.
- `packages/shared/src/lp_bank_deposit_repo.rs` — `WireInMatcher` SQL (rule A direct, rule B `WireInAssigned`, unmatched count), all scoped by `chain_id` + `contract_address`, keyed on `ref_hash`.
- Settings: gated on `CHAIN_<id>_EVM_INDEXER_MINTER_ADDRESS` (the indexer key, D4), not `CHAIN_<id>_RELAYER_YIELD_MINTER_ADDRESS`. Staging already sets it to the hoodi-v5 `PipelineMinter` proxy `0xE75814d9618285AE4d789D4424672597DC494D3E` on chain 560048. `.env.example` line 93 documents it.
- TD-133: marked RESOLVED in `docs/exec-plans/tech-debt-tracker.md`. The EVM parser writes `receiver` and `contract_address` (`db.rs` `insert_log` → `to_checksum(None)`) as EIP-55, and `minter_id()` re-renders the configured address with `to_checksum(None)`, so both sides of `receiver <> $2` and `contract_address = $2` are checksummed. Pinned by `tests/evm_relayer_config.rs::minter_id_is_checksummed_whatever_the_configured_case` and `tests/wire_in_match.rs::an_evm_minter_is_scoped_by_its_checksummed_address_verbatim`.
- `ref_hash`: `parse_wire_in` writes unprefixed 64-char lowercase hex (asserted in `tests/parsers.rs`), which is what `decode(..., 'hex')` needs.

Remaining work for this Issue (what this plan covers):

1. The Issue's "integration test flipping `is_minted` for an EVM chain id" does not exist. No test in the repo runs the `WireInMatcher` SQL against Postgres; current tests use a mock matcher.
2. The Issue's "pure unit tests over fixture `contract_logs` rows for both event names, plus the casing case" exist only at the parser and config ends, not as one parser→row→matcher-key chain.
3. `docs/product-specs/relayer-service-internals.md` has no section on the wire-in matching phase for either chain. The Issue lists it as affected.
4. Close-out bookkeeping: TD-133 resolution text should cite #1500, and the evm-relayer-v5 plan should reference this Issue.

Out of scope: the Trustee EVM mint (`PipelineMinter.recordWireIn`, #1501), the per-chain LP settlement address (#1499), the yield-mint phase (#1502, TD-130), and any change to the matching SQL.

## Assumptions and Risks

- **#1499 (per-chain LP settlement address) is upstream and being planned in parallel.** Matching keys only on `ref_hash` plus the minter's own address for the escrow branch. It never reads the LP's settlement address, so #1500 does not need #1499 to land first. #1499 decides which `receiver` the Trustee passes (#1501). That choice only affects which rule (A or B) matches, not whether a match happens. If #1499 changes `lp_bank_deposits` (e.g. adds `chain_id`), re-check the SQL. Today `lp_bank_deposits.ref_hash` has no chain column, so a ref_hash minted on either chain flips the same row. That is intended: one bank deposit, one mint.
- Cross-chain double mint is not prevented by the matcher. `ref_hash` is single-use per contract, not across chains. That guard belongs in #1501 (Trustee UI refuses a second mint once `is_minted`). Noted here only.
- A DB-backed test needs a reachable Postgres. The repo has no such harness today (no `sqlx::test`, no testcontainers), so the new test must skip cleanly when no DB is configured, or CI value is zero. See Open Questions.
- Risk: the `contract_address` written by other EVM paths (`insert_row` is chain-agnostic and takes a preformatted string). Only `insert_log` (checksummed) is used for Minter events today. The new test pins that.

## Open Questions

1. DB integration test harness: is an opt-in Postgres test gated on `TEST_DATABASE_URL` (skipped when unset, run via `sqlx::migrate!` against a scratch DB) acceptable? Or should the "integration test" be satisfied by the mock-matcher tests plus SQL fixture assertions? Alternatively, should a shared DB-test harness be a separate chore Issue? The plan assumes the opt-in gated test.
2. Should #1500 be closed largely as "already delivered by the EVM relayer rework (feature/evm-relayer)" with only the test and spec additions below? Or does the user want the dedicated `CHAIN_<id>_RELAYER_..._MINTER_ADDRESS` key the Issue floated? The plan keeps the existing indexer-key gate (D4) because #1483 settled on it.

## Implementation Steps

1. **Postgres-backed matcher test** — new `packages/shared/tests/wire_in_matcher_db.rs`:
   - Connect via `TEST_DATABASE_URL`. If it is unset, print a skip notice and return.
   - Run `sqlx::migrate!("../../migrations")`. Confirm the migrations path from `packages/shared` or the worker's existing migrate call.
   - Isolate each test in a transaction that rolls back, or use a unique `chain_id`/`ref_hash` per test.
   - Seed one `lp_bank_deposits` row per case, plus `contract_logs` rows via `EventRepo::insert_log` / the real EVM parser output (`parse_wire_in` from fixture `Log`s). That way the row shape is the indexer's, not hand-written.
   - Cases, all on chain `560048` with minter `0xE75814d9618285AE4d789D4424672597DC494D3E`:
     - rule A: `WireIn` with receiver ≠ minter flips `is_minted`.
     - escrow: `WireIn` with receiver = minter, no `WireInAssigned` → stays false. Then add `WireInAssigned` with the same `id` → rule B flips it.
     - casing: minter env given lowercase → `EvmRelayerSettings::minter_id()` still matches. Escrowed receiver does not falsely match rule A (the TD-133 trap).
     - chain scoping: same rows under `99000001` / another minter address → no flip.
     - `count_unmatched_wire_ins` counts a `WireIn` whose `ref_hash` has no deposit.
     - idempotent: second tick flips 0 rows.
2. **Pure unit test (no DB)** — extend `packages/worker/tests/wire_in_match.rs`: a test that builds `WireIn` and `WireInAssigned` `ContractLog`s through `parse_wire_in` / `parse_wire_in_assigned` and asserts the fields the SQL keys on:
   - `event_name` values;
   - `params.ref_hash` unprefixed lowercase hex equal to `hex::encode(sha256(reference))`, the same as the API's `ref_hash` derivation;
   - `params.id` equality across the pair;
   - `params.receiver` equals `minter_id()` for an escrow log created from a lowercase-configured address.
3. **Spec** — `docs/product-specs/relayer-service-internals.md`: add a "Wire-in matching phase" section covering:
   - both chains, the gate key (`CHAIN_<id>_{STELLAR|EVM}_INDEXER_MINTER_ADDRESS`);
   - rules A/B, the unmatched-count log line, and chain + minter scoping;
   - EVM EIP-55 normalisation (TD-133);
   - the fact that it never reads the LP settlement address (#1499).
4. **Bookkeeping**:
   - `docs/exec-plans/tech-debt-tracker.md` TD-133: append "Tests: #1500".
   - `docs/exec-plans/active/evm-relayer-v5.md`: one line pointing at #1500 for the DB-level coverage.
   - `.env.example` line 93: also mention chain 560048 / hoodi-v5 in the example comment if a 560048 block exists. Otherwise leave it.
5. Run `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, and the `/test-fast` skill.

## Test Strategy

- New: `packages/shared/tests/wire_in_matcher_db.rs` (opt-in, Postgres) covers rule A, rule B, escrow-not-matched, casing, chain/minter scoping, unmatched count and idempotency for chain 560048.
- New: parser→matcher-key unit test in `packages/worker/tests/wire_in_match.rs` (always runs).
- Existing tests must stay green: `tests/wire_in_match.rs`, `tests/evm_relayer_config.rs`, `tests/parsers.rs` wire-in cases.
- Manual (optional, staging): after #1501, a Trustee mint on 560048 flips `is_minted` within one `JOB_RELAYER_INTERVAL_SECS`, and the worker log shows "evm wire-in matching phase enabled".

## Docs to Update

- `docs/product-specs/relayer-service-internals.md` (new wire-in matching section)
- `docs/exec-plans/tech-debt-tracker.md` (TD-133 note)
- `docs/exec-plans/active/evm-relayer-v5.md` (cross-reference)
