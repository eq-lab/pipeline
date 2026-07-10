# Issue #829: Trustee Origination: wire Approve/Reject submission review (reject-reason dialog + auth)

Source: https://github.com/eq-lab/pipeline/issues/829

## Scope

Frontend-only, in the trustee app (`packages/trustee`). Make the currently inert
Approve/Reject controls on the Origination review page (`/origination/$id`)
functional by wiring them to the **existing** DB-only endpoint:

```
POST /v1/loan-book/submissions/{id}/review
body: { "decision": "Approved" }                       // approve — NO reason
body: { "decision": "Rejected", "reason": "<non-empty>" } // reject — reason required
```

In scope:

- A new React Query mutation hook (`useReviewSubmission`) over the existing
  `apiFetch` (which already injects `Authorization: Bearer <token>`).
- Enable the Approve button (fires immediately, no reason) and the Reject button
  (opens a reject-reason dialog).
- A small reject-reason dialog: single text input, client-side min-5-chars
  (after trim) validation, Submit + Cancel.
- Pending / error / success handling: disable buttons + spinner while pending;
  inline error surfacing with special-cased copy for `409` (already reviewed)
  and `403` (not authorized); on success invalidate the submissions query so the
  #823 status footer flips to the Approved/Rejected banner.
- A small client-error typing change so the mutation can distinguish HTTP status
  codes (403 vs 409 vs other).
- Fix `useOriginationDetail`'s submission resolution so a post-mutation refetch
  actually updates the rendered footer (see Assumptions/Risks — this is the
  load-bearing correctness detail).

Explicitly OUT of scope:

- Any on-chain / Stellar / Soroban / `draw_loan` mint work. That is split out to
  the blocked issue **#831** (Option B, trustee wallet-signed). This issue wires
  only the DB-only review endpoint.
- The **"Request changes"** button — no endpoint exists for it; it stays
  inert/disabled exactly as today.
