# Issue #823: Trustee Origination: row-click navigation + status-conditional detail footer (Approved/Rejected blocks)

Source: https://github.com/eq-lab/pipeline/issues/823

Sub-issue of epic #775. Extends the Origination table (#813) and the details page (#821, MERGED via PR #822). Branch: `feat/823-origination-rowclick-status-footer` (checked out). No comments on the issue; all scope is in the body.

## Scope

Two changes, both in the trustee app (`packages/trustee`), both token/pixel-exact and reusing #821's view/hook split and trustee formatters.

**1. Row-click navigation (`origination.index.tsx`).** Make the entire submissions table row navigate to `/origination/:id`, passing the row's `SubmissionView` via router state — for ALL statuses, including Approved and Rejected rows (which have status pills, not a Review button). Keyboard-accessible. On InReview rows the existing Review `Link` and the row both go to the same place; the two must not double-navigate.

**2. Status-conditional detail footer (`origination.$id.tsx`).** Replace the always-shown `ActionButtons` block (Request changes / Reject / Approve) with rendering that branches on the submission status:

- **InReview** → the existing `ActionButtons` (note + three inert buttons). Unchanged.
- **Approved** → a green banner (Figma node `4116:9656`): reuse the existing `CheckIcon` + text `Approved & minted · <date>` in `--color-pipeline-positive-primary` (`#208000`, 14px). Date = `updated_at`, formatted like "2 Jan". The Figma's semibold navy `funded from batch #B-102 →` segment is **omitted** — see Open Questions #1 (no backing field).
- **Rejected** → a similar banner in red (`--color-pipeline-negative`, `rgba(192,57,43,0.08)` bg / `rgba(192,57,43,0.3)` border): `Rejected · <date> — <reason>`, where `reason` = `SubmissionView.reason` (backed) and date = `updated_at`. No Figma reference; mirrors the Approved banner's shape/tokens in red — see Open Questions #3.
- **unknown** status → fall back to the InReview footer (or render nothing) — see Open Questions #3.

To render the footer the detail view model (`-origination-detail.ts`) must expose the raw status kind plus a formatted `updated_at` date and the `reason`; today its `statusChip` only carries a label, and neither date nor reason is surfaced.

