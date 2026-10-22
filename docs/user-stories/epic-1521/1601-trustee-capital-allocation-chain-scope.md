# User Stories: #1601 — Trustee: the Capital Allocation card follows the signed-in chain

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1601](https://github.com/eq-lab/pipeline/issues/1601)
Spec: [docs/frontend/trustee-flows.md#capital-allocation-card--data-layer](../../frontend/trustee-flows.md#capital-allocation-card--data-layer)

Trustee app (`packages/trustee`) against staging (`CHAINS=99000001,560048`); a trustee wallet
allow-listed on both chains. No Figma for the chain chip.

---

## Story 1: Signed in with Stellar — the card shows the Stellar allocation with the custody fold-in

**Persona:** Trustee who picked the Soroban wallet at sign-in.

**Steps:**

1. Open `/` (Overview) with the Network tab open.

**Expected outcomes:**

- The request is `GET /v1/capital-allocation?chain_id=99000001`; a "Stellar" chip sits beside the "Capital Allocation" title.
- While the backend's `capital_wallet` bucket is `null`, the Capital Wallet row and the total include the on-chain Stellar custody balance (the #805 fold-in).
- Needs Attention on the same page still lists submissions and loans from every chain (cross-network work queue, by design).

---

## Story 2: Signed in with the EVM wallet — the card shows the Hoodi allocation, no Stellar fold-in

**Persona:** Trustee who picked the EVM wallet at sign-in.

**Steps:**

1. Sign out, sign in again choosing the EVM row, open the Overview.

**Expected outcomes:**

- The request is `GET /v1/capital-allocation?chain_id=560048`; the chip reads "Hoodi".
- The Capital Wallet row shows the served Hoodi bucket or "—" — never the Stellar custody balance; the total is the served Hoodi total.
