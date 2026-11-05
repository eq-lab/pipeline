# User story: #1791 — Withdrawal queue: index the recovery rate; serve queue offsets, aggregates and rate-scaled USD

**Epic:** #1776
**Issue:** https://github.com/eq-lab/pipeline/issues/1791
**Status:** Initial

---

## Overview

The worker indexes the Stellar WithdrawalQueue `rate_set` event as `WithdrawalRateSet`. `GET /v1/requests` serves `queued_through` and `usdc_paid` on Stellar `Withdraw` rows, and `GET /v1/withdrawal-queue` serves `total_queued`, `total_claimed` and `rate` and values `in_queue_usd` at the queue's recovery rate. Spec: `docs/product-specs/withdrawals.md#stellar-queue-read-model-1791`.

Persona: operator. Every step is a shell step (`curl`, `jq`, the `stellar` CLI) against pipeline-test after the deploy. `$WQ` is the testnet WithdrawalQueue `CBVXURJRF3DG7MBBLQZ4NTJ7K5MT2LJW3HA4LDW3XUMSPC4PROSNXFYQ`; `$API` is `https://api.pipeline.stage.eqlab.net`; `$G` is any funded `G…` for `--source-account`.

---

## Story 1 — A testnet `rate_set` is indexed and audit-logged

**Given** a disposable WithdrawalQueue whose owner calls `set_rate(850000)` (the live `$WQ` must not enter shutdown without a human decision; mark this story N/A when no disposable queue exists)

**When** the worker has indexed the ledger and the operator reads `GET $API/v1/audit-log?chain_id=99000001`

**Then:**

- An item with `event_name = "WithdrawalRateSet"` has `action = "Withdrawal recovery rate set — 0.850000"`, `scope.label = "Protocol"` and `details.new_rate = "850000"`

---

## Story 2 — Served totals and rate match the on-chain views

**Given** `$WQ` and the API's `CHAIN_99000001_API_STELLAR_WQ_CONTRACT_ID` set to the same id

**When** the operator runs `stellar contract invoke --id $WQ --source-account $G --network testnet --send=no -- {rate,total_queued,total_claimed}` and `curl -s "$API/v1/withdrawal-queue?chain_id=99000001" | jq .summary`

**Then:**

- `summary.rate` equals `rate()` (`"1000000"` while no rate is set)
- `summary.total_queued` equals `total_queued() / 10` to 6 decimals
- `summary.total_claimed` equals `total_claimed() / 10` to 6 decimals
- The 2026-11-03 baseline is `"1000000"`, `"3187.500000"` and `"2250.000000"` if nothing moves

---

## Story 3 — `queued_through` matches `withdrawal_request_queued(id)`

**Given** a Stellar wallet `$W` with a withdrawal request `<id>` on `$WQ`

**When** the operator runs `curl -s "$API/v1/requests?wallet=$W&chain_id=99000001" | jq '.requests[] | select(.type=="Withdraw")'` and `stellar contract invoke --id $WQ --source-account $G --network testnet --send=no -- withdrawal_request_queued --request_id <id>`

**Then:**

- `queued_through` equals the on-chain value, and `queued_through - amount` is the PLUSD queued ahead of the request
- A claimed request also carries `usdc_paid`; with no `WithdrawalRateSet` it equals `amount`
- Unclaimed requests carry no `usdc_paid`

---

## Story 4 — EVM responses are unchanged

**Given** the Hoodi chain `560048` on pipeline-test

**When** the operator compares `GET $API/v1/withdrawal-queue?chain_id=560048` and `GET $API/v1/requests?wallet=<0x…>&chain_id=560048` before and after the deploy

**Then:**

- Every existing field has the same value
- `summary.total_queued`, `summary.total_claimed` and `summary.rate` are `null`
- No `queued_through` or `usdc_paid` key appears on any request row

---

## Story 5 — A local stack without the WQ key serves null totals and a fallback rate

**Given** a local API with `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` unset on a Stellar chain

**When** the operator runs `curl -s "http://localhost:3000/v1/withdrawal-queue?chain_id=<id>" | jq .summary`

**Then:**

- `total_queued` and `total_claimed` are `null`
- `rate` is the latest `WithdrawalRateSet` on the chain, or `"1000000"` when none exists
- The API booted without a warning-level failure; a malformed key value logs a warning and behaves as unset
