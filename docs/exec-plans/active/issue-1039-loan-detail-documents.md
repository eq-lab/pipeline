# Issue #1039: Trustee loan detail: show the Documents section on every loan, regardless of status

Source: https://github.com/eq-lab/pipeline/issues/1039

Labels: `enhancement`, `frontend`. No Figma URL is referenced in the body or comments (the
issue has zero comments); the reference visual is the already-shipped Origination detail
documents block, whose Figma binding is node `4116:9364` (see `origination.$id.tsx`'s
`DocumentIcon` docblock).

---

## Critical research finding: the loan↔submission join is NOT needed

The Issue's "Current state" section states that documents "are currently served **only** on the
submissions endpoint — neither `/v1/loan-book` nor `/financials` carries them". **That premise is
stale.** `GET /v1/loan-book` already serves a per-loan `documents` array.

**Backend evidence (on `main`, in this working tree):**

- `packages/api/src/routes/loan_book.rs:259-261` — `LoanBookEntry` declares
  `pub documents: Vec<LoanDocumentDto>` with the doc comment "Documents referenced in the loan
  metadata (Agreement, License, T&Cs, …). Empty when the loan's metadata records none."
- `packages/api/src/routes/loan_book.rs:1452-1459` — the entry builder populates it from the
  indexed loan snapshot (`s.documents`).
