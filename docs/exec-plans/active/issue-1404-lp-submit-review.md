# Issue #1404: Submit LP for KYB review after setup and uploads

Source: https://github.com/eq-lab/pipeline/issues/1404
Epic: https://github.com/eq-lab/pipeline/issues/1247

## Scope

Wire the authenticated LP `POST /v1/lps/me/submit` into Finish account setup and Account page
document uploads. The modal's review confirmation must follow an actual server UnderReview
response. Adopt submission responses to freeze profile/document editing and show Account's
existing under-review state. Provide submit-only actions for already-uploaded eligible files
and retry after submission failures, preserving successful uploads. Keep Account profile Save
independent. No backend, trustee, notification-preference, or bank changes. Preview modes remain
local and do not call the API.

## Assumptions and Risks

- The endpoint is merged and returns `LpResponse`; it takes no request body. It accepts only
  NotStarted or ChangesRequested LPs with at least one document and no Rejected document.
  InProgress remains a legal but non-submittable API value.
- Upload success and submission are separate commits. A submit failure must never cause
  accepted files to upload again or make retry impossible once the staged list becomes empty.
- Do not auto-submit after partial/rejected uploads or unresolved network upload outcomes.
  Even if a reconciliation GET finds uploaded files, leave submission as an explicit next
  action once unresolved staged/ambiguous files have been reviewed and cleared.
- A lost submit response can occur after the server commits UnderReview. Reconcile with GET
  before allowing another POST. UnderReview proves success; Passed/Failed prove a subsequent
  terminal decision and must be adopted without a misleading under-review confirmation.
  ChangesRequested may follow a quick trustee verdict: adopt it with correction guidance and
  require an explicit next submission action, never automatically issue another POST.
- If reconciliation itself fails, block submission retries until a Check submission status GET
  succeeds. Do not infer status from upload completion or from an HTTP error alone.
- Guard every post-await state update by the captured session token; reset submission recovery
  state on session/LP changes. Check credentials before every follow-up request as well as
  before adopting its result. Existing upload reconciliation and profile-draft preservation
  behavior must remain. Serialize writes and block upload/deletion while submit state is unknown.
- For Account existing LPs, pending unsaved profile drafts must not silently freeze and become
  uneditable through a submit-only action: require them to be saved or discarded first. Profile
  Save remains an independent write and never triggers submission.

## Open Questions

_None_

## Implementation Steps

1. Update `docs/product-specs/kyb-lp-verification.md` and the CompanyDocsModal/provider sections
   of `docs/frontend/auth-components.md` to replace the saved-setup-only confirmation semantics
   with real submission. Update `docs/frontend/account-page.md` for submit-only eligibility,
   independent profile Save, automatic all-success upload submission, and recovery states.
   Amend #1396, #1371, and #1373 user stories only where their saved-setup/no-submit wording
   contradicts this new flow. Add `docs/user-stories/epic-1247/1404-lp-submit-review.md` and its
   index link.
2. In `packages/frontend/src/api/lps.ts`, add and export `submitMyLp()` over POST
   `/v1/lps/me/submit` with authenticated headers and no JSON body. Extend `LpResponse` with
   current nullable submission/decision timestamp fields needed by reconciliation (and current
   optional decision reason where rendered). Re-export through `src/api/index.ts`.
3. Add a focused frontend helper for submission eligibility and guarded submit/reconciliation
   shared by modal and Account controller. Eligibility is writable NotStarted/ChangesRequested,
   documents nonempty, no Rejected document, and no remaining staged or unresolved uploads.
   Use the current LP snapshot for eligibility. Return confirmed LP response, known
   refusal/error, or unresolved submit state; preserve API error details for existing copy.
   Never repeat POST as part of reconciliation. On network/parse uncertainty and 409, GET current
   LP and adopt it. UnderReview is successful submission; terminal status is current truth and
   must not open the review confirmation. A ChangesRequested read is adopted with correction
   guidance and requires an explicit next submission action. Failures of this GET expose Check submission status and keep
   write actions blocked until a confirmed read.
