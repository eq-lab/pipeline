# User story: #1593 — EVM sPLUSD share transfers keep PnL correct

**Epic:** #2129
**Issue:** https://github.com/eq-lab/pipeline/issues/1593
**Status:** Initial

---

## Overview

On EVM, a peer-to-peer sPLUSD transfer is indexed as `ShareTransfer`, the same as on Stellar, so the receiver inherits the sender's cost basis. Spec: `docs/references/backend.md` (sPLUSD share-transfer tracking).

Persona: LP holding sPLUSD on an EVM chain, viewing `/v1/pnl` and `/v1/positions/history`.

---

## Story 1 — Transfer before redeem

**Given** Alice staked 400 PLUSD for 400 shares at price 1.0, transferred all 400 shares to Bob, and the share price rose to 1.05

**When** Bob redeems 400 shares for 420 PLUSD

**Then:**

- Bob's realized PnL is +20, not +420
- Alice's share balance is 0 and her realized PnL is unchanged
- Bob's `/v1/positions/history` shows 400 shares at cost basis 1.0 from the transfer block

---

## Story 2 — Partial transfer

**Given** Alice holds 400 shares at cost basis 1.0

**When** Alice transfers 100 shares to Bob

**Then:**

- Alice holds 300 shares at 1.0 and Bob holds 100 shares at 1.0
- No realized PnL is booked on either side

---

## Story 3 — Mint, burn and foreign tokens are not share transfers

**Given** a vault stake (mint), an unstake (burn), and PLUSD or deal-token transfers on the same chain

**When** the indexer processes the logs

**Then:**

- Mint and burn appear only as `StakingDeposit` / `StakingWithdrawal`, never also as `ShareTransfer`
- Transfers emitted by contracts other than the sPLUSD vault are not stored as `ShareTransfer`
