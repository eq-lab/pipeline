# User story: #1758 — see and claim your share of a defaulted loan's pocket

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1758
**Status:** Initial

---

## Overview

When a loan defaults its outstanding moves out of the staking vault into a pocket held for the sPLUSD holders at that moment. Recovered proceeds go to the pocket and each holder claims a share, repeatedly, as more is recovered. The `/stake` page shows a "Default pockets" card with one row per existing pocket: the pocket balance, what the connected wallet can claim and what it already claimed, and a Claim button. Spec: `docs/product-specs/staking.md#default-pockets`; behaviour source `docs/user-docs/risks/default-management.md`.

Checks use the real API and chain on staging, no localStorage mocks. Open DevTools Network before starting. Testnet has no pockets until a default is staged, so Stories 1 and 3 to 6 need a staged default; Story 2 and 7 run today. The card needs `VITE_STELLAR_POCKET_ID` (Stellar) or `VITE_EVM_POCKET_ADDRESS` (EVM) in the LP container.

---

## Story 1 — A defaulted loan with a pocket

**Given** a connected wallet that held sPLUSD at default, and a loan with status Default whose pocket exists

**When** the lender opens `/stake`

**Then:**

- Network shows `GET /v1/loan-book?chain_id=<active>` and Soroban `simulateTransaction` (or `eth_call`) reads of `pocket`, `claimable` and `claimed`
- The "Default pockets" card sits below the stake card with a row "Loan #<id> · <borrower>", the commodity, "Pocket balance", "Claimable" and "Claimed"
- The amounts equal the on-chain values formatted in PLUSD decimals; nothing is computed in the page

---

## Story 2 — No pockets, disconnected wallet or unset env

**Given** any of: no Default or Closed loan with a pocket (testnet today), no wallet connected, or no `VITE_STELLAR_POCKET_ID` / `VITE_EVM_POCKET_ADDRESS` for the active chain

**Then** `/stake` shows no "Default pockets" card and the stake flow works unchanged.

---

## Story 3 — Claim

**Given** a row with a positive Claimable

**When** the lender presses Claim

**Then:**

- One wallet signature is requested; Network shows `simulateTransaction` and `sendTransaction` for `claim` (Stellar) or the `claim` transaction (EVM)
- A toast "Claimed {amount} PLUSD" appears; the row's Claimable drops and Claimed rises after the refetch, and the PLUSD balance rises by the amount

---

## Story 4 — Nothing to claim

**Given** a row whose Claimable is `0.00`, or whose reads are still loading

**Then** the row stays listed, Claim is disabled, and unavailable values show "—".

---

## Story 5 — More recovered later

**Given** a claimed row and a further recovery repayment booked on the loan

**When** the page polls (every 30 seconds)

**Then** Claimable rises above `0.00` and Claim becomes enabled again.

---

## Story 6 — Claim fails or is cancelled

**When** the lender rejects the signature or the transaction reverts

**Then** a danger toast and a one-line error under the list appear (with "View details" for the raw text), the row's values do not change, and Claim is usable again.

---

## Story 7 — No XLM on Stellar

**Given** a connected Stellar account with no XLM

**Then** the page shows the XLM funding banner and every Claim button is disabled.
