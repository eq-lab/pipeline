# User Stories: #1887 — Trustee: match incoming wires to the LP by the issued payment reference

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1887](https://github.com/eq-lab/pipeline/issues/1887)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#match-an-incoming-wire-by-reference), [docs/product-specs/deposits.md](../../product-specs/deposits.md#wire-matching-by-payment-reference)

Trustee stories on staging. Pre-conditions for all: signed in as a Trustee on Stellar (a token for the trustee wallet); an LP that has requested bank payment details (`GET /v1/lps/me/payment-details?chain_id=…`), which issues a `PL-XXXX-XXXX-XXXX` reference once system bank details are filled. In the browser Network tab, check `GET /v1/lps?payment_details=` and the `POST /v1/lps/{id}/bank-deposits` body.

---

## Story 1: Paste a reference and land on the right LP

**Steps:**

1. Open `/lp-counterparties`.
2. In **Match an incoming wire**, paste the LP's reference in lowercase with no hyphens (for example `pl7k3mq9tx2abc`) and press **Find LP**.

**Expected outcomes:**

- Find LP is disabled while the box is blank.
- The LP's detail page opens and the Record-deposit dialog is already open with **LP payment reference** pre-filled.
- The URL no longer carries `paymentDetails` after the dialog opens; refreshing or going Back does not reopen it.

---

## Story 2: Record with the reference

**Steps:**

1. In the pre-filled dialog, enter an amount, a unique **Bank reference** and a received time, then **Record deposit**.

**Expected outcomes:**

- The `POST` body carries `payment_details` (trimmed).
- The new row shows a **Matched by reference** chip with the canonical `PL-…` reference and its issue time under the bank reference.

---

## Story 3: Record without the reference

**Steps:**

1. Open Record deposit on an LP, leave **LP payment reference** blank, fill the rest and record.

**Expected outcomes:**

- The `POST` body has no `payment_details` key.
- The row shows **Attributed by hand**.

---

## Story 4: Another LP's reference is refused

**Steps:**

1. In LP A's Record-deposit dialog, enter a reference issued to LP B and submit.

**Expected outcomes:**

- The dialog stays open and shows the served `422` text ("payment reference … was issued to LP …, not LP …").
- A second line links to Escrowed wires. No deposit is recorded.

---

## Story 5: An unknown reference points to escrow

**Steps:**

1. On `/lp-counterparties`, look up a well-formed reference that was never issued, for example `PL-AAAA-BBBB-CCCC`.
2. Click **Escrowed wires** in the notice.

**Expected outcomes:**

- The notice reads "No LP was issued this reference." and no navigation happens.
- The link opens `/cash-management?tab=escrow` on the Escrowed wires tab.

---

## Story 6: A malformed reference is rejected

**Steps:**

1. Look up `not a reference`.

**Expected outcomes:**

- The card shows "This is not a valid LP payment reference." with the served text under details.

---

## Story 7: A reused bank reference is refused

**Steps:**

1. Record a deposit with a Bank reference that an existing deposit already uses.

**Expected outcomes:**

- The dialog shows "A deposit with this bank reference is already recorded." and stays open.

---

## Story 8: A `PL-…` code in the Bank reference field is refused

**Steps:**

1. Paste an issued `PL-…` reference into **Bank reference** (leaving **LP payment reference** blank) and submit.

**Expected outcomes:**

- The served guard `422` is shown verbatim ("`payment_reference` is an issued LP payment reference …"). Nothing is recorded.

---

## Story 9: Minting a matched deposit on the same chain

**Pre-conditions:** A matched, unminted deposit whose reference was issued for Stellar; Trustee wallet connected with the Cash reporter role.

**Steps:**

1. Click **Mint PLUSD** on the row.

**Expected outcomes:**

- The confirm dialog lists **LP payment reference** and **Shown to the LP** (chain and full address).
- If the LP's current settlement address differs from the one shown, a note says PLUSD goes to the current address, and the **Receiver** row shows that current address.

---

## Story 10: A deposit matched to another chain cannot be minted here

**Pre-conditions:** A matched deposit whose reference was issued for an EVM chain; signed in on Stellar.

**Expected outcomes:**

- **Mint PLUSD** is disabled with "This wire was matched to a reference issued for {chain}. Sign in on {chain} to mint it." and nothing is read or signed.

---

## Automated coverage

`packages/trustee`: `src/api/-useLps.test.tsx`, `src/routes/-PaymentReferenceLookup.test.tsx`, `src/routes/-useLpBankDeposits.test.ts`, `src/routes/-LpBankDepositsSection.test.tsx`, `src/routes/-lp-counterparties.index.test.tsx`, `src/routes/-lp-counterparties.$id.test.tsx`, `src/routes/-cash-management-page.test.tsx`.
