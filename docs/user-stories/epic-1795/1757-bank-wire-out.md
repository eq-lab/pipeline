# User story: #1757 — request a bank wire-out and follow its status

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1757
**Status:** Initial

---

## Overview

A lender with a passed KYB can request a bank wire-out of an amount of PLUSD from the withdraw page. The PLUSD moves into escrow in the Minter. The Trustee settles the request (the PLUSD is burned) or cancels it (the PLUSD returns). The lender cannot cancel. Each request is listed with its on-chain status. Spec: `docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app`; behaviour source `docs/user-docs/lenders/withdraw.md`.

Checks use the real API and chain on staging (Stellar testnet first, Hoodi once `VITE_EVM_MINTER_ADDRESS` is set), no localStorage mocks. Open DevTools Network before starting. Before Story 1, confirm the Minter's `addresses_config().plusd` equals the PLUSD asset the lender sees.

---

## Story 1 — Request on Stellar

**Given** a signed-in lender with `kyb_status` Passed, a connected Stellar wallet authorised for PLUSD and a PLUSD balance

**When** the lender opens `/deposit?direction=withdraw`, presses "Request bank wire-out", enters an amount and presses Request

**Then:**

- The modal shows one step, "Request wire-out", with the escrow hint
- One wallet signature is requested; Network shows `simulateTransaction` and `sendTransaction` for `request_wire_out`
- A toast "Wire-out of {amount} PLUSD requested" appears, the modal closes and the PLUSD balance drops by the amount
- "Your bank wire-outs" shows a row "Withdraw funds" with `−{amount} PLUSD` and "Bank transfer · Pending"

---

## Story 2 — Request on EVM

**Given** the same lender with an EVM wallet holding PLUSD

**When** the lender requests a wire-out

**Then:**

- The modal shows "Allow Pipeline to use PLUSD" then "Request wire-out"; Request stays disabled until the approval is confirmed
- Approve, then Request, each need one signature; the row appears as Pending

---

## Story 3 — The row persists after reload

**Given** a request was submitted and the audit log now serves it

**When** the lender reloads the page

**Then:**

- Network shows `GET /v1/audit-log?chain_id=<chain>` returning a `WireOutRequested` row for the wallet
- The row is listed once, with the served time, amount and status read from the contract

---

## Story 4 — The Trustee settles

**Given** a Pending row

**When** the Trustee settles the request

**Then** within about 30 seconds the row shows "Bank transfer · Settled" and stops polling

---

## Story 5 — The Trustee cancels

**Given** a Pending row

**When** the Trustee cancels the request

**Then** the row shows "Bank transfer · Cancelled" and the PLUSD is back in the balance

---

## Story 6 — Not authorised or no trustline

**Given** a connected address that is not authorised to hold PLUSD (or has no PLUSD trustline on Stellar)

**Then:**

- The "Request bank wire-out" button is disabled and shows "Your address must be authorised to hold PLUSD to request a bank wire-out."
- No wallet prompt appears and no `request_wire_out` call is sent

---

## Story 7 — Amount above balance, zero amount, KYB not passed

**When** the lender types more than the PLUSD balance

**Then** "Insufficient balance" shows and Request is disabled; with an empty or zero amount Request is disabled too.

**Given** a wallet-only visitor or a lender whose KYB is not Passed

**Then** the section button is disabled with "Complete KYB to withdraw to a bank account".

---

## Story 8 — Minter paused (needs a testnet admin)

**Given** a testnet admin pauses the Minter

**Then** the button is disabled with "Bank wire-outs are paused. Check the status page before retrying."

---

## Story 9 — Home and Transactions

**Given** at least one wire-out request

**Then:**

- Home "Recent activity" interleaves the wire-out row with other requests by time
- `/transactions` shows it under "All" and "Sell", and not under Buy, Stake or Unstake

---

## Story 10 — Section hidden when the minter env is unset

**Given** the LP container has no `VITE_STELLAR_YIELD_MINTER_ID` (Stellar) or `VITE_EVM_MINTER_ADDRESS` (EVM)

**Then** the withdraw page shows no "Withdraw to a bank account" section, and the page otherwise works unchanged.
