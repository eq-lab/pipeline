# User Stories: #1878 — Backend: seed per-holder PLUSD balances (Stellar SAC) so plusd_balance can be enabled on testnet / mainnet

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1878](https://github.com/eq-lab/pipeline/issues/1878)
Spec: [docs/product-specs/lp-total-balance.md](../../product-specs/lp-total-balance.md), [docs/references/backend.md](../../references/backend.md#plusd-balance-seed)

API-level stories for `GET /v1/positions/history` on a Stellar chain, plus the operator acceptance that gates setting `CHAIN_<id>_STELLAR_API_PLUSD_ADDRESS`. There is no UI in this issue; #1282 and #1629 render the gap before the PLUSD bound. The pure-compute behavior is also covered by automated tests (listed at the end).

---

## Story 1: A seeded wallet gets `plusd_balance` from the coverage bound

**Persona:** Stellar LP viewing the home graph.

**Pre-conditions:** The Stellar indexer PLUSD key is set and the worker has been running; the wallet has a row in `plusd_balance_seeds`; the API key is set on a local API.

**Steps:**

1. `GET /v1/positions/history?wallet=<G…>&chain_id=<id>`.

**Expected outcomes:**

- From the bucket that contains the chain's earliest indexed `PlusdTransfer` (`C`), every item has `plusd_balance`. For an `initial` seed, a bucket before the seed equals `seed − Σ(rows in (bucket close, seed ledger])`; later buckets fold the rows after the seed.
- The last item equals `balance(W) / 10^7` rounded down to 6 places when the wallet has not moved since the seed.

---

## Story 2: Buckets before the bound carry no `plusd_balance`, and no `total_balance` when PLUSD was held at the bound

**Steps:**

1. Request the history of a seeded wallet with positions that start before `C`, and whose PLUSD at `C` is non-zero.

**Expected outcomes:**

- Items before the bucket of `C` have no `plusd_balance` and no `total_balance`, while `splusd_value` is present. The response's `total_balance` stat is absent and its `splusd_value` stat is present.
- For a wallet whose PLUSD at `C` is zero, those items keep `total_balance = splusd_value + wire_out_escrow?` and the stat is present, with no step at the bound.

---

## Story 3: An inconsistent back-compute starts at the seed and logs a warning

**Pre-conditions:** A wallet whose back-computed balance goes negative (a missed credit before the seed), or whose latest seed is a `reanchor`.

**Expected outcomes:**

- `plusd_balance` starts at the seed bucket; every earlier bucket, including those after `C`, has neither `plusd_balance` nor `total_balance`.
- The API logs `PLUSD back-computed balance inconsistent; pre-seed buckets incomplete` once for an `initial` seed. A `reanchor` seed logs nothing here, because the worker already warned.

---

## Story 4: An unseeded wallet carries no value

**Steps:**

1. Request the history of a Stellar wallet with no `plusd_balance_seeds` row, with the API key set.

**Expected outcomes:**

- No `plusd_balance` on any item; `total_balance` equals the #1865-without-the-key value. Setting the key is therefore safe while seeding is still running. The same holds for a seed whose ledger the indexer cursor has not passed yet.

---

## Story 5: A drift re-anchors the wallet

**Pre-conditions:** A seeded wallet whose PLUSD changed by a movement that the indexer did not store (for example a classic payment not reported by `getEvents`).

**Steps:**

1. Wait for the next verify check of the holder (one per holder every 6 h, up to 10 per minute).

**Expected outcomes:**

- The worker logs `PLUSD balance drift; re-anchoring seed` with the holder, ledger, expected, actual and difference, and inserts a `reanchor` row `(balance(W), ledger)`.
- The API then matches `balance(W)` again; earlier buckets lose `plusd_balance` (and `total_balance` when non-zero at the new bound).

---

## Story 6: Acceptance before the API key is set (operator)

**Pre-conditions:** Worker deployed on 99000001 with the indexer key set; the API key unset.

**Steps:**

1. SAC errors (testnet): simulate `balance` for a `G…` with no PLUSD trustline and for an unfunded `G…`; confirm the error text contains `Error(Contract, #13)`. If not, adjust `is_no_balance_error` and record it. Confirmed on testnet 2026-11-10: both an unfunded `G…` and the funded friendbot account return `Error(Contract, #13)` ("trustline entry is missing for account") with `latestLedger` set.
2. Wait about 15 minutes; `SELECT kind, count(*) FROM plusd_balance_seeds WHERE chain_id = 99000001 GROUP BY 1` must cover the candidate count.
3. Wait one verify round; expect no `PLUSD balance drift` warning.
4. For at least 5 LP wallets with a non-zero balance: simulate `balance(W)` giving `(B, L')`, wait for the cursor to pass `L'`, and check that the seed plus the rows in `(as_of_ledger, L']` equals `B` exactly.
5. Run a local API against the same DB with the key set: the last bucket equals `B / 10^7` rounded down to 6 places; for a wallet with pre-seed movements, a bucket between `C` and the seed equals `seed − Σ(rows in (bucket close, L])` computed by hand from SQL; buckets before `C` show neither field when PLUSD at `C` is non-zero.
6. Classic events (testnet): send PLUSD between two whitelisted G-accounts with a classic payment and record in TD-175 whether a `PlusdTransfer` row appears. If it does not, wait for the next verify and expect a drift `warn` and a `reanchor` row, after which the API value matches `balance(W)`.
7. Only then set the key in eq-lab/argocd (99000002 follows the same procedure).

**Expected outcomes:**

- Every check passes; otherwise the key stays unset.

---

## Automated coverage

- `packages/shared/tests/plusd_seed_fold.rs`, `plusd_seed_sql.rs`, `migration_plusd_balance_seeds.rs`, `contract_logs_plusd_sql.rs`.
- `packages/worker/tests/stellar_plusd_seed.rs`.
- `packages/api/tests/positions_history_plusd_seed.rs`, `positions_history_plusd.rs`, `positions_history_composite.rs`.
