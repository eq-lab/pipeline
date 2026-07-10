# Issue #838: Trustee Origination — update Approve-mint & Reject dialogs to Figma; drop footer note + Request changes

Source: https://github.com/eq-lab/pipeline/issues/838

Epic: #775 (Trustee panel). Builds on merged #829 (approve/reject wiring) and #831 (on-chain `draw_loan` mint). FRONTEND flow, `packages/trustee` only.

## Scope

A UI/design pass over the Origination review page (`/origination/:id`) plus two removals. Three parts:

1. **Approve & mint dialog → Figma node `4116-13943`.** Re-skin the Approve/mint confirmation surface to the Figma design (title "Approve & mint loan", subtitle "Transaction preview — sent from your Trustee key.", a dark monospace transaction-preview block, and `Cancel` / `Mint loan` buttons). **Omit the four green mint-invariant checklist rows** ("senior + equity == facility size", "offtaker price ≥ facility size", "maturity > origination", "assay + offtake excerpt hashed into metadataURI") — that is the "green information" with no backing data (consistent with #821's omission of the "All three mint invariants pass" / "Originator signature verified" banners).
2. **Reject dialog → Figma node `4116-14123`.** Re-skin the existing `RejectReasonDialog` (#829) to the Figma design (title "Reject request — `<originator>`", subtitle, a single-line reason input with placeholder, `Cancel` / `Send to originator` buttons). Keep the logic exactly: reason required, min 5 chars after trim, submit → `POST /v1/loan-book/submissions/{id}/review {decision:"Rejected", reason}`.
3. **Removals** in `origination.$id.tsx`: the footer note "Approval mints the loan NFT from your Trustee key. Disbursement is the separate Cash Management stage you co-sign next." (`origination.$id.tsx:310-313`) and the inert "Request changes" button (`origination.$id.tsx:322-331`).

**Explicitly out of scope / do NOT change:** the underlying #831 chain-first orchestration (`useDrawLoan` → `useReviewSubmission`), its ordering, its wallet-rejection/tx-failure error mapping, the idempotency/no-double-mint guards, and the review REST contract. This issue moves that flow's UI presentation into the Figma dialog surface; it does not touch the orchestration in `useDrawLoan.ts` or `useReviewSubmission`.

## Important discovery — the approve "dialog" does not currently exist

The issue body assumes there is an existing "Approve/mint confirmation+progress dialog" to re-skin. There is **not**. Today (`origination.$id.tsx` `ActionButtons` + `-useOriginationReview.ts`):

- Clicking **Approve** immediately fires the mint→review orchestration (`review.approve`). There is **no confirmation dialog and no confirm gate**.
- Progress is shown only by swapping the page-level Approve **button label** through `mintingLabel` ("Waiting for wallet signature…" → "Submitting on-chain…" → "Confirming…" → "Finalizing approval…").
- Errors render inline in a `<p data-testid="origination-detail-review-error">` next to the buttons.
- Success flips `statusKind` to `approved` (via list invalidation) and `DetailFooter` swaps `ActionButtons` for `ApprovedBanner`.

So implementing Figma `4116-13943` (a dialog with `Cancel` / `Mint loan`) **introduces a pre-mint confirmation gate** that does not exist today: Approve will open the dialog; the user reviews the transaction preview; `Mint loan` runs the existing orchestration. The frame depicts only the confirm state — none of the progress/error/success states — so those are carried over (button-label swap + inline error) styled inside the dialog. This behavioral addition is flagged in **Open Questions** (it is the crux of the issue).

## Design mapping (Figma → project tokens/px)

Both frames are **640px** wide with **30px** horizontal / **28px** vertical padding (580px content width). Fonts: Figma "Besley" → `var(--font-display)`; Figma "Inter" → `var(--font-body)` (project body face Graphik LC — the established trustee-route mapping); Figma "SF Mono" → **no project token exists**, use a system mono stack. Consistent with the existing `origination.$id.tsx` / `-RejectReasonDialog.tsx`, colors are applied as inline hex/rgba or `--color-pipeline-*` where a token matches (the sibling files already inline `#262524`, `rgba(56,55,53,0.18)`, `#000080` for pixel-exact Figma matching per the project convention).

### Shared dialog shell (both frames)

| Figma | Value | Implementation |
|---|---|---|
| Backdrop | overlay | reuse current `rgba(38,37,36,0.4)` full-screen backdrop (unchanged from `-RejectReasonDialog`) |
| Dialog bg | `#ffffff` | `bg-white` (= `--color-pipeline-surface`) |
| Width | 640px | `w-[640px]` + `max-w-[calc(100vw-32px)]` viewport guard |
| Radius | 6px | `rounded-[6px]` (note: current reject dialog is `rounded-[4px]` — change to 6px) |
| Padding | px 30 / py 28 | `px-[30px] py-[28px]` |
| Shadow | `0px 10px 40px rgba(0,0,40,0.25)` | `shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]` |
| Container gap | 4px | `gap-[4px]` (per-section top-padding provides the rest) |
| Title | Besley 26px / 36.4px, `#262524` | `font-[family-name:var(--font-display)] text-[26px] leading-[36.4px] text-[#262524]` |
| Subtitle | Inter 14px / 19.6px, `rgba(56,55,53,0.6)` | `font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[rgba(56,55,53,0.6)]` |
| Secondary button (Cancel) | white, border `rgba(56,55,53,0.18)`, 40px tall, px-17, text 16px `#262524` | matches existing `reject-reason-cancel` |
| Primary button | `#000080`, 40px tall, px-16, text 16px white | `h-[40px] rounded-[4px] bg-[#000080] px-[16px] ... text-white` |
| Button row | `gap-[12px]` justify-end, top pad 20px | `flex justify-end gap-[12px] pt-[20px]` |

### Approve & mint (`4116-13943`) specifics

| Figma | Value | Implementation |
|---|---|---|
| Code block bg | `#000040` | `bg-[#000040]` |
| Code block radius / padding | 4px / px-16 pt-28 pb-14 | `rounded-[4px] px-[16px] pt-[28px] pb-[14px]` |
| Code block overflow | horizontal scroll | `overflow-x-auto` |
| Code font | SF Mono 12.5px / 22.1px | inline `fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"`, `text-[12.5px] leading-[22.1px]`, `whitespace-pre` |
| `LoanRegistry.mintLoan` keyword | `#9fd0ff` | `text-[#9fd0ff]` |
| Punctuation / field labels | `#e2e2f5` | `text-[#e2e2f5]` |
| Field values | `#c8e6a0` | `text-[#c8e6a0]` |
| Green checklist (4 rows) | `#208000` | **OMITTED** (no backing data) |
| Primary label | "Mint loan" | button label; swaps to `mintingLabel` while minting |

### Reject (`4116-14123`) specifics — deltas from current `-RejectReasonDialog.tsx`

| Figma | Value | Implementation |
|---|---|---|
| Title | "Reject request — `<originator>`" | interpolate `loan_data.originator` (backed; already surfaced as `dealDetails.originator`) — was "Reject submission" |
| Subtitle (new) | "The request closes and the originator sees your reason." | new `<p>` (ink-muted 14px) |
| "Reason" label | Inter 13px / 18.2px `rgba(56,55,53,0.6)` | was 14px |
| Reason field | **single-line** input, border `rgba(56,55,53,0.18)`, rounded-4, px-13 / py ~12-11, placeholder `#757575` 15px "e.g. offtaker price below facility covenant" | current is a 3-row `<textarea>` with no placeholder — switch to single-line input with placeholder (validation unchanged) |
| Primary label | "Send to originator" (px-16, width follows content) | was "Submit" |

## Assumptions and Risks

- **A1.** Figma "Inter" maps to `var(--font-body)` (Graphik LC), matching every existing trustee route; "Besley" → `var(--font-display)`. Confirmed against `packages/ui/src/styles/theme.css`.
- **A2.** No project monospace token exists (`theme.css` has only `--font-display` / `--font-body`). Use a system mono stack for the code block. Not introducing a new font token for a single dialog.
- **A3.** The transaction-preview block is rendered from **real** `loan_data` (the same payload already passed to `useDrawLoan`): `originator`, `economics.*` (facility/senior/equity/offtaker/rate/dates — reuses `formatFullUsd`/`formatBpsRate`/`formatMaturityDate` from `-origination-detail.ts`), `metadata_uri`, and `initial_location`. Missing fields render as `—` (never fabricated), per `docs/FRONTEND.md` and the project no-fabricated-metrics rule. This is passthrough of backend-served fields, not a client-computed metric. See Open Question 2 for the `initialLocation` formatting gap.
- **A4.** Extracting a discrete `ApproveMintDialog` component (mirroring `RejectReasonDialog`) is the right structure per `docs/FRONTEND.md` code-structure rule 1/2 — the current inline `ActionButtons` progress logic moves into the dialog.
- **Risk R1.** Test churn: `-origination-detail-page.test.tsx` asserts the "Request changes" button (`origination-detail-request-changes`, ~lines 281-360) and the page-level Approve-button label swaps (`mintingLabel`, ~lines 394-449). Both move/disappear and must be updated in the same commit — see Test Strategy.
- **Risk R2.** The confirm-gate addition (Open Question 1) changes `-useOriginationReview.ts`'s surface (new `approveOpen`/`openApprove`/`cancelApprove`), which its unit test (`-useOriginationReview.test.ts`) and the page test both consume. Must update both.
- **Risk R3.** If Open Question 1 is answered "no confirm gate", parts 1's scope shrinks dramatically (the dialog would be a progress-only overlay, or the code preview lives elsewhere) — do not start part 1 until it is resolved.

## Open Questions

1. **Confirm-gate behavior (crux).** No approve dialog exists today — Approve mints immediately, showing progress via the page button's label. Figma `4116-13943` is a `Cancel` / `Mint loan` confirmation dialog. Confirm the intended behavior: **Approve opens this dialog as a pre-mint confirmation gate**, and the existing #831 orchestration runs on `Mint loan` (progress = button-label swap inside the dialog; errors = inline inside the dialog; success closes the dialog and flips the page footer to the Approved banner). This adds a confirm step the issue's "re-skin only, don't change the flow" wording did not anticipate.
2. **Transaction-preview code block data.** The block is backed by `loan_data` except the `initialLocation` line: Figma shows "Callao warehouse, PE" but `LocationInput` only has `location_type` / `location_identifier` / `tracking_url` — there is no country ("PE") field (it appears to come from `corridor`'s origin token, e.g. "PE → CN"). Confirm (a) the code preview block is wanted at all (vs. being excluded as "no-data" content alongside the green checklist), and (b) the exact `initialLocation` format — proposed default: `"<location_identifier> <location_type-lowercased>"` (omitting the country suffix, `—` if fields missing), rather than deriving a country from the corridor.
3. **Progress / success / error visuals.** Frame `4116-13943` shows only the confirm state — not waiting-for-signature/submitting/confirming/finalizing/success/error. Confirm it is acceptable to carry over the existing copy (swap the `Mint loan` label through `mintingLabel`; render `errorMessage` inside the dialog; no dedicated in-dialog success state — success closes the dialog). No new Figma exists for these states.

## Implementation Steps

1. **Remove the footer note** in `packages/trustee/src/routes/origination.$id.tsx` `ActionButtons` — delete the `<p>` at lines 310-313 ("Approval mints the loan NFT…"). Adjust the `flex flex-col ... gap-[20px]` container as needed so the error/button layout still reads correctly without it.
2. **Remove the "Request changes" button** in `ActionButtons` (lines 322-331) and its `data-testid="origination-detail-request-changes"`. The remaining `Reject` / `Approve` buttons keep their `gap-[10px]` row. Reflow check: the row is left-aligned (`items-start gap-[10px]`); removing the first (leftmost) button simply shifts Reject/Approve left — no centering or spacer to fix. Confirm visually against the page (no Figma change for the InReview footer itself in this issue).
3. **Reject dialog re-skin** — `packages/trustee/src/routes/-RejectReasonDialog.tsx`:
   - Add an `originator: string` prop; title becomes `Reject request — {originator}`.
   - Add the subtitle `<p>` "The request closes and the originator sees your reason.".
   - Container: `rounded-[6px]`, `w-[640px]` (+ `max-w-[calc(100vw-32px)]`), `px-[30px] py-[28px]`, the Figma shadow, `gap-[4px]` with per-section top-padding (`pt-[14px]` before the "Reason" label, `pt-[20px]` before the button row) to match the frame.
   - "Reason" label → 13px / 18.2px ink-muted.
   - Replace the 3-row `<textarea>` with a **single-line `<input type="text">`** carrying `placeholder="e.g. offtaker price below facility covenant"` (placeholder color `#757575`), keeping `data-testid="reject-reason-input"`, the same bound `value`/`onChange`, disabled-while-submitting, and initial focus. (The `useRejectReasonDialog` hook and its min-5-after-trim validation are unchanged.)
   - Primary button label → "Send to originator" (`px-[16px]`); keep `data-testid="reject-reason-submit"`, disabled logic, and the submitting label.
   - Keep all accessibility (`role="dialog"`, `aria-modal`, `aria-labelledby`, Escape-to-close, backdrop-click-cancels) and the `data-testid`s (`reject-reason-backdrop`, `-dialog`, `-cancel`, `-validation-error`, `-error`).
   - Update the `origination.$id.tsx` render site to pass `originator={detail.dealDetails.originator}`.
4. **Extract `ApproveMintDialog`** — new file `packages/trustee/src/routes/-ApproveMintDialog.tsx` (one component per file, render-only per FRONTEND.md rule 2). Props: `open`, `onCancel`, `onConfirm` (the `Mint loan` action), `isSubmitting`, `mintingLabel: string | null`, `errorMessage: string | null`, and `preview` (the formatted transaction-preview lines). Renders the shared dialog shell + title + subtitle + code-preview block (omitting the green checklist) + `Cancel` / `Mint loan` row. `Mint loan` label swaps to `mintingLabel` while minting; `errorMessage` renders inside the dialog (mirror `RejectReasonDialog`'s error `<p>`). Same accessibility contract as the reject dialog. Add `data-testid`s: `approve-mint-backdrop`, `approve-mint-dialog`, `approve-mint-cancel`, `approve-mint-confirm`, `approve-mint-error`, and one for the preview block.
5. **Transaction-preview formatting (view-model, not `.tsx`)** — in `packages/trustee/src/routes/-origination-detail.ts`, add a `transactionPreview` structure to `OriginationDetailResult` (a small array/object of `{ keyword, lines }` or pre-split colored segments) built from `submission.loan_data`, reusing the existing `formatFullUsd`/`formatBpsRate`/`formatMaturityDate`/`safeString` helpers and defensive `—` handling. Format the `initialLocation` line per the Open Question 2 resolution. This keeps `origination.$id.tsx` render-only. (Single-use → co-located in the view-model, no `utils/` extraction; if the coder factors a pure formatter out, it must ship a unit test per FRONTEND.md rule 3.)
6. **Confirm-gate wiring** — `packages/trustee/src/routes/-useOriginationReview.ts` (pending Open Question 1): add `approveOpen: boolean`, `openApprove()` (opens the dialog), `cancelApprove()` (closes it + `drawLoanMutation.reset()`/`reviewMutation.reset()` as appropriate). Keep the existing `approve()` as the `Mint loan` confirm action (unchanged mint→review orchestration, idempotency guard, error mapping, `mintingLabel`). Close the dialog on review success (e.g. an `onSuccess` that clears `approveOpen`; the footer flips to the Approved banner via list invalidation as today). The page's Approve button calls `openApprove`; the dialog's `onConfirm` calls `approve`.
7. **Page wiring** — `origination.$id.tsx`: the InReview Approve button `onClick` → `review.openApprove`; render `<ApproveMintDialog open={review.approveOpen} onCancel={review.cancelApprove} onConfirm={review.approve} isSubmitting={review.isPending} mintingLabel={review.mintingLabel} errorMessage={review.approveOpen ? review.errorMessage : null} preview={detail.transactionPreview} />` (mirroring the existing `RejectReasonDialog` wiring, including the "don't render the error twice" guard between the page and the dialog). Update the module-level JSDoc header to reflect the removed footer note, removed Request-changes button, and the new confirm dialog.
8. **Lint/build** — run `npx tsx scripts/lint-docs.ts` (TS doc validation) and the trustee typecheck/build; fix all errors before finishing.

## Test Strategy

Vitest + Testing Library (the existing suite under `packages/trustee/src/routes/`). This is the dedicated testing step for the plan.

- **`-RejectReasonDialog.test.tsx`** — add an `originator` prop to the render helper; assert the title reads "Reject request — <originator>", the subtitle renders, the single-line input carries the placeholder, and the primary button reads "Send to originator". Keep all existing behavior tests (open/close, Escape, backdrop-cancels, min-5 validation, disabled-while-submitting, error surface) green against the reskinned markup.
- **New `-ApproveMintDialog.test.tsx`** — closed when `open=false`; renders title/subtitle/preview and `Cancel`/`Mint loan` when open; `Cancel`/backdrop/Escape call `onCancel`; `Mint loan` calls `onConfirm`; the `Mint loan` label swaps to `mintingLabel` and the button disables while `isSubmitting`; `errorMessage` renders inside the dialog; the **green checklist strings are NOT present** (`senior + equity == facility size` etc.); accessibility attributes present.
- **`-origination-detail.test.ts`** — cover `transactionPreview`: correct values from a full `loan_data` fixture, and `—`/graceful handling when `loan_data`/nested fields are missing (never throws, never fabricates). Cover the chosen `initialLocation` format (per OQ2).
- **`-useOriginationReview.test.ts`** — add coverage for `approveOpen` default false, `openApprove` opens, `cancelApprove` closes (+ resets), the Approve button no longer mints directly (mint fires on confirm), and the dialog closes on review success. Keep the existing mint-ordering, idempotency, `mintingLabel`, and error-mapping tests green (the orchestration is unchanged).
- **`-origination-detail-page.test.tsx`** — remove/replace the "Request changes is inert" assertions and the `origination-detail-request-changes` `queryByTestId` checks (button no longer exists); remove the assertion that the footer note text renders; update the Approve-button label-swap tests so progress copy is asserted **inside the approve dialog** after opening it (Approve → open dialog → `Mint loan` label swaps through `mintingLabel`); keep the Approved/Rejected banner tests and the reject-dialog open/submit tests green.
- Run the full trustee unit suite; all green before handoff.

## Docs to Update

- No product-spec change required — this is a UI re-skin plus removal of two non-functional elements; no user-/agent-facing behavior contract changes (the review REST contract and the #831 orchestration are untouched). The only behavioral delta is the added confirm gate (Open Question 1), which is an interaction detail, not a spec-level contract.
- No `docs/frontend/hooks.md` / `utils.md` entry: the new dialog and its logic are component-local (FRONTEND.md rule 2), and the preview formatter is single-use (co-located). If the coder extracts a shared formatter util, it must be catalogued in `docs/frontend/utils.md` with a unit test in the same commit.
- Update the JSDoc headers in `origination.$id.tsx`, `-RejectReasonDialog.tsx`, `-useOriginationReview.ts`, and `-origination-detail.ts` to describe the Figma-backed dialogs, the removed footer note / Request-changes button, and (if OQ1 confirmed) the new confirm gate — with the Figma node ids `4116-13943` / `4116-14123`.
