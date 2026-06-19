# User stories — #634 [FE] [Stellar] Stake page: chain-aware wiring

Epic: #531 Stake/unstake page

---

## Story 1 — Stellar stake: wallet disconnected

**Persona:** User with no wallet connected.

**Steps:**
1. Open `/stake`.
2. Switch the TopBar pill to **Stellar**.

**Expected:** Wallet-disconnected banner renders (same as EVM disconnected state). No vault data, no steps, no fee row. Connect-wallet CTA is present.

---

## Story 2 — Stellar stake: full journey (trustline → stake)

**Persona:** User with a Stellar wallet connected on testnet. sPLUSD trustline not yet established.

**Steps:**
1. Open `/stake`, switch TopBar pill to **Stellar**.
2. Verify Step 1 reads "Enable sPLUSD" and is actionable (trustline missing).
3. Submit Step 1 (trustline tx); wait for confirmation.
4. Verify Step 1 shows as complete; Step 2 ("Stake") becomes active.
5. Enter a PLUSD amount. Verify the conversion card updates with a Stellar share-price estimate (7-decimal scale).
6. Verify the network-fee row shows `~0.00xx XLM` (no USD suffix).
7. Submit Step 2 (stake tx); wait for confirmation.
8. Verify a success toast appears ("Staked" or equivalent).
9. Verify sPLUSD balance updates and the page resets.

**Expected:** Full 2-step Stellar stake journey completes without errors. EVM path is unaffected.

---

## Story 3 — Stellar unstake: full journey (trustline → unstake)

**Persona:** User with a Stellar wallet connected on testnet, holding sPLUSD. PLUSD trustline not yet established.

**Steps:**
1. Open `/stake`, switch to **Unstake** tab, switch TopBar pill to **Stellar**.
2. Verify Step 1 reads "Enable PLUSD" and is actionable (PLUSD trustline missing).
3. Submit Step 1 (trustline tx); wait for confirmation.
4. Verify Step 1 shows complete; Step 2 ("Unstake") becomes active.
5. Enter an sPLUSD amount. Verify the conversion card shows PLUSD output at 7-decimal scale.
6. Verify the fee row shows `~0.00xx XLM`.
7. Submit Step 2 (unstake tx); wait for confirmation.
8. Verify a success toast appears ("Unstaked" or equivalent).
9. Verify PLUSD balance updates.

**Expected:** Full 2-step Stellar unstake journey completes without errors.

---

## Story 4 — Trustline already established: step 1 pre-completed

**Persona:** User with Stellar wallet connected; both sPLUSD and PLUSD trustlines already exist.

**Steps:**
1. Open `/stake`, switch TopBar pill to **Stellar**.
2. Check Step 1 on the Stake tab.
3. Switch to Unstake tab, check Step 1.

**Expected:** Step 1 renders as already complete on both tabs. Step 2 is immediately actionable without any trustline transaction.

---

## Story 5 — Chain switch clears stale data

**Persona:** User with both EVM and Stellar wallets configured.

**Steps:**
1. Open `/stake` on EVM. Note the displayed balance and exchange rate.
2. Switch TopBar pill to **Stellar**.
3. Observe page state immediately after the switch.
4. Switch back to EVM.

**Expected:** On switch to Stellar, any previously displayed EVM balances/amounts clear; Stellar data loads fresh. On switch back to EVM, Stellar data clears and EVM data reloads. No stale values from the other chain persist.

---

## Story 6 — EVM path unaffected (non-regression)

**Persona:** User with an EVM wallet connected.

**Steps:**
1. Open `/stake` with the TopBar pill set to **EVM** (default).
2. Enter an amount and proceed through the EVM stake flow as normal.

**Expected:** EVM stake/unstake behavior is identical to before this change. No regressions in steps, conversion card, or network fee row.
