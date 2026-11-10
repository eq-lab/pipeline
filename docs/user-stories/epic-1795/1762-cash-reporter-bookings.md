# User story: #1762 — Cash reporter role gating and bank income booking

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1762
**Status:** Initial

---

## Overview

Repayments, incoming wires and bank income are booked by the Cash reporter, a role separate from the Trustee (`docs/user-docs/how-it-works/capital-layer.md`). The Trustee console enables each booking only when `AccessManager.can_call(wallet, minter, fn).immediate` is true, and adds a Bank income tab in Cash Management. Spec: `docs/product-specs/cash-reporter-bookings.md`; UI: `docs/frontend/trustee-flows.md#cash-reporter-bookings`.

All checks use the real API and Stellar testnet (staging), no localStorage mocks. Open DevTools Network before starting. Known limit (BUG-32): the deployed minter lacks the PLUSD `MINTER` role, so any mint fails at simulation with AccessManager `Error(Contract, #1)` until ops grants it. Stories 1 to 4, 6 and 7 are unaffected; Story 5 stops at that error until the grant.

---

## Story 1 — A Cash reporter wallet can mint PLUSD

**Given** a trustee signed in with a Stellar wallet that holds `CASH_REPORTER` (delay 0), and an LP with an unminted bank deposit

**When** the trustee opens the LP detail page, Bank deposits

**Then:**

- Network shows a `simulateTransaction` against the AccessManager for `can_call` with the minter as target and `record_wire_in`
- Mint PLUSD is enabled and opens the confirm dialog

---

## Story 2 — A Trustee-only wallet cannot mint PLUSD

**Given** a trustee-allowlisted wallet without `CASH_REPORTER` is connected

**When** the trustee opens the same Bank deposits list

**Then:**

- Mint PLUSD is disabled with "Only the Cash reporter can book incoming wires."
- While the read is in flight the reason reads "Checking this wallet's Cash reporter role…"; if the read fails it reads "Could not verify this wallet's Cash reporter role."
- No wallet signature prompt appears

---

## Story 3 — Record Coupon is disabled for a Trustee-only wallet

**Given** a wallet without `CASH_REPORTER` and a Stellar loan

**When** the trustee opens Record Coupon and enters an amount

**Then:**

- The waterfall preview still loads
- "Only the Cash reporter can book repayments." shows above the button and "Record on the ledger" stays disabled

---

## Story 4 — Record Repayment is disabled, close-loan is unaffected

**Given** a wallet without `CASH_REPORTER` and a Stellar loan

**When** the trustee opens Record Repayment

**Then:**

- "Only the Cash reporter can book repayments." shows and "Record on the ledger" is disabled
- Close loan enables or disables only by its own checklist, never by this role

---

## Story 5 — Book bank income

**Given** a wallet that holds `CASH_REPORTER` (delay 0) and a Stellar session

**When** the trustee opens Cash Management, Bank income, then Book income

**Then:**

- Submitting empty shows "Enter an amount greater than 0 with at most 2 decimal places."; then, with an amount, "Enter the bank's reference for this income."; a future value date shows "The value date cannot be in the future."
- With a valid amount, date and reference, Network shows a `ref_hash_seen` read, then the wallet asks for a signature
- Expected today (BUG-32): simulation fails with AccessManager `Error(Contract, #1)`, shown as an inline error with "View details", and no signature is requested
- After the PLUSD `MINTER` grant: the dialog closes, "Booked $X income, value date …, Transaction …" shows with an Audit Log link, and the Audit Log later lists "Cash recorded — Income $X"

---

## Story 6 — A reused bank reference is refused before signing

**Given** a bank reference already consumed on the minter (a minted wire or a booked income)

**When** the trustee books income with that reference

**Then:**

- "This bank reference is already booked on-chain. Each bank record's reference can be used once." shows
- No signature prompt appears; Mint PLUSD refuses a reused wire reference the same way with "This deposit's reference has already been minted on-chain. Refresh the list."

---

## Story 7 — EVM sessions stay read-only

**Given** a trustee signed in on an EVM network

**When** the trustee opens Mint PLUSD, Record Coupon / Repayment and the Bank income tab

**Then:**

- Mint PLUSD shows "PLUSD minting on {chain} is not available in the Trustee app yet."
- Record Coupon / Repayment show only the Stellar-only reason
- Book income is disabled with "Booking bank income on {chain} is not available in the Trustee app yet."
- Network shows no AccessManager `can_call` read
