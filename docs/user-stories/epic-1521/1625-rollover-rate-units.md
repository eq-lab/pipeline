# User Stories: #1625 — Rollover rate is entered as a percent and converted exactly to bps

Issue: [#1625](https://github.com/eq-lab/pipeline/issues/1625) (bug, medium — wrong rate on-chain)
Spec: [docs/frontend/trustee-flows.md#wired-actions](../../frontend/trustee-flows.md#wired-actions)

Trustee app (`packages/trustee`) on a **Matured** loan with the Stellar trustee wallet. Story 2
sends a real `rollover` on the Stellar testnet.

---

## Story 1: The rate field states its unit and validates

**Persona:** Trustee opening Roll over on a matured loan.

**Steps:**

1. Read the rate label; type `14.5`.
2. Type `14.555`, then `0`, then `101`, then `abc`.

**Expected outcomes:**

- The label reads "New rate (% p.a.)", the placeholder `e.g. 14.5`, and the hint `1 bp = 0.01%`.
- Step 1 shows `= 1450 bps` under the field.
- Each step 2 value shows "Enter a rate from 0.01 to 100 with at most 2 decimals (1 bp = 0.01%)."
  and Roll over loan stays disabled.

---

## Story 2: The on-chain epoch carries 1450 bps

**Persona:** Same trustee.

**Steps:**

1. Enter `14.5` and a future maturity; click Roll over loan; sign.
2. Open the loan's economics / audit log after indexing.

**Expected outcomes:**

- The `rollover` invocation carries `new_rate = 145000` (1450 bps × 100 on-chain scale).
- The new epoch shows a 14.5% senior rate, not 0.14%.
