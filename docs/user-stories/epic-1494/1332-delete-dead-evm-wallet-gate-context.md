# User story: #1332 — Delete dead `evm/WalletGateContext.ts`

**Epic:** #1494 — EVM support for the LP app
**Issue:** https://github.com/eq-lab/pipeline/issues/1332
**Status:** Initial

---

## Overview

Cleanup only: the unused legacy `packages/frontend/src/wallet/evm/WalletGateContext.ts` (no `onProceed` callback) is removed. The live gate is `packages/frontend/src/wallet/WalletGateContext.ts`. No user-visible change and no Figma reference.

---

## Story 1 — Wallet gate still opens and proceeds after connect

**Given** the LP app is open with no wallet connected

**When** the user clicks a gated action (e.g. Deposit) and completes the Connect Wallet modal

**Then:**

- The Connect Wallet modal opens
- After connecting, the originally requested action proceeds (`onProceed` runs)
- No console errors about missing modules appear

## Story 2 — App builds with the dead file gone

**Given** the branch with `evm/WalletGateContext.ts` deleted

**When** the frontend is built

**Then:**

- The build succeeds and nothing in `packages/` references `evm/WalletGateContext`
