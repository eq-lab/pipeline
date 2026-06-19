# User Stories: #684 — [FE] [Stellar] Home page shows "Connect wallet" when only a Stellar wallet is connected

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#684](https://github.com/eq-lab/pipeline/issues/684)
Plan: `docs/exec-plans/active/issue-684-home-stellar-connection-gate.md`

Fix the home page connection gate so that a Stellar-only session shows the
connected portfolio layout instead of the "Connect wallet" promo card.
The gate now reads `stellar.isConnected` when `useWalletView().kind === "stellar"`,
mirroring the deposit/stake convention.

Note: Total Balance and Stake CTA remain EVM-sourced. A Stellar-only session
sees the connected layout with $0.00 — Stellar balance wiring is a follow-up
sub-issue of epic #463.

---

## Story 1: Stellar-only session — connected portfolio view renders

**Persona:** User (Stellar wallet connected, no EVM wallet).

**Pre-conditions:** Dev server running; the active view is "Stellar" (either set
by a prior Stellar connect, or manually via the TopBar chain toggle).

**Steps:**

1. In DevTools Console, seed a connected Stellar mock wallet and switch to Stellar view:
   ```js
   localStorage.setItem('pipeline.mock.wallet.stellar.address', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
   localStorage.setItem('pipeline.mock.wallet.stellar.isConnected', 'true')
   localStorage.setItem('pipeline.wallet.view.kind', 'stellar')
   ```
2. Refresh the page and navigate to `http://localhost:3000/`.
3. Observe the top-left card.

**Expected outcomes:**

- The top-left slot shows the Portfolio placeholder card ("Total Balance", "$0.00",
  "Get PLUSD to start" link, segmented tabs, chart).
- The "Connect Wallet" promo card is absent.
- No "Connect wallet" heading is visible anywhere on the page.
- Total Balance shows "$0.00" (EVM balance hooks return zero; this is expected
  until Stellar balance wiring is implemented in a follow-up).

---

## Story 2: EVM-only session, EVM view — connected layout unchanged

**Persona:** User (EVM wallet connected, no Stellar wallet; view kind is EVM).

**Pre-conditions:** Dev server running; active view is "EVM" (default).

**Steps:**

1. In DevTools Console:
   ```js
   localStorage.setItem('pipeline.mock.wallet.isConnected', 'true')
   localStorage.setItem('pipeline.mock.wallet.address', '0x1234000000000000000000000000000000000001')
   ```
2. Refresh the page and navigate to `http://localhost:3000/`.
3. Observe the top-left card.

**Expected outcomes:**

- The Portfolio placeholder card renders (no regression).
- "Total Balance" heading is visible.
- "Connect Wallet" promo card is absent.

---

## Story 3: Disconnected session (both chains), Stellar view — promo card renders

**Persona:** User (no wallets connected; view kind is Stellar).

**Pre-conditions:** Dev server running; no mock keys set; active view is Stellar.

**Steps:**

1. In DevTools Console:
   ```js
   localStorage.clear()
   localStorage.setItem('pipeline.wallet.view.kind', 'stellar')
   ```
2. Refresh and navigate to `http://localhost:3000/`.
3. Observe the top-left card.

**Expected outcomes:**

- The "Connect Wallet" promo card renders.
- "Total Balance" heading is absent.

---

## Story 4: Stellar connected, EVM view active — promo card renders (view-kind semantics)

**Persona:** User (Stellar wallet connected, but active view switched to EVM; EVM not connected).

**Pre-conditions:** Dev server running; Stellar mock seeded; active view is EVM.

**Steps:**

1. In DevTools Console:
   ```js
   localStorage.setItem('pipeline.mock.wallet.stellar.address', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
   localStorage.setItem('pipeline.mock.wallet.stellar.isConnected', 'true')
   localStorage.setItem('pipeline.wallet.view.kind', 'evm')
   ```
2. Refresh and navigate to `http://localhost:3000/`.
3. Observe the top-left card.

**Expected outcomes:**

- The "Connect Wallet" promo card renders, because the active view is EVM and
  the EVM wallet is not connected.
- This documents the chosen view-kind semantics: the home page mirrors the
  deposit/stake convention — it gates on the active namespace only, not on
  "any connected chain".
