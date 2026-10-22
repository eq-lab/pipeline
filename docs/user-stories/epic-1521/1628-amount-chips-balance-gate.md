# User Stories: #1628 — Max / % chips never exceed the balance; deposit is balance-gated

Issue: [#1628](https://github.com/eq-lab/pipeline/issues/1628) (bug, high — reverted tx or silently disabled Confirm)
Spec: [docs/frontend/wallet-flows.md#business-rules](../../frontend/wallet-flows.md#business-rules)

LP dashboard (`packages/frontend`) against staging, both chains. Use a wallet whose balance has
more than two fractional digits (e.g. sPLUSD after a stake, or PLUSD received from an unstake).

---

## Story 1: Max fills the exact balance

**Persona:** LP on `/stake` (Unstake tab) holding e.g. `1234.5678912` sPLUSD on Stellar, or an
odd 18-dp balance on EVM.

**Steps:**

1. Click **Max**.
2. Repeat on `/deposit?direction=withdraw` with a PLUSD balance, and on `/deposit` with USDC.

**Expected outcomes:**

- The input shows the full balance with every fractional digit (`1234.5678912`), not `1234.57`.
- No "Insufficient balance" line appears and the first step CTA is enabled.

---

## Story 2: Percent chips stay under the balance

**Persona:** Same LP.

**Steps:**

1. Click **25%**, **50%**, **75%** in turn on Unstake, Stake and Withdraw.

**Expected outcomes:**

- Each value is at most the exact fraction of the balance (floored in base units) and the CTA
  stays enabled; no "Insufficient balance" line.

---

## Story 3: Deposit above the balance is blocked with a message

**Persona:** LP on `/deposit` with a `$5,000` USDC balance.

**Steps:**

1. Click the **$10,000** chip, then type `5000.000001`.

**Expected outcomes:**

- A red "Insufficient balance" line appears right-aligned under the conversion card; Approve and
  Confirm are disabled. Nothing is sent to the wallet.
- Clearing back to `5000` or below removes the line and re-enables the step.

---

## Story 4: Over-balance stake / unstake / withdraw show the same message

**Persona:** LP on `/stake` and `/deposit?direction=withdraw`.

**Steps:**

1. Type an amount one base unit above the balance.

**Expected outcomes:**

- "Insufficient balance" shows under the input and the step CTAs are disabled — no longer a
  silently disabled button.
