# Issue #1913: Trustee: Originator cannot amend and resubmit a submission after Request changes — edit form over POST /v1/loan-book/submissions/{id}/resubmit

Source: https://github.com/eq-lab/pipeline/issues/1913

Parent epic: #775 (Trustee Admin Panel). Branch `feat/1913-trustee-resubmit-submission`, draft PR #1915.

## Scope

In scope (frontend only, `packages/trustee` + docs):

- New mutation hook `api/useResubmitLoan.ts` for `POST /v1/loan-book/submissions/{id}/resubmit`
  (body = `SubmitLoanRequest`, response = `SubmitLoanResponse`, `200`).
- New page **`/origination/$id/edit`** (file `routes/origination.$id_.edit.tsx`, non-nested like
  `loans.$id_.record-coupon.tsx`, because `origination.$id.tsx` renders no `<Outlet />`). Title
  "Amend and resubmit"; the Trustee's reason is shown above the form; the form is pre-filled from
  the served `loan_data` of the row.
- An **Amend and resubmit** action on `/origination/$id` in the `ChangesRequested` footer, under
  the existing orange banner.
- The create form's JSX is extracted into a shared component so both pages render the same
  fields, validation, document rows and error block. `/origination/new` keeps its behaviour and
  every existing `submit-loan-*` test id.
- Resubmit-specific error copy (`400` served text, `403`, `404`, two `409` cases).
- Docs: `docs/frontend/trustee-flows.md`, `docs/product-specs/trustee-dashboard.md` (edit in
  place, 200-line cap), new user-stories doc + index row.

Decisions made in this plan (not open questions):

1. **Route: `/origination/$id/edit`, not `/origination/new?resubmit=<id>`.** The submission id is
   the resource identity, so it belongs in the path; a search-param mode would turn the create
   page into a two-mode page with a different endpoint, title, banner, chain behaviour and
   success target, and would need search validation. A separate route reuses the form through a
   shared component and leaves `origination.new.tsx` behaviour untouched.
2. **Prefill verbatim from the served `loan_data`.** The same reader the Import-from-JSON path
   uses (`parseSubmissionJson`) is refactored into an object reader and applied to
   `submission.loan_data`. Numbers are stringified into the inputs, strings are kept as served
   (USDC amounts are human-unit strings, #1620; no rescaling). Legacy keys (`to`, `initial_ccr`,
   `initial_location`) are not read and are not resent (the backend marks them deprecated and
   "accepted and stored verbatim, never validated"; resubmit is a full replace of `loan_data`).
   Required paths absent from the served payload (for example `data_room_id`,
   `collateral_valuation.*`, `fee_schedule.*` on old rows) are listed in a warning banner, the
   same way the import warning works, and fail the client-side "Required." check until filled.
3. **Documents are carried over as served.** The create form has no upload; documents are
   name/URI rows. The served `loan_data.documents` rows are placed in the editable rows; the
   originator can edit, remove or add rows. Nothing is re-uploaded.
4. **Target chain cannot change on resubmit — this corrects the Issue.** The backend
   `resubmit_loan` handler takes no `chain_id` (no `RequiredChain` extractor), and
   `RESUBMIT_SQL` (`packages/shared/src/submitted_loan_repo.rs:98`) only sets `loan_data`,
   `status`, `reason`, `updated_at`; `target_chain_id` is fixed at creation. The edit form shows
   the target chain as a **disabled** select holding only the row's `target_chain_id`
   (labelled with `targetChainLabel`), with the hint "Fixed at submission. To target another
   chain, submit a new loan." Changing the chain on resubmit would be a backend change and is
   out of scope.
5. **Non-originator sessions.** The trustee app has no client-side role model, and comparing the
   session address with `SubmissionView.originator` is not done (address-format risk, and the
   API already decides). The action is shown on every `ChangesRequested` submission; a session
   without the `originator` role gets the API's `403` rendered inline as "Only the originator can
   resubmit this loan."; an originator who does not own the row gets the `404` as "Only the
   originator who submitted this loan can resubmit it."
6. **`metadata_uri` may stay the same.** The partial unique index only collides with *another*
   undrawn submission, and `validate_metadata_uri` only checks that the URI resolves. The
   unique-URI banner on the edit page therefore reads: "You can keep this submission's
   `metadata_uri`. A new one must not be used by another open submission." The `409` collision
   is mapped separately.
