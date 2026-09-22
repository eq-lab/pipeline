# Issue #1278: KYB: update Company Docs step to the V1.0 redesign

Source: https://github.com/eq-lab/pipeline/issues/1278

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Branch: `feat/1278-company-docs-v1` (draft PR #1305), cut from `main` with #1284 and the six
fidelity fixes (#1291–#1295) merged.

Figma (source of truth for styling, file `A43rjYYjSwdTmiwwf5cx5n`):

- `KYB — Company docs` (empty) — [`6701-96852`](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-96852&m=dev)
- `KYB — Uploaded` — [`6701-96881`](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-96881&m=dev)
- Content instance inside the empty frame: `6701:96867`

---

## Scope

Replace the shipped five-slot `CompanyDocsModal` (#1251) with the V1.0 flat-upload modal.

**In scope**

1. Rewrite `packages/frontend/src/components/CompanyDocsModal.tsx` as the V1.0 screen: one
   upload row + the KYB requirements list + a staged-file list inside a single surface card,
   with a full-width `Submit` below it.
2. Retire the five-slot machinery: delete `DocumentUploadRow.tsx` and `useCompanyDocsModal.ts`;
   move the five company-document labels into `kybDocumentRequirements.ts` (their only surviving
   consumer).
3. Reuse the #1284 Account-page primitives rather than duplicating them —
   `AccountUploadRow`, `AccountRequirementsList`, `useAccountDocuments`, plus the already-shared
   `UploadedFileRow` and `kybFileValidation`. The only change to those files is **additive
   optional props** (`dataNodeId`, `testId`, and — only if the frames prove a delta — `className`)
   whose defaults reproduce today's Account-page DOM byte-for-byte.
4. Delete `FileDropZone.tsx` and `KybInfoBanner.tsx` — the delete-or-reshape call this Issue owns.
5. Update the `/test?tab=auth` preview seam and its guards.
6. Update specs, user-stories docs, tech-debt tracker, and the docs catalogues.

**Out of scope**

- Any network call, upload transport, or persistence (#1267 transport, #1273 read-back, #1254
  wiring). `onSubmit` stays a no-op seam.
- The production entry point and where closing the modal lands the user — #1282 owns the header
  auth buttons and the home gating states.
- The Account page itself. `AccountDocumentsCard`, `AccountStatusBanner`, `AccountDocumentRow`,
  `accountPageState`, `AccountPage` and the `/account` route are **not** modified, and their tests
  are the regression guard for the #1291–#1295 fidelity fixes.
- Verified / Invalid / under-review document states. The modal has exactly two designed states
  (empty, staged); the Account page owns the review-outcome states.

---

## Design read (from `get_metadata` + `get_screenshot`; the coder re-confirms tokens with `get_design_context`)

Both frames are the same `Sign In` shell component (`8550:10210` content pane / `8550:10546`
image pane) with the image pane hidden, the close icon shown, and the header chrome empty.

Container slot `400 × 624` (empty) / `400 × 940` (uploaded) at `x=664, y=128`:

| Part | Empty frame | Uploaded frame | Geometry |
| --- | --- | --- | --- |
| `heading` | `6701:96859` | `6701:96888` | `400×164`; title `112` (48/56 × 2 lines), 8px gap, description `44` (16/22 × 2 lines) |
| card `input-sum-inline` | `6701:96889`¹ | `6701:96889` | starts `y=196` (32px below heading); children inset `x=8`; 16px internal gaps; bottom inset 16 |
| upload row `list-item` | `6701:96891`¹ | `6701:96891` | `384×56` at card `y=8` |
| requirements `text` | `6701:96892`¹ | `6701:96892` | `384×188` at card `y=80` |
| staged file list | — | `6701:96893` | `384×300` at card `y=284`; six rows of **40px** at a **52px** pitch (12px gap) |
| `button` | `6701:96864` | `6701:96900` | `400×48`, 32px below the card; 64px of column padding beneath it |

¹ The empty frame's own ids are `6701:96860` (card) / `6701:96862` (row) / `6701:96863` (text);
use the uploaded frame's ids in `data-node-id` since both states render the same DOM.

Copy, verbatim from the frames:

- Heading: `Finish account setup`
- Description: `Upload your company documents and personal KYC for each shareholder so we can
  verify your account.` — **changed** from #1251's "Upload your company documents so we can
  verify your account."
- Upload row: `Upload documents` / `pdf, jpg, png files up to 10MB` / `Upload` button
- Requirements block: the existing `REQUIREMENTS_LEAD_LINE` + `KYB_DOCUMENT_REQUIREMENTS` +
  `KYB_UBO_SUB_REQUIREMENTS` strings render character-for-character what the frames show
- CTA: `Submit` — **changed** from #1251's "Continue"

### Settled design questions

**No step badge.** The `Step` group (`6701:96870` empty / `6701:96906` uploaded) containing the
`Step 1/2` text is `hidden="true"` in **both** frames. It is a leftover from the two-step
Company Docs + Owners flow, and Owners was retired (#1279). A hidden node does not render, so
the modal ships **without** `stepLabel`. The stale label is worth a designer note, not a code
decision — record it in the spec, do not render it and do not invent "Step 1/1".

**Flat upload, no slots, no typing UI.** Per the epic's 2026-09-21 decision (raw upload,
classify-at-review), the LP picks untyped files; the five company documents and the per-UBO
personal KYC appear only as a bullet list of requirements. There is no per-slot structure and no
doc-type or UBO selector anywhere in either frame.

**Dismissal keeps staged files.** The × is present and not hidden. Per the epic's 2026-09-21
flow-semantics comment ("closing the docs step means *exit onboarding, keep progress*"), the
modal must **not** discard staged files on close — a deliberate reversal of #1251's
reset-on-open behaviour. Presentationally this is exactly what dropping the reset effect gives:
`useAccountDocuments` holds the files for the lifetime of the mounted component, so closing and
reopening the preview shows them still staged. Real server-side progress is #1267 + #1273,
wired by #1254; `onDismiss` here only closes the modal.

**Submit enables at ≥ 1 file.** `useAccountDocuments.canSave` already encodes this, and it is the
only non-arbitrary rule the raw-upload model permits (the empty frame shows Submit disabled, the
uploaded frame with six files shows it solid). Same gap the retired TD-66 described; re-filed
against both surfaces as TD-83.

### Reuse verdicts

| Piece | Verdict |
| --- | --- |
| `AuthModalShell` | **Reuse.** Props: `open`, `onDismiss`, `heading`, `description`, `headingId="company-docs-modal-heading"`, `testId="company-docs-modal"`, `showImagePanel={false}`, `align="center"`. No `stepLabel`, no `onBack`, no `icon`, no `headingAlign`, default close button. No new shell prop is needed. |
| `AccountUploadRow` | **Reuse as-is** — the frame's `list-item` is the same `384×56`/`w-full` row the Account page renders. Add optional `dataNodeId` / `testId`. |
| `AccountRequirementsList` | **Reuse.** Identical strings and nesting. Add optional `dataNodeId` / `testId`, and an optional `className` for the padding **only if** `get_design_context` on `6701:96892` proves a delta against the shipped `px-2 pb-6`. |
| `UploadedFileRow` | **Reuse unchanged.** Its existing `className` prop already covers the difference: the Account page passes `p-2` (56px rows, `gap-1` list); this modal passes **nothing** (40px rows) and uses a `gap-3` list. |
| `useAccountDocuments` | **Reuse unchanged.** `{ files, rejected, addFiles, removeFile, canSave, handleSave }` is exactly this screen's state. Call it as `useAccountDocuments({ onSave: onSubmit })`. |
| `kybFileValidation` | **Reuse unchanged** (via the hook). |
| `kybDocumentRequirements` | **Reuse**, after inlining the five labels it currently imports from `useCompanyDocsModal`. |
| `AccountDocumentsCard` | **Do not reuse.** It owns the Account page's six-state banner/document-row machine and a different card geometry (`480` wide, `py-4`, 56px staged rows, `Save`). The modal composes the three leaves directly. |
| `AccountStatusBanner` | **Do not use.** Neither modal frame has a banner. |
| `DocumentUploadRow` | **Delete.** Sole consumer is the old five-slot modal. |
| `useCompanyDocsModal` | **Delete.** Replaced by `useAccountDocuments`; the slot tuple moves to `kybDocumentRequirements.ts`. |
| `FileDropZone` | **Delete.** No consumer since #1279; no dashed drop zone exists anywhere in V1.0 (this modal, the Account page, #1282's home cards, #1283's static funding-details modal). |
| `KybInfoBanner` | **Delete.** No consumer since #1279; V1.0's banner is `AccountStatusBanner`, a different component, and no remaining epic sub-issue needs a centred single-line tooltip banner. |

**Layering note.** `CompanyDocsModal.tsx` will import three modules from
`@/components/account/`. Their names say "Account" while the modal is the onboarding-time view of
the same documents hub — a naming smell, not a correctness one. Promoting and renaming them
(`KybUploadRow`, `KybRequirementsList`, `useKybDocumentUpload`, plus `AccountIconTile`) would
touch four shipped components, four consumers, three test files and two docs, all carrying the
freshly merged #1291–#1295 fidelity work. That cleanup is deliberately **not** bundled into this
redesign; it is filed as TD-84 for a dedicated PR.

---

## Assumptions and Risks

- **Assumption:** the frames' node geometry above is accurate; exact colors, radii and paddings
  still come from `get_design_context` at implementation time (the plan was read from
  `get_metadata` + `get_screenshot` to stay within context).
- **Assumption:** the card surface is `--color-pipeline-surface` on `--color-pipeline-paper`, and
  the radius is `--radius-pipeline-card` — the same pair the Account-page card uses. The coder
  **must** confirm both; the frames' variable dump only exposes `radius/radius-s = 4` and
  `bg/primary = #f8f7f6`.
- **Risk — fidelity regression on the Account page.** The only guard against breaking
  #1291–#1295 is that `AccountUploadRow` / `AccountRequirementsList` gain *optional* props with
  the current values as defaults. Any change to their default-rendered DOM is a bug.
  `AccountDocumentsCard.test.tsx`, `AccountPage.test.tsx` and `-account.test.tsx` must pass
  untouched — do not edit them to accommodate a refactor.
- **Risk — breaking prop change.** `CompanyDocsModalProps.onSubmit` changes from
  `(documents: Record<CompanyDocumentSlotId, File>) => void` to `(files: File[]) => void`. The
  only consumer is `/test?tab=auth`, so the blast radius is one call site, but #1254's plan
  references the old shape and must be told.
- **Risk — deleting `FileDropZone` / `KybInfoBanner`.** Verified against every open sub-issue of
  epic #1247 (#1254, #1265, #1266, #1267, #1273, #1282, #1283, #1285): none ships a dashed drop
  zone or a tooltip info banner. Git history keeps them if a future design revives either.
- **Risk — the close-keeps-progress behaviour is presentational.** With no persistence, the files
  survive only while `CompanyDocsModal` stays mounted. A future consumer that unmounts it on
  close loses them. Called out in the spec and covered by TD-85.
- **Pre-existing, not introduced here:** BUG-19 (`packages/ui` `tsc --noEmit` on
  `TextField.stories.tsx`) and BUG-20 (`SignInModal`/`CreateAccountModal` submit-attempt path
  unreachable in a browser). Neither blocks this Issue; both are already in
  `docs/exec-plans/known-bugs.md`.
- **Dependency order:** nothing blocks this Issue. #1254 (wiring) is blocked and consumes the
  seam this Issue leaves; #1282 owns the production entry point.

---

## Open Questions

_None_

---

## Implementation Steps

**Status: all 8 steps completed 2026-09-22.** One confirmation from step 1: `get_design_context`
on `6701:96881` proved the anticipated padding delta on `6701:96892` — the requirements node
itself carries only `px-2` (no `pb-6`), since the card's own `gap-4` supplies the vertical space to
the next element. `AccountRequirementsList` gained the planned `className` prop (default
`"px-2 pb-6"`, unchanged Account-page rendering) and `CompanyDocsModal` passes `className="px-2"`.
No other deviation from the plan.

1. **Pull the design context.** `get_design_context` on `6701:96881` (uploaded — the richer
   frame) and `6701:96852` (empty), plus `get_variable_defs` on both. Confirm, before writing
   JSX: the card's fill/radius tokens, the card's internal padding (`px-2 pt-2 pb-4` is the
   reading from geometry), the 16px internal gap, the staged-row 40px height / 12px gap, and the
   requirements block's internal padding against the shipped `AccountRequirementsList`
   (`px-2 pb-6`). Confirm the heading, description, upload-row, requirements and `Submit` strings
   character-for-character.

2. **Move the company-document labels.** In
   `packages/frontend/src/components/kybDocumentRequirements.ts`, drop the
   `import { COMPANY_DOCUMENT_SLOTS } from "@/components/useCompanyDocsModal"` and inline the five
   labels directly into `KYB_DOCUMENT_REQUIREMENTS`, in the same order and with the same strings
   (`Certificate of Incorporation`, `Registry of Legal Entities`, `Certificate of Good Standing`,
   `Legal Address`, `Shareholder Register`, then `Personal KYC for each shareholder / UBO:`). The
   raw-upload model has no slots, so the `{ id, label }` tuple and `CompanyDocumentSlotId` die
   with it. Rendered output must be unchanged — `AccountDocumentsCard.test.tsx` proves it.
   Update the file's `// spec:` pointer if the section it names moves.

3. **Add the two optional props.**
   - `packages/frontend/src/components/account/AccountUploadRow.tsx`: add
     `dataNodeId?: string` (default `"6701:98157"`) and `testId?: string` (default
     `"account-upload-row"`); feed them to the existing `data-node-id` / `data-testid`.
   - `packages/frontend/src/components/account/AccountRequirementsList.tsx`: same two props
     (defaults `"6701:98158"` / `"account-requirements-list"`), plus `className?: string`
     defaulting to `"px-2 pb-6"` **only if** step 1 proved a padding delta — otherwise do not add
     it. Keep `w-full` and the typography classes unconditional.
   - No other change to either file. Their default-rendered DOM must be identical to `main`.

4. **Rewrite `packages/frontend/src/components/CompanyDocsModal.tsx`.** Keep the single
   `// spec: docs/frontend/auth-components.md#companydocsmodal` header line and no other comment.

   ```ts
   export interface CompanyDocsModalProps {
     open: boolean;
     onDismiss: () => void;
     onSubmit?: (files: File[]) => void;
   }
   ```

   State: `const { files, rejected, addFiles, removeFile, canSave, handleSave } =
   useAccountDocuments({ onSave: onSubmit });` — no reset-on-open effect (see "Dismissal keeps
   staged files").

   Composition inside `AuthModalShell` (props exactly as in the reuse table):

   - Children wrapper `<div className="mt-2 flex w-full flex-col gap-8 pb-16">` — unchanged from
     the shipped modal and from `AccountInReviewModal`/#1280: `mt-2` turns the shell column's
     24px `gap-6` into the frame's 32px heading→card gap, `gap-8` is the 32px card→button gap,
     `pb-16` the column's 64px bottom padding.
   - The card: a `<div data-node-id="6701:96889">` with `flex w-full flex-col`, the 16px gap, the
     surface fill, the card radius and the padding confirmed in step 1. Children, in order:
     1. `<AccountUploadRow rejected={rejected} onFiles={addFiles} dataNodeId="6701:96891"
        testId="company-docs-upload-row" />`
     2. `<AccountRequirementsList dataNodeId="6701:96892"
        testId="company-docs-requirements-list" />`
     3. when `files.length > 0`, `<ul role="list" data-node-id="6701:96893"
        className="flex w-full flex-col gap-3">` of `<UploadedFileRow file={file}
        onRemove={() => removeFile(index)} />` — **no** `className` on the rows (40px), keyed
        `` `${file.name}-${index}` `` as `AccountDocumentsCard` does.
   - `<Button variant="primary-dark" disabled={!canSave} onClick={handleSave}
     className="!w-full !min-w-0 disabled:opacity-[0.32]">Submit</Button>` — same variant and
     disabled opacity as the shipped modal and the Account page's `Save`.

5. **Delete the retired files:** `packages/frontend/src/components/DocumentUploadRow.tsx`,
   `packages/frontend/src/components/useCompanyDocsModal.ts`,
   `packages/frontend/src/components/FileDropZone.tsx`,
   `packages/frontend/src/components/KybInfoBanner.tsx`. Confirm with a repo-wide grep that no
   import survives (`FileDropZone`, `KybInfoBanner`, `DocumentUploadRow`,
   `useCompanyDocsModal`, `COMPANY_DOCUMENT_SLOTS`, `CompanyDocumentSlotId`).

6. **Update `packages/frontend/src/routes/test.tsx`.**
   - The seam paragraph currently reads "… OTP (issue #1250), Company Docs (issue #1251), and
     Account-in-review (issue #1253) …" → change the Company Docs attribution to **#1278**.
   - The `Open Company Docs step` button, the `companyDocsOpen`/`companyDocsSubmitted` state and
     the `auth-company-docs-submitted` stand-in line stay as they are; only the `onSubmit`
     callback's parameter type changes (it already ignores the argument).
   - The OTP stand-in line ("OTP verified — open the Company Docs step from the button above.")
     stays — the Company Docs step still exists and is still the next step. Do not touch it.

7. **Rewrite `packages/frontend/src/components/CompanyDocsModal.test.tsx`** (see Test Strategy).

8. **Lint and build.** `yarn workspace @pipeline/frontend lint`, `tsc --noEmit`, the frontend
   build, and `npx tsx scripts/lint-docs.ts` after the docs edits.

---

## Test Strategy

**Rewritten — `packages/frontend/src/components/CompanyDocsModal.test.tsx`** (jsdom, mirroring
`AccountDocumentsCard.test.tsx`'s shape; the file input is hidden, so drive it with
`fireEvent.change(input, { target: { files: [...] } })` on the row's input):

1. Empty state renders the heading `Finish account setup`, the description verbatim, the upload
   row (`Upload documents` / `pdf, jpg, png files up to 10MB` / `Upload`), the lead line
   `Requirement documents:`, all six top-level requirement items and both nested UBO items.
2. Empty state renders **no** staged-file list and a **disabled** `Submit`.
3. Shell composition: `role="dialog"` named `Finish account setup`, a `Close` button present, **no
   `Step 1/2` text anywhere**, no `Back` button, and the image panel absent.
4. Picking one valid file renders one staged row showing the file name + `Uploaded` + a
   `Remove {name}` button, and enables `Submit`.
5. Picking several files at once appends all of them, in order.
6. Removing the last staged file empties the list and re-disables `Submit`.
7. `Submit` calls `onSubmit` once with the `File[]` in staging order, and does not call it when
   disabled.
8. Rejection — oversize (> `MAX_FILE_BYTES`) and wrong type (`.txt`): no row is added and the
   upload row's caption gains `role="alert"`; a subsequent valid pick clears the alert and adds
   the row.
9. **Close does not discard staged files** — rerender with `open={false}` then `open`, and assert
   the staged rows and the enabled `Submit` are still there. This is the inverse of #1251's
   "reopen resets everything" case and is the regression guard for the resumable-onboarding
   decision.
10. Image preview: a `image/png` pick renders an `<img>`; a `application/pdf` pick renders the
    glyph tile (the `UploadedFileRow` branch, carried over from the old suite).

**Updated — `packages/frontend/src/routes/-test.test.tsx`:** the two Company Docs cases keep
passing unchanged (the dialog is still named `Finish account setup`); add one case asserting the
opened modal shows the `Upload documents` row and no `Step 1/2` badge.

**Unchanged and expected to stay green (the fidelity-fix guard):**
`packages/frontend/src/components/account/AccountDocumentsCard.test.tsx`,
`AccountPage.test.tsx`, `useAccountDocuments.test.ts`, `AccountWalletCard.test.tsx`,
`AccountEmailCard.test.tsx`, `accountPageState.test.ts`,
`packages/frontend/src/routes/-account.test.tsx`, and `AuthModalShell.test.tsx`. If any of these
needs editing, the additive-props contract in step 3 was violated.

**Deleted:** the five-slot cases in the old `CompanyDocsModal.test.tsx`. No `OwnersModal` or
`FileDropZone`/`KybInfoBanner` tests exist to delete (retired in #1279).

**Figma verification** (before opening the PR for review): run the dev server, open
`http://localhost:5173/test?tab=auth`, click `Open Company Docs step`, and compare the empty
state against `6701-96852` and the state after staging six files against `6701-96881` — heading
block, card geometry, the 40px/12px staged rows, and the `Submit` disabled/enabled treatments.
Per the recorded convention, do not drive the user's browser session; report what you see from a
dev server you started yourself, or hand the user the URL.

---

## Docs to Update

1. **`docs/frontend/auth-components.md`**
   - Replace the whole `### CompanyDocsModal` section with the V1.0 spec: the two new node ids,
     the shell props, the card composition, the reuse table above, the verbatim copy, the
     flat-upload/no-slots rationale (epic decision 2026-09-21), the close-keeps-progress
     semantics, the `Submit` threshold, and a **designer note** that both frames still carry a
     hidden `Step 1/2` badge left over from the retired two-step flow.
   - `### Shared file validation`: `UploadedFileRow`'s consumers become `AccountDocumentsCard`
     (with `p-2`) and `CompanyDocsModal` (no `className`); `DocumentUploadRow` is gone.
   - `### OwnersModal`: record that #1278 resolved the deferred call by **deleting**
     `FileDropZone.tsx` and `KybInfoBanner.tsx`.
   - `AuthModalShell`'s `stepLabel` row in the props table: its last consumer is gone — mark it
     as currently unused and say why (both V1.0 frames hide the badge).
2. **`docs/frontend/account-page.md`** — record the new optional `dataNodeId`/`testId` (and
   `className`, if added) on `AccountUploadRow` / `AccountRequirementsList`, that their defaults
   are the Account page's values, and that `CompanyDocsModal` is now a second consumer of both
   plus `useAccountDocuments`. Fix the reuse-verdict table rows for `FileDropZone` /
   `KybInfoBanner` (now deleted) and the `COMPANY_DOCUMENT_SLOTS` row (now inlined labels).
   Remove the "`CompanyDocsModal.tsx` and `useCompanyDocsModal.ts` are not modified" statement.
3. **`docs/frontend/hooks.md`** — add `useAccountDocuments` (`@/components/account/useAccountDocuments`):
   it now has two consumers, so rule 5 requires a catalogue entry.
4. **`docs/frontend/index.md`** — extend the `auth-components.md` line's component list to name
   `CompanyDocsModal` and `AccountInReviewModal`, which it currently omits.
5. **`docs/user-stories/epic-1247/1251-kyb-company-docs.md`** — add a supersede header block in
   the #1252 style: *"Superseded 2026-09-22 by #1278 — the five-slot Company Docs step was
   replaced by the V1.0 flat-upload redesign. Kept for history."*
6. **New `docs/user-stories/epic-1247/1278-kyb-company-docs-v1.md`** — stories for the V1.0
   modal, following the #1284 doc's shape (preamble stating it is presentational, reachable only
   from `/test?tab=auth`, styling out of scope, with the Figma nodes named): empty state; staging
   one file; staging several; removing the last file; oversize rejection; wrong-type rejection;
   Submit and its stand-in confirmation line; **close and reopen keeps the staged files**; and a
   note that there is no step badge. Preamble tech-debt callouts: TD-62 (rejection stand-in),
   TD-63 (PDF thumbnail), TD-83 (Submit threshold), TD-85 (progress is not persisted) — "not bugs
   to file". Also note BUG-19/BUG-20 are pre-existing and unrelated.
7. **`docs/user-stories/index.md`** — set the #1251 row's status to
   `Superseded (V1.0 redesign 2026-09-22, #1278)` and add the #1278 row.
8. **`docs/exec-plans/tech-debt-tracker.md`** (next free id is **TD-83**; note the file already
   has a duplicated `TD-73` — do not renumber it here):
   - TD-62 / TD-63: retarget `Location` from the deleted `DocumentUploadRow.tsx` to
     `AccountUploadRow.tsx` (rejection caption) and `UploadedFileRow.tsx` (PDF thumbnail), and
     update the node references to the V1.0 frames. Both gaps survive the redesign.
   - TD-64, TD-65, TD-67: mark **Resolved by deletion (2026-09-22, #1278)** — `FileDropZone.tsx`
     and `KybInfoBanner.tsx` are gone, so the gaps they described no longer have a location.
   - **TD-83** — Submit/Save enables at ≥ 1 file on both KYB upload surfaces; the raw-upload model
     gives the LP no way to signal completeness and the design specifies no threshold. Successor
     to the retired TD-66.
   - **TD-84** — the shared KYB document primitives (`AccountUploadRow`,
     `AccountRequirementsList`, `useAccountDocuments`, and `AccountIconTile` beneath them) live
     under `components/account/` but are consumed by `CompanyDocsModal`; promote and rename them
     to `components/Kyb*` in a dedicated PR.
   - **TD-85** — the modal's "closing keeps progress" is local React state, not persistence; it
     survives only while the component stays mounted. Needs #1267 + #1273, wired by #1254.
     Companion to TD-75 (the Account page's Save has no real transition).
9. **`docs/exec-plans/active/issue-1278-company-docs-v1.md`** → move to
   `docs/exec-plans/completed/` when the Issue closes, per the repo convention.

No product-spec change is required: this is a frontend presentational redesign of a screen the
epic already specifies, and the document model behind it was settled by the 2026-09-21 epic
decision.
