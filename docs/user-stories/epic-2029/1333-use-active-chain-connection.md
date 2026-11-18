# User story: #1333 — Extract useActiveChainConnection() to deduplicate active-chain isConnected derivation

**Epic:** #2029
**Issue:** https://github.com/eq-lab/pipeline/issues/1333
**Status:** Initial

---

## Overview

A refactor with no intended behaviour change. The `isConnected` / address / `chain_id` derivation for the active wallet view moves into one hook, `useActiveChainConnection()` (`packages/frontend/src/wallet/`), used by `useRequests`, `useActionConfirmedRefresh`, `usePnl`, `usePositionsHistory`, `RecentActivityCard`, `/transactions` and `/`. These stories are regression checks: every state and request must look exactly as before. Spec: `docs/frontend/hooks.md`.

Persona: liquidity provider (LP). Check the Network tab for `/v1/requests`, `/v1/pnl` and `/v1/positions/history`.

---

## Story 1 — No wallet connected

**Given** a visitor with no EVM or Stellar wallet connected

**When** they open `/transactions` and the home page

**Then:**

- `/transactions` shows its empty / connect state and the home Recent Activity card shows its empty state
- No `/v1/requests`, `/v1/pnl` or `/v1/positions/history` request is sent

---

## Story 2 — EVM wallet connected

**Given** an LP signed in with an EVM wallet

**When** they open the home page and `/transactions`

**Then:**

- Recent Activity and `/transactions` list the requests of that EVM address
- P&L and the portfolio history show that address's data
- Each request carries `wallet=<0x…>` and the EVM `chain_id`

---

## Story 3 — Stellar wallet connected

**Given** an LP signed in with a Stellar wallet

**When** they open the home page and `/transactions`

**Then:**

- Recent Activity and `/transactions` list the requests of that Stellar address
- P&L and the portfolio history show that address's data
- Each request carries `wallet=<G…>` and the Stellar `chain_id`

---

## Story 4 — A confirmed action refreshes Recent Activity

**Given** a connected LP on the home page with the Recent Activity card visible

**When** they confirm a deposit, stake or withdrawal

**Then:**

- The new request shows up in Recent Activity without a manual reload
- The refresh uses the same wallet address and `chain_id` as the list request