7. **Success.** Invalidate `["loan-submissions"]` and wait for the refetch (the hook's
   `onSuccess` returns the invalidation promise) before navigating to `/origination/$id`, so the
   detail page lands on the served `InReview` row with the review action buttons. No optimistic
   status is written client-side.

Out of scope:

- Any backend change (chain change on resubmit, role endpoint, edit of `InReview` rows).
- Letting the Trustee review a `ChangesRequested` row again from the UI (backend allows it; the
  footer stays banner + amend action).
- Import from JSON on the edit page (the prefill already fills the form; not requested).
- Sidebar attention counts (`GET /v1/attention-counts` is not consumed by the trustee app yet).
- Figma: no frame exists for the edit form. The page is built from the create form's layout and
  the trustee theme (same tokens and classes as `origination.new.tsx`); not a design question.

## Assumptions and Risks

- `GET /v1/loan-book/submissions` is public and returns the full `loan_data` per row
  (`SubmissionView.loan_data`, `loan_book.rs`), so the edit page needs no new read endpoint. The
  frontend type `SubmitLoanRequest` in `api/useLoanSubmissions.ts` is narrower than the payload
  (no `collateral_valuation`, `fee_schedule`, `documents`); the prefill reads it as `unknown`
  through the path reader, so no type widening is required. Widening the type is optional and not
  needed.
- `SubmissionView.target_chain_id` is typed optional in the frontend but always served
  (`i64`, non-null). If it is ever absent the disabled select is empty, the builder fails with
  "Required." on `target_chain_id`, and nothing is sent; the resubmit request does not use the
  value anyway.
- `safeString`, `mapHeading` and the `formatSubmittedDate` import in `-origination-detail.ts`
  are module-private; export the ones the edit presenter reuses instead of copying them.
- The submissions list polls every 30 s. The form state is seeded once (lazy `useState`) when the
  form component mounts with the resolved submission, keyed by submission id, so polling never
  resets user edits.
- If the row stops being `ChangesRequested` while the page is open (another tab resubmitted, or
  the Trustee decided), the next poll would switch the page to the "not awaiting changes" panel.
  The gate ignores status changes while the mutation is pending or succeeded, so the page's own
  successful resubmit does not flash that panel before navigation.
- Error copy relies on the backend `409` message text to tell a `metadata_uri` collision
  (`"metadata_uri `…` is already used by another undrawn submission"`) from a wrong status
  (`"submission {id} is not in ChangesRequested …"`). If the backend text changes, the collision
  falls back to the status copy; the raw text stays behind View details either way. Covered by
  unit tests against the current strings.
- Trustees see the action on a `ChangesRequested` row they cannot use; the inline `403` explains
  why. Accepted by decision 5.
- New TanStack route: `npx vite build` must run before `yarn build` so `routeTree.gen.ts` is
  regenerated (tsc runs first); the regenerated file is committed.
