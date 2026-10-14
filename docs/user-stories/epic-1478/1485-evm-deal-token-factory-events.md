# User story: #1485 — EVM indexer records DealTokenFactory events and DEBT/CARGO movements

**Epic:** #1478 — Index the deal-token factory and its DEBT/CARGO tokens
**Issue:** https://github.com/eq-lab/pipeline/issues/1485
**Status:** Initial

---

## Overview

Backend-only change: no Figma reference, no UI. The EVM indexer writes `contract_logs`
rows for `PipelineDealTokenFactory`'s three deal events and for every DEBT/CARGO `Transfer`
of a registered deal. Verification is by inspecting `contract_logs` after the worker has
indexed the relevant blocks. All Rust coverage is pure unit tests — see
`packages/worker/tests/deal_token_parsers.rs`, `deal_token_registry.rs`,
`evm_dynamic_poll.rs`, `evm_deal_token_factory_config.rs`.
Specification: [backend.md](../../references/backend.md#evm-dealtokenfactory-1485).

---

## Story 1 — A registered deal appears in `contract_logs`

**Persona:** Operator running the worker with
`CHAIN_<id>_EVM_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS` set.

**Steps:** The factory owner calls `registerDeal` for a loan; wait for the worker to index
that block.

**Expected:**

- One `DealRegistered` row from the factory address with `params.loan_id` (decimal string),
  `params.debt` and `params.cargo` as checksummed addresses.
- The two token addresses are polled from the same cycle on, with no restart.

## Story 2 — Syncs are recorded as emitted, including no-ops

**Steps:** Anyone calls `syncDebt` and `syncCargo` for the loan, once with a change and once
with nothing to do.

**Expected:**

- `DebtSynced` rows carry `loan_id`, `target`, `previous`, `minted`, `clawed`; `CargoSynced`
  rows carry `loan_id`, `target`, `previous`, `minted`, `burned` (all decimal strings).
- The no-op sync is stored too, with `minted` and `clawed` / `burned` equal to `"0"`.

## Story 3 — Token movements become `DealTokenTransfer` rows

**Steps:** A sync mints DEBT, later claws part of it back, and CARGO is minted then burned.

**Expected:** `DealTokenTransfer` rows from the token's address with `params` keys exactly
`loan_id`, `token_kind`, `token`, `from`, `to`, `amount`:

- mint: `from` is JSON `null`, `to` is the holder;
- clawback / burn: `from` is the holder, `to` is JSON `null`;
- `token_kind` is `"debt"` or `"cargo"`; `amount` is raw at the 6-decimal scale;
- the sPLUSD vault's own `Transfer` logs never produce a `DealTokenTransfer` row.

## Story 4 — Mint in the registering block is not missed

**Steps:** In one transaction (or block), register a deal and sync its DEBT so a mint lands
beside the `DealRegistered`.

**Expected:** Both the `DealRegistered` row and the DEBT mint `DealTokenTransfer` row are
written, and the mint is ordered after nothing it depends on (lower `log_index` than its
`DebtSynced`).

## Story 5 — The token set survives a restart

**Steps:** Restart the worker after Story 1, then move DEBT again.

**Expected:** The deal's tokens are seeded from the existing `DealRegistered` rows at startup
and the new movement is recorded.

## Story 6 — Ships dark when unset

**Steps:** Start the worker with the key unset or blank.

**Expected:** No factory or token addresses in `eth_getLogs`, no seed query, no
`DealRegistered` / `DealTokenTransfer` rows. A malformed address fails startup with an error
naming `DEAL_TOKEN_FACTORY_ADDRESS`.

## Story 7 — Known limitation: deals registered before the indexer saw them

**Steps:** Register a deal, then start indexing from a block after the registration.

**Expected:** The deal's tokens are not tracked and no rows are written for them. Rewinding
the cursor to before the registration re-indexes the `DealRegistered` and tracking begins.
