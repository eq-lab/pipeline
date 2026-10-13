# User Stories: #1475 — Account page opens on the connected wallet's tab; home heading reads "Welcome back" with the account icon

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1475](https://github.com/eq-lab/pipeline/issues/1475)
Spec: [docs/frontend/account-page.md](../../frontend/account-page.md#wallet-card),
[docs/frontend/dashboard-components.md](../../frontend/dashboard-components.md#welcomeheader),
[docs/product-specs/home-screen-states.md](../../product-specs/home-screen-states.md#heading)
Figma: heading frames `6701:98220` (zero, "Welcome"), `6701:97538`, `6701:98417`, `6701:97340`,
`7149:16033` ("Welcome back")

**Scope note:** the entry tab is chosen once per `/account` entry, after wallet state settles, and
is not kept in sync afterwards. Tech debt TD-138 is narrowed, not closed.

---

## Story 1: A Stellar-only visitor lands on the Stellar tab

**Persona:** A visitor with only a Stellar wallet connected, persisted view `evm`; run once
without a session (wallet-only) and once signed in.

**Pre-conditions:** Stellar connected, EVM not connected, `pipeline.wallet.view.kind` = `evm`.

**Steps:**

1. Load `/account` by client-side navigation from `/`.

**Expected outcomes:**

- The wallet card opens on the `Stellar` tab with the connected state and the `Disconnect` row.
- `localStorage["pipeline.wallet.view.kind"]` is `stellar`.

---

## Story 2: An EVM-only visitor with a persisted Stellar view lands on Ethereum

**Persona:** A visitor with only an EVM wallet connected.

**Pre-conditions:** EVM connected, Stellar not connected, persisted view `stellar`.

**Steps:**

1. Load `/account`.

**Expected outcomes:**

- The wallet card opens on the `Ethereum` tab; storage is `evm`.

---

## Story 3: Both namespaces connected keeps the persisted tab

**Persona:** A visitor with EVM and Stellar both connected.

**Steps:**

1. With persisted view `stellar`, load `/account`. Repeat with persisted view `evm`.

**Expected outcomes:**

- The card opens on the persisted tab each time; storage is unchanged. With no wallet connected
  (dev only) the persisted tab is likewise kept.

---

## Story 4: Hard refresh chooses the tab after reconnect settles

**Persona:** The Story 1 visitor.

**Steps:**

1. Hard-refresh `/account`.

**Expected outcomes:**

- While wallets reconnect the card shows the persisted tab; once settled it switches to the
  connected namespace's tab. The connected visitor is not redirected away.

---

## Story 5: The tab stays switchable after entry

**Persona:** The Story 1 visitor.

**Steps:**

1. After the card opens on `Stellar`, click `Ethereum`.

**Expected outcomes:**

- The `Ethereum` tab stays selected and shows its own `Connect Wallet` state; nothing snaps it
  back. Storage is `evm`.

---

## Story 6: Returning to home after entering `/account` Stellar-only shows the Stellar view (TD-138 narrowed)

**Persona:** The Story 1 visitor.

**Steps:**

1. Enter `/account` (Story 1), then navigate to `/`.

**Expected outcomes:**

- The home grid reads the Stellar view, agreeing with the header's account icon. A visitor who
  never opens `/account` still sees the zero-state grid under the icon (TD-138 remainder).

---

## Story 7: The home heading per state

**Persona:** Visitors in each home state, at desktop and 402px mobile.

**Steps:**

1. Load `/` as: no session and no wallet; wallet only (EVM, and Stellar on the default EVM view);
   signed in, disconnected; signed in, connected.

**Expected outcomes:**

- No session and no wallet: "Welcome".
- Every other case: "Welcome back".
- The text is identical at desktop and 402px, and matches the frames listed above.
