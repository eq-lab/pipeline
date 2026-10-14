# User story: #1482 — Stellar indexer records deal-token-factory events and DEBT/CARGO movements

**Epic:** #1478 — Index the deal-token factory and its DEBT/CARGO tokens
**Issue:** https://github.com/eq-lab/pipeline/issues/1482
**Status:** Initial

---

## Overview

Backend-only change: no Figma reference, no UI. The Stellar indexer writes `contract_logs`
rows for the deal-token factory's three events and for every DEBT/CARGO token movement of a
registered deal. Verification is by inspecting `contract_logs` after the worker has indexed
the relevant ledgers. All Rust coverage is pure unit tests — see
`packages/worker/tests/stellar_deal_token_parsers.rs`, `stellar_rpc.rs`, `stellar_config.rs`.
Specification: [backend.md](../../references/backend.md#stellar-deal-token-factory-indexing).

---

## Story 1 — A registered deal appears in `contract_logs`

**Persona:** Operator running the worker with
`CHAIN_<id>_STELLAR_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS` set.

**Steps:** The factory owner calls `register_deal` for a loan; wait for the worker to index
that ledger.

**Expected:**

- One `DealRegistered` row from the factory address with `params.loan_id` (decimal string),
  `params.debt` and `params.cargo` as `C…` contract ids.
- The two token ids are polled from the same or next poll cycle on, with no restart.

## Story 2 — Syncs are recorded as emitted, including no-ops

**Steps:** Anyone calls `sync_debt` and `sync_cargo` for the loan, once with a change and once
with nothing to do.

**Expected:**

- `DebtSynced` rows carry `loan_id`, `target`, `previous`, `minted`, `clawed`; `CargoSynced`
  rows carry `loan_id`, `target`, `previous`, `minted`, `burned` (all decimal strings).
- The no-op sync is stored too, with `minted` and `clawed` / `burned` equal to `"0"`.

## Story 3 — Token movements become `DealTokenTransfer` rows

**Steps:** A sync mints DEBT, later claws part of it back, and CARGO is minted then burned.

**Expected:** `DealTokenTransfer` rows from the token's contract address with `params` keys
exactly `loan_id`, `token_kind`, `token`, `from`, `to`, `amount`:

- mint: `from` is JSON `null`, `to` is the holder;
- clawback / burn: `from` is the holder, `to` is JSON `null`;
- transfer: both set;
- `token_kind` is `"debt"` or `"cargo"`; `amount` is raw at the 7-decimal SAC scale.

## Story 4 — The token set survives a restart

**Steps:** Restart the worker after Story 1, then move DEBT again.

**Expected:** The deal's tokens are seeded from the existing `DealRegistered` rows at startup
and the new movement is recorded.

## Story 5 — Ships dark when unset

**Steps:** Start the worker with the key unset or blank.

**Expected:** No factory or token polling, no seed query, no `DealRegistered` /
`DealTokenTransfer` rows. A malformed or role-duplicating address fails startup with an error
naming `DEAL_TOKEN_FACTORY_ADDRESS`.

## Story 6 — Known limitation: deals registered before the indexer saw them

**Steps:** Register a deal, then start indexing from a ledger after the registration.

**Expected:** The deal's tokens are not tracked and no rows are written for them. Rewinding
the cursor to before the registration (within RPC retention) re-indexes the `DealRegistered`
and tracking begins.
