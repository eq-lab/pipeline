# Issue #1453: Trustee: align the LP counterparty detail page with the Loan detail page's visual conventions

Source: https://github.com/eq-lab/pipeline/issues/1453

Epic: [#1269 — Trustee LP Counterparties](https://github.com/eq-lab/pipeline/issues/1269) (**no Figma**; the
shipped Loan detail page + `docs/product-specs/trustee-dashboard-v3-design-assignment.md` are the reference).

Branch: `feat/lp-detail-loan-conventions` (draft PR #1454).

## Scope

Restyle `/lp-counterparties/$id` onto the Loan-detail (`/loans/$id`) conventions, and extract the
shared primitives so the two pages use one implementation instead of two look-alikes.

In scope:

- New shared detail primitives under `packages/trustee/src/components/detail/` (tokens, chip, card,
  card title, key/value row, hero), consumed by **both** `loans.$id.tsx` and `lp-counterparties.$id.tsx`.
- Rewrite of the LP detail page shell: page gutter/max width, hero (back link → `h1` → chip + meta),
  profile / KYB documents / KYB decision cards, button variants.
- Markup/class alignment of `-LpBankDepositsSection.tsx` and `-LpReviewDialog.tsx` (card + title +
  table typography + button variants only — wiring untouched).
- `mapKybStatus`: `UnderReview` moves from the `attention` band to a new `info` (brand) band, per the
  issue's band table. This is a one-line ripple into `lp-counterparties.index.tsx`'s `statusBandColor`
  (so the list chip renders brand rather than falling through to neutral grey) and into its tests/doc
  table — the only sanctioned touch of the out-of-scope list page.
- Docs: `docs/frontend/trustee-flows.md` §§ LP Counterparties / Account Status mapping / LP bank
  deposits; `docs/user-stories/epic-1269/1270-trustee-lp-counterparties.md` Story 5 (stale placeholder
  copy).

Out of scope:

- The LP counterparties **list** page's layout, columns, grid or row behaviour (only the `info` band
  colour case is added).
- Any new data, field or endpoint. Everything stays served-value-only; absent values render `—`.
- `loans.$id.tsx` beyond mechanically replacing its inlined primitives with imports of the extracted
  ones (byte-identical rendered output; see Step 1).
- `SummaryTiles` and `OtherActionsCard` — the LP page has neither tiles nor an "other actions on this
  loan" list, so they stay private to `loans.$id.tsx` (YAGNI; extracting them would add unused API).
- `packages/ui`. The loan-detail look is built from trustee-only raw literals (`rgba(56,55,53,0.18)`,
  `#262524`, 44/26/15px display+body steps) that encode the trustee design assignment, not the shared
  token system. Promoting them to `@pipeline/ui` would export trustee styling to the LP/borrower apps.
  **Decision: extract into `packages/trustee/src/components/detail/`, not `packages/ui`.**

## Assumptions and Risks

- **Assumption — one shared implementation, no visual change to `/loans/$id`.** Step 1 is a pure move:
  the extracted components keep their current class strings, inline styles and `data-testid`s
  (`loan-detail-status-chip`, `loan-detail-meta`, `loan-detail-tiles`, …) verbatim, parameterising only
  the back-link target, the chip/meta test ids and the title text. `-loans.$id.test.tsx` is extensive
  and must pass **unmodified** — treat any required edit to it as a signal the extraction changed
  behaviour, and fix the component instead of the test.
- **Risk — `StatusBand` lives in `-useLoanDetail.ts`** (line 76) and is imported by `loans.$id.tsx`.
  Move the type's definition to `components/detail/detailTokens.ts` and have `-useLoanDetail.ts`
  re-export it (`export type { StatusBand } from "@/components/detail/detailTokens";`) so existing
  importers keep working and there is one band vocabulary across both pages.