4. In `CompanyDocsModal.tsx`, keep preview `onSubmit` unchanged. For production Submit, upsert
   the profile and upload staged files in the existing sequence, retaining per-file recovery.
   After every staged file succeeds (or a valid persisted-document submit-only action), send
   submitMyLp. Adopt returned state through `onLpChange`; call `onSubmitSuccess` only if the
   authoritative response/reconciliation is UnderReview. Never call it after profile-only saves
   without eligible documents or after partial/all-failed uploads. Recheck eligibility against
   the latest response rather than stale React state after staged files are removed.
5. Add a clearly labelled Submit for review action when the modal has persisted eligible files
   and no staged files; it must not depend on profileChanged or canSave. After a submit failure,
   preserve persisted rows and offer that path again without re-upload. Before freezing, save
   changed profile data through the normal setup submission path. Unknown submission exposes
   Check submission status and locks writes. Handle terminal/current nonreviewable statuses
   with existing state/error feedback rather than opening an inaccurate confirmation. Check
   session identity after all submit/reconciliation calls, including catch/finally paths.
6. In `useAccountPage.ts`, make `applyUpload` report complete success and only then submit the
   response LP after accepted rows leave staging. Failures/partial/uncertain responses retain
   their current behavior and never auto-submit. Capture current session throughout. Add
   canSubmitForReview, submitForReview, and submission-recovery state/handlers for existing
   persisted documents with no staged files, upload uncertainty, busy state, or unsaved profile
   drafts. Submission adopts UnderReview or any newer authoritative LP without resetting
   unrelated drafts. Account profile-only Save continues to make only the upsert request.
7. Thread the Account submit-only action and Check submission status affordance into
   `AccountPage.tsx`/`AccountDocumentsCard.tsx`, production only. Use label Submit for review,
   existing button tokens, and clear error/pending feedback. Existing eligible accounts such as
   an LP with uploaded documents and NotStarted must submit without selecting another file.
   Keep upload Save separate while staged files exist, and explain saving profile drafts first
   when they block submission. After success the returned writable=false freezes controls and
   the existing Verifying account banner appears.
8. Extend `accountPageState.ts` KybStatus with ChangesRequested and preserve editable correction
   behavior; do not present ChangesRequested as UnderReview. Existing rejected-document
   correction stays available, and submission remains blocked until rejected files are removed
   and replaced. Ensure Failed status feedback does not falsely claim active review.
9. Run the checks below, inspect the final API/error/session paths against Rust, record progress
   in this plan, and report results without merging.

## Test Strategy

Manager frontend workflow has no testing phase: do not add or run automated tests or browser QA.
Run `npx tsx scripts/lint-docs.ts`, `yarn workspace @pipeline/frontend lint`,
`yarn workspace @pipeline/frontend build`, and `git diff --check`.
Review the save/upload/submit sequence, all-failed and partial responses, empty staged retry,
existing persisted-only submission, unresolved upload/submit blocking, committed-but-lost
submission reconciliation, fast trustee verdict, session changes, and independent profile Save.
Capture these scenarios in user stories for the later epic QA pass.

## Docs to Update

- `docs/product-specs/kyb-lp-verification.md`.
- `docs/frontend/auth-components.md` and `docs/frontend/account-page.md`.
- `docs/user-stories/epic-1247/1404-lp-submit-review.md` and `docs/user-stories/index.md`.
- Existing epic-1247 stories #1396, #1371, and #1373 where submission behavior changed.
- This execution plan's progress/decision log.

## Progress and Decisions

- [x] Step 1: Updated specification/auth/Account docs and amended existing user stories.
- [x] Step 2: Added bodyless authenticated submitMyLp and current response metadata types.
- [x] Step 3: Added shared eligibility, submission, and GET-only reconciliation helper.
- [x] Steps 4–5: Setup submits after complete uploads and supports submit-only retry/status checks.
- [x] Step 6: Account submits complete uploads and supports existing persisted documents.
- [x] Step 7: Added production submission action/status recovery and profile-draft guards.
- [x] Step 8: Added ChangesRequested type and a declined-state banner for Failed.
- [x] Step 9: Final documentation lint, frontend lint/build, and diff verification passed after
  existing-fixture maintenance.

Recovery deliberately does not infer a review cycle from timestamps: a ChangesRequested read
is adopted with correction guidance and can only be submitted again by explicit user action.
This avoids blindly resubmitting a quick trustee verdict. Existing test fixtures were maintained
for the new intentional API interactions and legal NotStarted status; no tests were added or run.
