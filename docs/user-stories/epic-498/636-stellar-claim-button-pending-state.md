# User story: #636 — Stellar deposit Claim button pending state fix

**Epic:** #498 — Deposit/withdraw page  
**Issue:** https://github.com/eq-lab/pipeline/issues/636  
**Status:** Initial

---

## Overview

While the `/voucher` poll is pending (after the deposit transaction is confirmed but before the claim signature arrives), the correct step to show as loading is the **Deposit (step 2)** button, not the **Claim (step 3)** button. The Claim button should be disabled (not spinning) until the voucher is `ready`.

Applies to both the Stellar and EVM deposit/withdraw flows.

---

## Story 1 — Stellar deposit: Deposit button shows pending while voucher is polling

**Given** a connected Stellar wallet with sufficient PLUSD balance and both trustlines enabled.

**When** the user enters an amount, clicks "Confirm" (step 2), and the deposit transaction is confirmed, but the `/voucher` poll is still returning `pending`.

**Then**

- The **Confirm / Deposit** (step 2) button shows a spinner.
- The **Claim** (step 3) button is disabled with no spinner.

**How to test**

1. Open the deposit page (`/deposit`) with Stellar selected.
2. Set `localStorage.setItem("pipeline.mock.wallet.stellar.voucher.status", "pending")` (or let the testnet voucher poll run naturally).
3. Run a deposit and confirm the transaction.
4. While the voucher is polling: step 2 button should spin, step 3 button should be disabled only (no spin).

---

## Story 2 — Stellar deposit: Claim button becomes active only when voucher is ready

**Given** the scenario from Story 1.

**When** the `/voucher` poll returns `ready` (signature available).

**Then**

- The **Confirm** (step 2) button is no longer loading (shows its complete / success state or is disabled).
- The **Claim** (step 3) button becomes enabled and shows "Claim" (no spinner).

---

## Story 3 — EVM deposit: same loading attribution (regression guard)

**Given** a connected EVM wallet mid-deposit flow, with the on-chain request confirmed and the `/voucher` poll pending.

**Then**

- The **Confirm** (step 2) button shows the pending/loading spinner.
- The **Claim** (step 3) button is disabled with no spinner.
- When voucher becomes `ready`, Claim becomes enabled.