- **Risk — band vocabularies differ.** `AccountStatusBand` (`-useLpCounterpartiesTable.ts`) is
  `neutral | attention | positive | negative`; `StatusBand` adds `info`. Widening `AccountStatusBand`
  to the shared `StatusBand` means `statusBandColor` in `lp-counterparties.index.tsx` must gain an
  `info` case (`var(--color-pipeline-brand)`), otherwise `UnderReview` silently falls to the muted
  default. Its exhaustive test (`-useLpCounterpartiesTable.test.ts:26`) asserts
  `UnderReview → attention` and must be updated to `info` — an intentional assertion change, not a
  selector fix.
- **Risk — bank-deposit regressions.** `-LpBankDepositsSection.tsx` shipped very recently (#1418,
  #1449; merged as PR #1450 at `b04d7e8d`). Its Mint PLUSD action, `mintDisabledReason` hints,
  "Waiting for the indexer" pending window and error-details dialog are the newest, least-settled code
  on the page. **Only** `className` / `style` / wrapper markup may change there; every `role`, label
  text, `aria-describedby`, `id` and handler stays byte-identical.
- **Risk — button geometry drift.** The loan page does **not** use `@pipeline/ui` `Button`; it renders
  raw `<button>`s at `h-[40px] rounded-[4px] px-[16px]` with brand bg (primary) or white bg +
  `LINE_COLOR` border (secondary). `Button`'s default size is `h-12`; `size="m"` is `h-10` (40px) and
  `--radius-pipeline-button` is 4px, so `size="m"` matches. `variant="primary-blue"` is
  `--color-pipeline-brand` (the loan primary); the LP page currently uses `primary-dark`
  (`--color-pipeline-cta`) — that changes colour, deliberately. `variant="secondary"` is transparent
  and **borderless**, so the loan-style secondary needs the shared border class/style added.
  Keeping `Button` (rather than raw `<button>`) preserves disabled/focus semantics and every existing
  `getByRole("button", …)` selector — do not swap LP buttons for raw elements.
- **Risk — visual verification is gated.** The trustee dev server answers on http://localhost:5174, but
  both detail pages sit behind the trustee sign-in overlay, so an isolated (non-user) browser context
  cannot reach them without credentials. Verification therefore rests on the px/colour literals, which
  are exact and shared by construction after Step 1, plus the human review on PR #1454. Do not drive
  the user's live browser session and do not restart the dev servers.
- **Dependency:** none open. #1418/#1449 are merged. No backend work is required.

## Open Questions

_None_

Resolved here rather than parked (the epic has no Figma, so these are design-assignment judgement
calls the planner is expected to make):

- `UnderReview` → brand/`info` while `InProgress` stays `attention`: the issue's band table names
  `UnderReview → brand`, and the loan page already reserves `info` for "an action is in flight"
  (`Disbursing`). `ChangesRequested` stays `attention` (amber), `Passed` positive, `Failed` negative,
  `NotStarted` neutral — i.e. labels are unchanged, only `UnderReview`'s band moves.
- Hero meta line: `Jurisdiction · Registered <date> · Submitted <date> · Decided <date>`, each clause
  dropped entirely when its value is absent (never `—` inside the meta line) — mirrors the loan hero's
  "drop the clause when not served" rule in trustee-flows.md § Hero.
- The **Refresh** button has no loan-page counterpart. Keep it (the documents' presigned download URLs
  expire, per story 1271 Story 1) but move it out of the `h1` row into the KYB documents card header,
  as a loan-style secondary button.

## Implementation Steps

### 1. Extract the shared detail primitives (no rendered change)

Create `packages/trustee/src/components/detail/`:

- **`detailTokens.ts`** — move verbatim from `loans.$id.tsx` (lines 45–51, 72–106, 131–137):
  `LINE_COLOR`, `INK`, `INK_MUTED`, `BRAND`, `POSITIVE_GREEN`, `ATTENTION_AMBER`, `NEGATIVE_RED`,
  `CARD_CLASS`, `cardStyle()`, `chipStyle(band)`, and the `StatusBand` type definition. Add
  `DETAIL_SECONDARY_BUTTON_CLASS` (`"!h-[40px] !rounded-[4px] !px-[16px] border border-solid bg-white text-[#262524]"`)
  and `detailSecondaryButtonStyle()` (`{ borderColor: LINE_COLOR }`) so both pages' secondary buttons
  are one definition.
- **`StatusChip.tsx`** — `<StatusChip band label testId? />`, body of the `<span>` currently inside
  `Hero` (lines 148–155), class string unchanged.
- **`DetailCard.tsx`** — `<DetailCard className? testId? ariaLabel? ariaLabelledBy? children />`
  rendering `${CARD_CLASS} ${className}` + `style={cardStyle()}`; plus `CardTitle` (lines 309–315).
- **`KeyValueRow.tsx`** — move lines 317–354 verbatim.
- **`DetailHero.tsx`** — generalise `Hero` (lines 140–174): props `backTo`, `backLabel`, `title`,
  `status: { label; band } | null`, `meta: string`, `statusTestId`, `metaTestId`. `backTo` is typed
  against the router's link options so `/loans` and `/lp-counterparties` both typecheck.

Then edit `loans.$id.tsx` to import all of the above and delete the local copies, passing
`backTo="/loans"`, `statusTestId="loan-detail-status-chip"`, `metaTestId="loan-detail-meta"`. Keep
`SummaryTiles`, `OtherActionsCard`, `toneColor`, `CheckIcon` and the stepper constants local to
`loans.$id.tsx`. Update `-useLoanDetail.ts` to re-export `StatusBand` from `detailTokens.ts`.

Run `-loans.$id.test.tsx` here, before touching the LP page — it must be green with zero test edits.

### 2. Unify the band vocabulary

- `packages/trustee/src/routes/-useLpCounterpartiesTable.ts`: make `AccountStatusBand` an alias of the
  shared `StatusBand` (keep the exported name for existing importers), and change `mapKybStatus`'s
  `"UnderReview"` case to `{ label: "KYB Pending", band: "info" }`. Labels are untouched.
- `packages/trustee/src/routes/lp-counterparties.index.tsx`: add `case "info": return BRAND;` to
  `statusBandColor` (import `BRAND` from `detailTokens.ts`; drop its now-duplicate local colour
  constants if they only served this switch).

### 3. Rebuild the LP detail shell and hero

In `packages/trustee/src/routes/lp-counterparties.$id.tsx`:

- `<main>` → `className="mx-auto flex w-full max-w-[1180px] flex-col gap-[16px] px-[56px] pt-[39px] pb-[80px]"`
  (the loan-detail wrapper, replacing `max-w-[1200px] gap-6 px-4 py-12 md:px-8`).
- Replace the back `Link` + `h1` + floated Refresh block with
  `<DetailHero backTo="/lp-counterparties" backLabel="‹ LP Counterparties" title={lp?.legal_name ?? \`LP ${id}\`} status={status} meta={meta} statusTestId="lp-detail-status-chip" metaTestId="lp-detail-meta" />`.
  Note the back label adopts the loan page's `‹ Loans` chevron form (the loan error branch at
  `loans.$id.tsx:1337` is the canonical spelling), replacing `← Back to LP Counterparties`.
