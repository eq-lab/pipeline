# User story: #1793 — Delete the Stellar yield-mint relayer (Phase 4); rename yield_minter_id to minter_id

**Epic:** #1776
**Issue:** https://github.com/eq-lab/pipeline/issues/1793
**Status:** Initial

---

## Overview

The Stellar relayer no longer runs the yield-mint phase: `minter.repay` mints interest and fees in the same call, and `mint_yield` / `can_yield_be_minted` no longer exist on the contracts. The `yield_mint_outbox_repo` module is deleted. The `yield_mint_outbox` table and its `confirmed` rows stay, because the legacy part of `minted_yield` still reads them. The indexer's minter field is renamed to `minter_id` (Rust only; the env key is unchanged). Spec: `docs/references/backend.md` (section "No Stellar yield-mint phase").

Checks run on pipeline-test (Stellar testnet 99000001) against the worker log and `GET /v1/loan-book/{loan_id}/financials`.

---

## Story 1 — The relayer boots and phase 4 is gone

**Given** the worker runs this change on testnet with `CHAIN_99000001_RELAYER_STELLAR_YIELD_MINTER_ID` and `CHAIN_99000001_RELAYER_STELLAR_LOAN_REGISTRY_ID` still set

**When** the worker starts

**Then:**

- The worker boots even if a legacy value is malformed
- The log has one `deprecated Stellar relayer env vars are set and ignored` warning for chain 99000001, naming both keys
- The log has no `stellar yield-mint phase` line and no `phase_yield_mint` error, on any cycle

---

## Story 2 — No warning once the keys are removed

**Given** both legacy keys are removed from the deployment

**When** the worker restarts

**Then:** the log has no deprecation warning

---

## Story 3 — A repayment no longer creates outbox work

**Given** the worker runs this change

**When** `minter.repay` records a payment with interest or fees on testnet

**Then:**

- No new `yield_mint_outbox` row appears for it
- The worker log has no `mint_yield` simulation error

---

## Story 4 — Minted yield is unchanged

**Given** a loan with `confirmed` legacy rows in `yield_mint_outbox`

**When** `GET /v1/loan-book/{loan_id}/financials` is called before and after the deploy

**Then:** `minted_yield` is identical

---

## Story 5 — Wire-in matching still runs

**Given** `CHAIN_99000001_STELLAR_INDEXER_MINTER_ADDRESS` is set

**When** a wire-in is indexed for a recorded bank deposit

**Then:**

- The log shows `stellar wire-in matching phase enabled`
- The deposit is marked minted as before
