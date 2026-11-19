# User story: #2074 — Trustee: EVM repayment recovery list falls back to the legacy repayment() view

**Epic:** #1937
**Issue:** https://github.com/eq-lab/pipeline/issues/2074
**Status:** Initial

---

## Overview

The EVM repayment-recovery list (#1943) reads each repayment's stored Minter record. The Hoodi Minter (source `f92d719`) has the legacy `repayment(uint256,uint256)` view and no `extsload`, so the client now calls the view first and reads `extsload` only when the view reverts with empty data (a `150631a` Minter). Spec: `docs/frontend/trustee-flows.md#repayment-recovery-1711` (section "EVM"), `docs/frontend/wallet-flows.md#trustee-evm-contract-client`, `docs/product-specs/loan-repayment-recovery.md`.

Persona: Risk Council member on the Trustee console, signed in on the Hoodi EVM chain. The story needs an EVM loan with at least one recorded repayment, which Hoodi does not have until the first `Minter.repay` (#1574 flow). It runs in the epic QA pass #1945 once that repayment exists. The Stellar loan flow is the regression reference and does not change.

---

## Story 1 — The recovery dialog lists repayments on the Hoodi Minter

**Given** an eligible EVM loan on Hoodi (offtaker fully paid, senior principal outstanding, status `Performing`..`Default`) with at least one recorded repayment

**When** the member opens the "Repayment recovery" dialog from the loan detail page

**Then:**

- The dialog lists the repayments and does not show "Failed to load the repayments."
- Each row shows the cash, the fee shares and the principal (the amount `Pocket.unrelease` restores) and the carved-out state, read from the Minter's `repayment` record
- The Network tab shows `eth_call` for `repayment(uint256,uint256)` and no `extsload` call

---

## Story 2 — A loan with no repayments still shows an empty list

**Given** an eligible EVM loan whose `nextRepaymentId` is `0`

**When** the member opens the dialog

**Then:**

- The dialog shows its empty state, with no log scan and no Minter read

---

## Story 3 — A genuine Minter error is surfaced, not hidden

**Given** the configured `VITE_EVM_MINTER_ADDRESS` points at an address with no Minter code

**When** the member opens the dialog

**Then:**

- The dialog shows "Failed to load the repayments." with the details, and no fabricated row
