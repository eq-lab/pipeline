# User Stories: #688 — [FE] [Stellar] Home page Total Balance & Stake-CTA read EVM tokens only (follow-up to #684)

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#688](https://github.com/eq-lab/pipeline/issues/688)
Plan: `docs/exec-plans/active/issue-688-home-stellar-balances.md`

Extends the home page balance wiring so a Stellar-connected session shows real
PLUSD/sPLUSD Total Balance, a correctly gated Stake CTA, and accurate mobile
balance states (State A / B / C) — mirroring the chain-select pattern already
established in `useStakeFlow.ts` and the #675 TopBar pattern.

---

## Story 1: Stellar connected, has PLUSD — Total Balance reflects balance, Stake CTA enabled

**Persona:** User (Stellar wallet connected; holds PLUSD; no sPLUSD).

**Pre-conditions:** Dev server running; active view is Stellar.

**Steps:**

1. In DevTools Console, seed a connected Stellar session with PLUSD:
   ```js
   localStorage.setItem('pipeline.mock.wallet.stellar.address', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
   localStorage.setItem('pipeline.mock.wallet.stellar.isConnected', 'true')
   localStorage.setItem('pipeline.wallet.view.kind', 'stellar')
   // 500 PLUSD at 7-decimal scale: 500 * 10^7 = 5_000_000_000
   localStorage.setItem('pipeline.mock.wallet.stellar.balance.sac.plusd', '5000000000')
   ```
2. Refresh and navigate to `http://localhost:3000/`.
3. Observe the Total Balance heading in the Portfolio card.
4. Observe the Stake CTA button.

**Expected outcomes:**

- Total Balance displays `$500.00` (not `$0.00`).
- The mobile StartHereCard shows the "PLUSD Balance" eyebrow and the balance value.
- The Stake PLUSD button is **enabled** (PLUSD > 0).

---

## Story 2: Stellar connected, has sPLUSD — Total Balance includes sPLUSD conversion, mobile State C

**Persona:** User (Stellar wallet connected; holds PLUSD and sPLUSD shares).

**Pre-conditions:** Dev server running; active view is Stellar.

**Steps:**

1. In DevTools Console:
   ```js
   localStorage.setItem('pipeline.mock.wallet.stellar.address', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
   localStorage.setItem('pipeline.mock.wallet.stellar.isConnected', 'true')
   localStorage.setItem('pipeline.wallet.view.kind', 'stellar')
   // 100 PLUSD (7-dec): 100 * 10^7 = 1_000_000_000
   localStorage.setItem('pipeline.mock.wallet.stellar.balance.sac.plusd', '1000000000')
   // 100 sPLUSD shares (7-dec): 100 * 10^7 = 1_000_000_000
   localStorage.setItem('pipeline.mock.wallet.stellar.stakedPlusd.shareBalance', '1000000000')
   // Rate 1.04 PLUSD per sPLUSD at SAC 1e7 scale
   localStorage.setItem('pipeline.mock.wallet.stellar.stakedPlusd.convertToAssets', '10400000')
   ```
2. Refresh and navigate to `http://localhost:3000/`.
3. Observe Total Balance and the mobile StakeCard.

**Expected outcomes:**

- Total Balance displays `$204.00` (100 PLUSD + 100 × 1.04 PLUSD-equivalent = 204).
- Mobile StakeCard shows the "Staked PLUSD" label and sPLUSD share count.
- Mobile RecentActivityCard is present (State C — has balance).

---

## Story 3: Stellar connected, zero balances / no trustline — $0.00, Stake CTA disabled, State A

**Persona:** User (Stellar wallet connected; no PLUSD trustline or zero balances).

**Pre-conditions:** Dev server running; active view is Stellar; no balance mock keys set.

**Steps:**

1. In DevTools Console:
   ```js
   localStorage.clear()
   localStorage.setItem('pipeline.mock.wallet.stellar.address', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
   localStorage.setItem('pipeline.mock.wallet.stellar.isConnected', 'true')
   localStorage.setItem('pipeline.wallet.view.kind', 'stellar')
   ```
2. Refresh and navigate to `http://localhost:3000/`.

**Expected outcomes:**

- Total Balance shows `$0.00`.
- Mobile StakeCard shows "Nothing to Stake" (disabled) — mobile State A.
- Mobile StartHereCard shows "Start here / Get PLUSD" (not PLUSD Balance).
- Mobile RecentActivityCard is absent (State A — empty).

---

## Story 4: EVM connected — EVM balance wiring unchanged (no regression)

**Persona:** User (EVM wallet connected; holds PLUSD and sPLUSD on EVM).

**Pre-conditions:** Dev server running; active view is EVM.

**Steps:**

1. In DevTools Console:
   ```js
   const PLUSD = '0xaaaa000000000000000000000000000000000001'
   localStorage.setItem('pipeline.mock.wallet.isConnected', 'true')
   localStorage.setItem('pipeline.mock.wallet.address', '0x1234000000000000000000000000000000000001')
   localStorage.setItem('pipeline.mock.wallet.contract.stakedPlusd.asset', PLUSD)
   // 1000 PLUSD at 18 decimals
   localStorage.setItem(`pipeline.mock.wallet.balance.${PLUSD}`, '1000000000000000000000')
   ```
2. Refresh and navigate to `http://localhost:3000/`.

**Expected outcomes:**

- Total Balance displays `$1,000.00`.
- Stake CTA enabled.
- EVM connected layout is identical to pre-#688 behaviour.
