# User Stories: #1429 — Account-setup modal dismissal persists across reloads

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1429](https://github.com/eq-lab/pipeline/issues/1429)
Spec: [docs/product-specs/kyb-lp-verification.md](../../product-specs/kyb-lp-verification.md),
[docs/frontend/auth-components.md](../../frontend/auth-components.md#companydocsmodal)

The "Finish account setup" modal (`CompanyDocsModal`) auto-opens once per stored session, not once
per page load. The dismissal is persisted next to the session record and cleared on sign-out.

---

## Story 1: A dismissed account-setup modal stays closed across reloads

**Persona:** An LP who signed in, saw the auto-opened "Finish account setup" modal and closed it
because they want to browse first.

**Pre-conditions:**

- A valid session exists (signed in).
- `GET /v1/lps/me` returns 404, or a loaded LP whose `documents` array is empty.

**Steps:**

1. Load the app and wait for the "Finish account setup" modal to open.
2. Close it with its close button.
3. Reload the page.
4. Reload the page a second time.

**Expected outcomes:**

- Step 1: the modal opens.
- Step 2: the modal closes, the session stays active, and the home screen is usable.
- Steps 3 and 4: `GET /v1/lps/me` is re-read on each load, but the modal does **not** open again.
  The home screen renders its unverified state with no modal over it.

---

## Story 2: Start Verification still opens the modal after the dismissal was persisted

**Persona:** Same as Story 1, now ready to upload documents.

**Pre-conditions:** Story 1 completed — the modal is dismissed and the page has been reloaded.

**Steps:**

1. Click "Start Verification" on the home screen's `AddUsdCard` (`verify` variant).

**Expected outcomes:**

- The "Finish account setup" modal opens. The persisted dismissal gates the automatic open only;
  the explicit CTA is never blocked by it. The Account page reaches the same modal.

---

## Story 3: Sign-out then sign-in offers account setup again

**Persona:** An LP who dismissed account setup, signed out, and signed back in later.

**Pre-conditions:** Story 1 completed. The server still has no documents for this LP.

**Steps:**

1. Sign out.
2. Sign in again (email + passcode).

**Expected outcomes:**

- Step 1: the stored session and its dismissal are both cleared.
- Step 2: the "Finish account setup" modal auto-opens, because the server still reports a missing
  LP or zero documents.

---

## Story 4: An LP with documents is never prompted, dismissal or not

**Persona:** An LP who already uploaded documents.

**Pre-conditions:** `GET /v1/lps/me` returns an LP with at least one persisted document.

**Steps:**

1. Load the app and reload it once.

**Expected outcomes:**

- The modal never opens on either load. A read failure (401 or a network error) likewise never
  opens it — a failed read does not imply an empty account.
