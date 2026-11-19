# User story: #1547 — Waterfall caps fees at the registry's max_fee_bps

**Epic:** #2129
**Issue:** https://github.com/eq-lab/pipeline/issues/1547
**Status:** Initial

---

## Overview

The Trustee repayment waterfall (`GET /v1/loan-book/{loan_id}/waterfall`) caps the fee carve-outs at the LoanRegistry's live `max_fee_bps`, read on-chain by the worker, instead of an assumed 5000. Spec: `docs/references/backend.md#loanregistry-settings-sync` and `docs/product-specs/yield.md` (Waterfall components).

Persona: Trustee recording a repayment on `/loans/:id`.

---

## Story 1 — Registry value is synced

**Given** the worker has synced `max_fee_bps = 5000` for the chain's LoanRegistry

**When** the Trustee requests a waterfall suggestion for a loan

**Then:**

- The suggestion's `management_fee + performance_fee + oet_allocation` never exceeds `floor((senior_coupon_net + management_fee + performance_fee) × 5000 / 10000)`
- The components sum to `amount`

---

## Story 2 — Admin lowers max_fee_bps

**Given** an admin has set the registry's `max_fee_bps` to `2000` and the worker has completed its next 60 s sync

**When** the Trustee requests a suggestion for a loan whose fees were capped at 5000

**Then:**

- The fee carve-outs are capped at 20% of the interest pool
- The suggestion's fee total is lower than it was at 5000

---

## Story 3 — Value not synced yet

**Given** no `loan_registry_settings` row exists for the chain's LoanRegistry (before the first worker sync, or an address mismatch)

**When** the Trustee requests a waterfall suggestion

**Then:**

- The API answers `503` with a message that `max_fee_bps` is not synced yet
- The Trustee sees the generic error state and can retry after the worker's first sync (at most 60 s)
