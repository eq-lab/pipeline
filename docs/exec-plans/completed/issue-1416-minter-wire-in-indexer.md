# Issue #1416: Index the Stellar minter's WireIn / WireInAssigned and mark matched deposits minted

Source: https://github.com/eq-lab/pipeline/issues/1416

Epic #1269. Continues #1413, which created `lp_bank_deposits` with `ref_hash`
(`sha256(payment_reference)`) and `is_minted`, and left nothing writing `true`.
This issue makes the chain write it.

## Scope

**In scope:**

1. No new env var: the minter is configured by the existing
   `CHAIN_<id>_STELLAR_YIELD_MINTER_ID`. Contracts #33 renamed `yield-minter` to
   `minter` and rewrote it, so `yield_minter_id` already names this contract;
   one id, one role, one branch. Unset = the branch does not exist (ships dark).
2. `parse_wire_in` and `parse_wire_in_assigned` in
   `packages/worker/src/indexer/stellar/parsers.rs`, routed by contract id in
   `parse_stellar_event`.
3. Two new ScVal helpers: `extract_address_from_map`, `extract_bytes32_from_map`.
4. A relayer phase that matches indexed `WireIn` / `WireInAssigned` logs to
   `lp_bank_deposits` by `ref_hash` and sets `is_minted = true`.
5. `LpBankDepositRepo` gains the two matching statements behind a seam trait.
6. Tests: parsers, config, phase (in-memory seam). No database.
7. Tech-debt entry for the `WireInReturned` blind spot.

**Out of scope:** the minter's other 19 events (`WireInReturned` included);
submitting the mint; writing `lp_ledger.stellar_tx_hash`; any API or UI surface
for `is_minted`; verifying the event's `amount` or `receiver`.

## What `is_minted` means after this change

**The LP holds vault shares for this wire.** Not "PLUSD exists": a wire
escrowed on the minter has PLUSD minted against it (`record_wire_in` mints to
the contract itself) while no LP holds anything, and it stays `false` until
`assign_wire_in` resolves it. Rule A below encodes the direct case, Rule B the
escrow case; together they are the whole of `WireInStatus::{Direct, Assigned}`.

## Assumptions and Risks

- **`ScVal::Bytes` is decoded nowhere in the worker today.** Every existing
  helper handles scalars, addresses, strings or maps of those. `ref_hash` is a
  `BytesN<32>` non-topic field, so `extract_bytes32_from_map` is new code
  against an encoding we have never parsed. If `BytesN<32>` arrives as anything
  other than `ScVal::Bytes` holding 32 bytes, the parser returns `None` and the
  event is silently skipped — the failure mode is invisible. Mitigation: the
  parser tests build the fixture from `ScVal::Bytes` the same way the contract
  would, and the parser rejects a wrong length explicitly rather than padding
  or truncating.
