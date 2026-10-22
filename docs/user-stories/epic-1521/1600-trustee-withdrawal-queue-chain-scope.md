# User Stories: #1600 — Trustee: the Withdrawal Queue tab's chain scope is explicit

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1600](https://github.com/eq-lab/pipeline/issues/1600)
Spec: [docs/frontend/trustee-flows.md#cash-management--withdrawal-queue](../../frontend/trustee-flows.md#cash-management--withdrawal-queue)

Trustee app (`packages/trustee`) against staging (`CHAINS=99000001,560048`) with queued withdrawal
requests on both chains. No Figma for the scope chip.

---

## Story 1: The tab fetches the Stellar queue only

**Persona:** Trustee on Cash Management → Withdrawal Queue.

**Steps:**

1. Open `/cash-management`, switch to the Withdrawal Queue tab, with the Network tab open.

**Expected outcomes:**

- The request is `GET /v1/withdrawal-queue?chain_id=99000001`.
- "Total claimable" and "Requests" equal the Stellar figures only — a Hoodi request does not change them.

---

## Story 2: The scope is visible

**Persona:** Trustee reading the tab.

**Expected outcomes:**

- A small "Stellar" chip sits beside the "Withdrawal Queue" heading, and the sub-line reads "Stellar queue only, like the rest of Cash Management…".
- The chip matches the chain of the Capital-Wallet balance shown above the tabs.