- No dependency on unmerged work: the backend endpoint (#1733 ownership check included) is on
  `main`.

## Open Questions

_None_

## Implementation Steps

1. **Resubmit hook** — new `packages/trustee/src/api/useResubmitLoan.ts` (2–3-line `// spec:`
   header pointing at the new trustee-flows section):
   - `export interface ResubmitLoanVariables { id: number; input: SubmitLoanInput }` (import
     `SubmitLoanInput`, `SubmitLoanResponse` from `./useSubmitLoan`).
   - `postResubmit({ id, input })` →
     `apiFetch<SubmitLoanResponse>(`/v1/loan-book/submissions/${id}/resubmit`, { method: "POST",
     headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })`. No
     `chain_id` query.
   - `useResubmitLoan()` → `useMutation<SubmitLoanResponse, Error, ResubmitLoanVariables>` with
     `onSuccess: () => queryClient.invalidateQueries({ queryKey: ["loan-submissions"] })`
     (returned, not `void`ed, so `mutateAsync` resolves after the refetch).

2. **Resubmit error copy** — `packages/trustee/src/utils/userError.ts`: add
   `export function mapResubmitError(error: Error | null): UserFacingError | null`, placed beside
   `mapWaterfallError`, with `details` always the raw message:
   - `ApiError` `400` → `message` = the served text verbatim (the backend's `BadRequest` string is
     user-visible by contract, e.g. the `metadata_uri` resolve failure).
   - `403` → "Only the originator can resubmit this loan."
   - `404` → "Only the originator who submitted this loan can resubmit it."
   - `409` matching `/metadata_uri .* already used/i` → "This metadata URI is already used by
     another open submission. Use a unique one."
   - other `409` → "This submission is no longer awaiting changes. Refresh to see its latest
     status."
   - anything else → `toUserError(error, "Failed to resubmit the loan.")` (keeps 401/5xx copy).

3. **Form model refactor** — `packages/trustee/src/routes/-origination-new.ts`:
   - Split `parseSubmissionJson` into `parseSubmissionObject(root: unknown, targetChainIds)`
     (object checks + field/document reading, unchanged rules) and keep `parseSubmissionJson`
     as the `JSON.parse` wrapper calling it. Behaviour of Import from JSON stays identical.
   - Add `export function prefillFromSubmission(submission: SubmissionView): { values; documents;
     missingFields }`: calls `parseSubmissionObject(submission.loan_data, [submission.target_chain_id])`
     and sets `values[TARGET_CHAIN_FIELD] = String(submission.target_chain_id)` (empty string when
     the field is absent); returns `values` merged over `emptyFormValues()`, `documents ?? []`,
     and `missingFields`. A non-object `loan_data` yields empty values and every required path
     listed as missing.
   - Extend `useOriginationNewForm(targetChains, initial?: { values: Record<string,string>;
     documents: LoanDocumentInput[] })`: seed `storedValues` / `documents` from `initial` in the
     lazy `useState` initialisers. No other behaviour change; `/origination/new` passes nothing.

4. **Shared form component** — new `packages/trustee/src/routes/-SubmissionForm.tsx` (one
   `// spec:` header): move `FieldInput`, the class/colour constants, the sections grid, the
   Documents section, the error/validation-summary block and the submit button out of
   `origination.new.tsx` verbatim (same markup, same `submit-loan-*` test ids). Props:
   `form: OriginationNewForm`, `targetChainDisabled: boolean`, `targetChainHint?: string`
   (rendered under the target-chain field when set), `error: UserFacingError | null`,
   `isPending: boolean`, `submitLabel: string`, `pendingLabel: string`, `onSubmit: () => void`.
   Export the banner class constants the pages need (`ATTENTION_FILL`, `LINE_COLOR`,
   `SECONDARY_BUTTON_CLASS`) from here.
   - `origination.new.tsx` keeps its header, unique-URI banner, import warning, import dialog and
     `onSubmit`, and renders `<SubmissionForm … submitLabel="Submit loan" pendingLabel="Submitting…"
     targetChainDisabled={targetChains.isLoading || form.targetChainOptions.length === 0} />`.

5. **Edit-page presenter** — new `packages/trustee/src/routes/-origination-edit.ts`:
   - `useOriginationEdit(id: string, stateSubmission: SubmissionView | undefined)` returns
     `{ state: "loading" | "error" | "not-found" | "not-editable" | "ready"; submission;
     errorMessage; errorDetails; reason; reviewedDate; heading }`. Resolution precedence and the
     loading/error/not-found rules mirror `useOriginationDetail` (live `useLoanSubmissions()`
     copy first, router-state copy as first-paint fallback; `toUserError(…, "Failed to load the
     submission.")`). `not-editable` when `normalizeOriginationSubmissionStatus(status) !==
     "ChangesRequested"`. `reason` = `safeString(submission.reason)`, `reviewedDate` =
     `formatSubmittedDate(submission.updated_at)`, `heading` = `loan_data.originator` +
     commodity exactly as the detail breadcrumb (reuse the existing helpers in
     `-origination-detail.ts`; export them if not already exported).
   - `useResubmitForm(submission)` (same file): builds
     `prefill = prefillFromSubmission(submission)`; `form = useOriginationNewForm({ options:
     [{ id: submission.target_chain_id, label: targetChainLabel(submission.target_chain_id) }],
     defaultChainId: submission.target_chain_id }, prefill)`; `resubmit = useResubmitLoan()`;
     `onSubmit` = `form.buildForSubmit()` → on `null` stop; else `resubmit.reset()` and
     `resubmit.mutateAsync({ id: submission.id, input: built.input })` then
     `navigate({ to: "/origination/$id", params: { id: String(submission.id) } })`, catching
     rejections (error renders inline, no navigation, form intact). Returns `form`,
     `missingFields`, `error: mapResubmitError(resubmit.error)`, `isPending`, `isSuccess`,
     `onSubmit`.

6. **Edit page** — new `packages/trustee/src/routes/origination.$id_.edit.tsx`
   (`createFileRoute("/origination/$id_/edit")`, one `// spec:` header):
   - Reads `Route.useParams().id` and `useLocation().state.submission`; calls
     `useOriginationEdit`. Loading / error / not-found render like the detail page's states
     (`origination-edit-loading`, `origination-edit-error`, `origination-edit-not-found`).
   - `not-editable` (and not mid/after a successful mutation, see Risks) →
     `origination-edit-not-editable`: "This submission isn't awaiting changes." + link back to
     `/origination/$id`.
   - `ready` → render an inner `<ResubmitForm key={submission.id} submission={…} />` so the
     form hook seeds once from the resolved row. Layout copies `origination.new.tsx`:
     back link "‹ <heading>" to `/origination/$id`, h1 "Amend and resubmit", then
     - the reason banner `origination-edit-reason` reusing the detail page's orange tokens:
       "Changes requested · `<reviewedDate>` — `<reason>`";
     - the metadata-URI banner `origination-edit-uri-banner` (copy in decision 6);
     - when `missingFields.length > 0`, `origination-edit-prefill-warning`: "This submission was
       stored without some fields — fill these in before resubmitting:" + the path list
       (same styling as the import warning);
     - `<SubmissionForm targetChainDisabled targetChainHint="Fixed at submission. To target
       another chain, submit a new loan." submitLabel="Resubmit for review"
       pendingLabel="Resubmitting…" … />`.
   - Main container classes match `origination.new.tsx` (`max-w-[1200px]`, same padding).

7. **Detail page action** — `packages/trustee/src/routes/origination.$id.tsx`:
   - `DetailFooter` gains `submission: SubmissionView | undefined` (or `submissionId: string` +
     the router-state object) and, in the `changes-requested` branch, renders the existing
     `ChangesRequestedBanner` followed by a `<Link to="/origination/$id/edit" params={{ id }}
     state={{ submission }} data-testid="origination-detail-amend">Amend and resubmit</Link>`
     styled as the primary button already used for Approve (`h-[40px] rounded-[4px]
     bg-[#000080] px-[17px] … text-white`), wrapped in the same `flex flex-col items-start
     gap-[20px]` column the action buttons use. Replace the inline "no action buttons (#950)"
     comment rather than adding new ones (comment-minimal rule).
   - The presenter (`-origination-detail.ts`) exposes the resolved `submission` if it does not
     already, so the Link can pass router state; no other presenter change.

8. **Route tree + build** — from `packages/trustee`: `npx vite build` (regenerates
   `src/routeTree.gen.ts` with `/origination/$id/edit`), then `yarn build`; commit the
   regenerated `routeTree.gen.ts`.

9. **Lint** — `npx tsx scripts/lint-docs.ts` and `npx tsx scripts/lint-comments.ts` from the repo
   root; if a touched file is listed in `scripts/lint-comments.baseline.json`
   (`-origination-detail.ts`, `-origination-detail-page.test.tsx`), shrink its entry. New files
   carry only the one `// spec:` header.

## Test Strategy

Run vitest from inside `packages/trustee` (`npx vitest run <files>`, then the whole package).

- `api/-useResubmitLoan.test.tsx` (new, `fetch` stubbed like `-useSubmitLoan.test.tsx`):
  POSTs the body to `/v1/loan-book/submissions/42/resubmit` with **no** `chain_id` query, JSON
  content type and the bearer; resolves the served `{ id, draw_loan }`; invalidates
  `["loan-submissions"]` and `mutateAsync` resolves only after the invalidation; a `409` rejects
  with an `ApiError` carrying status 409 and the served message.
- `utils/-userError.test.ts` (extend or add): `mapResubmitError` for `400` (served text inline),
  `403`, `404`, `409` collision string, `409` status string, `401`, `500`, `null`.
- `routes/-origination-new.test.ts` (extend): `parseSubmissionJson` behaviour unchanged (existing
  cases pass untouched); `prefillFromSubmission` fills every scalar field from a full served
  `loan_data` (numbers stringified, USDC strings verbatim e.g. `"1200000.5"`), carries
  `documents` rows as served, sets `target_chain_id` from `submission.target_chain_id`, ignores
  legacy `to`/`initial_*`, lists missing `data_room_id`/`collateral_valuation.*`/`fee_schedule.*`
  for a legacy payload, and handles a non-object `loan_data`; `useOriginationNewForm` with
  `initial` seeds values and documents; without it, behaviour is unchanged.
- `routes/-origination-edit.test.ts` (new): presenter states — loading, error, not-found,
  `not-editable` for `InReview`/`Approved`/`Rejected`, ready for `ChangesRequested`; live list
  copy wins over router state.
- `routes/-origination-edit-page.test.tsx` (new, mocks like `-origination-new-page.test.tsx`):
  prefilled inputs show the served values; reason banner text; target-chain select is disabled
  with the hint and only the row's chain; missing-fields warning appears for a legacy row;
  clearing a required field shows "Required." and does not call the mutation; submit calls
  `mutateAsync({ id, input })` with the edited value and navigates to `/origination/$id` on
  success; on rejection with each mapped status the inline `submit-loan-error` shows the mapped
  copy and there is no navigation; editing state survives a re-render with a refreshed list row;
  not-editable panel for an `InReview` row with a back link.
- `routes/-origination-new-page.test.tsx`: must pass unchanged after the `-SubmissionForm.tsx`
  extraction (proves the create page is behaviour-identical).
- `routes/-origination-detail-page.test.tsx` (extend the existing #950 case): the
  ChangesRequested footer shows the banner **and** `origination-detail-amend` linking to
  `/origination/$id/edit` with the id; InReview/Approved/Rejected footers do not render it.
- Build: `npx vite build` then `yarn build` in `packages/trustee` succeed; `routeTree.gen.ts`
  contains `/origination/$id/edit`.
- Manual check (user's dev server, real API — no localStorage mocks): as an originator session,
  open a `ChangesRequested` row, Amend and resubmit, change one field, submit; the Network tab
  shows `POST …/submissions/<id>/resubmit` → `200`, the detail page shows "Awaiting your
  review"; as a trustee-only session the same submit shows the `403` copy inline.

## Docs to Update

- `docs/frontend/trustee-flows.md`:
  - §Origination & review **Sources**: add `api/useResubmitLoan.ts`, `routes/-origination-edit.ts`,
    `routes/origination.$id_.edit.tsx`, `routes/-SubmissionForm.tsx`.
  - §Submit a loan: one line noting the form body lives in `-SubmissionForm.tsx`, shared with the
    edit page.
  - New subsection **"Amend and resubmit (`/origination/$id/edit`, #1913)"** after §Submit a
    loan: endpoint and body, no `chain_id`, target chain fixed and shown disabled, prefill rules
    (served `loan_data` verbatim via the import reader, documents carried over, legacy keys
    dropped, missing-fields warning), metadata-URI banner copy, error mapping table
    (400/403/404/409×2), success = await `loan-submissions` refetch then navigate to the detail,
    not-editable panel, action visible to every session (API decides).
  - §Status-conditional footer: the **ChangesRequested** bullet changes from "no action buttons"
    to "banner + Amend and resubmit link to `/origination/$id/edit` (#1913)".
- `docs/product-specs/trustee-dashboard.md` line 88 (Flow note B implementation-status paragraph,
  file at 199/200 lines — edit in place, add no lines): replace "(the originator can amend and
  resubmit; the backend also allows the trustee to review it again, though the UI currently
  renders that state banner-only per #950)" with a sentence stating the originator amends it
  from the detail page's "Amend and resubmit" form (`/origination/$id/edit`, #1913) — prefilled
  from the served payload, target chain fixed, `POST /v1/loan-book/submissions/{id}/resubmit`
  returning it to `InReview` — while a trustee re-review of `ChangesRequested` stays out of the UI.
- `docs/user-stories/epic-775/1913-originator-amend-resubmit.md` (new): stories for (1) the
  action on a ChangesRequested detail page, (2) prefilled form with reason banner and fixed
  chain, (3) successful resubmit returns the detail to Awaiting your review and the row leaves
  the Changes-requested state in the Origination table / Needs Attention, (4) validation and API
  errors inline (403 trustee session, 409 metadata URI collision), (5) direct visit to the edit
  URL for a non-ChangesRequested row shows the not-editable panel.
- `docs/user-stories/index.md`: add the #1913 row in the epic-775 table.
