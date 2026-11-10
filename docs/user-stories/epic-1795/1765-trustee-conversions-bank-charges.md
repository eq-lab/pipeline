# User story: #1765 — Trustee books USDC/USD conversions and bank charges on-chain

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1765
**Status:** Initial

---

## Overview

The Cash Management On / Off-ramp tab stops being a disabled MPC swap shell. A wallet with the `TRUSTEE` role books USDC to USD (and USD to USDC) conversions and bank charges in the minter's on-chain cash book: `open_ramp`, `close_ramp` and `record_expense`, each through `AccessManager.execute`. Custody accounts sign their own USDC moves; the console never co-signs, it only books. Stellar only. Spec: `docs/frontend/trustee-flows.md#cash-management--conversions-and-bank-charges` and `docs/product-specs/trustee-dashboard.md` §Type 2.

All checks use the real API on staging (Stellar testnet), no localStorage mocks. Open DevTools Network before starting.

**Prerequisites and live-testing risks:**

- No ramp exists on testnet today (`ramp(0..8)` answers `#11` on both minters). The first open creates ramp id 0; ids start at 0.
- USDC → USD fails with "Custody USDC on-chain is below this amount." on both minters, because custody USDC is 0.
- On the API minter `CD2LPGLX…`, USD → USDC and bank charges fail with "The minter's booked bank cash is below this amount.", because `bank_cash` is 0. `CAPL5WN3…` holds booked cash (734,122).
- On `CAPL5WN3…`, `record_expense` and any close with a shortfall fail inside the vault's `pull` with the vault's own `#2`. `#2` is not mapped, so the dialog shows the generic message and "View details" shows the raw error. A close with the full amount does not touch the vault and should succeed.
- The app signs against `VITE_STELLAR_YIELD_MINTER_ID`. If the cash book reports a different minter, every action is disabled with "The app's minter differs from the server's cash-book minter." This is an environment alignment for ops, not a defect. The pool summary still renders and labels its source minter.
- The pool summary is read on-chain from the app's minter because the cash book does not serve `total_assets` (TD-180). Recorded bank charges are not listed by the cash book, so their notice points to the Audit Log.

---

## Story 1 — The pool summary matches the chain

**Given** a Trustee is signed in on the Stellar network

**When** they open Cash Management (On / Off-ramp tab)

**Then:**

- The pool summary shows "Booked bank cash", "Cash in transit" and "Pool total", with no rescaling, and they equal the minter's `pool_state()` (`bank_cash`, `in_flight`, `total_assets`) read with the planner's simulation probe
- The caption reads "Read on-chain from the minter {truncated id} (pool_state)."
- If `read_failed` is true the caption "A custody balance could not be read; the minter counts it as 0 in the pool total." shows
- The conversions list is loaded from `GET /v1/cash-book?chain_id=<Stellar id>`; with no ramp it reads "No conversions on Stellar."

---

## Story 2 — EVM session shows the reason

**Given** a Trustee is signed in on an EVM network

**When** they open the On / Off-ramp tab

**Then:**

- The conversions block reads "Conversions and bank charges on {chain} are not available in the Trustee app yet." and has no action buttons
- Network shows no `GET /v1/cash-book` request, and no RPC read of the minter

---

## Story 3 — A wallet without the Trustee role

**Given** a connected wallet that does not hold the `TRUSTEE` role (or holds it with a delay)

**When** the Trustee looks at the conversions block

**Then:**

- "Open conversion", "Record bank charge" and each row's "Close" are disabled
- The reasons read "Only the Trustee role can open conversions.", "Only the Trustee role can record bank charges." and "Only the Trustee role can close conversions." (or the delay wording)
- With no wallet connected the reason is "Connect your trustee wallet to book conversions and bank charges."

---

## Story 4 — The shells are gone and the review queue still works

**Given** a Trustee opens Cash Management

**When** they look at the tabs and the On / Off-ramp tab

**Then:**

- There is no T-Bills tab and no "New swap" button
- Below the conversions block, the "Ramp-event review" queue still lists inbound and outbound ramp events, and Approve and Reject (with a reason) behave as before

---

## Story 5 — Open USD → USDC: a reused reference blocks

**Given** the wallet holds `TRUSTEE` with no delay and the minter is not paused

**When** the Trustee opens "Open conversion", picks "USD → USDC", enters an amount and a transfer reference whose hash was already used on-chain, and confirms

