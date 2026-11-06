# User Stories: #1809 — LP home: Stake card opens the connect/sign-in flow for an already-connected wallet, then jumps to /stake a few seconds later

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#1809](https://github.com/eq-lab/pipeline/issues/1809)
Plan: `docs/exec-plans/active/issue-1809-stake-card-reconnect-race.md`

While a wallet is still reconnecting after a reload, the home grid shows the loading skeleton,
Buy / Sell / Stake navigate immediately, and no connect or sign-up modal opens for that wallet.
In the zero state (no session, no wallet) Stake goes to `/stake?tab=stake` and Buy to `/deposit`.

Use a clean app URL (no `user:pass@` credentials) and a real wallet, hard-refreshing the page.

---

## Story 1: Connected wallet, Stake clicked right after a reload

**Persona:** LP with a connected wallet (EVM or Stellar).

**Steps:**

1. Connect the wallet, then hard-refresh `/`.
2. As soon as a Stake control is clickable, click it.

**Expected outcomes:**

- `/stake?tab=stake` opens at once.
- No wallet picker, terms gate or sign-up modal appears.
- Nothing navigates again after waiting about 10 seconds.

---

## Story 2: Reconnecting wallet never flashes the zero state

**Persona:** Signed-in or sessionless visitor with a previously connected wallet.

**Steps:**

1. Hard-refresh `/` on a desktop viewport.
2. Watch the dashboard card until the wallet reconnects.

**Expected outcomes:**

- The grid shows the loading skeleton, with no Get Started promo, no Connect wallet card and no CTA.
- Once the wallet settles, the grid resolves to the state for that wallet.

---

## Story 3: Zero state, Stake and Buy navigate

**Persona:** Visitor with no session and no wallet.

**Steps:**

1. Open `/` on a desktop viewport and wait for the zero state.
2. Click Stake on the Stake card.
3. Go back, then click Buy.

**Expected outcomes:**

- Stake opens `/stake?tab=stake`; Buy opens `/deposit`.
- Both pages show the "Connect your wallet first" row.
- No sign-up modal opens; Sell stays disabled; sign-up opens only from the Get Started promo.

---

## Story 4: Settled with no wallet, Stake opens the connect flow and nothing navigates later

**Persona:** Visitor with a session but no wallet (mobile or legacy layout).

**Steps:**

1. Load `/` and wait for the wallet layer to settle.
2. Click Stake; the connect modal (or terms gate) opens.
3. Dismiss it and wait about 10 seconds.

**Expected outcomes:**

- The connect flow opens once.
- No navigation to `/stake` happens after the modal was opened or dismissed.

---

## Story 5: Earn link right after a reload shows no connect row flash

**Persona:** LP with a connected wallet.

**Steps:**

1. Hard-refresh `/` and click the header "Earn" link immediately.

**Expected outcomes:**

- `/stake` opens without a flash of the "Connect your wallet first" row.
- The same holds for `/deposit` after a reload.
