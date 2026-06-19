# User stories — #685 [FE] [Stellar] sPLUSD trustline step shows OK when the user has no trustline (fails open)

Epic: #531 Stake/unstake page

---

## Story 1 — Stellar stake: sPLUSD trustline step stays actionable while share asset is resolving

**Persona:** User with a Stellar wallet connected on testnet, on the Stake page.

**Steps:**
1. Open `/stake`, switch the TopBar pill to **Stellar**.
2. Stay on the **Stake** tab and enter a valid amount.
3. Observe the "Enable sPLUSD" step row immediately after the page loads (before the share-asset `name()` call has resolved).

**Expected:** The "Enable sPLUSD" step row shows its state as "idle" (actionable "Enable" button visible, not a green check). The Stake button is disabled. The step is never prematurely marked "success" while the share asset is still loading.

---

## Story 2 — Stellar stake: sPLUSD step shows green check only after trustline is confirmed present

**Persona:** User with a Stellar wallet connected on testnet who has already added the sPLUSD trustline.

**Steps:**
1. Open `/stake`, switch the TopBar pill to **Stellar**.
2. Stay on the **Stake** tab and enter an amount within the user's PLUSD balance.
3. Wait for the share-asset `name()` call to resolve.

**Expected:** The "Enable sPLUSD" step row transitions to "success" (green check) only after the share asset resolves AND the trustline is confirmed present via `hasTrustline: true`. The Stake button becomes enabled.

---

## Story 3 — Stellar stake: sPLUSD step stays actionable when trustline is missing

**Persona:** User with a Stellar wallet connected on testnet who has NOT added the sPLUSD trustline.

**Steps:**
1. Open `/stake`, switch the TopBar pill to **Stellar**.
2. Stay on the **Stake** tab and enter a valid amount.
3. Wait for the page to fully load (name() resolved, balance checked).

**Expected:** The "Enable sPLUSD" step row shows "idle" with an actionable "Enable" button. The Stake button remains disabled until the trustline is added.

---

## Story 4 — Stellar stake: Stake button is blocked when trustline is unverified

**Persona:** User with a Stellar wallet connected on testnet.

**Steps:**
1. Open `/stake`, switch TopBar pill to **Stellar**.
2. Stay on the **Stake** tab, enter a valid amount.
3. Attempt to click the "Stake" button while the "Enable sPLUSD" step is still loading or actionable.

**Expected:** The Stake button is disabled (not clickable). A deposit cannot proceed on an unverified trustline under any circumstances — not while loading, not on error, and not while the trustline is missing.

---

## Story 5 — Stellar stake: share-asset resolution error keeps step actionable

**Persona:** User with a Stellar wallet connected on testnet, where the vault's `name()` call fails.

**Steps:**
1. Open `/stake` with network conditions that cause the Soroban `name()` RPC call to fail.
2. Switch the TopBar pill to **Stellar**, Stake tab, enter an amount.

**Expected:** The "Enable sPLUSD" step remains actionable (idle, not green). The Stake button is disabled. The user is not silently allowed to proceed as if the trustline exists. The user can retry by reconnecting or refreshing.

---

## Story 6 — Stellar unstake flow is unaffected

**Persona:** User with a Stellar wallet connected on testnet, holding sPLUSD.

**Steps:**
1. Open `/stake`, switch TopBar pill to **Stellar**.
2. Switch to the **Unstake** tab.
3. Enter an amount within the sPLUSD balance and observe the steps.

**Expected:** The unstake flow (PLUSD trustline step + Unstake action) is unaffected by this fix. The "Enable PLUSD" step and "Unstake" button behave exactly as before.

---

## Story 7 — EVM stake path unaffected (non-regression)

**Persona:** User with an EVM wallet connected.

**Steps:**
1. Open `/stake` with the TopBar pill set to **EVM** (default).
2. Enter an amount and proceed through the EVM stake flow (Approve → Stake).

**Expected:** EVM stake/unstake behavior is identical to before this fix. No regressions in the EVM path.
