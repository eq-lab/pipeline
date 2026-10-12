# User Stories: #1426 — Home state 6: KYB not verified due to a problem

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1426](https://github.com/eq-lab/pipeline/issues/1426)
Spec: [docs/product-specs/home-screen-states.md](../../product-specs/home-screen-states.md),
[docs/frontend/dashboard-components.md](../../frontend/dashboard-components.md#home-route),
[docs/frontend/bank-transfers.md](../../frontend/bank-transfers.md),
[docs/frontend/account-page.md](../../frontend/account-page.md)
Figma (home, desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6702-104071&m=dev
— frame `6702:104071` ("Error Verification", home-frame column), card node `6702:104191`
Figma (account): frame `6701:97982` ("Error Verification")

**Scope note (user direction, 2026-10-12):** on the home route, only the `AddUsdCard`
(`variant="declined"`) is Figma-exact for this issue. Every other card on the frame — Total
Balance, Recent activity, Get PLUSD / Stake PLUSD, Earnings, the FAQ strip — is **formal**: it
reuses state 3's composition unchanged, no new geometry work. The state is gated on `kyb_status`
alone (`ChangesRequested` or `Failed`) — no wallet-connection condition, no balance condition. The
`View` action and the Account page state it lands on are in scope.

This state renders only on the desktop (`md+`) grid. Mobile keeps today's `isConnected`-only stack
unchanged — no mobile frame exists for this state (same decision as #1421–#1424).

---

## Story 1: A ChangesRequested LP sees the state-6 grid, regardless of wallet or balances

**Persona:** An LP who signed in and whose KYB verification came back with `ChangesRequested`.

**Pre-conditions:**
- A valid session exists (signed in).
- `GET /v1/lps/me` resolves with `kyb_status: "ChangesRequested"`.
- Desktop viewport (≥768px wide).

**Steps:**

1. Load the home route (`/`) with a wallet connected and zero PLUSD/sPLUSD.
2. Observe the bottom-right stack (col 3–4, row 2).
3. Reload with the wallet **disconnected**.
4. Reload with a **non-zero** PLUSD balance, wallet connected.

**Expected outcomes:**

- Step 2: `AddUsdCard` in its `declined` variant (`data-variant="declined"`,
  `data-node-id="6702:104191"`, 313.14 × 246, no `flex-1`) stacked above `EarnedCard
  layout="compact"` in the col 3–4 stack (`data-node-id="6702:104190"`). The card shows the
  heading `We can’t verify your account` (the Figma frame's typographic apostrophe, U+2019) over
  `Please check and try again.`, a 236 × 236 warning illustration anchored at card-box `(128.86,
  48)` and clipped by the card, and a 70 × 40 dark `View` button at `(16, 190)`.
- Step 3: the grid still renders — no wallet gating. The Total Balance card flips to its
  `connect-wallet` variant (formal, reused from state 2); `AddUsdCard` stays `declined`.
- Step 4: the grid still renders `AddUsdCard variant="declined"` — no balance gating. A non-zero
  PLUSD balance does not promote this LP into state 4 or fall through to `"legacy"`.
- In every case: `RecentActivityCard`, the compact `StartHereCard` + `StakeCard` stack, and
  `QnaSection` render — the same formal composition as state 3.

---

## Story 2: View navigates to the Account page's invalid state

**Persona:** Same as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Click `View` on the `AddUsdCard`.

**Expected outcomes:**

- The app navigates to `/account` (`navigate({ to: "/account", search: { state: undefined } })`
  — the same seam state 3's `View Status` uses).
- The Account page's documents card renders the `invalid` state (Figma frame `6701:97982`):
  negative banner, no icon tile, `Re-upload your document` / `Some information may be missing or
  incorrect`, with any `Rejected` document shown as an `Invalid document` row with `Re-upload`,
  Verified rows below. This holds **whether or not** the LP has a `Rejected` document — mapping
  `ChangesRequested` directly to `invalid` fixes the case where a `ChangesRequested` LP with no
  rejected document would otherwise see the first-time "Verify your account" banner
  ([account-page.md](../../frontend/account-page.md)).
- A writable `ChangesRequested` LP keeps the upload row, requirements list, and Save button on the
  Account page — the correction affordances stay available.

---

## Story 3: A Failed kyb_status renders the same declined branch, but is unreachable in practice

**Persona:** An LP whose KYB verification was declined (`kyb_status: "Failed"`).

**Pre-conditions:** `kyb_status: "Failed"`.

**Steps:**

1. Load `/` with a `Failed` kyb_status (unit-test only — see note below).

**Expected outcomes:**

- `deriveHomeState` returns `"kyb-problem"` for `Failed` exactly as it does for
  `ChangesRequested` — the derivation does not special-case either status.
- **In a running app this is unobservable.** A `Failed` verdict suspends the account in the same
  transaction (`LpRepo::decide_kyb`), so every subsequent bearer request — including the
  `GET /v1/lps/me` the home route depends on — 403s with `account_suspended`. The home route sees
  `lpRead === "error"` and renders `"legacy"` instead. This is documented as a known gap (tech
  debt), not a bug introduced here: the derivation must stay correct regardless of today's
  suspension behaviour.

---

## Story 4: The 403 `account_suspended` read on /account shows the declined copy with no Retry

**Persona:** An LP whose account was suspended by a `Failed` KYB verdict, now attempting to load
`/account` directly.

**Pre-conditions:** A valid session whose `GET /v1/lps/me` responds `403 account_suspended`.

**Steps:**

1. Load `/account`.

**Expected outcomes:**

- The page renders `Your account verification was declined. Profile and document changes are
  unavailable.` — the same stand-in string already shipped for the `kyb_status: "Failed"` paragraph
  — in place of the raw `account_suspended` machine string.
- **No `Retry` button appears.** Retrying a terminal refusal can never succeed.
- An unrelated `403` (any other reason string) keeps today's behavior: the raw message and a
  `Retry` button both render, unaffected by this change.

---

## Story 5: Mobile is unaffected

**Persona:** Same as Story 1, on a mobile viewport (<768px).

**Pre-conditions:** Same as Story 1, viewport <768px wide.

**Steps:**

1. Load `/` at a 402px-wide viewport.

**Expected outcomes:**

- The mobile layout keeps its existing `isConnected`-only rendering. No "We can’t verify your
  account" copy and no `View` button appear on mobile — no mobile frame exists for this state.

---

## Story 6: Neighbouring combinations are unaffected

**Persona:** A signed-in LP in a different `kyb_status` / `lpRead` combination.

**Pre-conditions:** One of — `kyb_status` `NotStarted` / `InProgress` / `UnderReview` / `Passed`
(each already routed to its own state or to `"legacy"`); or `GET /v1/lps/me` still pending or
failed with a non-404 error (`lpRead` `"unknown"` / `"error"` / `"absent"`).

**Steps:**

1. Load `/`.

**Expected outcomes:**

- None of these renders the `declined` `AddUsdCard` or the "We can’t verify your account" copy.
  `lpRead` other than `"loaded"` always falls through to `"legacy"`, matching the precedence rule
  in [home-screen-states.md](../../product-specs/home-screen-states.md).
