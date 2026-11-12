# User story: #1766 — Trustee registers the per-loan debt token

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1766
**Status:** Initial

---

## Overview

Drawing a Stellar loan does not create its debt token. The Trustee registers it with one more signature, `DealTokenFactory.register_deal(loan_id)`, sent through the AccessManager. The Trustee console offers "Register debt token" under the "Approved & drawn" banner right after Approve, and on the loan detail for any Stellar loan that has none. The loan detail's "Registry state & derived" card shows the registered address in a "Debt token" row. Stellar only; EVM `registerDeal` is #1892. Spec: `docs/frontend/trustee-flows.md#register-debt-token-1766` and `docs/product-specs/loans-data.md`.

All checks use the real API and Stellar testnet on staging, no localStorage mocks. Open DevTools Network before starting.

**Prerequisites and live-testing risks:**

- `VITE_STELLAR_DEAL_TOKEN_FACTORY_ID` must be set for the environment (testnet factories: `CAIBACM6…OSIP` on 99000001, `CBAZFRND…V3UH` on 99000002) and equal the indexer's `…_DEAL_TOKEN_FACTORY_ADDRESS`. Without it the control reads "Debt token registration isn't configured for this environment."
- `register_deal` is `#[only_owner]` with the AccessManager as owner. The connected wallet needs the `TRUSTEE` role on the AccessManager for the factory's `register_deal`; this must be confirmed on testnet before the stories below.
- The DEBT token issuer must already have signed `set_admin(factory)` for the loan, otherwise the registration fails with the issuer message in Story 7.
- The deployed factory returns `Deal` as `{ cargo, debt }`; the app reads `debt` only.

---

## Story 1 — Register right after Approve

**Given** a Trustee approved a submission on Stellar and the loan was drawn in this session

**When** the Approved & drawn banner appears

**Then:**

- The banner shows "View loan #{id}" and below it "Register debt token" with the role note
- Network shows a simulated read of the factory's `deal(loan_id)` answering "not registered" (`#4`)
- Approve did not request a second signature: registering is a separate click

**When** they click "Register debt token" and sign

**Then:**

- The wallet is asked to sign one `AccessManager.execute(factory, register_deal, [loan_id])` with `loan_id` as u32
- The button shows the signing, submitting and confirming labels in turn
- Afterwards the block reads "Debt token registered · {address}" with the address in full

---

## Story 2 — Register from the loan detail

**Given** a Stellar loan with no debt token

**When** the Trustee opens its loan detail

**Then:**

- A "Debt token" card with the Register button appears on the performing, watchlist and matured layouts
- On a performing or disbursing loan the Registry card's "Debt token" row (tag chain) shows "—"

**When** they register it

**Then:** the card disappears and the "Debt token" row shows the address returned by `deal(loan_id)`, verbatim.

---

## Story 3 — An already registered loan

**Given** a Stellar loan whose debt token is registered

**When** the Trustee opens its loan detail

**Then:**

- No "Debt token" card or Register button is shown
- The Registry card's "Debt token" row shows the registered address verbatim
- The app does not use `debt_address` to decide this

---

## Story 4 — A wallet without the role

**Given** a connected wallet that holds no role for `register_deal`

**When** the Trustee looks at the control

**Then:**

- The button is disabled with "Only the Trustee role can register a loan's debt token."
- No signature can be requested

---

## Story 5 — A role with a delay

**Given** a wallet that holds the role with an execution delay

**When** the Trustee uses the control

**Then:**

- The button reads "Schedule registration" and the note names the delay
- After scheduling, the note reads "Scheduled. Executable from {time}." and the button reads "Execute registration" once the ready time passed
- Executing registers the debt token as in Story 1

---

## Story 6 — An EVM loan and an unconfigured environment

**Given** a loan on an EVM network

**When** the Trustee opens its loan detail

**Then:**

- The "Debt token" card says the on-chain actions run on Stellar only and shows no button
- The Registry card's "Debt token" row shows "—"

**Given** an environment without `VITE_STELLAR_DEAL_TOKEN_FACTORY_ID`

**Then:** the card shows "Debt token registration isn't configured for this environment." and no button.

---

## Story 7 — Contract errors read as plain copy

**Given** a registration that the contract rejects

**When** the simulation fails

**Then:**

- Already registered reads "This loan's debt token is already registered."
- An issuer that has not made the factory admin reads "The debt token issuer has not made the factory the admin of the token yet. Ask the issuer to sign set_admin, then try again."
- A loan id the registry does not know reads "The registry has no loan with this id."
- No signature was requested, and "View details" holds the raw error

---

## Story 8 — A failed read shows no action

**Given** the factory read fails with anything other than "not registered"

**When** the Trustee opens the loan detail

**Then:**

- The Registry card's "Debt token" row shows "—"
- No Register button is offered
