# User Stories: #1817 — LP: Funding details modal with bank details and a fresh payment reference

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1817](https://github.com/eq-lab/pipeline/issues/1817)
Spec: [docs/frontend/bank-transfers.md](../../frontend/bank-transfers.md) § FundingDetailsModal

Exercised on `/` as a signed-in LP with `kyb_status: "Passed"` and a connected wallet (home states
passed-empty, plus-held, passed-staked), against the real API, with the browser Network tab open.
The `/test?tab=auth` openers `Open Funding details: ready | loading | not linked | error` show each
state without a network call. Styling-only assertions are out of scope.

---

## Story 1: A linked LP sees the bank details, a payment reference, and where the funds land

**Persona:** Passed LP with a linked settlement address for the active chain.

**Pre-conditions:** `system_configuration.system_bank_details` is filled in; the wallet view is the
chain whose address is linked.

**Steps:**

1. On `/`, click `Add Funds`.

**Expected outcomes:**

- A dialog headed `Funding details` opens; the six bank rows and a `Payment reference` row
  (`PL-XXXX-XXXX-XXXX`) show the served values verbatim; an empty served field shows `—`.
- An instruction line says to add the reference to the transfer's reference or remittance field.
- `Network` shows the served chain's name. `Receiving wallet` shows the served address truncated
  (`GCGQVO…GQ5C`, full address on hover via `title`), a copy icon beside it, and an info icon next
  to the label whose tooltip reads "Your transfer is credited to this wallet as sPLUSD."
- The note "Transfers may take from the same day up to 5 business days" ends with an info icon
  whose tooltip reads "Domestic transfers: Same day or within 1 business day" / "International
  transfers: 1–5 business days".

---

## Story 2: Exactly one request per open

**Steps:**

1. Open the Network tab, click `Add Funds`, then switch tabs and back, go offline and online.
2. Close the modal and click `Add Funds` again.

**Expected outcomes:**

- Step 1 shows exactly one `payment-details?chain_id=<id>` request, with no retry or refetch.
- Step 2 shows exactly one more request, and the reference differs from the first.

---

## Story 3: Every value is click-to-copy; there is no copy-all button

**Steps:**

1. Hover a bank row's value (e.g. `IBAN`): the cursor is a pointer and the value highlights; there
   is no copy icon.
2. Click it.
3. Click another row (e.g. `Payment reference`).

**Expected outcomes:**

- The clipboard holds exactly that row's value. A success toast "IBAN copied" appears in the
  bottom-right corner, outside the dialog, for about 2 seconds; nothing changes inside the modal
  and it never grows a horizontal scrollbar. Clicking a second row replaces the toast text.
- There is no full-width `Copy` button and no copy icon anywhere in the modal.
- `Network` is plain text, not a button.

## Story 3a: On a phone, a tap or a press-and-hold copies

**Steps:**
1. On a touch device, tap the `IBAN` value.
2. Then press and hold the `Payment reference` value for about half a second.

**Expected:**
- The tap copies the IBAN and raises the toast. The hold copies the reference when the half second
  elapses (no need to release first), raises its toast, and releasing does not copy a second time or
  open the browser's text-selection callout. A press released before half a second behaves as a
  tap.

---

## Story 3b: The receiving wallet copies the full address

**Persona:** Story 1's LP.

**Steps:**
1. Click the truncated `Receiving wallet` value.

**Expected:**
- The clipboard holds the **full** served address, not the truncated text (the full address is also
  the button's hover `title`); the toast reads "Receiving wallet copied".

## Story 4: Keyboard users can copy too

**Steps:**

1. Tab to the `Payment reference` row's button (accessible name `Copy Payment reference`) and press
   Enter.

**Expected outcomes:**

- The clipboard holds only the reference, and the toast reads "Payment reference copied".

---

## Story 5: No linked address for the chain

**Pre-conditions:** The active chain has no linked settlement address (the API answers 409).

**Steps:**

1. Click `Add Funds`, then `Go to Account`.

**Expected outcomes:**

- A notice reads `Bank details need a {chain name} wallet linked to your account. …`; every value
  is `—` and every row copy button is disabled.
- `Go to Account` closes the modal and opens `/account`.

---

## Story 6: Any other failure shows a generic notice

**Pre-conditions:** The API answers 400, 404, 500, or the network fails.

**Steps:**

1. Click `Add Funds`.

**Expected outcomes:**

- A notice reads `Bank details are unavailable right now. Close this window and try again, or
  contact support.`; no `Go to Account` button, every value `—`, every row copy button disabled, no
  crash, and no scratch values shown. Closing and reopening issues one new request.

---

## Story 7: While loading, nothing is copyable

**Steps:**

1. Click `Add Funds` and observe the modal before the response arrives (or use
   `Open Funding details: loading` on `/test`).

**Expected outcomes:**

- All values are `—` and every row copy button is disabled (no hover highlight, default cursor).
