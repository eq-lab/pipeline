# User Stories: #1252 — KYB: Owners step

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1252](https://github.com/eq-lab/pipeline/issues/1252)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md)

This is a presentational modal — no network call, no persistence. `OwnersModal` is reachable
only from `/test?tab=auth`; it is not wired to any production entry point. Files picked or
dropped live in React state as `File` objects for the lifetime of the open modal —
closing/reopening the modal discards them. **This screen is a drag-and-drop file uploader, not
an owner-details form** — there is no name field, no role field, no ownership-percentage input,
and no per-owner grouping anywhere in the design; the "owners" framing lives only in the heading
and the banner copy. Styling-only stories (spacing, colors, radius) are out of scope here —
visual fidelity is verified separately by the QA agent's Figma comparison.

**Tech debt to be aware of while executing these stories:**

- TD-64: the drop-zone subtitle binds to a misspelled, non-namespaced legacy Figma variable;
  shipped with the existing muted-ink token — not a bug to file.
- TD-65: the banner's hint tooltip is a loose canvas instance with no specified trigger, offset,
  or arrow; shipped as hover/focus, no arrow — not a bug to file.
- TD-66: Submit enables at ≥1 file because the design provides no owner count or per-owner
  grouping — not a bug to file.
- TD-67: the drop zone's drag-over and rejection states have no Figma treatment; both reuse
  existing tokens on existing copy — not a bug to file.
- TD-63 (carried over from #1251): uploaded PDF files keep the same brand-tint glyph tile as the
  empty state rather than a rendered PDF-page thumbnail — only `jpg`/`png` uploads get a real
  image preview; also intentional.

See `docs/exec-plans/tech-debt-tracker.md` for full detail on each entry.

---

## Story 1: Opening the screen shows the default empty state

**Persona:** LP visiting the Owners preview.

**Pre-conditions:** LP dev server running, at `http://localhost:5173/test?tab=auth`.

**Steps:**

1. Click "Open Owners step".

**Expected outcomes:**

- The modal opens full-viewport with the heading "Add company owners" and **no** description
  line underneath it.
- The step badge in the top-left reads "Step 2/2".
- A white banner reads "Upload ID and proof of address documents for each owner" with an info
  glyph.
- Below the banner, a dashed drop zone shows "Drag and drop your files", the caption
  "pdf, jpg, png files up to 10MB", and a "Select files" button.
- No uploaded-file rows appear.
- The "Submit" button is disabled.
- The close button is present (top-right); there is no back arrow — a plain "Back" line of text
  appears below Submit but is not clickable.

---

## Story 2: Picking one file via the file picker

**Persona:** LP uploading their first owner document.

**Pre-conditions:** Owners modal open, no files uploaded.

**Steps:**

1. Click "Select files" and choose one PDF file.

**Expected outcomes:**

- A row appears showing the picked file's name and the caption "Uploaded".
- "Submit" becomes **enabled** — one file is sufficient (unlike Company Docs' five-slot
  requirement).

---

## Story 3: Picking multiple files at once

**Persona:** LP uploading several owner documents together.

**Pre-conditions:** Owners modal open, no files uploaded.

**Steps:**

1. Click "Select files" and choose two files in one picker selection.

**Expected outcomes:**

- Two rows appear, in the order the files were selected.
- "Submit" is enabled.

---

## Story 4: Dragging and dropping a file

**Persona:** LP who drags a file from their desktop onto the drop zone.

**Pre-conditions:** Owners modal open.

**Steps:**

1. Drag a valid file over the dashed drop zone, then drop it.

**Expected outcomes:**

- While dragging over the zone, the dashed border darkens.
- On drop, a row appears for the file, same as picking it via the button.
- "Submit" reflects the new file count.

---

## Story 5: The banner hint tooltip

**Persona:** LP unsure what documents are acceptable.

**Pre-conditions:** Owners modal open.

**Steps:**

1. Hover over (or tab-focus) the info glyph in the banner.

**Expected outcomes:**

- A tooltip appears above the glyph with the text: "You could upload a passport, ID card, or
  driver’s licence, plus a recent (no older than 90 days) utility bill or bank statement as
  proof of address."
- Moving the mouse away (or blurring the glyph) hides the tooltip.
- Pressing Escape while the tooltip is open closes the whole modal instead of just the tooltip —
  this is expected (TD-65); the shell owns Escape.

---

## Story 6: Removing an uploaded file

**Persona:** LP who picked the wrong file.

**Pre-conditions:** At least one file uploaded.

**Steps:**

1. Click the remove button on one of the rows.

**Expected outcomes:**

- That row disappears from the list.
- If it was the only file, "Submit" becomes disabled again and the list disappears entirely.

---

## Story 7: Submitting

**Persona:** LP who has uploaded at least one owner document.

**Pre-conditions:** At least one file uploaded, "Submit" enabled.

**Steps:**

1. Click "Submit".

**Expected outcomes:**

- The modal closes.
- The preview page shows the stand-in confirmation line "Owners submitted — the #1253
  Account-in-review screen opens here once it exists." This is not a bug to file — #1253 does
  not exist yet.
- No HTTP request is made — this issue ships no upload endpoint call (deferred to #1254).

---

## Story 8: Rejecting an oversize file

**Persona:** LP who picks a file larger than the 10MB limit.

**Pre-conditions:** Owners modal open.

**Steps:**

1. Pick or drop a file larger than 10MB.

**Expected outcomes:**

- No row is added for that file.
- The drop zone's subtitle text is unchanged ("pdf, jpg, png files up to 10MB") but turns red,
  signalling an error.
- "Submit" is unaffected by the rejection itself (reflects only the accepted files, if any).

---

## Story 9: Rejecting a wrong file type

**Persona:** LP who picks an unsupported file type.

**Pre-conditions:** Owners modal open.

**Steps:**

1. Pick or drop a file that is not a PDF, JPG, or PNG (e.g. a `.txt` file).
2. Then pick or drop a valid PDF/JPG/PNG file.

**Expected outcomes:**

- After step 1: no row is added, and the subtitle turns red.
- After step 2: the red subtitle clears, and the new row shows the valid file as uploaded.
- A single drop that mixes one valid and one invalid file adds a row for the valid file **and**
  shows the red subtitle at the same time.

---

## Story 10: Reopening resets the step

**Persona:** LP who closes the modal mid-upload and reopens it.

**Pre-conditions:** Owners modal previously had at least one file uploaded.

**Steps:**

1. Close the modal (the × button).
2. Reopen it via "Open Owners step".

**Expected outcomes:**

- The file list is empty again.
- "Submit" is disabled.
- Any prior rejection state is cleared.
