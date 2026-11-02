# User Stories: #1813 — LP: connecting a wallet links it to the LP record

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1813](https://github.com/eq-lab/pipeline/issues/1813)
Spec: [docs/frontend/account-page.md](../../frontend/account-page.md#settlement-address-1813), [docs/product-specs/kyb-lp-verification.md](../../product-specs/kyb-lp-verification.md#settlement-address)

A signed-in LP with a connected Stellar wallet has that wallet linked to the LP record through
`POST /v1/lps/me/link-address`. The Account page and the account-setup modal show the served settlement
address as a read-only row. Use a real Stellar wallet and the real API; a wallet already linked to another LP
returns 409.

---

## Story 1: Connecting a Stellar wallet links it

**Persona:** Signed-in LP (`NotStarted` or `UnderReview`, LP exists) with no wallet connected.

**Steps:**

1. Open `/account` and connect a Stellar wallet.

**Expected outcomes:**

- Exactly one `POST /v1/lps/me/link-address` with the connected G-address returns 200.
- `GET /v1/lps/me` returns that address as `stellar_address` with `address_linked_at` set.
- The `Settlement address` row shows the full address with `Linked to your connected wallet.`
- The Trustee LP profile "Linked wallet" row shows the same address.

---

## Story 2: Wallet already connected, then sign in

**Persona:** LP with a Stellar wallet connected, signed out.

**Steps:**

1. Sign in. 2. Reload the page.

**Expected outcomes:**

- The link call fires once after the LP read loads.
- After the reload no second link call is made, because the served address already matches.

---

## Story 3: New account with no LP yet

**Persona:** Newly registered account with a Stellar wallet connected.

**Steps:**

1. Open Finish account setup. 2. Submit the company details.

**Expected outcomes:**

- Before submitting, the row shows the connected address with `Linked when you submit your company details.`
- After submitting, `POST /v1/lps/me` is followed by the link call, and the row shows the served address.

---

## Story 4: Replacing the wallet before the entity passes

**Persona:** LP `NotStarted` or `UnderReview` with a linked wallet.

**Steps:**

1. Disconnect and connect a different Stellar wallet.

**Expected outcomes:**

- A new link call is made with the new address and the record follows it.

---

## Story 5: Passed LP with an address is fixed

**Persona:** LP `Passed` with a settlement address already held.

**Steps:**

1. Connect a different Stellar wallet.

**Expected outcomes:**

- No link call is made.
- The row shows the served address with `Your settlement address is fixed. The connected wallet is not linked.`
- If the app's LP read was stale and the call returns 409, the served message appears in the error toast and the
  row refreshes to the served address.

---

## Story 6: Passed LP with no address yet

**Persona:** LP `Passed` that never named an address.

**Steps:**

1. Connect a Stellar wallet.

**Expected outcomes:**

- The first connect links once; a different wallet afterwards makes no call.

---

## Story 7: Wallet already linked to another LP

**Persona:** LP connecting a Stellar wallet that another LP holds.

**Steps:**

1. Connect that wallet.

**Expected outcomes:**

- The API returns 409 and its message appears in the error toast.
- The row shows `This wallet is already linked to another account. Connect a different Stellar wallet.` as an alert.
- The app does not retry the same wallet.

---

## Story 8: EVM-connected LP

**Persona:** Signed-in LP with only an EVM wallet connected.

**Expected outcomes:**

- No link call is made (a chain-aware settlement address is backend issue #1816).
- The row shows `—` and `Bank-wire settlement needs a Stellar wallet. Connect one to name your settlement address.`

---

## Story 9: Bank deposit mints to the linked wallet

**Persona:** Trustee recording a bank deposit for the linked LP.

**Steps:**

1. Record the deposit and mint.

**Expected outcomes:**

- The mint receiver is the LP's served `stellar_address`, and PLUSD lands in the linked wallet. A mint failure
  for a missing trustline or `CASH_REPORTER` role is outside this issue.
