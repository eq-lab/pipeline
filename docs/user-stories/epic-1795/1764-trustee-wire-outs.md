# User story: #1764 — Trustee settles or cancels lender bank withdrawals

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1764
**Status:** Initial

---

## Overview

A lender who withdraws to a bank account calls `request_wire_out`; the minter holds the PLUSD in escrow until a Trustee acts. The Trustee console lists these requests on Cash Management → Bank wire-outs and resolves each one: settle it after sending the bank wire (`settle_wire_out`, burns the PLUSD) or cancel it (`cancel_wire_out`, returns the PLUSD to the lender). Stellar only. Spec: `docs/product-specs/withdrawals.md#bank-wire-withdrawals-trustee-console` and `docs/frontend/trustee-flows.md#cash-management--bank-wire-outs`.

All checks use the real API on staging (Stellar testnet), no localStorage mocks. Open DevTools Network before starting.

**Prerequisites and live-testing risks:**

- No wire-out exists on testnet today (`wire_out(0..6)` answers `#10` on both minters). A lender must call `request_wire_out` first (the LP UI is #1757 on `epic/1795-lp-ui`, or a funded lender can call the contract directly). Until then stories 4–8 can only be covered by the unit tests.
- `bank_cash` on the API minter `CD2LPGLX…` is 0, so a settle there fails with "The minter's bank cash is below this amount. Book the incoming wires first." until wire-ins are booked on that minter (`CAPL5WN3…` holds cash).
- The app signs against `VITE_STELLAR_YIELD_MINTER_ID`. If the cash book reports a different minter, every action is disabled with "The app's minter differs from the server's cash-book minter." This is an environment alignment for ops, not a defect.
- The staging API needs `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS` set, otherwise the cash book answers `404 minter_not_configured` (an ops env change).
- The lender's bank account is not served by the API yet (#1812), so the settle dialog shows "—" for it.

---

## Story 1 — List on a Stellar session

**Given** a Trustee is signed in on the Stellar network

**When** they open Cash Management and the Bank wire-outs tab

**Then:**

- Network shows `GET /v1/cash-book?chain_id=<Stellar id>` answering 200 (or `404 minter_not_configured`, in which case the tab says "The cash book is not configured for Stellar on this server.")
- The chain chip reads Stellar
- Every `wire_outs` row is listed in served order with id, lender name (or "—") linking to the lender, address chip, amount with its served decimals and a PLUSD suffix, requested at and status
- `Pending` rows show "Pending (confirmed on-chain)"; `Settled` rows show the served settled at, value date and reference hash; `Cancelled` rows show the served cancelled at
- With no wire-out the tab reads "No bank wire-outs on Stellar."

---

## Story 2 — EVM session shows the reason

**Given** a Trustee is signed in on an EVM network

**When** they open the Bank wire-outs tab

**Then:**

- The tab reads "Bank wire-outs on {chain} are not available in the Trustee app yet." with the chain chip
- Network shows no `GET /v1/cash-book` request

---

## Story 3 — A wallet without the Trustee role

**Given** a connected wallet that does not hold the `TRUSTEE` role (or holds it with a delay) and a pending wire-out is listed

**When** the Trustee looks at the row

**Then:**

- Settle and Cancel are disabled
- The reason line reads "Only the Trustee role can settle bank wire-outs." (or the delay wording)
- With no wallet connected the reason is "Connect your trustee wallet to act on bank wire-outs."

---

## Story 4 — Settle: an amount mismatch blocks

**Given** a pending wire-out is listed and the wallet holds `TRUSTEE` with no delay

**When** the Trustee clicks Settle and changes "Amount wired (PLUSD)" away from the pre-filled value

**Then:**

- The amount is pre-filled with the exact on-chain amount, and the Destination bank account row shows "—" with "The API does not serve the lender's bank account yet."
- The dialog says "The minter settles only the full requested amount ({amount} PLUSD). If a different amount was wired, cancel this request instead."
- Confirm stays disabled and no signature is requested

---

## Story 5 — Settle: a reused reference blocks

**Given** the Settle dialog is open

**When** the Trustee enters a bank reference whose hash was already used on-chain and confirms

**Then:**

- The computed reference hash is shown
- The dialog says "This bank reference is already recorded on-chain. Use the outgoing wire's own reference."
- No signature is requested

---

## Story 6 — Settle succeeds

**Given** the Settle dialog is open with the pre-filled amount, a value date that is not in the future and a fresh bank reference

**When** the Trustee confirms

**Then:**

- The wallet is asked to sign one `AccessManager.execute(minter, settle_wire_out, [id, amount, value_date, ref_hash])`
- The notice reads "Wire-out #{id} settled on-chain. Status Settled; the escrowed PLUSD was burned. Transaction {hash}. It updates in this list once indexed."
- The row shows "Settled on-chain — waiting for the indexer" with both actions disabled; Network shows the cash book refetching about every 5 seconds
- Once indexed the row is `Settled` with the served settled at, value date and reference hash

---

## Story 7 — Cancel blocked for an unauthorised lender

**Given** a pending wire-out whose lender address is not PLUSD-authorised or has no PLUSD trustline

**When** the Trustee clicks Cancel

**Then:**

- The dialog says "This lender's address is not authorised to hold PLUSD, so the PLUSD cannot be returned. Cancel is blocked until it is authorised again." or "This lender's address has no PLUSD trustline."
- Confirm stays disabled and no signature is requested

---

## Story 8 — Cancel succeeds and the PLUSD returns

**Given** a pending wire-out whose lender address is authorised to hold PLUSD

**When** the Trustee clicks Cancel and confirms

**Then:**

- The dialog says "The escrowed PLUSD returns to the lender's address." and the authorisation result reads authorised
- The wallet is asked to sign one `AccessManager.execute(minter, cancel_wire_out, [id])`
- The notice reads "Wire-out #{id} cancelled on-chain. Status Cancelled; the PLUSD was returned to {lender address}. Transaction {hash}. It updates in this list once indexed."
- The lender's PLUSD balance rises by the requested amount and the row ends `Cancelled` with the served cancelled at

---

## Story 9 — The destination bank account shows "—"

**Given** the Settle dialog is open for any wire-out

**When** the Trustee reads the summary

**Then:**

- "Destination bank account" shows "—" with "The API does not serve the lender's bank account yet."
- The app never shows a guessed account
