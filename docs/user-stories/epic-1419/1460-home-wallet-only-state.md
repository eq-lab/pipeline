# User Stories: #1460 — Home state 7: wallet connected, not signed in, PLUSD = 0, sPLUSD = 0

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1460](https://github.com/eq-lab/pipeline/issues/1460)
Spec: [docs/product-specs/home-screen-states.md](../../product-specs/home-screen-states.md),
[docs/frontend/dashboard-components.md](../../frontend/dashboard-components.md#home-route)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=7149-16033&m=dev
— frame `7149:16033` ("Wallet connected: PLUSD = 0, sPLUSD = 0", header `7149:16817`, account icon
`7149:16828`)

**Scope note:** `7149:16033` resolves to state 3's composition verbatim with one card swap — the
Shape B slot mounts `AddUsdCard variant="verify"` (the same card state 2 uses) instead of
`"verifying"`. No new geometry work was needed for this issue. The header's account icon over
Sign In / Sign Up was already shipped by #1458; this issue only has to not regress it.

This state renders only on the desktop (`md+`) grid. Mobile keeps today's `isConnected`-only stack
unchanged — the sessionless connected visitor already renders `mobileHomeState === "empty"`
(State A), which is this state's mobile reading (see Story 5).

---

## Story 1: A connected, sessionless visitor with zero balances sees the state-7 grid

**Persona:** A visitor who has connected an EVM or Stellar wallet, has no auth session (no email
account), and whose connected wallet holds neither PLUSD nor sPLUSD.

**Pre-conditions:**
- No session in `localStorage`.
- A wallet is connected (EVM or Stellar) on its active view.
- PLUSD and sPLUSD both display as zero for that wallet (the #1186 displayed-zero rule).
- Desktop viewport (≥768px wide).

**Steps:**

1. Load the home route (`/`).
2. Observe the top-left card (col 1–4, row 1).
3. Observe the top-right card (col 5–7).
4. Observe the bottom-left stack (col 1–2, row 2).
5. Observe the bottom-right stack (col 3–4, row 2).
6. Observe the bottom strip (col 1–7, row 3).
7. Observe the header.

**Expected outcomes:**

- Step 2: `PortfolioPlaceholderCard variant="get-plusd"` (643×274) shows "Total Balance", the served
  `$0.00` heading (the sPLUSD-position binding, not a default — same decision #1424 took for state
  4), an underlined navy `Get PLUSD to start` link, the period tabs, and the flat placeholder chart.
  No "Get Started" / "Sign Up" copy and no "Connect wallet" link appear.
- Step 3: `RecentActivityCard padding="md"` (477.71×634) shows its empty placeholder — "You will see
  all transactions here".
- Step 4: `StartHereCard layout="compact"` ("Get PLUSD" / "Convert with USDC 1:1") stacked above
  `StakeCard layout="compact"` ("Stake PLUSD" / "Earn X% p.a." / "From senior loan coupons and
  T-bills"), `gap-4`, both 313.14×164, `data-node-id="7149:16787"` on the wrapper. `Buy` is enabled
  and **default navy** (no `compactVariant="balance"` tinting — state 7's `Buy` treatment matches
  states 1–3, not state 4). `Sell` is disabled at 32% opacity.
- Step 5: `AddUsdCard variant="verify"` ("Verify your account" / "Complete KYB to unlock bank
  transfers." / "Start Verification", 313.14×246, no `flex-1`) stacked above `EarnedCard
  layout="compact"` ("Earnings" / "Tracked once you stake", 313.14×82), `gap-4`,
  `data-node-id="7149:16152"` on the wrapper.
- Step 6: `QnaSection` renders unchanged, spanning the full 1136px content width.
- Step 7: the header shows the account icon (Figma `7149:16828`), not Sign In / Sign Up — shipped
  by #1458; this issue only verifies it is not regressed.

---

## Story 2: Start Verification opens the Add email screen, not account setup — and the follow-on

**Persona:** Same as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Click `Start Verification` on the `AddUsdCard`.
2. Complete the Add email → OTP flow to get a session.
3. Reload `/` after step 2.

**Expected outcomes:**

- Step 1: the click calls `useAuthFlow().openAddEmail()`, opening the Add email screen shipped by
  #1459 — **not** `openAccountSetup()` (the `CompanyDocsModal` seam), which is a silent no-op
  without a session (`AuthFlowProvider`'s `setup` is `null` until a token exists). Neither the
  wallet connect modal nor the `create-account` auth flow screen opens.
- Step 3 (expected follow-on, not a defect): the visitor is now signed-in + connected +
  `lpRead: "absent"` (no LP profile submitted). This combination is not `"unverified"`
  (`deriveHomeState`'s `"unverified"` branch requires the wallet to be **disconnected**), so the
  grid renders `"legacy"` — today's pre-#1419 taller-card layout, with no `AddUsdCard` at all. The
  "Verify your account" card the visitor just acted on disappears until the session + connected +
  `NotStarted`/absent combination gets its own design (tracked as tech debt, TD-139).

---

## Story 3: Buy navigates; Sell and the Stake CTA are inert

**Persona:** Same as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Click `Buy` on `StartHereCard`.
2. Observe `Sell` on `StartHereCard`.
3. Observe the Stake CTA on `StakeCard`.

**Expected outcomes:**

- Step 1: navigates to `/deposit?direction=deposit` — the same action a connected visitor gets
  anywhere else on the grid. `/deposit` carries no `beforeLoad` auth guard, so no session is
  required. Neither the connect modal nor the auth flow opens.
- Step 2: `Sell` is disabled (32% opacity) — PLUSD displays as zero.
- Step 3: the CTA reads `Nothing to Stake` and is disabled, tinted at 32% opacity — sPLUSD and
  PLUSD both display as zero.

---

## Story 4: Neighbouring combinations fall back to the correct state

**Persona:** Visitors just outside state 7's exact condition.

**Steps / Expected outcomes:**

1. Same wallet, no session, but a **non-zero** PLUSD or sPLUSD balance → the zero-state composition
   (state 1), not state 7. This is the existing undesigned fall-through
   (`docs/user-stories/epic-1419/1421-home-zero-state.md`, Story 3) — not a new defect.
2. No wallet connected, no session → the zero-state composition (state 1 still owns the no-wallet
   case).
3. Same wallet and balances, but **signed in** → unchanged from today (`"legacy"`, or whichever KYB
   branch applies) — state 7 never applies to a signed-in visitor.

---

## Story 5: Mobile is unaffected

**Persona:** Same as Story 1, on a mobile viewport (<768px).

**Pre-conditions:** Same as Story 1, viewport <768px wide.

**Steps:**

1. Load `/` at a 402px-wide viewport.

**Expected outcomes:**

- The mobile block branches on `isConnected` alone, never on `homeState`, so this visitor already
  renders `mobileHomeState === "empty"` (State A): `PortfolioPlaceholderCard` with `$0.00`,
  `StartHereCard` + `EarnedCard` left, `StakeCard` with a disabled "Nothing to Stake" right, no
  `RecentActivityCard`, `HomeStatsStrip` at the bottom. The heading reads "Welcome back" (mobile
  keys the greeting on `isConnected`, independent of session).
- The only visible difference from a signed-in State A visitor is the absence of a
  `Verify your account` card, for which no mobile frame exists — not a gap introduced by this
  issue.

---

## Story 6: The header keeps its #1458 account icon

**Persona:** Same as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Observe `TopBar` (desktop) or `MobileNavMenu` (mobile).

**Expected outcomes:**

- The account icon renders (Figma `7149:16828`), not Sign In / Sign Up —
  `TopBar`/`MobileNavMenu` key on `useWalletPresence().isAnyConnected || isAuthenticated` (#1458).
  This issue does not touch the header; this story is a regression check only.
