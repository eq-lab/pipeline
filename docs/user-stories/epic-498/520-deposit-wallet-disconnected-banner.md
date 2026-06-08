# User Stories: #520 — Deposit/withdraw wallet-disconnected banner

Epic: [#498 — Deposit/withdraw page](https://github.com/eq-lab/pipeline/issues/498)
Issue: [#520](https://github.com/eq-lab/pipeline/issues/520)

Viewport: 402×874 (mobile) and 1280×800 (desktop). Mock scenario: wallet not connected.

Figma references: desktop node 1994-6885, mobile node 1993-8916.

---

## Story 1: Disconnected deposit — banner replaces StepsCard

**Persona:** An LP who has not yet connected a wallet, visiting `/deposit`.

**Pre-conditions:**

- App is running at `/deposit?direction=deposit` (or `/deposit`).
- Wallet is not connected.

**Steps:**

1. Open `/deposit` in a browser without a connected wallet.
2. Observe the content below the conversion card.

**Expected outcomes:**

- A yellow banner is shown with the text "Connect your wallet first".
- A dark "Connect" button is visible inside the banner.
- No step buttons ("Approve", "Confirm", "Claim") are visible.
- The low-balance banner ("Add funds to your USDC balance") is not shown.

---

## Story 2: Disconnected withdraw — banner replaces StepsCard

**Persona:** An LP who has not yet connected a wallet, visiting `/deposit?direction=withdraw`.

**Pre-conditions:**

- App is running at `/deposit?direction=withdraw`.
- Wallet is not connected.

**Steps:**

1. Open `/deposit?direction=withdraw` without a connected wallet.
2. Observe the content below the conversion card.

**Expected outcomes:**

- A yellow banner is shown with the text "Connect your wallet first".
- A dark "Connect" button is visible inside the banner.
- No withdraw step labels ("Allow Pipeline to use PLUSD", "Confirm PLUSD burn", "Claim your USDC") are visible.

---

## Story 3: Connect button opens the wallet-connect flow

**Persona:** An LP who sees the disconnected banner and clicks "Connect".

**Pre-conditions:**

- App is running at `/deposit`.
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

**Persona:** An LP who connects a wallet from the deposit page.

**Pre-conditions:**

- App is running at `/deposit`.
- Wallet is not connected — the banner is visible.

**Steps:**

1. Click "Connect" and complete the wallet-connection flow.
2. Observe the page after the wallet connects.

**Expected outcomes:**

- The yellow "Connect your wallet first" banner is no longer shown.
- The three-step card (Approve / Confirm / Claim) is rendered.
- The conversion input card becomes active (not disabled).
