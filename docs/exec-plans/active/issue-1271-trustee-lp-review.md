# Issue #1271: Trustee LP counterparty detail and KYB review

Source: https://github.com/eq-lab/pipeline/issues/1271
Epic: https://github.com/eq-lab/pipeline/issues/1269

## Scope

Replace the LP counterparty detail placeholder with live profile and document data and trustee
review actions. Update the existing list contract and ChangesRequested status display. Read
`GET /v1/lps/{id}`; its embedded flat document list supplies presigned download links. Send
per-document Verified/Rejected decisions and LP-level Passed/ChangesRequested/Failed decisions.
Follow shipped Loan detail and Origination review layout and tokens; this epic has no Figma.
Bank requisites, bank transfers, ledger work, document classification, and LP onboarding are out
of scope. Keep Bank Info Available as `—`.

## Assumptions and Risks

- Backend dependencies #1267 and #1274 are merged; #1273 was absorbed into the embedded detail
  response. Current `packages/api/src/routes/lps.rs` is the contract, superseding older issue
  comments about document types or a standalone document endpoint.
- Document review requires LP `UnderReview` and document `Provided`. Verified and Rejected
  documents cannot be reviewed again. `Rejected` requires a nonblank reason; `Verified` must
  omit the reason. Do not inherit the Origination dialog's arbitrary five-character minimum.
- KYB verdicts require `UnderReview`. Passed requires every document Verified; conservatively
  require a nonempty document list too. Reasons are optional for all LP verdicts and limited
  to 2,000 characters. Failed is terminal and suspends the owner's account; its confirmation
  must explain this before submission. ChangesRequested reopens the LP for correction.
- Preserve list labels New, KYB Pending, Approved, Rejected; add Changes requested in the
  attention band. Unknown status strings retain the neutral fallback.
- Presigned URLs expire or may be null. Offer explicit refresh for fresh detail/download data;
  missing URLs show unavailable download copy rather than a fabricated link.
- Server state can change between opening a dialog and saving it. Guard eligibility again at
  submission, disable duplicate writes, and refresh detail/list after success or stale-state
  responses. A failed mutation must retain the reason for correction or retry.
- Continue using trustee `apiFetch` and session/query conventions. Do not change global fetch
  or authentication to implement this page. Route changes must clear the prior LP's dialog
  and mutation state; protected 401 handling must follow the existing authenticated shell.

## Open Questions

_None_

## Implementation Steps

1. Update `docs/frontend/trustee-flows.md#lp-counterparties` before implementation to describe
   the live detail, document and verdict contract, eligibility, terminal refusal, optional
   reasons, fresh download links, and cache/error behavior. Remove obsolete placeholder and
   claims that every LP is permanently New. Add trustee review presentation details to the
   relevant section of `docs/product-specs/kyb-lp-verification.md` without changing backend
   policy. Add `docs/user-stories/epic-1269/1271-trustee-lp-review.md` and link it in the index.
2. Extend `packages/trustee/src/api/useLps.ts` summary types with nullable submission and
   decision timestamps. Add an LP detail response/document model in the trustee API layer,
   mirroring current Rust fields, not importing the LP frontend. Add `useLp` over
   `/v1/lps/{id}` with query key `["lp", id]`, abort support, explicit refetch, and current
   query conventions. Fetch detail independently of the list so direct links work.
3. Add trustee API mutation hooks for `/v1/lps/{id}/documents/{doc}/review` with JSON
   `{ decision: "Verified" | "Rejected", reason? }`, and `/v1/lps/{id}/kyb` with
   `{ decision: "Passed" | "ChangesRequested" | "Failed", reason? }`. Omit blank optional
   reasons; omit reason on document verification. Match current empty/JSON success responses.
   Invalidate `["lp", id]` and `["lps"]` after success. Refresh on 404/409 conflicts and keep
   mutation errors available; prevent overlapping document/verdict submissions.
4. Update `packages/trustee/src/routes/-useLpCounterpartiesTable.ts` for ChangesRequested.
   Retain existing table columns, served order, bank placeholder, and other status mappings.
   Ensure the list updates after detail mutations via query invalidation.
5. Add `packages/trustee/src/routes/-useLpCounterpartyDetail.ts` to own profile/document display
   mapping, eligibility, mutation/dialog state, optional reason validation, errors, and refresh.
   Keep `.tsx` render-only per `docs/FRONTEND.md`. Distinguish invalid id/404, pending lookup,
   permission failure, session expiry, network failure, empty documents, and loaded data. Use
   LP-specific error text rather than Origination-specific generic 403/409 copy. Preserve raw
   error details for `InlineError`. Show latest verdict reason and submission/decision dates.
6. Replace `packages/trustee/src/routes/lp-counterparties.$id.tsx` placeholder with the shipped
   Loan-detail identity/back-link/card pattern: legal name and status; country/contact email,
   registration/submission/decision dates, settlement address, and latest decision reason;
   flat file rows with original filename, size/type, status, reviewer/time, rejection reason,
   and real download links. Missing fields render `—`. Include refresh, pending/error/404,
   retry, and no-documents states. Downloads use presigned URLs and safe external-link attrs.
7. Add LP-specific review dialog component(s) matching shipped trustee dialog appearance.
   Verify a Provided document through confirmation; reject it with required reason. Offer
   Confirm KYB passed only after all documents Verified; offer Request changes and Reject
   account while UnderReview with optional reason. Reject-account confirmation explains the
   permanent refusal and account suspension. Use accessible labels, dialog focus handling,
   Escape/Cancel, and visible pending/error state; prevent closing a pending write from
   accidentally clearing its feedback. Do not reuse origination-specific copy or mandatory
   reason rules. After successful writes close dialogs, refetch current data, and show the
   resulting read-only state. Reset state on LP route changes.
8. Run the validation commands in Test Strategy, fix change-related lint/build errors, and
   review the final diff for accidental scope expansion. Report verification and any remaining
   limitation; do not merge the PR.

## Test Strategy

The manager frontend workflow has no testing phase. Do not add or run automated tests or browser
QA for this implementation. Run `npx tsx scripts/lint-docs.ts`,
`yarn workspace @pipeline/trustee lint`, `yarn workspace @pipeline/trustee build`, and
`git diff --check`. Code review must trace response/mutation types against the current Rust
contract and inspect session, route reset, cache invalidation, reviewability, and error paths.
Record user stories for the eventual epic QA pass: direct detail navigation and downloads;
Provided-only review; required document rejection reason; optional LP verdict reasons;
Passed gating; terminal refusal confirmation; ChangesRequested list/detail refresh; stale
409, 401/403, missing record, missing URL, and network retry. No Figma verification applies.

## Docs to Update

- `docs/frontend/trustee-flows.md#lp-counterparties` — shipped live list/detail and dialogs.
- `docs/product-specs/kyb-lp-verification.md` — trustee review UI presentation and guards.
- `docs/user-stories/epic-1269/1271-trustee-lp-review.md` and `docs/user-stories/index.md`.
- This execution plan — progress and material decisions during implementation.