**Out of scope:** wiring the actual Approve/Reject/Request-changes actions (still inert, separate sub-issue per #821); any backend change; the "funded from batch" link; any change to the #813 status column pills themselves.

## Assumptions and Risks

- **Depends on #821 / PR #822 — already MERGED.** All four files below exist on `main` and are inherited by this branch. No dependency wait.
- `SubmissionView` (`packages/trustee/src/api/useLoanSubmissions.ts`) already carries `status: "InReview" | "Approved" | "Rejected"`, `reason: string | null` (present iff Rejected), `updated_at: string` (RFC 3339), and `created_at: string`. No API/type change needed.
- `formatSubmittedDate(rfc3339)` in `packages/trustee/src/utils/formatDate.ts` renders an RFC 3339 string as "2 Jan" (day + short month, no year) — exactly the Figma's `Approved & minted · 2 Jan` format. `updated_at` is RFC 3339, so `formatSubmittedDate(updated_at)` is the right call. `formatMaturityDate` takes Unix seconds and adds the year, so it is NOT used here.
- Color tokens `--color-pipeline-positive-primary` (`#208000`), `--color-pipeline-negative` (`#c0392b`), and `--color-pipeline-brand` (`#000080`) all exist and are already used in these files (verified). The bg/border alpha steps `rgba(32,128,0,0.08/0.3)` and `rgba(192,57,43,0.08/0.3)` have no token match and are one-offs — the same precedent already used by the existing `StatusPill` in `origination.$id.tsx` and the `StatusCell` pills in `origination.index.tsx`.
- **Row-click double-navigation risk (InReview).** The existing Review control is a TanStack `<Link>` nested inside the row. If the whole row is made a `<Link>`, nesting two interactive `<a>` elements is invalid HTML and the inner Review link may still be present. Mitigation options, in order of preference:
  1. Make the row a `<Link>` and REMOVE the now-redundant inner Review `Link`, replacing it with a non-interactive green/red/brand status *label* for all statuses — but the Figma table (#813) still shows a Review *button* on InReview rows, so removing it is a visual regression. Prefer option 2.
  2. Keep the row as a clickable `role="row"` element with an `onClick`/`onKeyDown` handler + `tabIndex={0}` (NOT an `<a>`), calling `useNavigate()`. Keep the inner Review `<Link>` as-is and add `stopPropagation` on its click so it does not double-fire the row handler (both go to the same URL, so a double-fire is harmless functionally, but stopPropagation keeps intent clean and avoids a duplicated history entry). This preserves the Figma's Review button and avoids nested anchors. **Recommended.**
- Keyboard accessibility: with option 2 the row needs `tabIndex={0}`, `role="row"` (already present) and an `onKeyDown` that navigates on Enter/Space. The inner Review link remains independently focusable.
- The two colocated view tests mock the view-model hook and render the route as a pure component (`docs/FRONTEND.md` rule 2). Extending the `OriginationDetailResult` shape will require updating the `READY_RESULT` fixture in `-origination-detail-page.test.tsx` and the assertions there (the "three inert action buttons" test currently assumes they always render — it must move under an InReview case).
- Sandbox quirk (from the manager brief): if the workspace test runner breaks under this environment, run `node node_modules/.bin/vitest run` under Node 20 from `packages/trustee`.

## Open Questions

1. **"funded from batch #B-102 →"** — no batch field exists in `SubmissionView` / `loan_data`. Recommendation: **omit** that segment entirely (render only `Approved & minted · <date>`); do NOT fabricate a batch number, consistent with the project rule against frontend-derived/unbacked data. Confirm omission.
2. **Date source for both banners** — recommendation: `updated_at` (the review/approval timestamp, the closest proxy for "when minted/rejected"), formatted "2 Jan" via `formatSubmittedDate`. This matches the Figma text and mirrors the #813 Approved pill, which already uses `formatSubmittedDate(updated_at)`. Confirm.
3. **Rejected-block copy/layout** — no Figma reference exists (Figma only has the Approved block). Recommendation: mirror the Approved block's container/shape in red tokens, text `Rejected · <date> — <reason>` (no icon, or a red ✗ — the issue says "red ✗/status chip"; simplest is no icon since there is no red-cross asset and the existing red `StatusPill` uses none). Confirm the exact copy and whether an icon is wanted. Also confirm the **unknown-status** fallback (recommend: render the InReview footer so the page is never actionless/blank).

## Implementation Steps

1. **Extend the detail view model** — `packages/trustee/src/routes/-origination-detail.ts`:
   - Import `formatSubmittedDate` from `@/utils/formatDate` (alongside the existing `formatMaturityDate`).
   - Add fields to the `OriginationDetailResult` interface to drive the footer without the view re-deriving anything:
     - `statusKind: "in-review" | "approved" | "rejected" | "unknown"` (or reuse `statusChip.kind`),
     - `reviewedDate: string` — `formatSubmittedDate(submission.updated_at)`,
     - `rejectionReason: string` — `safeString(submission.reason)` (renders "—" if absent).
   - Populate them in the ready branch and give them safe defaults in the not-found/empty branch. Keep all formatting in the hook (view stays pure — `docs/FRONTEND.md` rule 2).

2. **Replace `ActionButtons` with a status-conditional footer** — `packages/trustee/src/routes/origination.$id.tsx`:
   - Keep `ActionButtons` as the InReview footer (unchanged markup + `data-testid`s).
   - Add an `ApprovedBanner` component: container `flex items-center gap-[6px] rounded-[4px] border border-solid border-[rgba(32,128,0,0.3)] bg-[rgba(32,128,0,0.08)] px-[17px] py-[11px]`; a 15px `CheckIcon` (reuse the existing one, sized to match the Figma's 15px SVG) in `--color-pipeline-positive-primary`; text `Approved & minted · {reviewedDate}` at `text-[14px] leading-[19.6px]` in `--color-pipeline-positive-primary`. `data-testid="origination-detail-approved-banner"`. Omit the "funded from batch" segment (pending OQ#1).
   - Add a `RejectedBanner` component: same container shape with `border-[rgba(192,57,43,0.3)] bg-[rgba(192,57,43,0.08)]`; text `Rejected · {reviewedDate} — {rejectionReason}` in `--color-pipeline-negative`, same type scale. `data-testid="origination-detail-rejected-banner"`. (Copy/icon pending OQ#3.)
   - In `OriginationDetail`, replace the unconditional `<ActionButtons />` with a switch on the new status kind: InReview → `<ActionButtons />`; Approved → `<ApprovedBanner date={...} />`; Rejected → `<RejectedBanner date={...} reason={...} />`; unknown → `<ActionButtons />` fallback (pending OQ#3).

3. **Row-click navigation** — `packages/trustee/src/routes/origination.index.tsx` (recommended option 2 from Assumptions):
   - Import `useNavigate` from `@tanstack/react-router`; call it inside `OriginationTable`.
   - On each row `<div role="row">`, add `tabIndex={0}`, an accessible label (e.g. `aria-label={`Open ${row.originator} submission`}`), `cursor-pointer`, an `onClick` that calls `navigate({ to: "/origination/$id", params: { id: String(row.id) }, state: { submission: row.submission } })`, and an `onKeyDown` that fires the same navigation on `Enter`/`Space` (prevent default on Space to avoid page scroll).
   - Keep the existing InReview `<Link>` (`StatusCell` "in-review") intact for the Figma's Review button, but add `onClick={(e) => e.stopPropagation()}` so it doesn't also trigger the row handler (both target the same URL; stopPropagation prevents a duplicated navigation/history entry). Do the same on the document/other interactive children if any exist (none currently in the table row besides the Review link).
   - Leave the Approved/Rejected/unknown pills as non-interactive (`<span>`) — the row handles their navigation.

4. **Update the docstrings** in both `.tsx` files and `-origination-detail.ts` to describe the new footer states and the row-click behavior, and cross-reference `#823` and this exec plan (matching the existing docstring style that cites issue numbers + Figma node ids).

## Test Strategy

Colocated tests, hyphen-prefixed, mocking the view-model hook so views render as pure components (existing convention). Run from `packages/trustee`; fall back to `node node_modules/.bin/vitest run` under Node 20 if the workspace runner breaks.

- **`-origination-detail.test.ts`** (extend): assert the new view-model fields — `reviewedDate` = `formatSubmittedDate(updated_at)` for a known `updated_at`; `rejectionReason` = the `reason` for a Rejected fixture and `"—"` when `reason` is null; `statusKind`/`statusChip.kind` correct for each of InReview/Approved/Rejected/unknown.
- **`-origination-detail-page.test.tsx`** (extend/adjust):
  - Move the existing "three inert action buttons" test under an InReview `READY_RESULT` and assert the banners are ABSENT for InReview.
  - Approved result → `origination-detail-approved-banner` present with `Approved & minted · <date>`; assert the three action buttons are ABSENT; assert NO "funded from batch" / "#B-102" text (guards OQ#1).
  - Rejected result → `origination-detail-rejected-banner` present with `Rejected · <date> — <reason>`; action buttons ABSENT.
  - unknown → fallback renders (per OQ#3 resolution).
- **`-origination.index.test.tsx`** (extend): using the in-test router already set up (`buildRouter`/`LocationRecorder`):
  - Clicking an **Approved** row navigates to `/origination/2` with `{ submission }` state.
  - Clicking a **Rejected** row navigates to `/origination/3` with `{ submission }` state.
  - Pressing **Enter** on a focused row navigates (keyboard path).
  - The InReview row's **Review link** still navigates to `/origination/1` with state, and clicking it does not produce a second/duplicate navigation (assert `onDetailLocation` call count / single history entry).
  - Each row is focusable (`tabIndex={0}`) and has an accessible name.

## Docs to Update

- No product-spec change: this is UI-behavior work with no new backend-facing behavior; the detail page and table are already specced under #813/#821. The exec plan + updated in-file docstrings are sufficient.
- If OQ resolutions change the recommended approach (e.g. a batch field is later added), note it in a comment on the issue rather than fabricating here.
