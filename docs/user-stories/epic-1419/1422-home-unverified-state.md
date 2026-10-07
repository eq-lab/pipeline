# User Stories: #1422 — Home state 2: account created but not verified, wallet not connected

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1422](https://github.com/eq-lab/pipeline/issues/1422)
Spec: [docs/product-specs/home-screen-states.md](../../product-specs/home-screen-states.md),
[docs/frontend/dashboard-components.md](../../frontend/dashboard-components.md#home-route)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-97538&m=dev

Follow-up defects found while testing this state have their own docs:
[#1429](./1429-account-setup-dismissal-persistence.md) (account-setup modal reopens on reload) and
[#1430](./1430-addusdcard-verify-illustration-anchor.md) (`AddUsdCard` verify frame and artwork
anchor).

This state renders only on the desktop (`md+`) grid. Mobile keeps today's `isConnected`-only stack
unchanged — no mobile frame exists yet for this state (decision recorded on #1421, reapplied here).

---

## Story 1: Signed-in, unverified, disconnected visitor sees the unverified-state grid

**Persona:** An LP who signed in but either bypassed KYB registration or never completed it, and
has not connected a wallet.

**Pre-conditions:**
- A valid session exists (signed in).
- `GET /v1/lps/me` reports either 404 (no LP record) or a loaded LP with `kyb_status: "NotStarted"`.
- No wallet connected.
- Desktop viewport (≥768px wide).

**Steps:**

1. Load the home route (`/`).
2. Observe the top-left card (col 1–4, row 1).
3. Observe the top-right card (col 5–7).
4. Observe the bottom-left stack (col 1–2, row 2).
5. Observe the bottom-right stack (col 3–4, row 2).
6. Observe the bottom strip (col 1–7, row 3).

**Expected outcomes:**

- Step 2: A pale-yellow "Total Balance" card shows `$0.00` and a `Connect wallet` link in place of
  the unrealized-PnL caption, plus the period tabs and the flat zero-value placeholder chart. No
  "Get Started" heading or "Sign Up" button appears.
- Step 3: `RecentActivityCard` shows its empty placeholder.
- Step 4: `StartHereCard` is stacked above `StakeCard`, `gap-4` (`data-node-id="6701:97659"`).
- Step 5: `AddUsdCard` in its `verify` variant ("Verify your account" / "Complete KYB to unlock
  bank transfers." / "Start Verification" button, `data-variant="verify"`) is stacked above
  `EarnedCard`, `gap-4` (`data-node-id="6701:97694"`).
- Step 6: `QnaSection` renders unchanged.

---

## Story 2: Buy and Stake open the wallet-connect modal; Sell is disabled

**Persona:** Same as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Click "Connect wallet" on the Total Balance card.
2. Close the modal. Click "Buy" on `StartHereCard`.
3. Close the modal. Click "Stake" on `StakeCard`.
4. Observe the "Sell" button on `StartHereCard`.

**Expected outcomes:**

- Steps 1–3 each open the shared wallet-connect modal (`useConnectModal().open()`) — not the
  email/password auth flow.
- Step 4: "Sell" is disabled (matches the disconnected CTA rule).

---

## Story 3: Start Verification reopens account setup

**Persona:** Same as Story 1.

**Pre-conditions:** Same as Story 1. The user previously dismissed the "Finish account setup"
modal (`CompanyDocsModal`).

**Steps:**

1. Click "Start Verification" on the `AddUsdCard`.

**Expected outcomes:**

- The "Finish account setup" modal reopens. No navigation occurs and no new modal is built — this
  reuses the modal `AuthFlowProvider` already mounts for a KYB-bypassed or incomplete account.

---

## Story 4: A connected wallet falls through to the legacy layout

**Persona:** A signed-in LP with `kyb_status: "NotStarted"` (or an absent LP record) who has
connected a wallet.

**Pre-conditions:** Signed in, KYB not started or LP absent, a wallet connected.

**Steps:**

1. Load `/`.

**Expected outcomes:**

- The desktop grid renders today's pre-#1419 connected layout (`PortfolioPlaceholderCard` default
  variant, "Get PLUSD to start" link) — the `"legacy"` branch. A connected wallet with
  `kyb_status: "NotStarted"` is a combination not yet designed (precedence rule,
  `docs/product-specs/home-screen-states.md`).

---

## Story 5: An in-flight or failed LP read falls through to the legacy layout

**Persona:** Same as Story 1, but the `GET /v1/lps/me` request has not yet resolved, or resolved
with a non-404 error.

**Pre-conditions:** Signed in, wallet disconnected, `GET /v1/lps/me` pending or erroring (not 404).

**Steps:**

1. Load `/` while the LP read is in flight or has failed.

**Expected outcomes:**

- The desktop grid renders today's pre-#1419 disconnected layout (`ConnectWalletPromoCard` default
  variant) — request failures do not imply an empty account, so this state never fabricates a
  loading or empty-account UI (`docs/product-specs/kyb-lp-verification.md`).

---

## Story 6: Mobile is unaffected

**Persona:** Same as Story 1, on a mobile viewport (<768px).

**Pre-conditions:** Same as Story 1, viewport <768px wide.

**Steps:**

1. Load `/` at a 402px-wide viewport.

**Expected outcomes:**

- The mobile layout is unaffected by this issue — it keeps its existing `isConnected`-only
  rendering (`ConnectWalletPromoCard` default variant, `StartHereCard` + `EarnedCard` left,
  `StakeCard` right, no `RecentActivityCard`). No "Verify your account" copy appears on mobile.
