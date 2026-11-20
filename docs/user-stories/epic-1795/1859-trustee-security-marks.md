# User Stories: #1859 — Trustee price marks, extension consent and check coverage (SecurityRegistry)

Issue: [#1859](https://github.com/eq-lab/pipeline/issues/1859) (epic #1795)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#security-marks-1859), [docs/product-specs/loan-security-state.md](../../product-specs/loan-security-state.md#mark-suggestions)

Trustee app (`packages/trustee`), loan detail `/loans/{id}?chain=<stellar chain>` of a Stellar loan with security terms, Stellar wallet connected. Revalue and Record buyer consent go through the AccessManager `execute` of the SecurityRegistry (`VITE_STELLAR_SECURITY_REGISTRY_ID`) and render on the connected wallet's `can_call`; Check coverage is permissionless and invoked directly on the registry. Served values are shown verbatim and `—` when missing; the app computes nothing. The served suggestions need `SECURITY_MARK_COMMODITIES` on the API.

---

## Story 1: Revalue a goods record with the suggested price

**Persona:** Trustee whose wallet can call `revalue`.

**Steps:**

1. Open the loan detail of a loan with an open goods record. Read the record's Suggested price, Move vs suggestion, Mark due and Mark due at rows.
2. Click "Set price". Leave the prefilled price and benchmark unchanged.
3. Click "Set price" in the dialog and approve in the wallet.

**Expected outcomes:**

- The record shows the served suggestion as `{benchmark} · $x per {unit}` and a "Mark due" chip when `mark_due` is true, with the reasons in plain words.
- The dialog prefills the served `suggested_mark.value_per_unit` and benchmark, shows no evidence field and shows the served `report_hash`.
- One AccessManager `execute` of `revalue(record_id, value_per_unit raw at 7 dp, benchmark, report_hash)` is signed; the card then shows "Price set for record #N. Transaction …".
- After the next worker cycles the record's Price, Price updated and Mark due rows show the new served mark.

---

## Story 2: Override the suggestion with evidence

**Persona:** Trustee whose wallet can call `revalue`.

**Steps:**

1. Open "Set price" and change the price (or the benchmark).
2. Leave the Price evidence empty, then enter a source reference.

**Expected outcomes:**

- A "Price evidence" field appears and the button stays disabled with "Describe the source of your price." until it is filled.
- The shown report hash is the sha256 of the trimmed evidence text, not the suggestion's hash, and that is the hash sent on-chain.

---

## Story 3: A zero price is allowed and a negative one is rejected

**Persona:** Trustee whose wallet can call `revalue`.

**Steps:**

1. In "Set price" enter `-5`; then enter `0` with an evidence text.

**Expected outcomes:**

- `-5` shows "The price can't be negative." and keeps the button disabled; more than 7 decimals or a non-number shows the decimals hint.
- `0` is accepted and sends an i128 raw of 0.

---

## Story 4: A wallet without the role cannot set a price or record a consent

**Persona:** Any connected wallet whose `can_call` for `revalue` and `record_extension_consent` is not immediate.

**Steps:**

1. Open the loan detail of a loan with a goods record.

**Expected outcomes:**

- "Set price" is disabled with "This wallet is not allowed to set a price mark."; with no wallet connected it reads "Connect a Stellar wallet to set a price mark."
- The consent form is disabled with "This wallet is not allowed to record an extension consent." No wallet prompt appears and no copy names a role.

---

## Story 5: Record the buyers' extension consent

**Persona:** Trustee whose wallet can call `record_extension_consent`.

**Steps:**

1. In the "Security actions" card enter a New maturity date after today and a Buyer consent reference.
2. Click "Record consent" and approve.

**Expected outcomes:**

- The button stays disabled until the date is after today (UTC) and the reference is non-empty; "Consent hash" shows the sha256 of the trimmed reference.
- One AccessManager `execute` of `record_extension_consent(loan_id, new_maturity = 00:00 UTC of the picked day in unix seconds, consent_hash)` is signed.
- After the next worker cycles the "Extension consents" list shows the new entry with its position, new maturity date, truncated hash and recorded date, exactly as served; an empty list reads "No extension consents are recorded."

---

## Story 6: Check coverage from any wallet

**Persona:** A connected Stellar wallet with no role at all.

**Steps:**

1. Open the loan detail; when the served hints read "LTV is back at or below the advance ratio…" or "LTV is above the margin-call ratio…" note them.
2. Click "Check coverage" and approve.

**Expected outcomes:**

- The button is enabled for any connected wallet and disabled with "Connect a Stellar wallet to check coverage." without one.
- One direct `check_coverage(loan_id)` invocation on the SecurityRegistry is signed (no AccessManager) and the card shows "Coverage checked. Transaction …".
- After the refetch the Security card shows the served margin-call state; a loan without terms fails with "This loan has no security terms yet. Set them first." and the raw text behind "View details".

---

## Story 7: An unmapped or missing suggestion renders dashes

**Persona:** Trustee on an environment where `SECURITY_MARK_COMMODITIES` is unset or a record's commodity is unmapped.

**Steps:**

1. Open the loan detail of a loan with an open goods record that has a mark.
2. Open "Set price".

**Expected outcomes:**

- Suggested price shows the status text ("No price source is configured for this commodity") or `—`; Move vs suggestion, Mark due and Mark due at show `—` for missing values; nothing is derived client-side.
- The dialog starts with an empty price, keeps the current benchmark and always requires the Price evidence text before it can submit.