- Provenance chain: `packages/shared/src/loan_metadata.rs:40-44` (`LoanMetadataJson.documents`,
  fetched from the loan's IPFS metadata document by the indexer) →
  `packages/shared/src/loan_snapshot.rs:26-31` (`LoanSnapshot.documents`, persisted in
  `contract_logs.params.snapshot` JSONB) → `LoanBookEntry.documents`.
- Introduced by commit `f73d54d` "feat(loan): surface metadata `documents` array through indexer
  and loan-book API".

**Live stage verification** (`curl "https://api.pipeline.stage.eqlab.net/v1/loan-book?chain_id=99000001"`):
the single served loan (`loan_id: "0"`, status `Closed`) carries a populated `documents` array
with the three expected entries — Stockpile Composite Certificate of Analysis and Weight, Offtake
Contract (commercial terms extract), Facility Agreement (extract) — each with a `name` and a
Filebase IPFS `uri`. The full response key set is:

```
chain_id, loan_id, originator, borrower, commodity, principal, senior_outstanding,
original_senior_tranche, maturity, next_payment_timestamp, days_overdue, ccr_reported_at,
reported_ccr_bps, spot_price, spot_change_7d, collateral, ltv, ccr_bps, duration_days, rate,
protection, status, documents, repaid_to_date, disbursed, days_on_watchlist, watchlist_entered_at
```

**The only gap is the frontend TS mirror.** `packages/trustee/src/api/useLoanBook.ts`'s
`LoanBookEntry` interface is a hand-written port of the backend DTO (TD-42) and was never updated
when `documents` (and `reported_ccr_bps`) landed. The data is on the wire today and simply
discarded by the type.

**Therefore: no join, no new endpoint, no client-side metadata fetch.** The four sourcing
avenues the Issue asked me to investigate are all resolved as follows:

1. **Submission↔loan join keys.** A real join key *does* exist and is served — the backend
   `SubmissionView` carries `chain_id: Option<i64>` and `loan_id: Option<String>`
   (`loan_book.rs:437-444`), both `null` while pre-drawn and set once the submission's loan is
   drawn and linked by `metadata_uri`; both sides normalize through the same `loan_key()`
   (`loan_book.rs:1268`), so `SubmissionView.loan_id === LoanBookEntry.loan_id` is an exact
   string match. The live stage payload confirms `loan_id: "0"` on the submission and `"0"` on
   the loan-book row. The trustee TS `SubmissionView`
   (`packages/trustee/src/api/useLoanSubmissions.ts:135-172`) is likewise missing these two
   fields. **This join is real but must NOT be used for #1039** — reading `documents` off the
   loan-book row the page already fetches is strictly better: one fetch instead of two, no
   cross-endpoint consistency window, correct for loans whose submission row is absent or was
   created outside the submissions pipeline, and sourced from the *indexed on-chain metadata*
   (the loan's live document set) rather than the frozen submitted payload.
2. **Mint-flow mapping (`useDrawLoan`, #831).** Not needed. `mintedLoanId` is captured from the
   tx client-side and is not persisted as a frontend-visible mapping — the backend's own
   `metadata_uri` linkage (above) is the durable one.
3. **Resolving `metadata_uri` client-side.** Rejected and unnecessary. No loan endpoint exposes
   the loan's metadata URI to the frontend, and fetching arbitrary URIs from the browser is the
   exact class of risk #886/#890 hardened *on the backend* (`validate_metadata_uri`). The
   backend already does this fetch in the indexer; the frontend consumes the result.
4. **No-reliable-join escalation.** Not applicable — no re-scope, no block, no backend gap. This
   Issue is a pure frontend change.

**Never-fabricate consequence.** Because the field is populated from the indexed metadata
snapshot with `#[serde(default)]`, loans whose snapshot rows were indexed *before* `f73d54d`
deserialize to an empty vec until re-indexed. Those loans will legitimately render the
"No documents provided." empty state. That is a data-freshness gap, not a frontend bug — see
Assumptions and Risks R3.

---

## Resolved decisions (settled with the Issue author — do not re-litigate)

- **Placement.** The Documents section renders **directly before the "Other actions"
  (`OtherActionsCard`) section**, in **every** §S5 status variant — `performing`, `watchlist`,
  `disbursing`, `matured`.
- **Design/structure.** It reuses the **same design and structure as the Origination detail
  page's documents block** (`DealDetailsCard` in `packages/trustee/src/routes/origination.$id.tsx`,
  lines 278-311): `DocumentIcon` in a 32px `rgba(0,0,128,0.06)` tinted square, the document name
  as a dashed-underline link, `target="_blank" rel="noopener noreferrer"`, opening `uri` in a new
  tab; `"No documents provided."` muted paragraph as the empty state. The **section always
  renders**; only its contents vary.
- **v3 design doc placement is superseded.** `docs/design-docs/trustee-dashboard-v3-design-assignment.md`
  §S5 (line 237) lists Documents as one of six *tabs* (Ledger / Terms / Movements / Documents /
  Location / Activity). The implemented page has no tab strip at all — it is the #847/#859/#862/#866
  card layout. Building the tab strip is a separate, much larger migration. The card placement
  above is the author-approved interim; log the tab migration as tech debt (Step 8).

---

## Scope

**In scope** (all under `packages/trustee/`, plus two docs):

1. `src/api/useLoanBook.ts` — add `documents: LoanDocumentDto[]` to the `LoanBookEntry`
   interface and export a trustee-local `LoanDocumentDto` type.
2. `src/components/DocumentIcon.tsx` — extract the icon component out of `origination.$id.tsx`
   into its own file (FRONTEND.md rule 1; `LockIcon.tsx` is the precedent), and re-point the
   origination page's import at it.
3. `src/routes/-useLoanDetail.ts` — expose a `documents: DocumentDisplay[]` field on
   `UseLoanDetailResult`, built by a new exported pure builder `buildDocuments(entry)`.
4. `src/routes/loans.$id.tsx` — a new render-only `DocumentsCard` component, rendered
   immediately before `<OtherActionsCard …>` in all four variant branches.
5. Tests: unit tests for `buildDocuments`, route tests for the card in each variant, and fixture
   updates wherever a full `LoanBookEntry` literal is constructed.
6. `docs/frontend/trustee-flows.md` — spec prose under `## Loan detail` (FRONTEND.md rule 6).
7. `docs/exec-plans/tech-debt-tracker.md` — the v3 tab-strip deferral and the TD-42 mirror drift.

**Out of scope:**

- Any backend change. `GET /v1/loan-book` already serves everything needed.
- Any submission↔loan join, `SubmissionView` type change, or `useLoanSubmissions` call from the
  loan detail page.
- Any client-side `metadata_uri` / IPFS fetch or parse.
- The v3 S5 tab strip (Ledger / Terms / Movements / Documents / Location / Activity).
- The origination page's behavior — only its `DocumentIcon` *import* moves; the rendered output
  must be byte-identical.
- The LP frontend's `packages/frontend/src/api/useLoanBook.ts` (pre-#833 shape; not extended).
- `reported_ccr_bps`, the other field missing from the trustee TS mirror — nothing reads it;
  note it in the tech-debt tracker rather than adding it here.

---

## Assumptions and Risks

- **A1.** `documents` is served by every API deployment the trustee app talks to (verified on
  stage). Even so, the frontend guards with `Array.isArray(entry.documents)` before mapping, the
  same defensive pattern `mapDealDetails` already uses
  (`packages/trustee/src/routes/-origination-detail.ts:326-327`) — an older API build that omits
  the key must degrade to the empty state, never crash.
- **A2.** Individual documents may carry an empty `uri`. The origination block already handles
  this (`href={doc.uri || undefined}`, `aria-disabled`, `pointer-events-none`); the new card
  copies that handling verbatim rather than assuming a URI is always present.
- **R1 — rebase order against PR #1026 (issue #997).** PR #1026 (`docs/997-comments-to-specs-trustee`,
  open) *rewrites* `docs/frontend/trustee-flows.md` end to end, replacing today's placeholder
  `## Loan detail` stub ("_To be migrated from …_", line 142 on `main`) with a full ~215-line
  section (lines 298-512 on that branch: Architecture / Never-fabricate / Status chip mapping /
  Stepper / Hero / Price & collateral / Registry / Summary tiles / **Status-conditional layout** /
  CCR-trend chart / Wired actions / Figma map). It also touches
  `packages/trustee/src/api/useLoanBook.ts` (docblock-to-spec migration), which #1039 edits too.
  **Mitigation:** write the doc prose to whichever version of the file is present at
  implementation time, and if #1026 merges first, rebase and move the prose into #1026's
  `### Status-conditional layout` subsection (a new `### Documents` sibling immediately after
  it). Whoever merges second owns the conflict resolution in both files. See Step 7 for the
  branch-aware instruction.
- **R2 — fixture breakage.** Adding a required field to `LoanBookEntry` breaks every full-object
  fixture. Three `makeEntry`-style factories construct complete literals and must each gain
  `documents: []`:
  `packages/trustee/src/routes/-useLoanDetail.test.ts:34`,
  `packages/trustee/src/routes/-useLoansTable.test.ts:33`,
  `packages/trustee/src/components/-useNeedsAttention.test.ts:160`.
  A full `tsc` pass (Step 9) is the authoritative sweep — do not rely on this list alone.
- **R3 — legacy snapshots render empty.** Loans whose `contract_logs.params.snapshot` rows were
  indexed before `f73d54d` deserialize `documents` to `[]` (the field is `#[serde(default)]`).
  Those loans show "No documents provided." even though their IPFS metadata lists documents. This
  is correct never-fabricate behavior and matches the Issue's acceptance ("the empty state shows,
  with the reason logged as a known limitation if it's a data gap"). Log it in
  `docs/exec-plans/known-bugs.md` as a data-freshness limitation with the re-index remedy
  (#442 covers loan-registry indexer resync) — do **not** attempt a frontend workaround.
- **R4 — PR #1040 already exists** on `feat/1039-loan-detail-documents`. Push to the same branch;
  do not open a second PR.
- **R5 — no Figma frame for this card.** The v3 doc specifies a tab, not a card, so there is no
  frame to verify against pixel-for-pixel. Verification is instead a **structural parity check**
  against the shipped origination block (Step 10) — the resolved decision says "same design and
  structure", which makes the origination DOM the reference artifact.

---

## Open Questions

_None._

Placement and design were settled by the Issue author mid-planning (see Resolved decisions). The
sourcing question — the Issue's one flagged unknown — is resolved by evidence, not by choice:
`GET /v1/loan-book` already serves `documents`, so no join, no new endpoint, and no re-scope is
required.

---

## Implementation Steps

### 1. Add `documents` to the trustee `LoanBookEntry` type

File: `packages/trustee/src/api/useLoanBook.ts`

- Add an exported interface mirroring the backend `LoanDocumentDto`
  (`packages/api/src/routes/loan_book.rs:284-288`):

  ```ts
  export interface LoanDocumentDto {
    name: string;
    uri: string;
  }
  ```

  Keep it trustee-local — do **not** import from `useLoanSubmissions.ts`, which declares its own
  identical copy; the two endpoints are independent mirrors and TD-42 already tracks the
  consolidation debt. Add a one-line comment noting the duplicate and pointing at TD-42.
- Add to `LoanBookEntry`, positioned after `status` to match the backend field order:

  ```ts
  documents: LoanDocumentDto[];
  ```

  Doc comment: sourced from the loan's indexed IPFS metadata document
  (`LoanMetadataJson.documents` → `LoanSnapshot.documents`); empty for loans whose metadata
  records none **and** for snapshots indexed before the field existed — render the empty state,
  never fabricate.

### 2. Extract `DocumentIcon` into its own component file

New file: `packages/trustee/src/components/DocumentIcon.tsx`

- Move the function body verbatim from `packages/trustee/src/routes/origination.$id.tsx:135-159`
  (the filled 16×16 `currentColor` file glyph with the fill-rule folded corner). Keep its
  existing docblock, including the Figma-asset note (`4116:9364`).
- Follow `packages/trustee/src/components/LockIcon.tsx` exactly for shape: `import React`, a
  single named export, `aria-hidden="true"`, `focusable="false"`, `{...props}` spread last.
- In `origination.$id.tsx`: delete the local definition and import from
  `@/components/DocumentIcon`. **The rendered origination DOM must be unchanged** — the existing
  `-origination-detail-page.test.tsx` assertions are the regression guard.
- Per FRONTEND.md rules 4/5, an icon *component* is neither a util nor a shared hook —
  `LockIcon.tsx` sets the precedent of not cataloguing it. No `utils.md`/`hooks.md` entry.

### 3. Build the documents view-model

File: `packages/trustee/src/routes/-useLoanDetail.ts`

- Add the display type next to the other view-model interfaces:

  ```ts
  /** One document row of the Documents card — name + the URI it opens. */
  export interface DocumentDisplay {
    name: string;
    uri: string;
  }
  ```

- Add an exported pure builder alongside `buildHero` / `buildSummaryTiles`:

  ```ts
  export function buildDocuments(entry: LoanBookEntry | undefined): DocumentDisplay[]
  ```

  Behavior: return `[]` when `entry` is `undefined` or `entry.documents` is not an array (A1).
  Otherwise map each served item to `{ name: doc.name ?? "", uri: doc.uri ?? "" }`, preserving
  the served order. Do **not** filter, sort, dedupe, or synthesize names — mirror
  `mapDealDetails`'s pass-through semantics.
- Add `documents: DocumentDisplay[];` to `UseLoanDetailResult` (doc-comment it as rendered in
  every variant), and wire `documents: buildDocuments(entry)` into the hook's return object in
  `useLoanDetail`.
- Extend the module docblock's `## Data sources` list with: **Documents** ← the matching
  `/v1/loan-book` row's `documents` (indexer-sourced from the loan's IPFS metadata). Keep it to
  the one line — the behavioral spec goes in the doc (Step 7), per FRONTEND.md rule 6.

### 4. Render the Documents card

File: `packages/trustee/src/routes/loans.$id.tsx`

- Import `DocumentIcon` from `@/components/DocumentIcon` and the `DocumentDisplay` type from
  `./-useLoanDetail`.
- Add a render-only component next to the other card components (place it after
  `RegistryCard`, before `CurrentStageCard`):

  ```tsx
  function DocumentsCard({ documents }: { documents: DocumentDisplay[] }) { … }
  ```

  Structure:
  - Outer `<div>` using this page's card idiom — `className={`${CARD_CLASS} gap-[8px] p-[26px]`}`,
    `style={cardStyle()}`, `data-testid="loan-detail-documents"`.
  - `<CardTitle>Documents</CardTitle>` (the page's existing 26px Besley title component — this is
    the one deliberate divergence from origination, whose heading is 28px; the card *chrome*
    follows the host page, the *documents list* follows origination).
  - The list body: copy the markup of `origination.$id.tsx:277-311` verbatim except for the
    test ids — a `flex flex-col gap-[4px]` wrapper; empty state a `<p>` reading
    `No documents provided.` at `text-[15px] leading-[21px]` in `INK_MUTED`; otherwise one `<a>`
    per document keyed `` `${doc.name}-${i}` ``, `href={doc.uri || undefined}`,
    `target="_blank"`, `rel="noopener noreferrer"`,
    `aria-disabled={doc.uri ? undefined : true}`, class
    `flex items-center gap-[12px] py-[8px] no-underline` plus
    `cursor-pointer` / `pointer-events-none`, containing the 32px tinted
    `bg-[rgba(0,0,128,0.06)] text-[#000080]` icon square and the dashed-underline name span
    (`border-b border-dashed pb-px`, `borderBottomColor: LINE_COLOR`).
  - Per-row `data-testid="loan-detail-document"`.
- Render `<DocumentsCard documents={detail.documents} />` **immediately before**
  `<OtherActionsCard …>` in **all four** places in `LoanDetail()`: the `watchlist` branch, the
  `matured` branch, and the shared `performing`/`disbursing` branch. It is rendered
  unconditionally — never guarded on `documents.length`.
- Update the route file's `## Status-conditional layout` docblock only to note that Documents is
  a shared always-rendered section; the behavioral spec lives in the doc (rule 6).

### 5. Update the broken `LoanBookEntry` fixtures

Add `documents: []` to the three factories listed in R2. Prefer the neutral empty default so
existing assertions are unaffected; individual tests override via the `Partial<LoanBookEntry>`
argument.

### 6. Tests

Covered in detail under **Test Strategy** below.

### 7. Spec prose (FRONTEND.md rule 6)

File: `docs/frontend/trustee-flows.md`

Add a `### Documents` subsection under `## Loan detail`. **Branch-aware:**

- If PR #1026 has **not** merged: today's `## Loan detail` is a one-line placeholder stub
  (line 142). Add the subsection under it and leave the stub line intact so #1026's rewrite
  conflicts loudly rather than silently dropping the new prose.
- If PR #1026 **has** merged: rebase onto `main` first, then insert `### Documents` immediately
  after `### Status-conditional layout`, and add a "Documents" bullet to that section's
  "Shared live sections render in every variant" sentence.

Content (prose, not code):

- Source: the matching `/v1/loan-book` row's `documents` array — indexer-sourced from the loan's
  IPFS metadata document, not from the submission payload. State explicitly that the submissions
  endpoint is *not* consulted and that `SubmissionView.loan_id` (a real, served join key) is
  deliberately unused, with the reason (single fetch; live metadata; works for loans with no
  submission row).
- Placement: directly before the Other-actions section, in every §S5 variant; the section always
  renders, only its contents vary.
- Rendering rules: document name + filled navy `DocumentIcon` in a 32px tinted square, dashed
  underline, opens `uri` in a new tab (`rel="noopener noreferrer"`); a document with an empty
  `uri` renders inert (`aria-disabled`, no pointer events); the zero-document empty state reads
  "No documents provided." Note that this deliberately mirrors the Origination detail block, with
  the card chrome (26px `CardTitle`) following the loan-detail page.
- Never-fabricate: served order preserved; no filtering, sorting, deduping, or synthesized names;
  legacy pre-`f73d54d` snapshots legitimately show the empty state (cross-reference the
  known-bugs entry from Step 8).
- Deferral: the v3 design assignment §S5 places Documents in a tab strip that this page does not
  implement; the card is the approved interim.

### 8. Tracker entries

- `docs/exec-plans/tech-debt-tracker.md`: (a) the v3 S5 tab-strip migration
  (Ledger / Terms / Movements / Documents / Location / Activity) that would relocate this card;
  (b) an addendum to TD-42 noting the trustee `LoanBookEntry` mirror drifted from the backend DTO
  — `documents` fixed here, `reported_ccr_bps` still missing.
- `docs/exec-plans/known-bugs.md`: R3 — loans indexed before `f73d54d` carry an empty
  `documents` vec and render the empty state until the loan-registry indexer resync (#442)
  backfills them. Date, location (`packages/shared/src/loan_snapshot.rs:26-31`), symptom, root
  cause, remedy. Do not fix inline.

### 9. Lint, typecheck, build

From the repo root:

- `yarn workspace @pipeline/trustee test` (or `npx vitest run` within the package)
- the package's typecheck/build script (`tsc` must be clean — this is the authoritative sweep for
  R2 fixture breakage)
- the package's lint script
- `npx tsx scripts/lint-docs.ts` — required after any TypeScript change per AGENTS.md, and it
  also validates the two doc edits.

No Rust changed, so `cargo clippy` is not required.

### 10. Structural parity verification (in place of Figma)

No Figma frame exists for this card (R5). Verify instead that the rendered documents list is
structurally identical to the origination block: same icon glyph and 32px tinted square, same
dashed-underline name treatment, same 15px/21px type, same `gap-[4px]` row rhythm, same
new-tab link semantics, same empty-state copy. A side-by-side of `/origination/$id` and
`/loans/$id` in the running app is sufficient; per the standing preference, ask the user to
confirm rather than driving their browser.

---

## Test Strategy

All tests are vitest + React Testing Library, matching the existing trustee suite conventions.
The suite is **762 green on `main`** — the run after this change must be green with a strictly
larger count.

**Unit — `packages/trustee/src/routes/-useLoanDetail.test.ts`** (new `describe("buildDocuments")`):

1. Maps a served two-document array to `DocumentDisplay[]` preserving name, uri, and order.
2. Returns `[]` for `undefined` entry (loan-book row not found — the direct-URL case
   `buildHero` already covers).
3. Returns `[]` for `documents: []`.
4. Returns `[]` when `documents` is absent/malformed — cast a fixture with `documents` deleted or
   set to a non-array (A1's defensive guard); must not throw.
5. Passes through a document with an empty `uri` rather than dropping it (the view renders it
   inert).
6. Does not dedupe two documents sharing a name.

**Hook wiring — same file:** assert `useLoanDetail(...).documents` reflects the loan-book row's
served array (the existing mocked-`useLoanBook` harness in that file already supplies entries).

**Route — `packages/trustee/src/routes/-loans.$id.test.tsx`** (new
`describe("Loan detail route — Documents (#1039)")`):

1. **Every variant renders the section.** Parameterize over the four variants — `performing`
   (`status: "Performing"`), `watchlist` (`"WatchList"`), `disbursing` (`"Disbursing"`),
   `matured` (`"Past Due"`) — and assert `loan-detail-documents` is present in each. This is the
   Issue's headline acceptance criterion; the existing variant `describe` blocks show the exact
   fixture/mocking setup for each.
2. **Placement.** Assert the Documents card precedes the Other-actions card in DOM order in at
   least the performing and matured variants — e.g. via
   `compareDocumentPosition` between `getByTestId("loan-detail-documents")` and
   `getByTestId("loan-detail-other-actions")`, asserting `DOCUMENT_POSITION_FOLLOWING`.
3. **Populated list.** Two served documents → two `loan-detail-document` anchors, names visible,
   `href` equal to the served `uri`, `target="_blank"`, `rel` containing both `noopener` and
   `noreferrer`.
4. **Empty state.** `documents: []` → the section still renders, contains
   `No documents provided.`, and contains zero `loan-detail-document` anchors.
5. **Empty-uri document.** Renders the row with no `href` and `aria-disabled="true"`.
6. **Loading / error top-level states.** The whole page is replaced by the skeleton/alert in
   those states, so the Documents card is absent — assert `queryByTestId` is `null` to lock the
   behavior in (mirrors how the existing `top-level states` describe treats other cards).

**Regression — `packages/trustee/src/routes/-origination-detail-page.test.tsx`:** must pass
unchanged after the `DocumentIcon` extraction. No new assertions; its existing
`origination-detail-documents` / `origination-detail-document` coverage is the guard that the
move was behavior-neutral.

**Edge cases explicitly covered:** absent/malformed `documents` key (older API build);
zero documents; empty `uri`; duplicate names (React key stability — the
`` `${name}-${i}` `` key pattern); loan-book row not found for the route param;
long document names (no assertion needed, but confirm no truncation logic is introduced —
the origination block has none).

---

## Docs to Update

| Doc | Change |
| :-- | :-- |
| `docs/frontend/trustee-flows.md` | New `### Documents` subsection under `## Loan detail` — source, placement, rendering rules, never-fabricate, v3-tab deferral. Branch-aware insertion per Step 7 (conflicts with PR #1026). |
| `docs/exec-plans/tech-debt-tracker.md` | v3 S5 tab-strip migration deferral; TD-42 addendum on the `LoanBookEntry` mirror drift (`reported_ccr_bps` still missing). |
| `docs/exec-plans/known-bugs.md` | Pre-`f73d54d` snapshots carry an empty `documents` vec until the #442 indexer resync backfills them. |

**No product-spec change required.** `docs/product-specs/trustee-dashboard.md:171` already
specifies that the one-loan full view shows "the terms we store on-chain, the numbers we
calculate from them, and **the loan documents**" — this Issue implements existing product intent
rather than changing it.

**No `docs/frontend/utils.md` or `hooks.md` entry** — `DocumentIcon` is a component, not a util
or a shared hook (`LockIcon.tsx` precedent), and `buildDocuments` is a component-local builder
exported only for unit testing, exactly like `buildHero` / `buildSummaryTiles`.

**No OpenAPI/generated-doc regeneration** — the backend is untouched.
