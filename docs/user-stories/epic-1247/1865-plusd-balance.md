# User Stories: #1865 — Backend: index PLUSD token movements and serve the LP's PLUSD balance history

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1865](https://github.com/eq-lab/pipeline/issues/1865)
Spec: [docs/product-specs/lp-total-balance.md](../../product-specs/lp-total-balance.md), [docs/references/backend.md](../../references/backend.md#plusd-transfer-indexing)

API-level stories for `GET /v1/positions/history`. There is no UI in this issue; #1282 and #1629 bind the fields. Run them with `curl` against a live API and a seeded wallet; the pure-compute behavior is also covered by automated tests (listed at the end).

---

## Story 1: Each bucket carries the PLUSD held and it is part of the total

**Persona:** LP viewing the home graph.

**Pre-conditions:** A chain with `CHAIN_<id>_<EVM|STELLAR>_API_PLUSD_ADDRESS` set and indexing covering PLUSD from its deployment. The wallet claimed a deposit (mint), staked, and unstaked part of it.

**Steps:**

1. `GET /v1/positions/history?wallet=<wallet>&chain_id=<id>&days=7`.

**Expected outcomes:**

- Every `history[]` item has `plusd_balance`, a 6-decimal plain string rounded down, equal to the wallet's PLUSD at the bucket close: a claim adds, a stake subtracts, an unstake adds.
- Each `total_balance` equals `splusd_value + wire_out_escrow? + plusd_balance`.
- A wire-out request lowers `plusd_balance` and raises `wire_out_escrow` by the same amount, so `total_balance` does not move; a cancel reverses it.
- The response `total_balance` stat includes PLUSD.
- On an EVM chain, an EVM `WireOutRequested` shows in `wire_out_escrow` and a settle or cancel closes it, so `total_balance` stays continuous (cancel returns the PLUSD to `plusd_balance`).

---

## Story 2: Without the API key the term is absent

**Steps:**

1. Request the history on a chain with no `…_API_PLUSD_ADDRESS` (Stellar 99000001 and 99000002 until TD-175 lands).

**Expected outcomes:**

- No `plusd_balance` key on any item. `total_balance` equals the #1313 value.

---

## Story 3: A broken fold omits the term for the whole response

**Pre-conditions:** A wallet whose indexed PLUSD rows fold below zero (history missed before the cursor), or an unparseable amount.

**Steps:**

1. Request the history for the wallet.

**Expected outcomes:**

- 200, with no `plusd_balance` on any item and `total_balance` without the PLUSD term. The API logs `PLUSD balance fold failed; omitting plusd_balance`.

---

## Story 4: A wallet with only PLUSD has a history

**Steps:**

1. Request the history, with `days` omitted, for a wallet that received PLUSD but never held sPLUSD.

**Expected outcomes:**

- `history` is dense from the day of the first PLUSD movement; items show `shares_balance: "0"`, `splusd_value: "0.000000"` and the PLUSD in `plusd_balance` and `total_balance`.
- `vault_address` is present.

---

## Story 5: EVM acceptance against the chain

**Persona:** Operator enabling the term on an EVM chain.

**Pre-conditions:** `CHAIN_<id>_EVM_INDEXER_PLUSD_ADDRESS` set, the shared cursor rewound to the PLUSD deploy block, the indexer caught up, then the API key set.

**Steps:**

1. Pick a wallet `W` and let `N = last_indexed_block − 1`.
2. `cast call $PLUSD "balanceOf(address)(uint256)" $W --block $N`.
3. Fold `W`'s `PlusdTransfer` rows with `block_number <= N` (incoming minus outgoing, raw `amount`).
4. Request the history and read the last `plusd_balance`.

**Expected outcomes:**

- The raw DB fold equals `balanceOf` exactly.
- The last `plusd_balance` equals that value rounded down to 6 places, provided `W` has no movement after `N`.
- The sum of all holders' folds equals `totalSupply()` at `N`.

---

## Story 6: Stellar parser acceptance (testnet, local API only)

**Pre-conditions:** A fresh testnet wallet whose first PLUSD movement happens after `CHAIN_99000001_STELLAR_INDEXER_PLUSD_ADDRESS` is set on a local worker. A local API with the matching `…_API_PLUSD_ADDRESS`. The shared testnet API key stays unset.

**Steps:**

1. Run: deposit claim, stake, wire-out request, wire-out cancel.
2. After each step, simulate the SAC `balance(W)`; the result carries `latestLedger L`. Wait until the indexer cursor is past `L`.
3. Compare the DB fold of `W`'s rows with `block_number <= L` to the balance.
4. Send PLUSD between two whitelisted testnet G-accounts with a classic payment and check that a `PlusdTransfer` row appears (CAP-67). If it does not, record it in TD-175.

**Expected outcomes:**

- The DB fold equals `balance(W)` exactly after every step.
- The classic payment appears as a `transfer` row, with `B…`, `L…` or base `G…` strkeys for non-account counterparties.

---

## Automated coverage

- `packages/worker/tests/stellar_plusd_parsers.rs`, `stellar_plusd_config.rs`, `evm_plusd_transfers.rs`, `stellar_deal_token_parsers.rs` (shared decoder).
- `packages/shared/tests/contract_logs_plusd_sql.rs`, `migration_plusd_transfer_index.rs`.
- `packages/api/tests/positions_history_plusd.rs`, `positions_history_composite.rs`, `chains_config.rs`, `analytics_pnl_positions_chain.rs`.
