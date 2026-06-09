# User Stories: #533 — Stake/unstake wallet-disconnected banner

Epic: [#531 — Stake/unstake page](https://github.com/eq-lab/pipeline/issues/531)
Issue: [#533](https://github.com/eq-lab/pipeline/issues/533)

Viewport: 402×874 (mobile) and 1280×800 (desktop). Mock scenario: wallet not connected.

Figma references: desktop node 1994-7280.

---

## Story 1: Disconnected wallet on Stake tab — banner replaces StepsCard

**Persona:** A user who has not yet connected a wallet, visiting `/stake` on the Stake tab.

**Pre-conditions:**

- App is running at `/stake`.
- Wallet is not connected.

**Steps:**

1. Open `/stake` in a browser without a connected wallet.
2. Observe the content below the output card (exchange rate / network fee row).

**Expected outcomes:**

- A yellow banner is shown with the text "Connect your wallet first".
- A dark "Connect" button is visible inside the banner.
- No step action buttons ("Approve", "Stake") are visible.
- The input card (tab switcher + PLUSD token input) is still visible.
- The output card (sPLUSD amount display + exchange rate + network fee) is still visible.

---

## Story 2: Disconnected wallet on Unstake tab — banner replaces StepsCard

**Persona:** A user who has not yet connected a wallet, switching to the Unstake tab on `/stake`.

**Pre-conditions:**

- App is running at `/stake`.
- Wallet is not connected.

**Steps:**

1. Open `/stake` without a connected wallet.
2. Click the "Unstake" tab in the segmented tab control.
3. Observe the content below the output card.

**Expected outcomes:**

- The yellow "Connect your wallet first" banner is still shown (tab-agnostic).
- No "Unstake" step action button is visible.
- The input card now shows the sPLUSD token input.
- The output card now shows the PLUSD amount display.

---

## Story 3: Connect button opens the wallet-connect flow

**Persona:** A user who sees the disconnected banner and clicks "Connect".

**Pre-conditions:**

- App is running at `/stake`.
- Wallet is not connected.
- The "Connect your wallet first" banner is visible.

**Steps:**

1. Click or tap the "Connect" button in the yellow banner.
2. Observe whether a wallet-connection modal appears.

**Expected outcomes:**

- Clicking "Connect" triggers the AppKit wallet-connection flow (same as the home-page CTA).
- If terms have not been acknowledged, the terms gate opens before the AppKit modal.
- No error is thrown.

---

## Story 4: After connecting, banner disappears and StepsCard renders

**Persona:** A user who connects a wallet from the stake page.

**Pre-conditions:**

- App is running at `/stake`.
- Wallet is not connected — the banner is visible.

**Steps:**

1. Click "Connect" and complete the wallet-connection flow.
2. Observe the page after the wallet connects.

**Expected outcomes:**

- The yellow "Connect your wallet first" banner is no longer shown.
- The two-step card (Approve / Stake) is rendered on the Stake tab.
- The single-step card (Unstake) is rendered on the Unstake tab.
- The token input becomes active (not disabled).
