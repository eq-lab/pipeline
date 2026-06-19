# User stories — #692: Stellar shared connection state

Source: https://github.com/eq-lab/pipeline/issues/692
Epic: #556 — Connect page / TopBar header

## Context

Previously, connecting a Stellar wallet via the connect modal updated only that
component's local `useState`. Other consumers of `useStellarWallet()` (TopBar,
home page, deposit, stake, …) each held independent `useState` instances and
never received the update — so "Connect Wallet" buttons stayed visible until a
full page reload.

This issue replaces the per-instance state with a module-level external store
(`useSyncExternalStore`), so connecting or disconnecting in any one component
propagates immediately to every `useStellarWallet()` consumer.

---

## Story 1: Connect in the modal — TopBar updates without reload

**Persona:** A user who has never connected a wallet.

**Precondition:** The app is loaded. No wallet is connected (EVM or Stellar).
The TopBar shows a "Connect Wallet" CTA button.

**Steps:**

1. Click the "Connect Wallet" CTA in the TopBar to open the connect modal.
2. Select the "Soroban" tab in the connect modal.
3. Choose a Stellar wallet (e.g. Lobstr, xBull, Freighter) and complete the
   connection flow (approve in the wallet extension / auth modal).
4. Observe the TopBar without reloading the page.

**Expected outcome:**

- The "Connect Wallet" button in the TopBar disappears and is replaced by the
  connected wallet pill (address + balance) immediately after step 3 completes.
- No page reload is required.

---

## Story 2: Connect on the home page — header and other CTAs flip simultaneously

**Persona:** A user on the home page who has not yet connected a Stellar wallet.

**Precondition:** Home page is open. TopBar shows "Connect Wallet". Home page
shows a "Connect Wallet" banner or CTA (the wallet-not-connected state).

**Steps:**

1. Click the "Connect Wallet" CTA on the home page (not in the TopBar).
2. In the resulting connect modal, select "Soroban" tab and complete the
   Stellar wallet connection.
3. Observe the TopBar and the home page simultaneously after connection.

**Expected outcome:**

- The TopBar "Connect Wallet" button flips to the connected pill at the same
  time as the home page transitions to its connected state.
- Both components update in the same render cycle; neither requires a reload.

---

## Story 3: Disconnect in the TopBar — all CTAs revert to disconnected state

**Persona:** A user with a connected Stellar wallet.

**Precondition:** A Stellar wallet is connected. TopBar shows the wallet pill.
Home page shows the connected (balance) state.

**Steps:**

1. Click the wallet pill in the TopBar to open the `AccountDropdown`.
2. Click "Disconnect" in the dropdown.
3. Observe the TopBar and the home page without reloading.

**Expected outcome:**

- The TopBar wallet pill is replaced by the "Connect Wallet" CTA immediately.
- The home page reverts to its wallet-not-connected state (shows the Connect
  Wallet banner / CTA) in the same render cycle.
- No page reload is required.

---

## Story 4: Disconnect on any page — all consumers revert

**Persona:** A user with a connected Stellar wallet who is on the deposit page.

**Precondition:** Stellar wallet connected. Deposit page shows the connected
state (step card / action buttons active). TopBar shows wallet pill.

**Steps:**

1. Navigate to the deposit page.
2. Trigger disconnect via the TopBar `AccountDropdown`.
3. Observe the deposit page and the TopBar simultaneously.

**Expected outcome:**

- The deposit page shows the "Connect Wallet" banner (disconnected state)
  immediately after disconnect.
- The TopBar wallet pill is replaced by "Connect Wallet" at the same time.
- Neither component requires a page reload to reflect the disconnected state.

---

## Story 5: EVM wallet behaviour is unaffected

**Persona:** A user who connects an EVM wallet (not Stellar).

**Precondition:** No wallet connected.

**Steps:**

1. Connect an EVM wallet via the connect modal.
2. Observe the TopBar, home page, and deposit page.

**Expected outcome:**

- All components update to connected state as before — this change does not
  regress EVM wallet reactivity.
- The Stellar `isConnected` flag remains `false` for all consumers while only
  an EVM wallet is connected.

---

## Story 6: Mock / test environment — mock state still takes precedence

**Persona:** Developer running the app with a mock Stellar address configured.

**Precondition:** `VITE_MOCK_STELLAR_ADDRESS` env var is set. App is loaded.

**Steps:**

1. Open the app without connecting any wallet through the UI.
2. Observe the TopBar and pages.

**Expected outcome:**

- The app shows the mock address as connected across all pages (mock precedence
  is preserved — the mock store result overrides the real connection store).
- The shared connection store does not interfere with mock mode.
