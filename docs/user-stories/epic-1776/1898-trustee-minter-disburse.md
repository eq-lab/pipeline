# User story: #1898 — Trustee: on-chain disbursement (Minter.disburse) moves an Approved loan to Performing

**Epic:** #1776
**Issue:** https://github.com/eq-lab/pipeline/issues/1898
**Status:** Initial

---

## Overview

A loan drawn from the Trustee app stays `Approved` on-chain until `Minter.disburse` runs. The loan detail page has a **Disbursement** card and a Disburse dialog that sign `AM.execute(minter, "disburse", [loan_id, amount, value_date, ref_hash], caller)` with the trustee wallet. Spec: `docs/frontend/trustee-flows.md#disburse-1898`.

Persona: trustee on pipeline-test with a Stellar trustee wallet that holds `TRUSTEE`, signed in on the Stellar chain.

**Precondition (stories 1 to 5 and 7):** a drawn Stellar loan (for example loan 0).
**Precondition (story 6):** ops has run `just new-deal 0` (DEBT SAC deployed, capital-wallet trustline added), `register_deal(0)` has run from the Debt token card, and the minter's booked bank cash covers the amount.

---

## Story 1 — A loan without a debt token is blocked

**Given** an `Approved` loan whose `deal(loan_id)` is not registered

**When** the trustee opens `/loans/0`

**Then:**

- The **Disbursement** card shows "Register this loan's debt token first."
- The **Disburse** button is disabled

---

## Story 2 — A missing DEBT trustline is explained

**Given** a registered deal whose loan NFT holder (the capital wallet) has no DEBT trustline

**When** the trustee opens the loan

**Then:**

- The card names the holder and says operations must add the DEBT trustline
- The **Disburse** button is disabled

---

## Story 3 — A non-Trustee wallet cannot disburse

**Given** a ready loan and a connected wallet without the `TRUSTEE` role

**When** the page loads

**Then:**

- The card shows "Only the Trustee role can disburse a loan."
- The **Disburse** button is disabled

---

## Story 4 — An amount above the booked bank cash is refused before signing

**Given** a ready loan and the Disburse dialog open

**When** the trustee enters an amount above the booked bank cash shown on the card

**Then:**

- The dialog shows "The minter's booked bank cash (…) is below this amount. Book the incoming wires first."
- The confirm button is disabled and no wallet prompt appears

---

## Story 5 — A reused bank reference is refused before signing

**Given** a bank reference that was already recorded on the minter by an earlier booking

**When** the trustee enters it, a valid amount and today's date, and confirms

**Then:**

- The dialog shows "This bank reference is already recorded on-chain. …"
- No wallet signature is requested and no transaction is sent

---

## Story 6 — Happy path on loan 0

**Given** the story 6 precondition and an `Approved` loan 0

**When** the trustee clicks **Disburse**, enters an amount not above the booked bank cash, today's date and a new bank reference, confirms and signs

**Then:**

- The dialog closes and the card shows "Disbursed … on-chain, value date …" with the transaction hash
- The registry status of loan 0 is `Performing` and the minter's `bank_cash` drops by the amount
- A `CashDisbursed` row appears in the audit log and the cash book once indexed
- **Record coupon** and **Update lifecycle** (to WatchList) then succeed for the loan

---

## Story 7 — A fully disbursed loan shows no card

**Given** a `Performing` loan whose on-chain `disbursed` equals `original_senior_tranche`

**When** the trustee opens the loan

**Then:**

- No **Disbursement** card is shown

---

## Story 8 — An EVM loan shows the Stellar-only line

**Given** a loan on an EVM chain

**When** the trustee opens the loan

**Then:**

- The **Disbursement** card shows the Stellar-only line and the **Disburse** button is disabled
