# User Stories: #1553 — Account: Log Out also disconnects the connected wallet

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1553](https://github.com/eq-lab/pipeline/issues/1553)
Spec: [docs/frontend/account-page.md](../../frontend/account-page.md#route-gate)

`Log Out` on `/account` now ends the email session **and** disconnects every connected wallet
namespace before navigating to `/`. Amends #1362 story 6 and #1458 story 9.

---

## Story 1: Signed in with a wallet connected — Log Out drops both

**Persona:** LP signed in by email who also connected a wallet (EVM or Stellar; both via the mock
layer if you want to check every namespace).

**Pre-conditions:** Session present, wallet connected, on `/account` (the wallet card shows the
address and a `Disconnect` row).

**Steps:**

1. Click `Log Out` at the bottom of the page.

**Expected outcomes:**

- The app navigates to `/`.
- The header shows "Sign In" / "Sign Up" — no account icon.
- The home page is the zero state (no session, no wallet), not the wallet-only state; the wallet
  extension reports the site as disconnected.
- `localStorage` has no `pipeline.auth.session`. Reloading keeps everything signed out and
  disconnected.

---

## Story 2: Session expiry still leaves the wallet connected (unchanged)

**Persona:** Same LP, wallet connected.

**Pre-conditions:** Session present, wallet connected.

**Steps:**

1. Let the session expire (or remove `pipeline.auth.session` and trigger an authenticated call).

**Expected outcomes:**

- The "Your session expired. Sign in again to continue." toast appears and the app returns to `/`.
- The wallet stays connected — only the explicit `Log Out` click disconnects it.