**Then:**

- The computed reference hash (sha256 of the trimmed reference) is shown
- The dialog says "This bank reference is already recorded on-chain. Use the outgoing wire's own reference."
- No signature is requested

---

## Story 6 — Open USD → USDC succeeds

**Given** the Open dialog is filled with USD → USDC, an amount within booked bank cash and a fresh reference (run on `CAPL5WN3…`)

**When** the Trustee confirms

**Then:**

- The wallet is asked to sign one `AccessManager.execute(minter, open_ramp, [BankToUsdc, amount, ref_hash])`
- The notice reads "Conversion opened on-chain (USD → USDC, {amount}). Transaction {hash}. It appears in the list once indexed."
- Network shows the cash book refetching about every 5 seconds, and the row appears as Open (id 0 on a fresh minter) with "Open (confirmed on-chain)"
- In the pool summary, "Cash in transit" rises and "Booked bank cash" falls by the amount, read from the chain

---

## Story 7 — Open USDC → USD with custody 0 is blocked

**Given** the custody USDC balance on-chain is below the amount

**When** the Trustee opens a USDC → USD conversion for that amount and confirms

**Then:**

- The dialog shows "Custody USDC on-chain is below this amount." from the simulation, before any signature
- "View details" shows the raw contract error

---

## Story 8 — Close with the full amount

**Given** an Open conversion is listed with "Open (confirmed on-chain)"

**When** the Trustee clicks "Close", enters the full opened amount as "Amount received" and a fresh closing reference, and confirms

**Then:**

- The dialog shows the opened amount from the cash book and from the chain, and the shortfall-is-an-expense copy
- The wallet is asked to sign one `AccessManager.execute(minter, close_ramp, [id, received, ref_hash])`
- The notice reads "Conversion #{id} closed on-chain. Received {received}; any shortfall is booked as an expense and shows in this list once indexed. Transaction {hash}."
- Once indexed the row is Closed with the served received amount and the served shortfall "$0" or "—"

---

## Story 9 — Close with a shortfall

**Given** an Open conversion is listed

**When** the Trustee closes it with an amount received below the opened amount (0 is allowed)

**Then:**

- The contract books the difference as an expense, absorbed by the vault
- Once indexed the row shows the served `loss` as the shortfall; the app never computes it
- On `CAPL5WN3…` this can fail inside the vault's `pull` with `#2` (known risk); the generic message shows and "View details" holds the raw error

---

## Story 10 — Received above the opened amount is blocked

**Given** the Close dialog is open

**When** the Trustee enters an amount received above the on-chain opened amount

**Then:**

- The dialog says "The amount received cannot exceed the opened amount ({amount})."
- Confirm stays disabled and no signature is requested

---

## Story 11 — Record a bank charge

**Given** the wallet holds `TRUSTEE` and booked bank cash covers the charge

**When** the Trustee clicks "Record bank charge", enters an amount, a value date that is not in the future and a fresh bank reference, and confirms

**Then:**

- A future value date is blocked with "The value date cannot be in the future."
- The wallet is asked to sign one `AccessManager.execute(minter, record_expense, [amount, value_date, ref_hash])`
- The notice reads "Bank charge of {amount} booked on-chain, value date {date}; it was burned from the vault. Transaction {hash}. It appears in the Audit Log once indexed." with a link to the Audit Log
- Once indexed the Audit Log shows "Cash recorded — Expense …", and "Booked bank cash" in the pool summary falls by the amount
- Known risk: on `CAPL5WN3…` the vault `pull` fails with `#2`, and on `CD2LPGLX…` the charge fails with "The minter's booked bank cash is below this amount."

---

## Story 12 — A paused minter blocks only Open

**Given** ops has paused the minter (optional; only when a pause is scheduled)

**When** the Trustee looks at the conversions block

**Then:**

- "Open conversion" is disabled with "The minter is paused; conversions cannot be opened."
- "Record bank charge" and "Close" stay enabled, because only `open_ramp` is pause-gated

---

## Story 13 — A minter mismatch disables every action

**Given** the cash book's minter differs from the app's `VITE_STELLAR_YIELD_MINTER_ID`

**When** the Trustee opens the On / Off-ramp tab

**Then:**

- "The app's minter differs from the server's cash-book minter. Actions are disabled." shows
- "Open conversion", "Record bank charge" and every "Close" are disabled with that reason
- The pool summary still renders and labels the app's minter
