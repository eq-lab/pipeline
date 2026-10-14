# User story: #1498 — Stats, home strip and dashboard follow the active chain

**Epic:** #1494
**Issue:** https://github.com/eq-lab/pipeline/issues/1498
**Status:** Initial

---

## Overview

Protocol-level figures (home stats strip, stake-card APY, Protocol Dashboard) are requested for the
connected wallet's chain, and for Stellar when no wallet is connected. Rule:
[`wallet-flows.md#active-chain-for-protocol-reads`](../../frontend/wallet-flows.md#active-chain-for-protocol-reads),
dashboard: [`dashboards.md`](../../product-specs/dashboards.md), strip:
[`dashboard-components.md#homestatsstrip`](../../frontend/dashboard-components.md#homestatsstrip).
Real EVM figures depend on the staging frontend pointing at the `hoodi-v5` contracts (#1503); until
then `—` in EVM-only rows is expected.

---

## Story 1 — Visitor with no wallet sees Stellar figures

**Given** no wallet is connected

**When** the visitor opens `/` and then `/dashboard`

**Then:**

- The home strip shows Exchange rate, TVL and Current APY from the Stellar chain; every protocol request in the Network tab carries `chain_id=99000001`
- The exchange rate reads `1 sPLUSD = X.XXXX PLUSD` (4 decimals, truncated, not rounded), or `—` when the Soroban rate is unavailable
- All Protocol Dashboard panels (yield history, loan book, balance sheet, withdrawal queue) load with `chain_id=99000001`

---

## Story 2 — Connected EVM wallet sees EVM figures

**Given** an EVM wallet is connected

**When** the LP opens `/` and `/dashboard`

**Then:**

- The home strip and the stake-card "Earn X% p.a." request `/v1/stats` and `/v1/dashboard/summary` with the EVM `chain_id` (`560048` on staging)
- The exchange rate comes from the EVM `convertToAssets` read and is shown to 4 decimals, truncated
- Every Protocol Dashboard request carries the same EVM `chain_id`
- A missing figure renders `—`; nothing is computed in the browser

---

## Story 3 — EVM balance sheet reads

**Given** an EVM wallet is connected and `/dashboard` is open

**When** the Balance Sheet panel loads

**Then:**

- `PLUSD outstanding` shows the PLUSD total supply and `Cash — stablecoins (USDC)` shows the custodian's USDC balance, both read on-chain
- If a read is unavailable (for example the contract set is not yet configured), that row shows `—`, the totals footnote "Excludes assets pending a data source" is shown, and the panel does not show an error

---

## Story 4 — Switching wallet changes the figures

**Given** a Stellar wallet is connected and the home strip shows Stellar figures

**When** the LP disconnects it and connects an EVM wallet

**Then:**

- The strip and the dashboard refetch with the EVM `chain_id` (a brief loading state is acceptable)
- Disconnecting the EVM wallet returns every protocol request to `chain_id=99000001`
