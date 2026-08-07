# Issue #1037: Trustee app: adopt the #1034 error UX (InlineError + ErrorDetailsDialog, toUserError)

Source: https://github.com/eq-lab/pipeline/issues/1037

## Goal

**Show the user a short, friendly sentence — never a 100+ line raw dump that blows up the layout.**
Everything below serves that one outcome. Where a step does not, cut it.

Today a failed on-chain call in the trustee app pipes the full Soroban diagnostic-event dump straight
into an inline `<p>` (e.g. `loans.$id_.record-coupon.tsx:420`, `loans.$id.tsx:1485/1525/1546`), which
both means nothing to an operator and pushes the page around. The #1034 pattern fixes exactly this:
`InlineError` renders one sentence, and the raw text — if kept at all — goes into
`ErrorDetailsDialog`'s `<pre>`, which is `max-h-[280px] overflow-auto` with
`whitespace-pre-wrap break-words`, so a giant single-line dump is confined to a scrollable modal and
can never force horizontal page scroll.

## Scope

Adopt the #1034 two-layer error pattern (short human line + "View details" → `ErrorDetailsDialog`)
across `packages/trustee/`, so no raw `ApiError`/`HostError`/Soroban-diagnostic string renders inline
anywhere in the trustee app.

**In scope**

1. A trustee-local mapping layer `packages/trustee/src/utils/userError.ts` (decision D1 below), with
   unit tests, catalogued in `docs/frontend/utils.md`.
2. Consolidation of the two byte-identical `mapWaterfallError` copies
   (`-record-coupon.ts:113-127`, `-record-repayment.ts:115-129`) into that module.
3. An adoption sweep over **21 raw `.message` reads** feeding display fields across 9 feature areas
   (full inventory in "Surface inventory" below): every presenter hook gains an `errorDetails`
   sibling to its `errorMessage`, and every render site swaps its bare `<p>{text}</p>` for
   `InlineError`.
4. Removal of the `{errorMessage ?? "Friendly fallback"}` anti-pattern at its **11 sites** — the
   friendly copy moves into the hook as the mapper's per-surface fallback, so it is used on *every*
   failure rather than only when the message happens to be `null`.
5. One fix in `@pipeline/ui`: make `ErrorDetailsDialog`'s Escape handler capture-phase +
   `stopImmediatePropagation`, so opening it from inside an existing trustee dialog does not close
   the parent dialog (decision D4).
6. Spec prose extends `docs/frontend/error-handling.md`; code keeps one-line `spec:` pointers
   (`docs/FRONTEND.md` rule 6).

**Out of scope**

- **Sign-in / auth** (`TrusteeSessionProvider.tsx:86-122`, `SignInCard.tsx`). Already 100% humanized
  — it discards the raw value at the `catch` and never reads `.message`, so it already meets the
  acceptance bar. Capturing raw text for a details dialog would mean widening `SessionState`
  (`auth/sessionStore.ts:30-38`) and the challenge/verify state machine; not worth it here.