- Build `meta` in the view-model layer, not the JSX: add a small `lpHeroMeta(lp)` helper to
  `-useLpCounterpartyDetail.ts` returning the `·`-joined clauses described under Open Questions, with
  absent clauses omitted. Dates via the existing `formatIsoDateUtc`.
- Delete the local `statusClasses` map and the pill chip; the chip now lives in the hero.
- Keep the invalid-id / pending / error branches, but render the error branch inside a `DetailCard`
  wrapping the existing `InlineError` + Retry, matching `loan-detail-error`'s treatment.

### 4. Restyle the cards

- **Profile** — `<DetailCard className="gap-[8px] p-[26px]" ariaLabel="LP profile">` with
  `<CardTitle>LP profile</CardTitle>` and the seven fields as `KeyValueRow`s (not a `dl` grid):
  Jurisdiction, Contact email, First registration date, Submitted for review, Latest decision date,
  Settlement address, Latest decision reason — `isLast` on the final row, `—` for absent values
  (delete `ProfileField`).
- **KYB documents** — `<DetailCard className="gap-[8px] p-[26px]" ariaLabelledBy="lp-documents-heading">`,
  `<CardTitle id="lp-documents-heading">KYB documents</CardTitle>` with the Refresh secondary button on
  the title row (`flex flex-wrap items-baseline justify-between`, the `CurrentStageCard` title-row
  pattern at `loans.$id.tsx:572`). Keep the `<ul>`/`<li>` structure and every string; restyle rows onto
  `borderBottom: 1px solid LINE_COLOR` separators (the `KeyValueRow` divider), filenames at 15px body /
  `#262524`, the byte/type/status and uploaded/reviewed sub-lines at 12.5px `INK_MUTED`, the rejection
  reason at 13px `NEGATIVE_RED`. Prefix each row with the loan Documents card's 32px `DocumentIcon`
  tile (`loans.$id.tsx:541–545`); keep Download as a real `<a>` to the presigned URL.