- **The minter is not deployed.** `deployments/networks/testnet/addresses.json`
  lists eight contracts and the minter is not one of them (it was reimplemented
  in contracts #33–#35). There is no live event stream to validate against, so
  acceptance rests on unit tests plus, at most, a hand-inserted `contract_logs`
  row carrying a known hex. Any mismatch between our assumed encoding and the
  real one surfaces only after deployment.
- **Hex case must agree on both sides.** The parser writes lowercase hex;
  `decode(..., 'hex')` accepts either case, so the match survives a future
  uppercase writer, but `params->>'ref_hash'` compared as text would not. The
  matching statements therefore compare decoded bytes, never text.
- **`params->>'id'` is text.** Rule B joins `WireInAssigned` to `WireIn` on the
  JSON text of `id`, which is exact for integers rendered without padding — the
  parser writes `id` as a JSON number, so `->>` yields a canonical decimal
  string on both sides. A future writer that zero-pads or stringifies `id`
  differently would break the join silently.
- **One wire, one deposit, by construction.** `ref_hash` is `UNIQUE` in
  `lp_bank_deposits` and single-use on-chain (`consume_mint_ref` panics with
  `RefHashSeen`), so neither statement can touch two rows for one event.
- **No ordering guarantee between the two rules.** `WireInAssigned` may be
  indexed in the same batch as its `WireIn`, or many ledgers later; both
  statements are re-run every tick and `NOT d.is_minted` makes a repeat a
  no-op, so order never matters and nothing needs to be remembered between
  ticks.

## Decisions

1. **No new columns on `lp_bank_deposits`.** The join key is `ref_hash` itself,
   so the log row — with the wire `id`, `tx_hash` and ledger — is always one
   query away. Storing them on the deposit duplicates indexed data.
2. **No outbox.** The yield-mint phase needs one because it submits
   transactions and must survive a crash mid-flight. This phase submits
   nothing: it is two idempotent `UPDATE`s over already-durable rows.
3. **The amount is not verified.** PLUSD's scale is pinned nowhere — we store
   dollars as `NUMERIC(20,2)`, the contract takes raw `i128` — so a comparison
   would be guesswork dressed as a safety check. The phase logs both figures
   side by side and does not gate on them. Pinning the scale belongs with the
   mint-submission work.
4. **`WireInAssigned.receiver` is recorded, not checked** against the LP's
   linked address. The check needs a wallet-to-LP mapping this issue does not
   otherwise touch.
5. **Matching is scoped by `chain_id` and `contract_address`** on the
   `contract_logs` side. The contract scope earns its keep on a redeploy: the
   previous deployment's `WireIn` rows carry the *old* minter as `receiver`, so
   Rule A's `receiver <> minter` test would otherwise be true for all of them and
   would mark every escrowed deposit of that deployment minted. Note the limit —
   `lp_bank_deposits` has no chain column, so the deposit side is not scoped at
   all (TD-117).
6. **`WireInReturned` is deferred** per the issue. The cost is a blind spot:
   a returned wire keeps `is_minted = false` and is indistinguishable from one
   still awaiting assignment. Logged as tech debt in step 7, not fixed here.

## Open Questions

None. The escrow semantics, the deferral of `WireInReturned`, and the
no-verification decisions were settled on the issue before planning.

## Implementation Steps

### 1. `indexer::config` — the contract id

Nothing to add: `yield_minter_id` already carries this contract's id, is already
in the distinctness check, and already reaches the RPC `contractIds` filter.
Only its doc comment changes, to record that one id now covers two event
families (pre-#33 `YieldMinted`, post-#33 `WireIn`/`WireInAssigned`).

**Ruling (2026-10-06):** an earlier pass added a separate `MINTER_ID` key and a
relayer-scoped variant of it. Both are removed. The two keys were two names for
one contract, and the distinctness check would have rejected a config that set
them to the same deployed address — while a config that set them apart would
have let Rule A mark escrowed wires minted. Cost if wrong: the env var is named
for the contract's former identity until the yield-minter retirement lands.

### 2. ScVal helpers

In `indexer/stellar/parsers.rs`, beside the existing helpers:

- `pub fn extract_address_from_map(b64: &str, key: &str) -> Option<String>` —
  the map walk from `extract_i128_from_map` with `ScVal::Address` and
  `sc_address_to_strkey`.
- `pub fn extract_bytes32_from_map(b64: &str, key: &str) -> Option<String>` —
  same walk, matching `ScVal::Bytes`, returning `hex::encode` of the payload
  **only when it is exactly 32 bytes long**; `None` otherwise.

### 3. `parse_wire_in`

Matches `raw.event_name == "wire_in"`, requires at least two topics, reads
`id` from `topics_base64[1]` via `extract_u32`, then `receiver`, `amount`,
`value_date`, `ref_hash` from the value map. Emits `StellarLog` with
`event_name = "WireIn"` and

```json
{"id": 7, "receiver": "C…", "amount": "50000000000", "value_date": "1790000000", "ref_hash": "72c1…"}
```

Amounts and timestamps as decimal strings, matching `parse_yield_minted`'s
`s_plusd_amount` convention; `ref_hash` lowercase hex.

### 4. `parse_wire_in_assigned`

Same shape, `wire_in_assigned`, `event_name = "WireInAssigned"`,
`params = {"id", "receiver"}`.

### 5. Routing

No new branch: the existing `yield_minter_id` branch tries all three parsers in
order — `parse_yield_minted`, then `parse_wire_in`, then `parse_wire_in_assigned`.
Each matches its own event name, and no deployment emits both families, so the
order is safe.

### 6. `LpBankDepositRepo` — the two matching statements

Add to `packages/shared/src/lp_bank_deposit_repo.rs`:

```rust
pub async fn mark_minted_direct(&self, chain_id: i64, minter_id: &str) -> Result<u64, sqlx::Error>
pub async fn mark_minted_assigned(&self, chain_id: i64) -> Result<u64, sqlx::Error>
pub async fn count_unmatched_wire_ins(&self, chain_id: i64) -> Result<i64, sqlx::Error>
```

carrying Rule A, Rule B and the observability count from the issue body
verbatim, each returning `rows_affected` (or the count). A seam trait
`WireInMatcher` with these three methods lets the phase be unit-tested with an
in-memory implementation, the way `OutboxStore` is.

### 7. Relayer phase

New `packages/worker/src/relayer/stellar/wire_in_match.rs`:
`phase_match_wire_ins(matcher: &dyn WireInMatcher, chain_id: i64, minter_id: &str)`
runs the two statements, sums the affected rows, reads the unmatched count, and
logs one line per tick: matched-direct, matched-assigned, unmatched. Wire it
into `run_stellar_relayer_inner` behind `if let Some(minter_id) = settings.minter_id`,
mirroring how Phase 4 is gated. `StellarRelayerSettings.minter_id` reads the
indexer's `CHAIN_<id>_STELLAR_YIELD_MINTER_ID` — the phase interprets rows that
indexer wrote, so the two can never be configured apart.

### 8. Tech debt

Add `TD-116` to `docs/exec-plans/tech-debt-tracker.md` (bump "Next free
number"): a returned escrow wire is indistinguishable from one awaiting
assignment, because `WireInReturned` is not indexed; suggested fix is the third
parser plus a terminal state on the deposit.

### 9. Docs

Update the Stellar-indexer section of the relevant `docs/` page with the new
contract and the two events, and note the new env var where the other
`CHAIN_<id>_STELLAR_*` keys are documented.

### 10. Lint

`cargo fmt --all`, `cargo clippy --all -- -D warnings`, `cargo test --all`,
`npx tsx scripts/lint-docs.ts`.

## Test Strategy

Pure unit tests, no database, no env-var gates.

### `packages/worker/tests/stellar_minter_parsers.rs` (new)

Fixtures built with the existing `encode_symbol` / map encoders, extended with
a `ScVal::Bytes` encoder:

- `wire_in` happy path — all five fields land in `params`, `ref_hash` is 64
  lowercase hex chars, `event_name` is `WireIn`, `log_index` is synthesised.
- `wire_in_assigned` happy path.
- A foreign event name returns `None` from both parsers.
- One topic only (no `id`) returns `None`.
- `ref_hash` absent, 31 bytes, and 33 bytes each return `None` — the length
  check is the point, since a silent truncation would produce a hash that
  matches nothing and looks like a missing deposit.
- A `receiver` that is an `Account` (`G…`) and a `Contract` (`C…`) both decode.

### `packages/worker/tests/stellar_config.rs` (edited)

`minter_id` present and absent; present-but-equal-to-another-contract-id trips
the distinctness check; the id reaches the `contractIds` filter.

### `packages/worker/tests/stellar_wire_in_match.rs` (new)

Against an in-memory `WireInMatcher`:

- Direct wire flips one deposit; a second run flips nothing (idempotence).
- An escrowed wire alone flips nothing; adding its `WireInAssigned` flips it.
- A `WireIn` whose hex matches no deposit flips nothing and raises the
  unmatched count.
- The phase's log line reports all three figures.

The SQL itself is not unit-testable under the repo's no-database rule, so the
statements are reviewed against the schema and exercised by hand once the
minter is deployed. This is the known gap in this plan's coverage.

## Progress

- [ ] 1. Contract id in indexer config
- [ ] 2. ScVal helpers
- [ ] 3. `parse_wire_in`
- [ ] 4. `parse_wire_in_assigned`
- [ ] 5. Routing
- [ ] 6. Repo statements + seam trait
- [ ] 7. Relayer phase
- [ ] 8. Tech debt
- [ ] 9. Docs
- [ ] 10. Lint
