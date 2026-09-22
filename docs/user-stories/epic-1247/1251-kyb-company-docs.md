# User Stories: #1251 — KYB: Company Docs upload step

**Superseded 2026-09-22 by #1278.** The five-slot Company Docs step was replaced by the V1.0
flat-upload redesign. Kept for history. See
[1278-kyb-company-docs-v1.md](./1278-kyb-company-docs-v1.md) for the current stories and
[`docs/frontend/auth-components.md#companydocsmodal`](../../frontend/auth-components.md#companydocsmodal)
for the spec.

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1251](https://github.com/eq-lab/pipeline/issues/1251)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md)

This is a presentational modal — no network call, no persistence. `CompanyDocsModal` is
reachable only from `/test?tab=auth`; it is not wired to any production entry point. Files
picked into a slot live in React state as `File` objects for the lifetime of the open modal —
closing/reopening the modal discards them. Styling-only stories (spacing, colors, radius) are out
of scope here — visual fidelity is verified separately by the QA agent's Figma comparison.

**Tech debt to be aware of while executing these stories:** neither Figma frame designs a
rejection state (TD-62, `docs/exec-plans/tech-debt-tracker.md`) — a rejected file recolors the
row's existing caption to red with no other layout change, which is intentional, not a bug to
file. Uploaded PDF documents keep the same brand-tint glyph tile as the empty state rather than a
rendered PDF-page thumbnail (TD-63) — only `jpg`/`png` uploads get a real image preview; also
intentional.

---

## Story 1: Opening the screen shows the default empty state

**Persona:** LP visiting the Company Docs preview.

**Pre-conditions:** LP dev server running, at `http://localhost:5173/test?tab=auth`.

**Steps:**

1. Click "Open Company Docs step".

**Expected outcomes:**

- The modal opens full-viewport with the heading "Finish account setup" and the description
  "Upload your company documents so we can verify your account."
- The step badge in the top-left reads "Step 1/2".
- Five rows appear, in this order, each with an "Upload" button and the caption
  "pdf, jpg, png files up to 10MB": Certificate of Incorporation, Registry of Legal Entities,
  Certificate of Good Standing, Legal Address, Shareholder Register.
- The "Continue" button is disabled.
- There is no × close button issue here — the close button is present (unlike OTP); there is no
  back arrow.

---

## Story 2: Uploading one document

**Persona:** LP uploading their first required document.

**Pre-conditions:** Company Docs modal open, all slots empty.

**Steps:**

1. Click "Upload" next to "Certificate of Incorporation".
2. Choose a PDF file.

**Expected outcomes:**

- The row's title changes from "Certificate of Incorporation" to the picked file's name.
- The caption changes to "Uploaded".
- The "Upload" button is replaced by a "Remove …" button.
- "Continue" is still disabled — the other four slots are empty.

---

## Story 3: Partial completion keeps Continue disabled

**Persona:** LP who has uploaded some but not all documents.

**Pre-conditions:** Company Docs modal open.

**Steps:**

1. Upload documents into three of the five slots, leaving two empty.

**Expected outcomes:**

- "Continue" remains disabled — it only enables when all five slots hold a file.

---

## Story 4: Completing all five documents enables Continue

**Persona:** LP who has uploaded every required document.

**Pre-conditions:** Company Docs modal open.

**Steps:**

1. Upload a valid file into each of the five slots.

**Expected outcomes:**

- "Continue" becomes enabled once the fifth slot is filled.

---

## Story 5: Submitting all five documents

**Persona:** LP who has completed the step and moves on.

**Pre-conditions:** All five slots filled (per Story 4).

**Steps:**

1. Click "Continue".

**Expected outcomes:**

- The modal closes.
- The preview page shows the stand-in confirmation line "Company documents submitted — open the
  Owners step from the button above."
- No HTTP request is made — this issue ships no upload endpoint call (deferred to #1254).

---

## Story 6: Removing an uploaded document

**Persona:** LP who picked the wrong file and wants to replace it.

**Pre-conditions:** All five slots filled, "Continue" enabled.

**Steps:**

1. Click the "Remove …" button on one row.

**Expected outcomes:**

- That row reverts to its empty state: the original slot label and the
  "pdf, jpg, png files up to 10MB" caption reappear, and the "Upload" button returns.
- "Continue" becomes disabled again.

---

## Story 7: Rejecting an oversize file

**Persona:** LP who picks a file larger than the 10MB limit.

**Pre-conditions:** Company Docs modal open, a slot empty.

**Steps:**

1. Click "Upload" on an empty slot and choose a file larger than 10MB.

**Expected outcomes:**

- The slot stays empty — no file name appears.
- The caption text is unchanged ("pdf, jpg, png files up to 10MB") but turns red, signalling an
  error.
- "Continue" is unaffected (stays disabled if it already was).

---

## Story 8: Rejecting a wrong file type

**Persona:** LP who picks an unsupported file type.

**Pre-conditions:** Company Docs modal open, a slot empty.

**Steps:**

1. Click "Upload" on an empty slot and choose a file that is not a PDF, JPG, or PNG (e.g. a
   `.txt` file).
2. Then choose a valid PDF/JPG/PNG file into the same slot.

**Expected outcomes:**

- After step 1: the slot stays empty and its caption turns red, same as the oversize case.
- After step 2: the red caption clears, and the row shows the valid file as uploaded.

---

## Story 9: Reopening resets the step

**Persona:** LP who closes the modal mid-upload and reopens it.

**Pre-conditions:** Company Docs modal previously had at least one slot filled.

**Steps:**

1. Close the modal (the × button).
2. Reopen it via "Open Company Docs step".

**Expected outcomes:**

- All five slots are empty again.
- "Continue" is disabled.
- Any prior rejection state is cleared.