- The `/origination` table's "Review" control — it already navigates to the
  detail page via a `<Link to="/origination/$id">` (row-click nav landed in
  #823). No change; it stays navigate, not an inline approve/reject.
- Any new toast infrastructure — the trustee app has no toast provider today;
  feedback is surfaced inline + via the existing #823 banner flip.

## Assumptions and Risks

- **Backend contract is fixed and already shipped** (`packages/api/src/routes/loan_book.rs`,
  `review_submission` + `resolve_review`): approve must send no reason (a reason
  → 400); reject must send a non-empty trimmed reason (missing/empty → 400); only
  `InReview` is reviewable (already-decided → 409); 401 missing/invalid token;
  403 lacks `trustee` role; 200 success. The client mirrors this exactly.
- **Load-bearing risk — stale router state hides the success flip.**
  `useOriginationDetail` (`packages/trustee/src/routes/-origination-detail.ts`,
  ~lines 247-250) currently prefers `stateSubmission` (the `SubmissionView`
  snapshot passed via router navigation state) over the live
  `useLoanSubmissions()` list, falling back to the list only when no router state
  exists. After a successful review, invalidating the list refetches fresh data,
  but the memo would keep returning the stale navigation-state snapshot, so the
  footer would **not** flip (until a hard refresh drops the state). The plan
  fixes the resolution to prefer the live list copy when present, using
  `stateSubmission` only as an initial-render fallback. Without this fix, the
  approve/reject "success" is invisible for users who arrived from the table.
- The submissions query key is `["loan-submissions", chainId, status ?? "all"]`
  (`useLoanSubmissions.ts`). Invalidating with the prefix `["loan-submissions"]`
  matches all filter variants (React Query matches query keys by prefix), so the
  detail page's unfiltered query and any status-filtered lists all refetch.
- `apiFetch` throws `ApiUnauthorizedError` on 401 and a plain `Error` (message =
  backend JSON `error` field) on any other non-2xx. To special-case 403 vs 409
  without brittle message-string matching, we add the HTTP status to the thrown
  error (typed). Small blast radius: `packages/trustee/src/api/client.ts` plus
  its test `packages/trustee/src/api/-client.test.ts`.
- The `QueryClient` is a singleton created in `main.tsx`; `useMutation` +
  `useQueryClient().invalidateQueries` work as usual.
- The `#823` Approved banner reads "Approved & minted" — but nothing is actually
  minted yet (mint deferred to #831). See Open Questions.

## Open Questions

- The #823 Approved banner / table pill copy says "Approved & minted", but this
  issue only flips the DB status — no on-chain mint happens until #831 lands.
  Should the interim copy stay "Approved & minted" (accepting it is aspirational)
  or drop "& minted" until #831 ships? (Product/copy decision; low stakes but the
  current wording is literally inaccurate in the #829-only state.)

## Implementation Steps

1. **Type HTTP status on API errors** — `packages/trustee/src/api/client.ts`.
   Add the failing response's `status` to the thrown error so callers can branch
   on 403/409 without parsing message text. Minimal approach: introduce an
   `ApiError extends Error { readonly status: number }` thrown for all non-2xx
   responses, and make `ApiUnauthorizedError extends ApiError` (constructed with
   `status = 401`) so existing 401 callers and `instanceof ApiUnauthorizedError`
   checks keep working. Preserve the current message-resolution logic (JSON
   `error` field, falling back to `statusText`). Update
   `packages/trustee/src/api/-client.test.ts` to assert `.status` is populated
   and that the 401 path still throws `ApiUnauthorizedError`.

2. **Add the review mutation hook** — new
   `packages/trustee/src/api/useReviewSubmission.ts`. A `useMutation` that
   `POST`s to `/v1/loan-book/submissions/{id}/review` through `apiFetch`
   (mirror the POST body/headers pattern in `packages/trustee/src/api/auth.ts`:
   `method: "POST"`, `Content-Type: application/json`). Input shape:
   `{ id: number; decision: "Approved" | "Rejected"; reason?: string }`; only
   include `reason` when rejecting (never send it on approve — backend 400s).
   The endpoint returns `200` with no JSON body, so do not attempt to parse a
   body as `SubmissionView` — type the call as returning `void`/`unknown` and
   tolerate an empty body. On success, call
   `queryClient.invalidateQueries({ queryKey: ["loan-submissions"] })`. Export
   a typed result including `mutateAsync`, `isPending`, `error`, `reset`.
   Register it in `docs/frontend/hooks.md` (shared hook catalogue, FRONTEND rule
   5) — noted in Docs to Update.

3. **Map errors to friendly copy** — inside the page orchestration (step 5), map
   the thrown `ApiError.status` to user-facing text:
   - `409` → "This submission has already been reviewed. Refresh to see the
     latest status."
   - `403` → "You are not authorized to review submissions."
   - `401` (`ApiUnauthorizedError`) → session/auth message (mirror the sign-in
     flow's "not authorized"/expired handling).
   - `400` → surface the backend message (validation guard; should not happen
     given client-side validation).
   - other → generic "Something went wrong. Please try again." plus the backend
     message when present.

4. **Reject-reason dialog** — new component
   `packages/trustee/src/routes/-RejectReasonDialog.tsx` (the `-` prefix keeps it
   out of TanStack file-based route generation, matching the existing
   `-origination-detail.ts` convention; one component per file, FRONTEND rule 1).
   - Single labelled `<textarea>`/`<input>` for the reason, Submit + Cancel
     buttons. Accessible modal: `role="dialog"`, `aria-modal="true"`,
     `aria-labelledby` on the title, close on Escape and on Cancel, initial focus
     on the input, and a backdrop that does not submit on click.
   - Client-side validation: reason must be `>= 5` chars **after trim** (issue
     body is authoritative — min 5, not merely non-empty). Submit is
     disabled + an inline error shows until satisfied; never submit an
     empty/whitespace-only reason.
   - Props: `open`, `onCancel`, `onSubmit(reason)`, `isSubmitting`,
     `errorMessage`. Show the pending state (disable Submit, spinner/label) and
     the mapped mutation error inside the dialog.
   - Put the trimmed-length validation + submit-guard state in a co-located
     `-useRejectReasonDialog.ts` hook (FRONTEND rule 2: logic out of the `.tsx`),
     with a unit test.

5. **Page orchestration hook** — new
   `packages/trustee/src/routes/-useOriginationReview.ts`, co-located with the
   route, so `origination.$id.tsx` stays JSX-only (FRONTEND rule 2). It composes
   `useReviewSubmission`, owns the reject-dialog open/close state, exposes:
   - `approve()` → fires the mutation with `{ decision: "Approved" }`.
   - `openReject()` / `cancelReject()` → dialog visibility.
   - `submitReject(reason)` → fires `{ decision: "Rejected", reason }`, and on
     success closes the dialog.
   - `isPending`, `errorMessage` (already status-mapped per step 3), `rejectOpen`.
   On success, the query invalidation from step 2 refetches the list; combined
   with step 6's resolution fix, the footer flips automatically. Add a unit test.

6. **Fix submission resolution so the footer flips** —
   `packages/trustee/src/routes/-origination-detail.ts`, the `submission` memo
   (~lines 247-250). Change the precedence to prefer the live
   `useLoanSubmissions()` copy when it contains the `id`, falling back to
   `stateSubmission` only when the list has not yet produced a match (initial
   render / direct-URL). Concretely:
   `const fromList = submissions?.find((s) => String(s.id) === id); return fromList ?? stateSubmission;`
   Keep the existing loading/not-found precedence intact (still no loading flash
   when router state is present). Update `-origination-detail.test.ts` to cover:
   (a) router state renders immediately before the list resolves, and (b) once
   the list contains a fresher copy (e.g. status changed to `Approved`), that
   copy wins and drives the footer.

7. **Wire the view** — `packages/trustee/src/routes/origination.$id.tsx`.
   - Call `useOriginationReview(id)` in `OriginationDetail` and thread its state
     down to the footer.
   - In `ActionButtons` (currently three inert buttons): enable **Reject**
     (`onClick={openReject}`) and **Approve** (`onClick={approve}`); remove the
     `disabled`/`aria-disabled`/`cursor-not-allowed` treatment from those two and
     restore the active Figma styling. Keep **Request changes** inert/disabled
     exactly as today (no endpoint). While `isPending`, disable both action
     buttons and reflect a loading label/spinner.
   - Render an inline error message near the buttons when `errorMessage` is set
     (with a data-testid, e.g. `origination-detail-review-error`).
   - Render `<RejectReasonDialog>` gated on `rejectOpen`, wired to
     `cancelReject`, `submitReject`, `isPending`, and the mapped error.
   - Preserve the existing `data-testid`s (`origination-detail-approve`,
     `origination-detail-reject`, `origination-detail-request-changes`) so
     existing selectors/tests still resolve.

8. **Lint** — run `npx tsx scripts/lint-docs.ts` (docs structure) and the
   trustee package's typecheck/lint/tests (per AGENTS.md TypeScript rule). Fix
   all errors before finishing.

## Test Strategy

Vitest + Testing Library, matching the trustee app's existing `-*.test.tsx`
conventions (see `-useLoanSubmissions.test.tsx`, `-origination.index.test.tsx`).

- **`useReviewSubmission`** (`-useReviewSubmission.test.tsx`): mock `apiFetch`;
  assert approve sends `{ decision: "Approved" }` with **no** `reason` key;
  reject sends `{ decision: "Rejected", reason }`; POST method + JSON headers;
  on success `invalidateQueries(["loan-submissions"])` is called; on error the
  thrown `ApiError` (with `.status`) propagates.
- **`client.ts`** (`-client.test.ts`, update): non-401 non-2xx throws an error
  carrying the numeric `.status`; 401 still throws `ApiUnauthorizedError`
  (and it is an `instanceof ApiError`); message resolution (JSON `error` →
  `statusText`) unchanged.
- **Reject dialog validation** (`-useRejectReasonDialog.test.ts`): reason of
  `<5` trimmed chars keeps Submit disabled + error; whitespace-only never
  submittable; a valid reason enables Submit and yields the trimmed value.
- **`-RejectReasonDialog.test.tsx`**: renders open/closed; Cancel and Escape
  fire `onCancel` without submitting; Submit disabled while `isSubmitting`;
  displays a passed `errorMessage`.
- **`-useOriginationReview.test.ts`**: approve fires approve mutation; reject
  flow opens dialog → submitReject fires reject mutation → dialog closes on
  success and stays open on error; error status is mapped to the 409/403/other
  copy.
- **`-origination-detail.test.ts`** (update): the resolution-precedence cases
  from step 6 (router-state-first initial render, list-copy-wins after refetch)
  and that `statusKind`/footer follow the live copy.
- Edge cases to cover: 409 conflict copy ("already reviewed"), 403 copy ("not
  authorized"), pending disables buttons, approve never sends a reason, empty
  submissions list / not-found unaffected.

No backend tests — the endpoint and its contract already exist and are unchanged.

## Docs to Update

- `docs/product-specs/trustee-dashboard.md` — Flow note B "Implementation status
  (#821)" paragraph (~line 88) currently states the Approve/Reject/Request-changes
  buttons render inert. Update it to record that #829 wires Approve/Reject to the
  DB-only `POST /v1/loan-book/submissions/{id}/review` (approve = no reason;
  reject = reason dialog, min 5 chars), that the on-chain mint remains deferred to
  #831 (so "Approved & minted" is not yet literally minting), and that
  "Request changes" stays inert (no endpoint).
- `docs/frontend/hooks.md` — add `useReviewSubmission` to the shared-hook
  catalogue with its import path and one-line description (FRONTEND rule 5).
- If any shared util is extracted (e.g. a status→copy mapper), catalogue it in
  `docs/frontend/utils.md` with a test (FRONTEND rules 3-4). Otherwise no util
  doc change.
