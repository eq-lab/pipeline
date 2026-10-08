# Issue #1017: Origination detail: "Request changes" action (ChangesRequested review decision)

Source: https://github.com/eq-lab/pipeline/issues/1017

## Scope

Add a third review action to the origination detail page's `InReview` footer
(`/origination/$id`): a **Request changes** button next to Reject/Approve that opens a
modal with a **reason `textarea`** and submits
`POST /v1/loan-book/submissions/{id}/review { decision: "ChangesRequested", reason }`.

Frontend only. The backend fully supports the decision (backend #949 —
`packages/api/src/routes/loan_book.rs` `ReviewDecision::ChangesRequested`, reason
required, 400 without one, non-final). The display side of the status (chip, orange
banner) already ships (#950) and needs no change.

Out of scope:
- Offering re-review actions from the **ChangesRequested** state. The backend allows
  another review of a `ChangesRequested` submission (it stays open), but #950
  deliberately renders that state banner-only ("waiting on the originator to
  resubmit"). Unchanged here; a follow-up issue can revisit.
- The originator-side resubmit flow (`resubmit` endpoint) — no trustee UI for it.

## Assumptions and Risks

- Contract (from `loan_book.rs` `review_submission` + `ReviewDecision` docs):
  `ChangesRequested` requires a non-empty `reason` (mirrors Reject); `Approved` must
  NOT carry one; only `InReview` and `ChangesRequested` submissions are reviewable —
  already-`Approved`/`Rejected` → 409. The existing 409/403/401/400 error copy in
  `-useOriginationReview.ts` (`mapReviewError`) applies as-is; no new mappings needed.
- Pure DB call — no on-chain mint, no wallet signature (same as Reject). On success the
  existing `["loan-submissions"]` invalidation refetches the list and the footer flips
  to the #950 Changes-requested banner; no new wiring needed.
- **Dialog copy decisions (no Figma exists for this dialog; recorded here, not open
  questions):** title `Request changes — {originator}`, subtitle "The request returns
  to the originator with your reason; they can amend and resubmit.", submit label
  "Send to originator" (matches Reject), reason field is a **`textarea`** (3 rows) per
  the issue — deliberately NOT the single-line input the #838 Reject re-skin uses.
- Validation mirrors Reject: min 5 chars after trimming (client-side UX guard;
  backend 400 is the source of truth). Reuses `-useRejectReasonDialog.ts` unchanged.
- New sibling dialog component rather than parameterizing `RejectReasonDialog`: the
  Reject dialog is Figma-matched (#838, node `4116:14123`) and load-bearing; a
  parameterized shared shell risks regressing it for little win. The duplication is
  bounded (~100 lines of styling) — if it grates, a later `simplify` pass can extract
  a shared shell once both variants are stable.
- Branch/PR: stacked on #1016 (`feat/1017-request-changes-action` off
  `feat/1014-protection-location-fields`, PR #1018 based on `main`). Until #1016
  merges, PR #1018's diff shows #1014's commits too. Merge #1016 first.

## Open Questions

_None_ — the issue (authored from the user's direct request) fixes the button, the
modal-with-textarea, and the endpoint; copy/styling decisions are recorded above.

## Implementation Steps

1. **`packages/trustee/src/api/useReviewSubmission.ts`**
   - `export type ReviewDecision = "Approved" | "Rejected" | "ChangesRequested"`.
   - In `postReview`, attach `body.reason` when `decision` is `"Rejected"` **or**
     `"ChangesRequested"` (keep omitting it for `"Approved"`).
   - Update the contract doc comment (Reject/ChangesRequested carry a reason;
     ChangesRequested is non-final and re-reviewable).
2. **`packages/trustee/src/routes/-useOriginationReview.ts`**
   - Add state `requestChangesOpen` and handlers mirroring the reject trio:
     `openRequestChanges()` (resets `reviewMutation`, opens), `cancelRequestChanges()`
     (closes, resets), `submitRequestChanges(reason)` → `reviewMutation.mutate({ id,
     decision: "ChangesRequested", reason }, { onSuccess: close })`.
   - Extend `UseOriginationReviewResult` with the four new members and update the
     file-header doc comment.
3. **`packages/trustee/src/routes/-RequestChangesDialog.tsx`** (new)
   - Mirror `-RejectReasonDialog.tsx` structurally (backdrop, `role="dialog"`,
     `aria-modal`, Escape/backdrop/Cancel close, initial focus, validation via
     `useRejectReasonDialog()`), with the copy decided above and a
     `<textarea rows={3}>` instead of the input. Test ids prefixed
     `request-changes-*` (`-backdrop`, `-dialog`, `-input`, `-validation-error`,
     `-error`, `-cancel`, `-submit`).
4. **`packages/trustee/src/routes/origination.$id.tsx`**
   - `ActionButtons`: add a **Request changes** button between Reject and Approve,
     styled like Reject (secondary, h-40), test id
     `origination-detail-request-changes`, same `isPending` disable; new
     `onRequestChanges` prop.
   - Render `<RequestChangesDialog>` alongside the existing two dialogs, wired to
     `review.requestChangesOpen` / `cancelRequestChanges` / `submitRequestChanges`,
     `isSubmitting={review.isPending}`, `errorMessage={review.errorMessage}`.
   - Inline footer error stays suppressed while ANY dialog is open — extend the
     existing "neither dialog open" condition to include `requestChangesOpen`.
   - Update the file-header doc comment (footer now has three actions; drop any
     "Request changes stays inert" remnants).
5. **Docs** — see below. Run lint/build/tests; commit on
   `feat/1017-request-changes-action` (PR #1018 carries `Closes #1017`).

## Test Strategy

- `packages/trustee/src/api/-useReviewSubmission.test.tsx`: add a ChangesRequested
  case — body is `{ decision: "ChangesRequested", reason }` (reason PRESENT), and the
  Approved case still omits `reason`.
- `packages/trustee/src/routes/-useOriginationReview.test.ts`: open/cancel resets the
  mutation and toggles `requestChangesOpen`; `submitRequestChanges("...")` fires the
  mutation with `decision: "ChangesRequested"` and closes on success; no draw-loan
  (mint) interaction whatsoever.
- New `packages/trustee/src/routes/-RequestChangesDialog.test.tsx`: mirror
  `-RejectReasonDialog.test.tsx` — renders nothing when closed; textarea element
  (`<textarea>`, not input); min-5-chars validation gate; Escape/backdrop/Cancel call
  `onCancel` without submitting; submit passes the trimmed reason; disabled while
  submitting; shows `errorMessage`.
- `packages/trustee/src/routes/-origination-detail-page.test.tsx`: extend the
  `mockReview` fixture with the four new members; InReview footer renders the third
  button; clicking it calls `openRequestChanges`; the dialog renders when
  `requestChangesOpen` is true and Cancel/Submit hit the mocked handlers; footer
  buttons disabled while pending; inline footer error hidden while the dialog is open
  (error shows inside the dialog instead); Approved/Rejected/ChangesRequested banner
  states still show NO action buttons.
- Commands: `yarn workspace @pipeline/trustee lint`, `... test`, `... build`,
  `npx tsx scripts/lint-docs.ts`.

## Docs to Update

- `docs/product-specs/trustee-dashboard.md`: replace the outdated sentence
  `"Request changes" has no endpoint yet and stays inert.` in the #821
  implementation-status paragraph with the wired behavior: Request changes opens a
  reason dialog (textarea, min 5 chars trimmed) and posts
  `{ decision: "ChangesRequested", reason }` to the same review endpoint — a pure DB
  status flip (no mint); the footer then flips to the #950 Changes-requested banner.
- No new spec file; Flow 1's action set in the same doc already names
  "Request changes (comment)" as an intended action.
