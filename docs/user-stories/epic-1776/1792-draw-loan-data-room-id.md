# User story: #1792 — Loan submission: data_room_id → borrower_ref and the HEAD draw_loan inputs

**Epic:** #1776
**Issue:** https://github.com/eq-lab/pipeline/issues/1792
**Status:** Initial

---

## Overview

`POST /v1/loan-book/loan` and `POST /v1/loan-book/submissions/{id}/resubmit` accept an optional `data_room_id`. `to`, `initial_ccr` and `initial_location` are optional, deprecated and no longer validated. `GET /v1/loan-book/submissions` and the two POST responses serve a contract-ready `draw_loan` block for Stellar-target submissions. Spec: `docs/product-specs/api-authorization-loan-submission.md#draw_loan-arguments`.

Persona: operator. Every step is a shell step (`curl`, `jq`, the `stellar` CLI) against pipeline-test after the deploy. `$API` is `https://api.pipeline.stage.eqlab.net`; `$STELLAR` is the Stellar chain id (`99000001`); `$TOKEN` is an `originator` JWT; `$BODY` is a valid submission body without `to`, `initial_ccr` and `initial_location` and with `"data_room_id": "  DR-0001 "`.

---

## Story 1 — A submission with a data-room id serves a contract-ready block

**Given** the Stellar target `$STELLAR`

**When** the operator runs `curl -s -X POST "$API/v1/loan-book/loan?chain_id=$STELLAR" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "$BODY"` and then `curl -s "$API/v1/loan-book/submissions?chain_id=$STELLAR" | jq '.[0]'`

**Then:**

- The POST returns `201` with `id` and a `draw_loan` block
- `draw_loan.economics.borrower_ref` equals `printf 'DR-0001' | shasum -a 256` (64 lowercase hex, no `0x`)
- `draw_loan.missing_inputs` is `[]`
- `loan_data.data_room_id` is `"DR-0001"` (trimmed) and `loan_data` has no `to`, `initial_ccr` or `initial_location` keys
- The block served by GET equals the one returned by POST

---

## Story 2 — Units match the contract

**Given** the submission from Story 1 with economics `100000.000000` / `80000.000000` / `20000.000000` / `105000.000000`, `senior_interest_rate_bps` `1200`

**When** the operator reads `jq '.draw_loan.economics'`

**Then:**

- `original_facility_size` is `"1000000000000"`, `original_senior_tranche` `"800000000000"`, `original_equity_tranche` `"200000000000"`, `original_offtaker_price` `"1050000000000"` (plain integer strings, no exponent)
- `senior_interest_rate` is `120000` and the dates equal the submitted unix seconds
- The 8 keys are exactly `borrower_ref`, `original_facility_size`, `original_senior_tranche`, `original_equity_tranche`, `original_offtaker_price`, `senior_interest_rate`, `origination_date`, `original_maturity_date`

---

## Story 3 — A legacy row without a data-room id reports it as missing

**Given** a submission created before this change (no `data_room_id`)

**When** the operator reads its `draw_loan` from `GET /v1/loan-book/submissions`

**Then:**

- `draw_loan.economics.borrower_ref` is `null`
- `draw_loan.missing_inputs` is `["data_room_id"]`
- The other economics fields are populated

---

## Story 4 — Legacy request fields are still accepted and stored

**Given** a body that still carries `to`, `initial_ccr: 0` and an `initial_location` with `location_type: "Moon"`

**When** the operator POSTs it

**Then:**

- The response is `201`
- `loan_data` in `GET /v1/loan-book/submissions` carries `to`, `initial_ccr` and `initial_location` verbatim
- `draw_loan` has none of those fields

---

## Story 5 — EVM targets get no block

**Given** an EVM target chain id `$EVM`

**When** the operator submits to `$EVM` and reads `GET /v1/loan-book/submissions?chain_id=$EVM`

**Then:**

- The POST response carries `"draw_loan": null`
- Each item's `draw_loan` is `null` and its other fields are unchanged

---

## Story 6 — The served block simulates on testnet

**Given** the Story 1 block and a delay-0 trustee `G…` from the testnet `access.trustee` list

**When** the operator encodes `[scvString(metadata_uri), scMap(economics)]` and simulates `access_manager.execute(loan_registry, "draw_loan", args, trustee)` without submitting

**Then:**

- The simulation succeeds and returns a `u32` loan id
