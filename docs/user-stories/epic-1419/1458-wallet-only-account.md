# User Stories: #1458 — Header + Account: wallet connected without a session

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1458](https://github.com/eq-lab/pipeline/issues/1458)
Spec: [docs/frontend/account-page.md](../../frontend/account-page.md#wallet-only-variant-1458),
[docs/frontend/dashboard-components.md](../../frontend/dashboard-components.md#topbar),
[docs/frontend/auth-components.md](../../frontend/auth-components.md#authflowprovider),
[docs/frontend/hooks.md](../../frontend/hooks.md),
[docs/product-specs/home-screen-states.md](../../product-specs/home-screen-states.md)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-98137&m=dev
— frame `6701:98137` "No Verified Account" (header `6701:98162`, account icon `6701:98174`; wallet
card `6701:98142` → rows frame `6701:98145` with divider `7127:15564` + `Disconnect` row
`7127:15570`; Corporate email block `7129:15858` with the `Email / Add email` row `7129:15860`).
The `Disconnect` row and its divider also exist on every other connected Account frame
(`6701:97942`/`7127:15605`, `6701:97982`/`15609`, `6701:98022`/`15611`, `6701:98175`/`15603`,
`6701:98061`/`15607`), so it ships for signed-in LPs too.

**Scope note.** The connected wallet is **display-only, not a credential** — nothing links the
wallet address to an account. To get an account the visitor goes through the normal create-account
registration from the `Add email` row (same signup → OTP → session flow as Create account, #1459).
This issue ships only the entry seam (`openAddEmail()`); the Add email screen itself is #1459's.
The home grid for this visitor (home state 7) is #1460's — `deriveHomeState` is untouched, so a
wallet-only visitor still sees the zero-state grid on `/` until #1460 lands.

---

## Story 1: Header shows the account icon when a wallet is connected but there is no session

**Persona:** A visitor with no auth session who connects a wallet (EVM or Stellar).

**Pre-conditions:**
- No auth session (`useAuthSession().isAuthenticated === false`).
- No wallet connected initially.

**Steps:**

1. Load any page. Observe the header's right slot: `Sign In` / `Sign Up`.
2. Connect a wallet (either namespace).
3. Observe the header's right slot again.

**Expected outcomes:**

- Step 1: `topbar-sign-in-button` and `topbar-sign-up-button` render; `topbar-account-button` does
  not.
- Step 3: `topbar-account-button` (the same 48×48 `AccountGlyph` as the signed-in icon) renders in
  place of Sign In / Sign Up, same-tab reactive (no page reload, no remount) — `TopBar`'s
  `showAccount = isAuthenticated || useWalletPresence().isAnyConnected` flips true.
- Clicking `topbar-account-button` navigates to `/account`, exactly as it does for a signed-in LP.
- The mobile menu mirrors this: `MobileNavMenu`'s `showAccount` prop picks `mobile-account-button`
  over `mobile-sign-in-button` / `mobile-sign-up-button`.

---

## Story 2: Sign In / Sign Up return once the wallet disconnects and there is no session

**Persona:** Same visitor as Story 1, now disconnecting.

**Pre-conditions:** A wallet is connected, no session exists, the header shows the account icon.

**Steps:**

1. Navigate to `/account` and click `Disconnect` (or disconnect the wallet via the extension).
2. Observe the header.

**Expected outcomes:**

- `topbar-account-button` disappears; `topbar-sign-in-button` / `topbar-sign-up-button` reappear,
  same-tab reactive.
- This is a regression guard, not a new affordance: a signed-in LP (session present) keeps the
  account icon regardless of wallet state, unaffected by this issue.

---

## Story 3: `/account` is reachable for a wallet-only visitor; the production redirect still applies with neither

**Persona:** A visitor with no session, testing the route gate directly.

**Pre-conditions:** Production build (`ENV.IS_DEV` false).

**Steps:**

1. Load `/account` with no session and no wallet connected.
2. Load `/account` with no session but a wallet connected.
3. Hard-refresh `/account` with a wallet connected (reconnection is asynchronous on mount).

**Expected outcomes:**

- Step 1: the page renders nothing for a tick, then navigates to `/` — once wallet-presence state
  has **settled** (`useWalletPresence().isSettled`), not immediately. `blocked = !ENV.IS_DEV &&
  !isAuthenticated && !isAnyConnected`.
- Step 2: the page renders the wallet-only variant (Story 4); no navigation occurs.
- Step 3: the page does **not** bounce to `/` during the reconnection window — the gate's `useEffect`
  only navigates once `isSettled` is true, so a connected visitor who hard-refreshes never sees a
  false redirect. Before #1458 this gate lived in `beforeLoad`, which could not wait for
  asynchronous wallet hydration; moving it into the route component is what fixes this case.
- On a dev deployment (`ENV.IS_DEV` true), the page is always reachable regardless of session or
  wallet state — unchanged from before.

---

## Story 4: The wallet-only Account page composition

**Persona:** A visitor with a connected wallet and no session, on `/account`.

**Pre-conditions:** A wallet is connected (EVM or Stellar), no auth session.

**Steps:**

1. Load `/account`.

**Expected outcomes:**

- The wallet card renders its connected state (truncated address, USDC balance, divider,
  `Disconnect` row) for whichever namespace tab is active.
- `Corporate email` shows the `Add email` row (`account-add-email-row`), not a read-only `—` row.
- The Documents card renders in its `verify` composition (warning banner "Verify your account",
  upload row, requirements list, a **disabled** `Save`) — `{ kybStatus: "NotStarted", documents:
  [], stagedCount: 0 }` derives to `verify`.
- **No profile card renders** (Figma node `6701:98148` is hidden in the frame).
- **No `Submit for review` button renders** (`AccountDocumentsCard` gates it on
  `production && documents.length > 0`; `production` is `false` in this variant).
- **No `GET /v1/lps/me` request fires** — the page does not call `useAccountPage()` at all for a
  visitor with no session.
- `Log Out` still renders (full-width, bottom of the page).

---

## Story 5: A wallet-only visitor looking at the other namespace's tab keeps today's per-tab semantics

**Persona:** A visitor connected on EVM only, on `/account`.

**Pre-conditions:** EVM wallet connected, Stellar not connected, no session.

**Steps:**

1. Load `/account` (default tab is `evm`). Observe the wallet card.
2. Click the `Stellar` tab.

**Expected outcomes:**

- Step 1: the wallet card shows the connected EVM state with the `Disconnect` row.
- Step 2: the wallet card switches to the Stellar tab's own `Connect Wallet` state — no
  `Disconnect` row for that tab — while the header still shows the account icon and the page
  remains reachable (no redirect). This is a **resolved decision**, not a defect: the header and
  the route gate key on "any namespace connected" (`evm.isConnected || stellar.isConnected`), but
  the wallet **card** itself is unchanged — a tab is a view switch, identical to the signed-in
  behaviour #1284 shipped.

---

## Story 6: `Add email` opens the normal create-account registration

**Persona:** The wallet-only visitor from Story 4.

**Pre-conditions:** Same as Story 4.

**Steps:**

1. Click the `Add email` row.

**Expected outcomes:**

- `useAuthFlow().openAddEmail()` is called, which today opens the same `create-account` screen the
  header's `Sign Up` button opens (email + password → OTP → session). Nothing about the connected
  wallet is sent to or read by this flow — registering does not link the wallet address to the new
  account.
- This is a named seam, not a `TopBar`-style raw `open()` call — #1459 re-points its
  implementation to a dedicated `"add-email"` screen without touching `AccountEmailCard`.

---

## Story 7: `Upload` routes into the Add email flow instead of opening the file picker

**Persona:** The wallet-only visitor from Story 4.

**Pre-conditions:** Same as Story 4.

**Steps:**

1. Click `Upload` on the Documents card.

**Expected outcomes:**

- `openAddEmail()` fires (same flow as Story 6); the hidden file input is **not** rendered in this
  variant, so no file picker opens and no request is attempted.
- Document writes need a session (`POST /v1/lps/me/documents`), so this is the one reachable write
  affordance in the wallet-only variant that needs interception — `Save` needs none (`canSave` is
  always `false` here, so the frame's disabled `Save` renders as-is).

---

## Story 8: `Disconnect` works on both the wallet-only and a signed-in Account page

**Persona A:** The wallet-only visitor from Story 4.
**Persona B:** A signed-in LP with a wallet connected.

**Pre-conditions A:** Wallet connected, no session, viewing the connected namespace's tab.
**Pre-conditions B:** Signed in, wallet connected, viewing the connected namespace's tab.

**Steps (both):**

1. Click `Disconnect` on the wallet card.

**Expected outcomes:**

- Both: `useActiveWalletAccount().disconnect()` is called for the **active namespace** only
  (switching tabs never disconnects — regression guard).
- Persona A: with no session, the header reverts to Sign In / Sign Up (Story 2) and the home route
  falls back to the zero state.
- Persona B: the LP stays signed in; only the wallet's connection state changes. The wallet card
  shows its disconnected `Connect Wallet` state for that namespace.
- This closes TD-111 (`docs/exec-plans/tech-debt-tracker.md`) — there was previously no UI control
  to disconnect a wallet anywhere in the app.

---

## Story 9: `Log Out` disconnects every connected namespace for a wallet-only visitor

**Persona:** The wallet-only visitor from Story 4, connected on **both** namespaces (e.g. via the
mock layer).

**Pre-conditions:** No session; both EVM and Stellar wallets connected; viewing the EVM tab.

**Steps:**

1. Click `Log Out`.

**Expected outcomes:**

- `useWalletPresence().disconnectAll()` is called — **both** namespaces disconnect, not only the
  active tab's — then the app navigates to `/`.
- The header reverts to Sign In / Sign Up: the stated outcome ("logging out returns to the signed-
  out header") holds even when the visitor was sitting on a tab whose namespace was not the only
  one connected.
- The signed-in variant's `Log Out` is unchanged: it calls `signOut()` and navigates to `/`,
  leaving any connected wallet untouched (the `Disconnect` row handles that separately, per Story
  8).
