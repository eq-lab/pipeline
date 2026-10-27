# User Stories: #1600 — Trustee: the Withdrawal Queue tab follows the signed-in chain

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1600](https://github.com/eq-lab/pipeline/issues/1600)
Spec: [docs/frontend/trustee-flows.md#cash-management--withdrawal-queue](../../frontend/trustee-flows.md#cash-management--withdrawal-queue)

Trustee app (`packages/trustee`) against staging (`CHAINS=99000001,560048`) with queued withdrawal
requests on both chains; a trustee wallet allow-listed on both. No Figma for the scope chip.

---

## Story 1: Signed in with Stellar — the tab shows the Stellar queue

**Persona:** Trustee who picked the Soroban wallet at sign-in.

**Steps:**

1. Open `/cash-management`, switch to the Withdrawal Queue tab, with the Network tab open.

**Expected outcomes:**

- The request is `GET /v1/withdrawal-queue?chain_id=99000001`.
- A "Stellar" chip sits beside the "Withdrawal Queue" heading; the sub-line reads "Stellar queue — the network you signed in with."
- "Total claimable" and "Requests" equal the Stellar figures only.

---

## Story 2: Signed in with the EVM wallet — the tab shows the Hoodi queue

**Persona:** Trustee who picked the EVM wallet at sign-in.

**Steps:**

1. Sign out, sign in again choosing the EVM row, open the Withdrawal Queue tab.

**Expected outcomes:**

- The request is `GET /v1/withdrawal-queue?chain_id=560048`; the chip reads "Hoodi"; the figures are Hoodi's only.
- The On/Off-ramp tab follows the same chain (see #1669); the Capital-Wallet balance shows only on a Stellar session (EVM custody read: TD-156).
