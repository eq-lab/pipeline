# User Stories: #1627 — EVM PLUSD / sPLUSD use their live 6 decimals

Issue: [#1627](https://github.com/eq-lab/pipeline/issues/1627) (bug, critical for the EVM launch)
Spec: [docs/frontend/wallet-flows.md#evm-token-decimals](../../frontend/wallet-flows.md#evm-token-decimals)

LP dashboard (`packages/frontend`) on the **EVM** view (Hoodi staging) with a wallet holding
e.g. 5,000 PLUSD (raw `5000000000`) and some sPLUSD. Stellar is unaffected.

---

## Story 1: Home shows the real balances and enables Stake / Sell

**Persona:** LP holding 5,000 PLUSD and 0 sPLUSD on EVM.

**Expected outcomes:**

- The home layout is the "PLUSD held" state: Stake and Sell are enabled, the StartHere line
  reads `$5,000.00`.
- After staking, the sPLUSD Total Balance card shows the share balance in dollars (not `$0.00`),
  the EarnedCard shows the served PnL at the 6-decimal scale, and the chart is no longer flat.

---

## Story 2: Stake and unstake previews

**Persona:** Same LP on `/stake`.

**Steps:**

1. Type `10` on the Stake tab; switch to Unstake and type `10`.

**Expected outcomes:**

- Stake preview shows about `9.99 sPLUSD` and the rate row `1 PLUSD = 0.99xx sPLUSD`.
- Unstake preview shows about `10.0x PLUSD` and `1 sPLUSD = 1.00xx PLUSD`.
- Before the token metadata loads the preview reads `0` and the rate `—`; neither ever shows
  `0.00` for a non-zero amount once loaded.

---

## Story 3: Activity rows

**Persona:** LP who staked 1,000 PLUSD.

**Expected outcomes:**

- Home Recent activity and `/transactions` show `−1,000.00 PLUSD / +999.xx sPLUSD` for the stake
  row, not `−0.00 / +0.00`.
- Home stats strip shows `1 sPLUSD = 1.0xxx PLUSD`.

---

## Story 4: Mock scenarios

**Persona:** Developer on `/test`.

**Expected outcomes:**

- Every EVM scenario seeds 6-decimal PLUSD / sPLUSD; the stake and withdraw scenarios show
  `100.00` balances and `10.00` request amounts.
