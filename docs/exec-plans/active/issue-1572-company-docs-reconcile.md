# Issue #1572: Account setup modal can discard the wrong staged file after an uncertain upload (BUG-23)

Source: https://github.com/eq-lab/pipeline/issues/1572 — `docs/exec-plans/known-bugs.md` BUG-23
(introduced by #1371; epic #1247). Branch: `fix/1572-company-docs-reconcile`.

## Scope

`packages/frontend` only.

- `CompanyDocsModal.reconcile` matches read-back documents to staged files by filename and removes
  the first unmatched same-name file, so with two staged files of one name it can drop the wrong
  one (the failed file is lost from the draft, the accepted one is retried). `useAccountPage`
  already handles this correctly (#1373): same-name sets that cannot be told apart are kept as
  **ambiguous**, retry stays blocked, and the LP discards them explicitly after reviewing the
  uploaded list. The modal adopts the same rule through one shared pure helper.
- New `components/account/reconcileUploads.ts`: `reconcileUploadedDocuments(added, files)` →
  `{ matched: number[]; ambiguousNames: string[] }` and `reconciliationMessage(result, verb)`.
  `useAccountPage.reconcile` and the modal's `reconcile` both call it (page behaviour unchanged).
- Modal: `ambiguousNames` state; `reconcile(idsBefore, files)` takes the staged list it was
  called with; Submit stays blocked while `uncertainIds` or `ambiguousNames` are set; a
  "Discard uncertain files" action removes the ambiguous staged copies (mirrors the page); the
  upload row and staged-row Remove stay disabled while `busy` (the Check-uploads read).
- Tests, docs (`auth-components.md` CompanyDocsModal, `account-page.md` seam note), BUG-23 →
  Resolved, user-stories doc + index row.

Out of scope: content hashing or size-based matching (the server's `original_filename` is the
documented match key on both surfaces), the Account page's own UI.

## Assumptions and Risks

- Removal stays index-based inside the helper, but every index refers to the exact `files` array
  passed in — the array the upload/read-back was issued for — and the rows are disabled for the
  whole `busy` window, so an index can no longer point at a different file than intended.
- The page's three messages are reused verbatim except the closing verb ("save again" on the
  page, "submit again" in the modal), so the page's existing tests keep passing.

## Open Questions

_None._

## Implementation Steps

1. `components/account/reconcileUploads.ts` + `reconcileUploads.test.ts`.
2. `components/account/useAccountPage.ts`: `reconcile` delegates to the helper.
3. `components/CompanyDocsModal.tsx`: `ambiguousNames`, helper-based `reconcile(idsBefore,
   files)`, `canSubmit` gate, "Discard uncertain files" button, `discardAmbiguous()`.
4. `CompanyDocsModal.test.tsx`: ambiguous same-name read-back keeps both copies, blocks Submit,
   Discard clears them and re-enables the flow; unambiguous same-name (two added) removes both;
   a single-name match still removes exactly that file.
5. Docs per **Docs to Update**.

## Test Strategy

`yarn workspace @pipeline/frontend lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`.

## Docs to Update

- `docs/frontend/auth-components.md` — CompanyDocsModal production paragraph: uncertain upload →
  Check uploads, the duplicate-name rule, Discard uncertain files.
- `docs/frontend/account-page.md` — `useAccountDocuments`/seams table: the shared helper.
- `docs/exec-plans/known-bugs.md` — BUG-23 → Resolved.
- `docs/user-stories/epic-1247/1572-company-docs-reconcile.md` + index row.
