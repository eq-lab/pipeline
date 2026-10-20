# User Stories: #1572 — Account setup modal: uncertain upload never discards the wrong staged file

Epic: [#1247 — KYB / V1.0 onboarding](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1572](https://github.com/eq-lab/pipeline/issues/1572) (BUG-23, introduced by #1371)
Spec: [docs/frontend/auth-components.md#companydocsmodal](../../frontend/auth-components.md#companydocsmodal),
[docs/frontend/account-page.md](../../frontend/account-page.md#production-actions-and-remaining-seams)

LP app, signed in with KYB not started, the account-setup modal open. To produce an "uncertain"
upload, use DevTools request blocking or go offline right after clicking Submit so
`POST /v1/lps/me/documents` fails without an HTTP response, then restore the network.

---

## Story 1: Two staged files with the same name, one of them uploaded — nothing is guessed

**Persona:** LP uploading two different files that happen to share a filename.

**Pre-conditions:** Stage `scan.pdf` (file A) and another `scan.pdf` (file B); make the upload request fail without a response while the server actually stores one of them.

**Steps:**

1. Click Submit; when the connection is back, let the modal read the account back (it does so automatically; otherwise click "Check uploads").

**Expected outcomes:**

- Both staged `scan.pdf` rows are still listed; the uploaded list shows one `scan.pdf`.
- The alert says the modal cannot tell which copy uploaded; Submit is disabled; a "Discard uncertain staged files" button is shown instead of "Check uploads".
- No second upload request has been sent.

---

## Story 2: Discarding the uncertain copies and re-selecting

**Persona:** LP continuing from Story 1.

**Steps:**

1. Click "Discard uncertain staged files".
2. Compare the uploaded list with the files you meant to send; stage the missing one again under a distinct name; click Submit.

**Expected outcomes:**

- Both staged `scan.pdf` rows disappear; the uploaded `scan.pdf` stays; the alert asks you to review and re-select.
- Submit is enabled again and uploads only the newly staged file.

---

## Story 3: Distinct names still reconcile automatically

**Persona:** LP whose uncertain upload stored one of two differently named files.

**Pre-conditions:** Stage `a.pdf` and `b.pdf`; the failed request stored `b.pdf` only.

**Steps:**

1. Click Submit; let the read-back run.

**Expected outcomes:**

- `b.pdf` moves to the uploaded list and leaves the staged list; `a.pdf` stays staged; the alert says some files were uploaded before the connection failed and asks you to submit again.
- Submit is enabled and the retry uploads only `a.pdf`.

---

## Story 4: The Account page behaves the same

**Persona:** LP repeating Story 1 on `/account` instead of the modal.

**Expected outcomes:**

- Identical rule and copy: ambiguous names are kept, Save is blocked, "Discard uncertain staged files" is offered (the two surfaces share one implementation).
