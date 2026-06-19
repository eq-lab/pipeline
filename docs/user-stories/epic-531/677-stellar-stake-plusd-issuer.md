# User stories — #677 [FE] [Stellar] Stake page reads PLUSD balance as 0 — assetIssuer hardcoded to ""

Epic: #531 Stake/unstake page

---

## Story 1 — Stellar stake: PLUSD balance reflects real holding

**Persona:** User with a Stellar wallet connected on testnet, holding PLUSD (issued by the protocol issuer `GC5SUAXM…`).

**Steps:**
1. Open `/stake`, switch the TopBar pill to **Stellar**.
2. Stay on the **Stake** tab.
3. Observe the PLUSD balance shown on the input card.

**Expected:** The balance displays the user's real PLUSD amount (e.g. "50.00"), not "0". The stake input is active (not blocked by "no balance"). The Approve / Stake step buttons are enabled once an in-range amount is entered.

---

## Story 2 — Stellar stake: input enabled for PLUSD holder

**Persona:** User holding PLUSD on Stellar testnet (balance > 0).

**Steps:**
1. Open `/stake`, switch TopBar pill to **Stellar**.
2. Enter an amount ≤ the displayed PLUSD balance into the stake input.
3. Observe the step buttons.

**Expected:** The Step 1 ("Enable sPLUSD") and Step 2 ("Stake") buttons are actionable (not disabled). `hasBalance = true` is reflected in the UI — the flow can proceed.

---

## Story 3 — Stellar unstake: sPLUSD balance unaffected

**Persona:** User with a Stellar wallet connected on testnet, holding sPLUSD.

**Steps:**
1. Open `/stake`, switch TopBar pill to **Stellar**.
2. Switch to the **Unstake** tab.
3. Observe the sPLUSD balance.

**Expected:** sPLUSD balance (read from the vault contract, not from Horizon issuer-matching) displays the real amount. The unstake input is active for an in-range amount. This path was not broken by the bug but must be verified as a non-regression.

---

## Story 4 — EVM path unaffected (non-regression)

**Persona:** User with an EVM wallet connected.

**Steps:**
1. Open `/stake` with the TopBar pill set to **EVM** (default).
2. Enter an amount and proceed through the EVM stake flow.

**Expected:** EVM stake/unstake behavior is identical to before this fix. PLUSD balance reads correctly via `useEvmToken` (unrelated to the Horizon issuer-matching path). No regressions.
