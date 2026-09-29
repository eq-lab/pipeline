# Issue #1371: KYB: auto-open Finish account setup and persist LP profile/documents

Source: https://github.com/eq-lab/pipeline/issues/1371

## Scope

Wire the production email-auth flow to `GET /v1/lps/me`, open the existing dismissible Company Docs modal when the authenticated LP has no persisted documents, and make the modal save legal name, optional country, and untyped document files through the current LP endpoints. Show staged and persisted filenames with separate removal behavior. Keep `/test?tab=auth` usable as the visual preview.

The Account-page document hub, wallet linking, home-page state matrix, backend routes, review submission, and KYB status transitions belong to #1254/#1282 or backend work and are outside this issue.

## Assumptions and Risks

- The API contract is already implemented in `packages/api/src/routes/lps.rs` and described in `docs/product-specs/lp-onboarding.md`: `GET /v1/lps/me` returns an `LpResponse` with `documents`, `writable`, `legal_name`, `country`, and `contact_email`; absent LP is 404. `POST /v1/lps/me` is a JSON full replace. Document upload is a separate multipart call returning `{ lp, files }`, including 207 partial results in request order. `DELETE /v1/lps/me/documents/{doc}` returns 204. #1267 is closed; #1254 remains blocked and must not duplicate this slice.
- `packages/api/src/auth.rs::Claims` has no email claim and the token response contains only token/expiry. Persist the normalized email alongside the session when login or OTP succeeds; use `GET`'s `contact_email` for an existing LP. A legacy session that predates this field and has no LP cannot safely infer an email. In that case, keep the account setup prompt read-only or show a clear re-authentication action before Submit; never invent `contact_email` or send an empty one. New sessions carry the email through reload. Clear the email with sign-out and expiry.
- One server LP and its documents are the source of truth. Do not auto-open while `GET` is pending or on 401/network/5xx failure. In-flight responses from a previous token must not open a modal after sign-out/account switch. A dismissed prompt must stay dismissed until the next successful sign-in/session restoration, even across ordinary rerenders/refetches.
- API MIME validation checks bytes as well as the client selection rule, so a picked file may still be rejected. The API can reject the entire upload at 400/409/413 or report per-file failures at 207. Match per-file outcomes by request order, not filename, because duplicate names are allowed. A network failure after an upload can leave success uncertain; refetch before retry to avoid obvious duplicates and report that uncertainty to the user.
- Figma nodes [empty](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-96852&m=dev) and [uploaded](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-96881&m=dev) remain the visual reference. The Figma connector currently returns `USER_NOT_LOGGED_IN`, so the new profile card's exact spacing cannot be inspected now; use the documented V1.0 modal composition and shared `TextField` treatment, then compare the rendered empty/uploaded states to those nodes when access is available. This is a verification dependency, not a product decision.

## Open Questions

_None_

## Implementation Steps

1. **Done** — Add a typed LP API module under `packages/frontend/src/api/` for `getMyLp`, `upsertMyLp`, `uploadMyDocuments`, and `deleteMyDocument`, using `apiFetch`, `authHeaders()`, `ApiError`, JSON only for profile upsert, and `FormData` file parts only for upload. Export it from `api/index.ts`. Preserve 207 bodies as successful HTTP responses and type the ordered `files` outcomes and returned `lp`.
2. **Done** — Extend `packages/frontend/src/auth/session.ts` and `useAuthSession.ts` to retain the authenticated email with the token/expiry. Pass the submitted email through both success paths in `useEmailAuthFlow.ts` (`login` and `verifyOtp`). Normalize it consistently with the auth request. Ensure old stored sessions still read safely, and logout/expiry remove all stored identity data.
3. **Done** — In the app-wide `AuthFlowProvider.tsx` (or a small child hook/component), observe the authenticated session on mount and token changes, request `GET /v1/lps/me`, and track loading, absent LP, loaded LP, and error distinctly. After a completed 404 or zero-document 200, open `CompanyDocsModal`; after a nonempty document list or any request error, do not auto-open. Let the modal's X dismiss without changing the session; suppress reopen on rerender/refetch until a new authentication event or restored session. Guard against stale async responses and keep the standalone `/test` auth and Company Docs preview independent.
4. **Done** — Extend `CompanyDocsModal.tsx` with a profile card above its existing upload card. Use two accessible, labelled shared `TextField`s, prefill from the LP response, keep `contact_email` from that response on every profile POST, and use session email for a new LP. Preserve country unless edited. Respect `writable` for an existing LP and disable submit/removal while saving or deleting. Keep the existing file picker, validation, requirements list, staged rows, and mounted-component staging behavior. Adapt `UploadedFileRow.tsx` or a small sibling row to show server documents by `original_filename`, stable `id`, status, and a trailing X only where deletion is allowed; do not construct fake `File` objects for persisted entries.
5. **Done** — On Submit, validate nonblank legal name and at least one staged file, upsert the complete profile, then upload staged files. Update the UI from returned LP data (or a refetch). Remove staged entries only for confirmed successes; keep rejected/failed entries with actionable feedback, including 207 outcomes. If the profile save succeeds but upload fails, preserve the saved profile and staged files for retry. Delete persisted documents by id and update the list only after 204; refetch on conflict/not-found to reconcile server truth. Show clear messages for 400, 401, 404, 409, 413, and network errors. Do not infer a review transition from Submit.
6. **Done** — Keep `/test?tab=auth` rendering both empty and uploaded visual states without requiring a live backend session. Update `docs/frontend/auth-components.md` to replace obsolete no-network statements for production behavior; keep the historical #1278 layout notes understandable. Add `docs/user-stories/epic-1247/1371-account-setup-flow.md` with the scenarios below and link it from `docs/user-stories/index.md` in the implementation PR.

## Test Strategy

- Focused tests for session email persistence through login, OTP, reload, logout, and legacy stored sessions; no guessed email on 404.
- Provider/component tests for pending GET, 404/empty/nonempty results, 401/network errors, stale results after sign-out, X dismissal without immediate reopen, and a later sign-in prompting again.
- Modal/API tests for prefilled editable profile, full-replace payload retaining email/country, required name, read-only `writable=false`, accepted PDF/JPEG/PNG and 10MB limit, staged removal, persisted deletion by id, verified deletion refusal, profile-before-upload order, 207 partial success with duplicate filenames, and retry without re-uploading confirmed successes.
- Run the focused frontend tests, frontend lint/build, and `npx tsx scripts/lint-docs.ts` after TypeScript/docs edits. Frontend flow has no separate manual testing phase. The epic's QA pass will exercise the user stories and Figma visual comparison.

## Docs to Update

- `docs/product-specs/lp-onboarding.md` — account-setup trigger, save/read-back, and upload behavior (drafted with this plan).
- `docs/frontend/auth-components.md` — modal, app-wide auth trigger, session email, and preview behavior (drafted with this plan; reconcile historical #1278 details during implementation).
- `docs/user-stories/epic-1247/1371-account-setup-flow.md` and `docs/user-stories/index.md` — add story-based QA artifact with the implementation.
