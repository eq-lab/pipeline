# User Stories: #1421 — Home state 1: zero state (not signed in, no account, wallet not connected)

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1421](https://github.com/eq-lab/pipeline/issues/1421)
Spec: [docs/product-specs/home-screen-states.md](../../product-specs/home-screen-states.md),
[docs/frontend/dashboard-components.md](../../frontend/dashboard-components.md#home-route)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-98220&m=dev

This state renders only on the desktop (`md+`) grid. Mobile keeps epic #463's existing
disconnected stack unchanged — no mobile frame exists yet for the zero state (decision recorded on
the Issue, 2026-10-07).

---

## Story 1: Unauthenticated desktop visitor sees the zero-state grid

**Persona:** A new visitor on a desktop browser (≥768px wide) who has never signed in, has no
account, and has not connected a wallet.

**Pre-conditions:**
- App is running, no session in `localStorage`, no wallet connected.
- Desktop viewport (≥768px wide).

**Steps:**

1. Load the home route (`/`).
2. Observe the top-left card (col 1–4, row 1).
3. Observe the top-right card (col 5–7).
4. Observe the bottom-left stack (col 1–2, row 2).
5. Observe the bottom-right stack (col 3–4, row 2).
6. Observe the bottom strip (col 1–7, row 3).

**Expected outcomes:**

- Step 2: A pale-yellow promo card shows heading "Get Started", sub-line "Access real-world yield
  on-chain", and a dark "Sign Up" button (`data-testid="home-connect-wallet-card"`). No "Connect
  Wallet" heading or "Connect" CTA appears on the desktop grid.
- Step 3: `RecentActivityCard` shows its empty placeholder — "Recent activity" heading, the empty
  illustration, and "You will see your transactions here".
- Step 4: `StartHereCard` ("Start here" / "Get PLUSD" / "Convert USDC 1:1") is stacked above
  `StakeCard` (its marketing CTA — "Stake PLUSD" eyebrow, "Earn X% p.a." heading, active "Stake"
  circular button), `gap-4`.
- Step 5: `AddUsdCard` in its `locked` variant ("Add USD" / "Use a bank transfer" / "KYB
  verification required", circular "Add Funds" button disabled) is stacked above `EarnedCard`
  ("Earnings" / "Tracked once you stake"), `gap-4`.
- Step 6: `QnaSection` renders unchanged ("Questions & answers" / "How it works?" / "What is
  PLUSD?" / "What is sPLUSD?").

---

## Story 2: Every CTA opens the sign-up auth flow, not the wallet connect modal

**Persona:** Same as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Click "Sign Up" on the promo card.
2. Close the modal. Click "Buy" on `StartHereCard`.
3. Close the modal. Click "Stake" on `StakeCard`.
4. Observe the "Sell" button on `StartHereCard`.

**Expected outcomes:**

- Steps 1–3 each open the same two-pane auth modal on its "Create account" screen — not the wallet
  connect chooser. (The modal is the production auth flow from epic #1247; see
  `docs/frontend/auth-components.md`.)
- Step 4: "Sell" is disabled (32%-opacity secondary), matching the Figma frame.

---

## Story 3: A connected wallet does not override the zero state while signed out

**Persona:** A visitor who has connected an EVM or Stellar wallet but has no account/session.

**Pre-conditions:** No session in `localStorage`; a wallet is connected (EVM or Stellar).

**Steps:**

1. Load `/` with a wallet connected and no session.

**Expected outcomes:**

- The desktop grid still renders the zero-state composition from Story 1 — the wallet connection
  is ignored for this decision (precedence rule, `docs/product-specs/home-screen-states.md`).
  This unauthenticated-but-connected combination is not yet a distinct designed state.

---

## Story 4: Signing in supersedes the zero state even with no wallet connected

**Persona:** A registered LP who has signed in but has not connected a wallet.

**Pre-conditions:** A valid session exists in `localStorage` (e.g. via a successful sign-in); no
wallet connected.

**Steps:**

1. Load `/`.

**Expected outcomes:**

- The desktop grid renders today's pre-#1419 disconnected layout (`ConnectWalletPromoCard`
  default variant, "Connect Wallet" / "Connect") — the `"legacy"` branch, unaffected by this issue.
  States 2–6 (account-created / KYB-driven layouts) are out of scope for #1421 and land in
  #1422–#1426.

---

## Story 5: Mobile is unaffected

**Persona:** Same as Story 1, on a mobile viewport (<768px).

**Pre-conditions:** No session, no wallet connected, viewport <768px wide.

**Steps:**

1. Load `/` at a 402px-wide viewport.

**Expected outcomes:**

- The mobile layout is byte-for-byte the same as `docs/user-stories/epic-463/465-mobile-home-base.md`
  Story 1 — `ConnectWalletPromoCard` default variant, `StartHereCard` + `EarnedCard` left,
  `StakeCard` right, no `RecentActivityCard`. No "Get Started" / "Sign Up" copy appears on mobile.
