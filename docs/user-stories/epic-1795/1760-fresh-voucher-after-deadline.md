# User story: #1760 — fetch a fresh voucher once the served deadline has passed

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1760
**Status:** Initial

---

## Overview

A claim voucher is valid for 24 hours (`docs/user-docs/lenders/deposit.md`, `docs/user-docs/lenders/withdraw.md`). The API serves the signed `deadline` (u64 unix seconds, string) on Stellar only; EVM vouchers carry none (backend follow-up #1798). The LP app treats a voucher whose served deadline has passed as absent: Claim goes back to its pending state, the voucher is refetched, and the lender never sees a "no voucher" or failed state. Spec: `docs/product-specs/deposits.md#voucher-validity` and `docs/product-specs/withdrawals.md#voucher-validity`.

All checks use the real API on staging (Stellar testnet), no localStorage mocks. Open DevTools Network before starting.

---

## Story 1 — Returning to a Stellar deposit after the voucher expired

**Given** a Stellar wallet is connected and a deposit request is `PendingClaim` whose last served voucher `deadline` is in the past

**When** the lender opens the deposit page

**Then:**

- Network shows `GET /v1/deposits/{id}/voucher?wallet=<G…>&chain_id=<Stellar id>` returning a later `deadline` than the stale one
- While that request is in flight the steps card shows its existing loading state; Claim is never shown as failed or "no voucher"
- Once it returns, Claim PLUSD becomes actionable and the claim succeeds

---

## Story 2 — Returning to a Stellar withdrawal after the voucher expired

**Given** a Stellar wallet is connected and a withdrawal request is `PendingClaim` whose last served voucher `deadline` is in the past

**When** the lender opens the withdraw page

**Then:**

- Network shows a fresh `GET /v1/withdrawals/{id}/voucher?...` returning a later `deadline`
- Claim USDC shows its loading state, then becomes actionable and the claim succeeds

---

## Story 3 — Tab left open across the deadline

**Given** a Stellar request is `PendingClaim`, Claim is actionable and the served `deadline` is a few minutes away

**When** the lender leaves the tab open past the deadline

**Then:**

- At the deadline Network shows a new voucher `GET` with no user action
- Claim goes back to its pending state, then actionable again with the new voucher

---

## Story 4 — Claim rejected as expired is retried once

**Given** a Stellar claim is submitted with a voucher the chain rejects with `Error(Contract, #4)` (for example client clock behind ledger time)

**When** the simulation fails

**Then:**

- The app refetches the voucher once for that request id and the claim step returns to loading
- If the same request fails with `#4` again, the error "The voucher expired or did not match the request. Your app fetches a fresh voucher." stays visible and no further refetch happens
- A bad-signature host error (`Error(Crypto, InvalidInput)`) is not retried

---

## Story 5 — EVM is unchanged

**Given** an EVM wallet is connected and a deposit or withdrawal request is `PendingClaim`

**When** the voucher is served without a `deadline`

**Then:**

- Claim becomes actionable as before and the voucher is not refetched on a timer
- Nothing about the voucher validity is visible in the UI
