# User Stories: #1278 — KYB: Company Docs step V1.0 redesign

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1278](https://github.com/eq-lab/pipeline/issues/1278)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md#companydocsmodal)

This is a presentational modal — no network call, no persistence. `CompanyDocsModal` is reachable
only from `/test?tab=auth`; it is not wired to any production entry point. Files picked live in
React state as `File` objects for the lifetime of the mounted component. Styling-only stories
(spacing, colors, radius) are out of scope here — visual fidelity is verified separately by the QA
agent's Figma comparison against nodes `6701-96852` (empty) and `6701-96881` (uploaded).

**Tech debt to be aware of while executing these stories — not bugs to file:**

- TD-62: neither Figma frame designs a rejection state; a rejected file recolors the upload row's
  existing caption to red with no other layout change.
- TD-63: uploaded PDF files keep the same brand-tint glyph tile as the empty state rather than a
  rendered PDF-page thumbnail — only `jpg`/`png` uploads get a real image preview.
- TD-83: Submit enables at ≥ 1 file because the raw-upload model gives no way to signal
  completeness and the design specifies no threshold.
- TD-85: "closing keeps progress" is local React state, not persistence — it survives only while
  `CompanyDocsModal` stays mounted.

Also note: BUG-19 (`packages/ui` `tsc --noEmit` on `TextField.stories.tsx`) and BUG-20
(`SignInModal`/`CreateAccountModal` submit-attempt path unreachable in a browser) are pre-existing
and unrelated to this issue.

See `docs/exec-plans/tech-debt-tracker.md` for full detail on each entry.

---

## Story 1: Opening the screen shows the empty state

**Pre-conditions:** LP dev server running, at `http://localhost:5173/test?tab=auth`.

**Steps:**

1. Click `Open Company Docs step`.

**Expected outcomes:**

- A dialog titled "Finish account setup" opens, with the description "Upload your company
  documents and personal KYC for each shareholder so we can verify your account."
- An upload row reads "Upload documents" / "pdf, jpg, png files up to 10MB" with a trailing
  `Upload` button.
- The requirements list is present: "Requirement documents:" followed by Certificate of
  Incorporation, Registry of Legal Entities, Certificate of Good Standing, Legal Address,
  Shareholder Register, and "Personal KYC for each shareholder / UBO:" with its two nested items.
- No staged-file rows are shown.
- The `Submit` button is present and disabled.
- No `Step 1/2` badge is shown anywhere in the dialog.

---

## Story 2: Staging one file

**Pre-conditions:** The Company Docs step is open, empty.

**Steps:**

1. Click `Upload` and pick one PDF file.

**Expected outcomes:**

- A staged row appears showing the file name, an "Uploaded" caption, and a "Remove {filename}"
  button.
- `Submit` becomes enabled.

---

## Story 3: Staging several files at once

**Pre-conditions:** The Company Docs step is open, empty.

**Steps:**

1. Click `Upload` and pick several files in one dialog.

**Expected outcomes:**

- All picked files appear as staged rows, in the order they were picked.
- `Submit` is enabled.

---

## Story 4: Removing the last staged file

**Pre-conditions:** The Company Docs step is open with exactly one staged file.

**Steps:**

1. Click the file's `Remove {filename}` button.

**Expected outcomes:**

- The staged-file list is empty again.
- `Submit` is disabled again.

---

## Story 5: Oversize file rejection

**Pre-conditions:** The Company Docs step is open, empty.

**Steps:**

1. Pick a file larger than 10MB.

**Expected outcomes:**

- No staged row is added for the oversize file.
- The upload row's caption switches to a `role="alert"` treatment, same copy
  ("pdf, jpg, png files up to 10MB").
- `Submit` stays disabled.

---

## Story 6: Wrong-type file rejection, then a valid pick clears it

**Pre-conditions:** The Company Docs step is open, empty.

**Steps:**

1. Pick a `.txt` file.
2. Pick a valid `.pdf` file.

**Expected outcomes:**

- After step 1: no staged row is added; the caption shows the `role="alert"` treatment.
- After step 2: the alert clears, and the valid file appears as a staged row.

---

## Story 7: Submit

**Pre-conditions:** The Company Docs step is open with at least one staged file.

**Steps:**

1. Click `Submit`.

**Expected outcomes:**

- The dialog closes.
- The `/test?tab=auth` page shows the stand-in line "Company documents submitted — open the
  Account-in-review screen from the button above."

---

## Story 8: Close and reopen keeps the staged files

**Pre-conditions:** The Company Docs step has at least one staged file.

**Steps:**

1. Close the dialog (× button).
2. Reopen it via `Open Company Docs step`.

**Expected outcomes:**

- The previously staged file rows are still present.
- `Submit` is still enabled.

This is the deliberate inverse of the retired five-slot modal's reset-on-open behaviour — closing
this step means "exit onboarding, keep progress," per the epic's 2026-09-21 flow-semantics
decision. See TD-85 above for the persistence caveat.