- **KYB decision** — `<DetailCard className="gap-[16px] p-[26px]" ariaLabel="KYB decision">` +
  `<CardTitle>KYB decision</CardTitle>`; gating copy at 13px `INK_MUTED` (the `OtherActionsCard` note
  style). Buttons unchanged in order, labels and handlers.
- **Bank deposits** (`-LpBankDepositsSection.tsx`) — swap the `section` wrapper for `DetailCard`
  (`ariaLabelledBy="lp-deposits-heading"`, keep the `id`), `h2` → `CardTitle`, and align the table:
  header cells to 14px `INK_MUTED` `font-normal`, body cells to 16px `#262524`, row separators to
  `1px solid LINE_COLOR` (replacing `divide-pipeline-line`), amounts right-aligned `tabular-nums` as
  today. Keep `overflow-x-auto` + `min-w-[720px]`. Leave `MintCell`, `mintDisabledReason`, the pending
  copy and the hint `id`/`aria-describedby` wiring exactly as they are.

### 5. Buttons

Across `lp-counterparties.$id.tsx`, `-LpBankDepositsSection.tsx` and `-LpReviewDialog.tsx`:

- Primary (Confirm KYB passed, Record deposit, every dialog submit): `variant="primary-blue" size="m"`.
- Secondary (Reject account, Request changes, Verify/Reject document, Refresh, Retry, Mint PLUSD, every
  dialog Cancel): `variant="secondary" size="m"` + `className={DETAIL_SECONDARY_BUTTON_CLASS}` +
  `style={detailSecondaryButtonStyle()}`.
- Disabled states keep `disabled`, `title={reason}` and the `aria-describedby` hint text verbatim.
- Dialog shells (`-LpReviewDialog.tsx`, `RecordBankDepositDialog`): title `h2` keeps its
  `font-display text-[26px] leading-[36px]` (already the `CardTitle` step) — only the two button rows
  change. Leave `rounded-pipeline-card-sm`, the backdrop, focus trap and `useLpReviewDialog` alone.

### 6. Lint and build

`yarn workspace @pipeline/trustee lint && yarn workspace @pipeline/trustee build`, then
`npx tsx scripts/lint-docs.ts`. Do not commit — the manager commits the plan and the code.

## Test Strategy

New file `packages/trustee/src/routes/-lp-counterparties.$id.test.tsx` — **there is currently no test
for this page at all** (only `-lp-counterparties.index.test.tsx`, `-useLpCounterpartiesTable.test.ts`
and `-LpBankDepositsSection.test.tsx` exist), so this issue adds the page's first direct coverage.
Mirror the harness used by `-lp-counterparties.index.test.tsx` (QueryClient + router stubs + mocked
`useLp`/`useReviewLp`):

1. **Hero** — renders the served `legal_name` as the `h1`, the back link to `/lp-counterparties`, and
   the meta line; a missing `kyb_submitted_at` / `kyb_decided_at` drops that clause rather than
   printing `—`; an unknown id falls back to `LP <id>`.
