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
- `Network` shows the served chain's name and `Receiving wallet` the served address; a caption says
  the transfer is credited to that wallet as sPLUSD.

---

## Story 2: Exactly one request per open

**Steps:**

1. Open the Network tab, click `Add Funds`, then switch tabs and back, go offline and online.
2. Close the modal and click `Add Funds` again.

**Expected outcomes:**

- Step 1 shows exactly one `payment-details?chain_id=<id>` request, with no retry or refetch.
- Step 2 shows exactly one more request, and the reference differs from the first.

---

## Story 3: Copy writes the seven wire rows

**Steps:**

1. Click `Copy`.

**Expected outcomes:**

- The clipboard holds seven `{label}: {value}` lines ending `Payment reference: PL-…`; `Network` and
  `Receiving wallet` are not included. The button reads `Copied` for about 1.5 seconds.

---

## Story 4: The reference has its own copy button

**Steps:**

1. Click the copy icon beside `Payment reference`.

**Expected outcomes:**

- The clipboard holds only the reference, and a `Copied` caption appears briefly.

---

## Story 5: No linked address for the chain

**Pre-conditions:** The active chain has no linked settlement address (the API answers 409).

**Steps:**

1. Click `Add Funds`, then `Go to Account`.

**Expected outcomes:**

- A notice reads `Bank details need a {chain name} wallet linked to your account. …`; every value
  is `—` and both copy buttons are disabled.
- `Go to Account` closes the modal and opens `/account`.

---

## Story 6: Any other failure shows a generic notice

**Pre-conditions:** The API answers 400, 404, 500, or the network fails.

**Steps:**

1. Click `Add Funds`.

**Expected outcomes:**

- A notice reads `Bank details are unavailable right now. Close this window and try again, or
  contact support.`; no `Go to Account` button, every value `—`, both copy buttons disabled, no
  crash, and no scratch values shown. Closing and reopening issues one new request.

---

## Story 7: While loading, nothing is copyable

**Steps:**

1. Click `Add Funds` and observe the modal before the response arrives (or use
   `Open Funding details: loading` on `/test`).

**Expected outcomes:**

- All values are `—` and `Copy` and the reference copy button are disabled.
