# User Stories: #1669 — Trustee: the On/Off-ramp tab follows the signed-in chain

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1669](https://github.com/eq-lab/pipeline/issues/1669)
Spec: [docs/frontend/trustee-flows.md#onoff-ramp-tab](../../frontend/trustee-flows.md#onoff-ramp-tab)

Trustee app (`packages/trustee`) against staging (`CHAINS=99000001,560048`); a trustee wallet allow-listed on both chains. No Figma for the scope chip.

---

## Story 1: Signed in with Stellar — the ramp tab shows Stellar

**Persona:** Trustee who picked the Soroban wallet at sign-in.

**Steps:**

1. Open `/cash-management` (On / Off-ramp tab) with the Network tab open.
2. Open "New swap".

**Expected outcomes:**

- The requests are `GET /v1/ramp/events?chain_id=99000001` and `GET /v1/ramp/addresses?chain_id=99000001`.
- A "Stellar" chip sits beside the "On / Off-ramp" heading; the sub-line reads "Stellar ramp — the network you signed in with."
- The swap dialog shows the Capital-Wallet USDC balance.

---

## Story 2: Signed in with the EVM wallet — the ramp tab shows Hoodi

**Persona:** Trustee who picked the EVM wallet at sign-in.

**Steps:**

1. Sign out, sign in again choosing the EVM row, open `/cash-management`.
2. Open "New swap".

**Expected outcomes:**

- The requests are `GET /v1/ramp/events?chain_id=560048` and `GET /v1/ramp/addresses?chain_id=560048`; the chip reads "Hoodi".
- An unconfigured ramp shows "No ramp transfers awaiting review." and the destination `—`.
- The swap dialog balance shows `—`, never the Stellar figure (EVM custody read: TD-156).

---

## Story 3: Approving or rejecting an event sends no query string

**Persona:** Trustee with a pending ramp event.

**Steps:**

1. Approve one event; reject another with a reason (Network tab open).

**Expected outcomes:**

- Each request is `POST /v1/ramp/events/<id>/review` with no `?`, and the body is `{"decision":"Approved"}` or `{"decision":"Rejected","reason":"…"}`.
- The reviewed event drops off the queue after the refetch.
