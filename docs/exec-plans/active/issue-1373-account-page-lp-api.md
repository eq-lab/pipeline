# Issue #1373: LP Account page: load and edit profile and documents from LP API

Source: https://github.com/eq-lab/pipeline/issues/1373

## Scope

Make the authenticated `/account` page the editable read-back surface for the LP profile and documents introduced by #1371. Add a Name/Country card above the document card, show the stored or session email, and persist profile and document actions through the existing `/v1/lps/me` API. Preserve the wallet card, logout, overall 480px column layout, route auth guard, and dev-only `?state=` visual fixtures. This issue owns Account page wiring only; #1254's home orchestration and wallet linking are outside scope. No backend changes or client-synthesized KYB transition.

## Assumptions and Risks

- `GET /v1/lps/me` returns `LpResponse` with `documents`, `kyb_status`, and `writable`, and 404 means no LP. `POST /v1/lps/me` fully replaces `{legal_name, country, contact_email}`. Upload is separate multipart `POST /v1/lps/me/documents`; delete uses numeric document id. Reuse `packages/frontend/src/api/lps.ts` and `ApiError` rather than another transport.
- `CompanyDocsModal.tsx` from #1371 already handles a full profile write, ordered 207/400 per-file upload outcomes, failed-file retry, uncertain network results, and id-based deletion. Extract or adapt this behavior carefully so page and modal agree. The modal itself remains a separate surface.
- `AccountDocumentsCard` currently shows persisted rows only in read-only looking states; `Provided` documents on a writable LP derive `verify`, so they would disappear. It also keys rows by filename and cannot identify duplicates. The API has no `NotProvided` document status or missing-document label; the `missing` preview is a design fixture. Production must not invent a named missing document.
- `writable=false` freezes profile writes and all document mutations; an individual `Verified` document is frozen even when the LP is writable. A `Rejected` document on a writable LP needs delete-then-upload correction. A 409 may arrive after an initially writable GET; reconcile server state before presenting further actions.
- A stored session may predate #1371 and lack email. An existing LP's `contact_email` is authoritative; a new LP with no session email cannot be created safely. Display a re-authentication instruction and disable creation instead of sending an empty or guessed email.
- Both `AuthFlowProvider` and the Account page may fetch the same LP. Treat response updates on the page as local read-back and guard async results against sign-out or token change. The page must not cause the setup modal to reopen after dismissal.
- Epic #1247 has Figma Account frames documented in `docs/frontend/account-page.md`. The Figma connector is unauthenticated, so implementation should use those documented measurements; epic QA should compare the rendered page with the Figma frames once access is available. The stage URL is a deployment target, not a source for API assumptions.

## Open Questions

_None_

## Implementation Steps

1. Add a production Account page controller hook beside `AccountPage.tsx` (for example `useAccountPage.ts`) to read `useAuthSession()`/`readSession()`, call `getMyLp()` with abort and token guards, and represent loading, loaded, absent (404), and error separately. Keep the route's dev preview branch independent of this hook's API requests. Provide an explicit retry on read failure and preserve the existing production auth redirect.
2. Add `AccountProfileCard.tsx` above the documents section, using labelled shared `TextField` inputs as in `CompanyDocsModal.tsx`. Populate from `legal_name`/`country`; display `contact_email` via `AccountEmailCard` or the new card, falling back to session email only for 404. Track draft and saved baseline separately; reset only on LP/account identity change, not when the same LP is refreshed after document actions. Save an edited profile independently of files with complete JSON; validate nonblank name and disable writes for `writable=false`, missing email, or in-flight action. Update baseline from successful POST and show useful 400/401/409/network errors. Refetch on 409.
3. Map server `LpDocument` rows to stable id, original filename, and Provided/Verified/Rejected status in `accountPageState.ts`. Derive presentation from `kyb_status` and actual documents, with a writable upload/list mode that can display already persisted Provided documents plus new staged rows. Keep synthetic `NotProvided` and named `missing` content in the dev fixture only. Adapt `AccountDocumentsCard.tsx` and `AccountDocumentRow.tsx` so stored rows use id keys, upload is available when writable, verified rows have no removal, and rejected rows offer a working delete-then-upload path when writable. Keep the existing Figma state treatments and preview tests.
4. Wire staged file Save in the Account controller to `uploadMyDocuments` after an LP exists. For a 404/new LP, validate the profile fields and authenticated email, create the LP through `upsertMyLp`, then upload staged files; for an existing LP, uploading must not silently save or overwrite an unsaved profile draft. Use ordered `files` results (not filenames) to remove only confirmed successes from the staged batch, show all rejected reasons for 207 and structured 400, and reconcile an uncertain network result with `GET` before retry. Use `deleteMyDocument(id)` for persisted removal and update the list only after 204; retain the row on failure and refetch on 404/409. Keep unsaved Name/Country drafts across these document mutations/refetches.
5. Make load/error/empty and per-action messages visible without fabricating email, documents, or KYB status. Preserve the `AccountWalletCard`, logout, 480px layout, and `?state=` fixture behavior in `routes/account.tsx` and `/test?tab=auth`. Ensure production query strings cannot activate fixture data.
6. Reconcile `docs/frontend/account-page.md`'s current presentational/seam language with the new production behavior and add `docs/user-stories/epic-1247/1373-account-page-lp-api.md`, linked from `docs/user-stories/index.md`.

## Test Strategy

- Add focused page/controller tests for pending GET, 404, loaded LP, 401/network errors with retry, sign-out/token switch during fetch, and dev preview isolation. Verify stored corporate email versus 404 session-email fallback, including legacy sessions without email.
- Test profile prefill, required name, optional country preservation, complete full-replace body, profile-only save, saved baseline, writable=false and 409 handling, and unsaved draft preservation after upload/delete/refetch.
- Test persisted rows after reload (including duplicate filenames), statuses, frozen Verified and frozen LP actions, rejected delete-then-upload correction, 207/400 ordered errors, successful-file retry exclusion, delete failure without optimistic removal, and uncertain network result reconciliation.
- Run affected Vitest suites, frontend lint and build, and `npx tsx scripts/lint-docs.ts`. The frontend flow has no separate manual testing phase; the epic QA issue owns story execution and Figma comparison.

## Docs to Update

- `docs/product-specs/lp-onboarding.md` — Account page read/edit and document behavior (drafted with this plan).
- `docs/frontend/account-page.md` — production data flow, profile card, document states/actions, and narrowed historical seams (drafted contract with this plan; reconcile implementation details during coding).
- `docs/user-stories/epic-1247/1373-account-page-lp-api.md` and `docs/user-stories/index.md` — story-based QA artifact in the implementation PR.