- **`NeedsAttention`** — see Open Question 1.
- **T-Bills swap form (#983)**. Verified: `-cash-management-tbills.ts` has **no error state at all**
  and `TbillsSwapDialog` (`cash-management.tsx:522+`) is a UI shell with submit disabled (execution
  blocked on Type-2 MPC #781). Same for the On/Off-ramp `SwapDialog` (#943). There is nothing to
  adopt; the cash-management work is the three real surfaces listed under area G.
- **Risk-council submit errors** — those three pages have no mutations wired, only load errors.
- Typing the LP `packages/frontend/src/api/client.ts` errors, and re-pointing `packages/frontend` at
  `@pipeline/wallet-connect` (TD-35). Both stay as tracked debt.
- `docs/frontend/trustee-flows.md` — deliberately untouched, see Assumptions/Risks R1.

## Key decisions

### D1 — Mapping table location: trustee-local `packages/trustee/src/utils/userError.ts`

The issue defers this. Resolved in favour of a trustee-local module, **not** a hoist into
`@pipeline/wallet-connect`:

- **The hoist cannot actually deduplicate.** `packages/frontend/package.json` declares only
  `@pipeline/ui` among workspace deps — there is no `frontend → @pipeline/wallet-connect` edge, and
  TD-35 records that the LP wallet code was deliberately *copied* rather than moved and has not been
  re-pointed. Moving the chain-generic half into `@pipeline/wallet-connect` would leave the LP copy
  in place, producing three copies instead of two.
- **`@pipeline/ui` is the wrong home too.** It has no `utils/` directory at all today and is a
  presentational design-system package; encoding Soroban contract-error codes and Pipeline operator
  copy there inverts the layering.
- **Most of the mapping is not chain-generic.** Trustee's dominant error source is `ApiError` with a
  typed numeric `.status` (`packages/trustee/src/api/client.ts:32-48`, added by #829). The LP's
  `matchHttp` does brittle *text* matching precisely because the LP client throws untyped `Error`s —
  a limitation `error-handling.md` already records as debt. Trustee should branch on status, which
  the LP table structurally cannot do. The copy also differs by role ("This submission has already
  been reviewed. Refresh to see the latest status." is meaningless to an LP).
- **The genuinely shared surface is ~60 lines** (`toError`, `parseSorobanContractErrorCode`, the
  rejection regex list, EVM/network matching). Duplicating that matches the precedent already
  documented in `docs/frontend/utils.md` → "Trustee app" and tracked as TD-38 / TD-42 / TD-46.

Log a new tech-debt row for the eventual cross-package consolidation, explicitly gated on TD-35.

### D2 — Module shape

```ts
// packages/trustee/src/utils/userError.ts
export interface UserFacingError { message: string; details: string; isSpecific: boolean }

export function toError(err: unknown): Error;                       // port of the LP stage 1
export function parseSorobanContractErrorCode(raw: string): number | null;
export function toUserError(err: unknown, fallback?: string): UserFacingError;
export function mapWaterfallError(error: Error | null): UserFacingError | null;
```

- `fallback` defaults to **"Something went wrong. Please try again."** (trustee's existing
  `mapReviewError` default), *not* the LP's "The transaction could not be completed." — most trustee
  surfaces are reads, not transactions. Each load surface passes its own ("Failed to load the loan
  book.", etc.), so the friendly copy that currently sits uselessly behind `??` in the JSX moves into
  the mapper and is always used.
- `details` is always the full normalized raw text, never truncated — same contract as the LP layer.
- **Match order** (`toUserError`): wallet/user rejection → trustee preflight guards ("… is not
  configured for this environment.", "Stellar wallet not connected." — thrown by the five on-chain
  hooks `useDrawLoan`/`useRollover`/`useUpdateLifecycle`/`useRecordPayment`/`useCloseLoan`) →
  Soroban `Error(Contract, #N)` table → simulation-error shape → `ApiError.status` table
  (401/403/409/404/5xx) → generic fallback.
- The `ApiError.status` branch is the trustee-specific one and must come from `instanceof ApiError`,
  not text matching. Seed it with exactly the copy `mapReviewError` already ships (see D3).

### D3 — Existing humanized copy is PRESERVED, only the raw interpolation is stripped

`-useOriginationReview.ts` already has partly-humanized copy. It becomes table entries, it is not
replaced by generics. The only change is that raw text moves out of the sentence and into `details`:

| Site | Today | After |
|---|---|---|
| `mapReviewError` 401 / 409 / 403 | already clean copy | unchanged, now with `details` attached |
| `mapReviewError` 400 (`:157`) | `error.message` **raw** | `"This request was invalid."` + details (but see Open Question 2) |
| `mapReviewError` default (`:159-160`) | `` `Something went wrong: ${raw}` `` | `"Something went wrong. Please try again."` + details |
| `mapMintError` simulation (`:178`) | `` `Could not verify the loan on-chain (${raw}). No signature was requested — safe to retry.` `` | same sentence minus the parenthetical; raw → details |
| `mapMintError` reject/cancel (`:181`) | `"Signature cancelled. Click Approve again to retry."` | unchanged + details |
| `mapMintError` not-configured (`:184`) | clean | unchanged + details |
| `mapMintError` not-connected (`:187`) | clean | unchanged + details |
| `mapMintError` default (`:189`) | `` `The on-chain transaction failed (${raw}). Please try again.` `` | same sentence minus the parenthetical; raw → details |
| partial-failure sentence (`:322-326`) | interpolates `reviewMutation.error.message` | same sentence minus the parenthetical; raw → details |

`mintStageLabel` (`:192-205`) is progress copy, not an error — leave it alone.

### D4 — Dialog-in-dialog: nesting is safe visually, but Escape is a real bug

Origination-review errors render **inside** `-ApproveMintDialog` / `-RejectReasonDialog` /
`-RequestChangesDialog`, so `InlineError`'s `ErrorDetailsDialog` would mount as a descendant of the
parent dialog's panel. Checked:

- **Stacking — fine.** Every trustee dialog backdrop is `fixed inset-0 z-50`
  (`-ApproveMintDialog.tsx:111`, `-RejectReasonDialog.tsx:81`, `-RequestChangesDialog.tsx:79`,
  `loans.$id.tsx:760/930/1110`, `cash-management.tsx:326/575/786`), which creates a stacking context;
  `ErrorDetailsDialog`'s identical `fixed inset-0 z-50`
  (`packages/ui/src/components/ErrorDetailsDialog/ErrorDetailsDialog.tsx:45`) is *inside* that
  context and therefore paints above it. No z-index change needed.
- **Backdrop click — fine.** The nested backdrop's `onClick` is a React synthetic handler; it bubbles
  up the React tree into the parent panel's `onClick={(e) => e.stopPropagation()}`, so it never
  reaches the parent's backdrop handler. The parent dialog stays open.
- **Escape — broken.** Both `useErrorDetailsDialog` (`useErrorDetailsDialog.ts`, window keydown) and
  each parent dialog (`-ApproveMintDialog.tsx:92-99`, `-RejectReasonDialog.tsx:62-70`, and the
  `-RequestChangesDialog` equivalent) register **bubble-phase `window` keydown listeners**.
  `window.addEventListener` ignores React's `stopPropagation`, and the parent's listener is
  registered first (it mounted first), so it fires first: Escape closes the *parent* dialog and
  unmounts the details dialog with it. `-RejectReasonDialog` / `-RequestChangesDialog` do not even
  have `-ApproveMintDialog`'s `isSubmitting` guard.

  **Fix (in `@pipeline/ui`):** register `useErrorDetailsDialog`'s keydown listener in the **capture**
  phase and call `e.stopImmediatePropagation()` before `onClose()`. Window capture-phase listeners
  run before window bubble-phase listeners for an event targeted at a descendant, so the topmost
  dialog consumes the key and the parent stays open. Backward-compatible — no LP surface nests today.
- **Duplicate DOM id.** `ErrorDetailsDialog` hardcodes `id="error-details-title"`. It renders `null`
  when closed and realistically only one is open at a time, so this is a latent-only concern —
  document it in the spec rather than parameterising the id in this issue.
- Keep `origination.$id.tsx:583-587`'s existing "suppress the footer error while a dialog is open"
  guard exactly as is.

### D5 — Waterfall preview keeps its no-details treatment for the expected-input case

Per #916 the waterfall 4xx is an **expected user-input** case ("amount exceeds what's left"),
deliberately given friendly copy with no numbers and no backend text. Adding "View details" to that
branch would be noise. So `mapWaterfallError` returns `details: ""` for the 4xx branch (so
`InlineError` renders no trigger) and full details for the unexpected/non-4xx branch.

### D6 — Rendering: keep each surface's container, swap only the inner text node

`InlineError` renders a `<span role="alert">` at `13px/18px` in `--color-pipeline-negative`. Do not
restructure the boxed panel-load treatments (border + `rgba(192,57,43,0.06)` fill) — keep the box,
replace the `<p>` inside it. Pass `className` where a surface needs its existing `14px` size or a
`block` display (a `<span>` in a flex column may need `inline-block`/`block`). This also fixes the
inconsistent `role="alert"` coverage for free, and retires the two hardcoded `#b20000` /
`NEGATIVE_RED` literals in the record pages (`docs/FRONTEND.md` forbids inline hex).
Keep all existing `data-testid`s on the wrapping element so current tests keep resolving.
Client-side validation lines (`-useRejectReasonDialog.ts`, `reject-reason-validation-error`,
`request-changes-validation-error`) stay plain `<p>` — they have no raw payload.

## Surface inventory

Every row is a raw-`.message` read or an `?? "friendly"` site. `→ InlineError` means the hook gains
`errorDetails` and the render site swaps to `InlineError` and drops its `??`.

**A. Origination review** — `-useOriginationReview.ts` (`mapReviewError:143`, `mapMintError:174`,
`errorMessage:320-328`; expose `errorDetails`) → render sites `origination.$id.tsx:316-326`
(ActionButtons, add missing `role="alert"` via InlineError), `-ApproveMintDialog.tsx:156-162`,
`-RejectReasonDialog.tsx:126-132`, `-RequestChangesDialog.tsx:125-131`. Thread `errorDetails` through
`DetailFooter` (`:464-496`) and all three dialog props alongside `errorMessage`.

**B. Origination list** — `-useOriginationTable.ts:201` raw → `toUserError(error, "Failed to load
loan submissions.")`; `origination.index.tsx:250-258` → InlineError, drop `??`.
Note `-origination-detail.ts:188/431` has no error state at all (a fetch failure renders "not found",
`origination.$id.tsx:529-535`) — out of scope, log as a known bug.

**C. Record coupon / repayment** — `-record-coupon.ts:487` and `-record-repayment.ts:470` (loanBook
raw → fallback "Failed to load the loan."); `:501` / `:483` → consolidated `mapWaterfallError`;
render sites `loans.$id_.record-coupon.tsx:190-206` / `:356-364` / **`:413-421` (fully raw on-chain
`record_payment` failure)** and `loans.$id_.record-repayment.tsx:212-228` / `:358-366` /
**`:401-409` (raw record)** / **`:411-419` (raw `close_loan`)**. The three on-chain surfaces are the
highest-value ones — they are where wallet rejections and Soroban dumps land today with zero mapping.

**D. Loan detail** — `-useLoanDetail.ts:535` (P&C), `:748` (registry), `:855` (loan book) raw; keep
the 404 → `"empty"` special cases untouched. Render: `loans.$id.tsx:412-420`, `:496-504`,
`:1400-1414`, plus the three on-chain action dialogs `:781-788` (disbursement), `:1001-1008`
(rollover), `:1222-1229` (lifecycle) whose `error` props are fed raw at `:1485`, `:1525`, `:1546`.
Widen those three dialog props from `error: string | null` to a `{ message, details }` pair.

**E. Loans list** — `-useLoansTable.ts:430`; `loans.index.tsx:531-538` (add `role="alert"`).

**F. Risk council** — `-risk-council-escalate.ts:322`, `-risk-council-reterm.ts:132`,
`-risk-council-writedown.ts:124`; pages `risk-council.escalate.$id.tsx:344-359`,
`risk-council.reterm.$id.tsx:204-214`, `risk-council.writedown.$id.tsx:239-249`.

**G. Cash management** — `-cash-management.ts:140` (ramp events load), `:146`
(`reviewErrorMessage`, the ramp-event review **mutation** — currently raw with `role="alert"`),
`-cash-management-withdrawals.ts:34`; render `cash-management.tsx:975-983`, `:1130-1137`,
`:1171-1179`. T-Bills tab: no error path (see Out of scope).

**H. Audit log** — `-useAuditLog.ts:84`; `audit-log.tsx:147-154` (add `role="alert"`).

**I. Capital allocation** — `useCapitalAllocationCard.ts:304`;
`CapitalAllocationCard.tsx:114-121` (add `role="alert"`). Preserve the documented behaviour at
`useCapitalAllocationCard.ts:30-32` that on-chain read failures degrade a single row and do **not**
set `isError`.

## Assumptions and Risks

- **R1 — PR #1026 (issue #997, "Comments→specs: trustee panel") is a hard merge-order constraint,
  not a footnote.** It is open with issue #997 still labelled `executing`, and it modifies **54
  files** — a near-total superset of this issue's touch set (`-useOriginationReview.ts`,
  `-ApproveMintDialog.tsx`, `-RejectReasonDialog.tsx`, `-RequestChangesDialog.tsx`,
  `-useLoanDetail.ts`, `-useLoansTable.ts`, `-useOriginationTable.ts`, `-record-coupon.ts`,
  `-record-repayment.ts`, all three risk-council presenters, `-cash-management*.ts`,
  `cash-management.tsx`, `loans.$id.tsx`, `useCapitalAllocationCard.ts`, `useNeedsAttention.ts`, …).
  It deletes large comment blocks wholesale and moves 1011 lines of prose into
  `docs/frontend/trustee-flows.md`. Conflicts are guaranteed and large in both directions.
  **Decided: #1037 lands first.** #1026 is then updated against the new `main` and its conflicts
  resolved afterwards. Because #1026 is comment-only churn over the same files, expect to
  **regenerate** its comment-stripping against the post-#1037 sources rather than replay the old
  diff — the comment blocks it deletes will have moved or changed wording. Whoever owns #997 should
  know this before they pick it back up.
  Consequence for this plan: put **all** new spec prose in `docs/frontend/error-handling.md` and do
  **not** touch `docs/frontend/trustee-flows.md` — that keeps this issue's doc surface disjoint from
  #1026's 1011-line rewrite of `trustee-flows.md`, so the two only collide in source comments, not
  in docs.
- **R2 — `@pipeline/ui` change has LP blast radius.** The capture-phase Escape fix (D4) touches a
  component the LP app already uses at 8 sites. It is additive and no LP surface nests dialogs today,
  but `packages/ui` and `packages/frontend` suites must both be re-run, not just trustee's.
- **R3 — Breadth.** ~21 presenter changes + ~25 render sites across 9 areas in one PR. Sequence the
  implementation area-by-area (A→I) and keep the trustee suite green after each area rather than at
  the end.
- **R4 — Prettier drift.** TD-51 records pre-existing Prettier drift in `packages/trustee` that fails
  `yarn lint` on `main`. Do not let it be mistaken for a regression, and do not opportunistically
  reformat unrelated files.
- **R5 — Baseline.** `yarn workspace @pipeline/trustee test` is **787 passed / 59 files** on the
  current branch (the issue text's "778" predates recent merges). Use 787 as the floor.
- **R6 — No Figma reference.** Neither the issue nor its comments carry a Figma URL, and #1034's
  components were built from existing dialog idioms. No Figma verification step applies; visual
  verification is "matches the `InlineError` treatment already shipped in the LP app".

## Open Questions

_All resolved:_

- **"View details" scope** → KEEP the dialog (user, 2026-08-07): full LP parity — friendly line +
  ErrorDetailsDialog with raw text and copy button, including the capture-phase Escape fix in
  `@pipeline/ui` for the nested-dialog bug. The trimmed friendly-copy-only fork was offered and
  declined.
- **Merge order vs PR #1026 (#997)** → #1037 proceeds NOW (user, 2026-08-07). The parked
  comment-extraction branch absorbs the conflicts and gets partially redone against the changed
  files when #997 resumes — accepted cost. All new spec prose still goes to
  `docs/frontend/error-handling.md` (not `trustee-flows.md`) to minimize the overlap.
- (Closed earlier via user steer to the planner: curated copy everywhere / raw dialog-only;
  NeedsAttention silent failure logged to `known-bugs.md`, out of scope.)

## Implementation Steps

1. [x] **Baseline.** From `feat/1037-trustee-error-ux`, confirm `yarn workspace @pipeline/trustee test`
   is 787/59 green. Re-read `packages/frontend/src/utils/userError.ts` and
   `docs/frontend/error-handling.md` — the LP implementation is the reference for structure and
   comment style.
2. [x] **Create `packages/trustee/src/utils/userError.ts`** per D2: `toError`,
   `parseSorobanContractErrorCode`, `toUserError(err, fallback?)`, `mapWaterfallError`. Port the LP
   rejection regexes and Soroban parser verbatim; add the trustee-specific `instanceof ApiError`
   status branch and the five preflight-guard patterns. Header comment is a `spec:` pointer only
   (rule 6) — behaviour prose goes in step 12.
3. [x] **Create `packages/trustee/src/utils/-userError.test.ts`** covering: every rejection pattern; each
   `ApiError` status (401 via `ApiUnauthorizedError`, 403, 409, 400, 404, 500); each preflight guard;
   `Error(Contract, #N)` parse incl. multiple-occurrence-first-wins and unlisted-code fallthrough;
   the simulation-error shape; per-surface `fallback` override; and the invariant that `details` is
   always the full untruncated normalized text on every branch.
4. [x] **`@pipeline/ui` Escape fix** (D4): in
   `packages/ui/src/components/ErrorDetailsDialog/useErrorDetailsDialog.ts`, register the keydown
   listener with `{ capture: true }` and call `e.stopImmediatePropagation()` before `onClose()`.
   Update the inline comment. Add a `packages/ui` test proving that with a sibling bubble-phase
   `window` keydown listener registered first, Escape invokes only the dialog's `onClose`.
   **Deviation:** the test lives in `packages/frontend/src/components/ErrorDetailsDialog.dom.test.tsx`
   (added to the existing suite there), not a new `packages/ui` test file — `packages/ui` has no test
   runner at all (confirmed: no vitest/jest config, no existing `.test.*` files in the package), and
   the established precedent for `ErrorDetailsDialog`/`InlineError` DOM coverage already lives in the
   frontend's jsdom Vitest environment (see that file's own doc comment). Also added the matching D4
   nested-dialog regression test per dialog in Areas A's dialog test files.
5. [x] **Area A — origination review.** Rework `mapReviewError` / `mapMintError` / the composed
   `errorMessage` in `-useOriginationReview.ts` to return `UserFacingError` per D3; expose
   `errorDetails: string | null` from the hook. Thread it through `origination.$id.tsx`'s
   `DetailFooter` → `ActionButtons` and the three dialogs' props. Swap all four render sites to
   `InlineError`, preserving existing `data-testid`s and the `:583-587` suppression guard.
   **Deviation:** `mapReviewError` was retired entirely (its 401/403/409/400/default branches are now
   exactly the shared `toUserError` `ApiError.status` table — see D3 table in the doc); the composed
   `errorMessage`/`errorDetails` logic calls `toUserError(reviewMutation.error)` directly instead of
   through a wrapper function.
6. [x] **Area B** — `-useOriginationTable.ts` + `origination.index.tsx`.
7. [x] **Area C** — move `mapWaterfallError` into the shared module, delete both local copies, update
   both route-module imports; map the loanBook load error and the three on-chain
   record/close failures in `loans.$id_.record-coupon.tsx` / `loans.$id_.record-repayment.tsx`;
   replace the `#b20000` / `NEGATIVE_RED` literals.
8. [x] **Area D** — `-useLoanDetail.ts` (three fields, 404-empty cases untouched) + `loans.$id.tsx`
   (three panels + three action dialogs; widen the dialog `error` props to a message/details pair).
9. [x] **Areas E–I** — loans list, the three risk-council presenters + pages, the three cash-management
   surfaces, audit log, capital allocation. Same shape each time: hook maps with a per-surface
   fallback and returns `errorDetails`; JSX drops its `??` and renders `InlineError`.
   **Deviation:** the remaining `errorMessage ?? "<friendly text>"` sites were NOT fully dropped —
   each hook's mapped `errorMessage` is now guaranteed friendly and non-raw, so keeping a same-text
   `??` fallback is purely for TypeScript's `string | null` narrowing (both sides read identically),
   not the original anti-pattern (raw `??` friendly). Verified via the sweep in step 10 that no `??`
   site still diverges between a raw and a friendly branch.
10. [x] **Sweep check.** `grep -rn "\.message" packages/trustee/src --include='*.ts' --include='*.tsx'`
    and confirm no remaining read of a caught/thrown `.message` feeds a display field; likewise
    `grep -rn 'errorMessage ??' packages/trustee/src` returns nothing raw (see step 9 deviation note).
11. [x] **Tests** per Test Strategy.
12. [x] **Docs** per Docs to Update.
13. [x] **Lint & build.** `yarn workspace @pipeline/trustee lint`,
    `yarn workspace @pipeline/ui lint`, `yarn workspace @pipeline/trustee build`, and
    `npx tsx scripts/lint-docs.ts`. **Deviation:** TD-51's pre-existing Prettier drift ended up fully
    resolved rather than left untouched — every one of TD-51's listed files was already being
    substantially rewritten by this issue, so each was run through `prettier --write` as part of
    finishing its edit rather than hand-picking a diff-only fix; `packages/trustee` is now fully
    Prettier-clean (`prettier --check .` passes with zero violations). TD-51 marked resolved in the
    tracker. No file outside this issue's touch set was reformatted.

## Test Strategy

Floor: `yarn workspace @pipeline/trustee test` stays green at **≥787 passing / 59 files**, plus
`@pipeline/ui` and `@pipeline/frontend` suites green (R2).

New / updated:

- **`packages/trustee/src/utils/-userError.test.ts`** (new) — as enumerated in step 3. This is the
  bulk of the new mapping coverage; per-surface tests then only assert wiring, not re-test the table.
- **`packages/ui`** — new `ErrorDetailsDialog` case for the capture-phase Escape fix (step 4):
  a bubble-phase `window` keydown spy registered *before* the dialog mounts must not fire on Escape.
- **`-useOriginationReview.test.ts`** — assert each preserved copy string from the D3 table is still
  produced verbatim (regression guard against "replaced with generics"); assert the raw text now
  appears in `errorDetails` and **not** in `errorMessage` for the simulation, mint-default, review-400,
  review-default and mint-succeeded-review-failed branches.
- **`-origination-detail-page.test.tsx`, `-ApproveMintDialog.test.tsx`, `-RejectReasonDialog.test.tsx`,
  `-RequestChangesDialog.test.tsx`** — with `errorDetails` set, `inline-error-view-details` renders,
  clicking it opens `error-details-dialog` with the raw text in `error-details-raw`; **Escape closes
  only the details dialog and the parent dialog is still in the document** (the D4 regression test —
  one per dialog); backdrop click on the details dialog likewise leaves the parent open; with
  `errorDetails` null/empty no trigger renders. Client-side validation lines keep their existing
  assertions and gain no trigger.
- **Per-surface tests** for areas B–I (`-origination.index.test.tsx`, `-record-coupon*.test.*`,
  `-record-repayment*.test.*`, `-useLoanDetail.test.ts`, `-loans.$id.test.tsx`,
  `-loans.index.test.tsx`, the three `-risk-council-*` pairs, `-cash-management*.test.*`,
  `-audit-log.test.tsx`, `-useAuditLog.test.ts`, `-CapitalAllocationCard.test.tsx`,
  `-useCapitalAllocationCard.test.ts`): for each, one case asserting that a rejected query/mutation
  with a raw `HostError`-shaped payload renders the surface's **friendly** line (proving the `??`
  removal actually took effect — previously the raw message won) and exposes the raw only via the
  dialog.
- **Waterfall (D5)** — move the two duplicated `mapWaterfallError` tests
  (`-record-coupon.test.ts:24-45`, `-record-repayment.test.ts:23-44`) into `-userError.test.ts`; add
  a case asserting the 4xx branch yields **no** details (no "View details" trigger) and the non-4xx
  branch does.
- **Edge cases to cover explicitly:** a non-`Error` thrown value (bare string / `{ code: 4001 }`);
  an empty-string message (must not render a details trigger); a very long single-line Soroban dump
  (renders inside the dialog `<pre>`, no horizontal page scroll); `ApiUnauthorizedError` resolving
  through the `instanceof ApiError` branch to the 401 copy, not the generic.

## Docs to Update

- **`docs/frontend/error-handling.md`** (primary):
  - Move the trustee bullet out of **"Out of scope (this issue)"** into **"Adopted surfaces"**.
  - New **"Trustee mapping layer"** section: the D1 rationale (why trustee-local and not
    `@pipeline/wallet-connect` / `@pipeline/ui`), the module's exported shape, the trustee match
    order, the `ApiError.status` → copy table, the preserved origination-review copy (D3 table), the
    per-surface `fallback` mechanism replacing the `?? "friendly"` anti-pattern, and D5's
    no-details-on-expected-input rule.
  - New **"Nested dialogs"** subsection under the components section: the stacking/backdrop analysis,
    the capture-phase `stopImmediatePropagation` Escape rule, and the latent duplicate
    `error-details-title` id note (D4).
  - Extend the adopted-surface inventory with the nine trustee areas.
- **`docs/frontend/utils.md`** — add alphabetically-sorted rows: `mapWaterfallError` (trustee),
  `toError` (trustee), `toUserError` (trustee), each with the `@/utils/userError` import path and the
  "(trustee)" duplication marker consistent with the existing `formatCompactUsd` (trustee) rows.
- **`docs/exec-plans/tech-debt-tracker.md`** — new row: trustee `userError.ts` duplicates the LP
  `packages/frontend/src/utils/userError.ts` chain-generic half (`toError`,
  `parseSorobanContractErrorCode`, rejection patterns); consolidation gated on TD-35 re-pointing
  `packages/frontend` at `@pipeline/wallet-connect`. Cross-reference TD-38/TD-42/TD-46.
- **`docs/exec-plans/known-bugs.md`** — `-origination-detail.ts` has no error state, so a failed
  submissions fetch silently renders the "not found" state (`origination.$id.tsx:529-535`); plus the
  `NeedsAttention` silent-collapse if Open Question 1 resolves to (b).
- **No product-spec change.** This is presentation-layer only — no user- or agent-facing *behaviour*
  changes beyond error copy, which `docs/frontend/error-handling.md` is the spec for.
- **Deliberately not updated:** `docs/frontend/trustee-flows.md` (see R1).