2. **Chip band mapping** — table-driven over all six `kyb_status` values plus an unknown string,
   asserting `lp-detail-status-chip`'s text and colour band (expose the band as a `data-band`
   attribute on `StatusChip`, as the list row already does, so this is assertable without snapshotting
   inline styles).
3. **Cards** — profile key/value rows render served values and `—` for absent ones; the documents card
   lists filenames, the uploaded/reviewed sub-line and the rejection reason, and renders the empty-state
   copy for `documents: []`.
4. **Behaviour unchanged** — review actions appear only for `UnderReview`; Confirm KYB passed is absent
   until every document is `Verified`; clicking Verify/Reject/Request changes/Reject account opens
   `LpReviewDialog` with the right title and submits through `useReviewLp`. These are regression guards
   for the restyle, not new behaviour.

Updated tests:

- `packages/trustee/src/routes/-useLpCounterpartiesTable.test.ts` — the `UnderReview` case changes from
  `band: "attention"` to `band: "info"` (assertion change, intentional).
- `packages/trustee/src/routes/-lp-counterparties.index.test.tsx` — add a case asserting an
  `UnderReview` row carries `data-band="info"`; the existing `negative`-band case is unaffected.

Expected to pass **unchanged** (state this explicitly in the PR description):

- `packages/trustee/src/routes/-LpBankDepositsSection.test.tsx` — every selector is `getByRole` /
  `getByLabelText` / `getByText`; there is not a single class or container query in the file, so the
  restyle must not touch it. If it needs an edit, the restyle broke a label, role or `aria-` wiring.
- `packages/trustee/src/routes/-loans.$id.test.tsx` — the primitives extraction is a pure move; zero
  edits expected.

Edge cases to cover: `documents: []`; a document with `download_url: null`; `kyb_decision_reason` with
embedded newlines (the `whitespace-pre-wrap` must survive the move to `KeyValueRow`); a long
`legal_name` (hero must wrap, not overflow the 1180px shell); the `busy` state disabling every action.

Commands: `yarn workspace @pipeline/trustee test`, `yarn workspace @pipeline/trustee lint`,
`yarn workspace @pipeline/trustee build`, `npx tsx scripts/lint-docs.ts`.

## Docs to Update

- **`docs/frontend/trustee-flows.md` § LP Counterparties** (line 731) — rewrite the detail-view
  description in Loan-detail building blocks: `DetailHero` / `StatusChip` / `DetailCard` + `CardTitle` /
  `KeyValueRow`, the `max-w-[1180px] px-[56px]` shell, and the `primary-blue`/`secondary` + `size="m"`
  button convention. Add a short subsection naming
  `packages/trustee/src/components/detail/` as the shared home of these primitives, which pages consume
  them, and why they are trustee-local rather than in `@pipeline/ui`.
- **`docs/frontend/trustee-flows.md` § Account Status mapping** (line 769) — change the `UnderReview`
  row's band to `info`, and extend the band → colour sentence beneath the table with
  `info var(--color-pipeline-brand)`.
- **`docs/frontend/trustee-flows.md` § Loan detail** (line 305, and § Hero at 392) — add a pointer that
  the hero/chip/card primitives are now shared, so the loan page is no longer their definition site.
- **`docs/frontend/trustee-flows.md` § LP bank deposits** (line 822) — note the card now uses
  `DetailCard`/`CardTitle` and the loan-page table typography; state that behaviour (#1418/#1449 mint
  flow) is unchanged.
- **`docs/user-stories/epic-1269/1270-trustee-lp-counterparties.md` Story 5** (line ~116) — the
  expected outcome still describes the #1271 placeholder line ("Document review and KYB confirmation
  land in issue #1271."), which no longer renders. Replace it with the shipped hero: legal name as the
  `h1`, status chip and meta line.
- **`docs/user-stories/epic-1269/1271-trustee-lp-review.md`** — no step references a changed label or
  layout; leave it unless Step 3/4 renames a control. Same for `1413-lp-bank-deposits.md` and
  `1449-trustee-mint-bank-deposit.md` (both reference the "Bank deposits" card by name, which is
  retained).
