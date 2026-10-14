# User story: #1496 — EVM claim vouchers request the EVM chain

**Epic:** #1494
**Issue:** https://github.com/eq-lab/pipeline/issues/1496
**Status:** Initial

---

## Overview

The EVM voucher hooks (`useDepositVoucher`, `useWithdrawalVoucher`) must send
`chain_id=<ENV.EVM_CHAIN_ID>` alongside `wallet`. Without it the API falls back to
`DEFAULT_CHAIN_ID` (the Stellar chain), rejects the `0x…` wallet with a 400, and the
Claim step never becomes actionable on EVM. The query keys include the chain id, mirroring
`useStellarDepositVoucher` / `useStellarWithdrawalVoucher`.

Mock-key lookup order (most specific first):

1. `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher?wallet=<addr>&chain_id=<id>`
2. `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher`

Withdrawals use the same forms under `/v1/withdrawals/`.

---

## Story 1 — Deposit voucher request carries the EVM chain id

**Given** an EVM wallet is connected and a deposit request `42` is `PendingClaim`

**When** the deposit page polls for the voucher

**Then:**

- The request path is `/v1/deposits/42/voucher?wallet=<0x…>&chain_id=<EVM chain id>`
- The API returns the voucher and step 3 (Claim PLUSD) becomes actionable

---

## Story 2 — Withdrawal voucher request carries the EVM chain id

**Given** an EVM wallet is connected and a withdrawal request `77` is `PendingClaim`

**When** the withdraw page polls for the voucher

**Then:**

- The request path is `/v1/withdrawals/77/voucher?wallet=<0x…>&chain_id=<EVM chain id>`
- The API returns the voucher and step 3 (Claim USDC) becomes actionable

---

## Notes

- Regression coverage: `packages/frontend/src/api/useDepositVoucher.test.tsx`,
  `packages/frontend/src/api/useWithdrawalVoucher.test.tsx`.
- Mock keys are documented in `packages/frontend/src/api/README.md`.
