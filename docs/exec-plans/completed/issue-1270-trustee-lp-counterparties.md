# Issue #1270: Trustee: LP Counterparties menu item + list table

Source: https://github.com/eq-lab/pipeline/issues/1270
Epic: [#1269 — Trustee LP Counterparties](https://github.com/eq-lab/pipeline/issues/1269)

## Scope

Add a seventh section to the Trustee sidebar — **LP Counterparties** — and its list page: a table
of every registered LP served by `GET /v1/lps` (trustee-role-gated, already on `main`), following
the shipped **Loan Book** page (`/loans`) as the structural and stylistic pattern.

**In scope**

1. Sidebar nav item + glyph + route registration (`packages/trustee/src/lib/nav.ts`,
   `components/TrusteeNavIcons.tsx`, `components/TrusteeSidebar.tsx`).
2. Data hook `api/useLps.ts` over `GET /v1/lps` (real endpoint — the trustee app carries a JWT).
3. Presenter `routes/-useLpCounterpartiesTable.ts` (React-Query wiring + value→display mapping,
   per `docs/FRONTEND.md` code-structure rule 2).
4. List view `routes/lp-counterparties.index.tsx` with the six requirement columns, a trailing
   chevron column, and loading / empty / error states per trustee conventions.
5. A pass-through layout route `routes/lp-counterparties.tsx` and a **thin placeholder detail
   route** `routes/lp-counterparties.$id.tsx` so the row-click seam is not a dead link. #1271
   replaces the placeholder body with the real detail page.
6. One new date formatter (`formatIsoDateUtc`) + unit test + `docs/frontend/utils.md` row.
7. Spec section `docs/frontend/trustee-flows.md#lp-counterparties`, user-stories doc
   `docs/user-stories/epic-1269/1270-trustee-lp-counterparties.md` + index row.

**Out of scope**

- The counterparty detail page: KYB document list, per-document verify / request-changes /
  classify controls, "Confirm KYB passed" (#1271 — and note the epic #1247 decision of 2026-09-21,
  *raw upload, classify-at-review*, which gives #1271 doc-type/UBO classification controls; nothing
  about that reaches this list page).
- Recording incoming bank transfers (#1272).
- Any backend change: the GET-documents route (#1273), KYB status transitions / LP-level confirm
  (#1274), bank-requisites fields (#1275).
- No summary cards, no tabs, no search/sort/pagination, no `contact_email` column, no
  committed/repaid/balance column — none is in the requirements table, and this codebase does not
  invent UI without a served source (`trustee-flows.md#never-fabricate-defaults-exec-plan-risk-3`).

### Columns (requirements → served field)

| # | Header | Source | Rendering |
|---|---|---|---|
| 1 | Legal Entity Name | `legal_name` | verbatim; non-empty-string guard → `—` |
| 2 | Jurisdiction | `country` (nullable) | **verbatim**, no code→name mapping (see memory rule "display backend values verbatim"); `null`/empty → `—` |
| 3 | First Registration Date | `created_at` (ISO-8601 UTC) | `formatIsoDateUtc` → `"18 Jun 2026"` |
| 4 | Account Status | `kyb_status` | chip, mapping below |
| 5 | Blockchain Address Available | `stellar_address` | `Yes` when a non-empty string, else `No` |
| 6 | Bank Info Available | *(none)* | always `—` until #1275 lands — **never** `No` |
| 7 | *(unlabeled)* | — | 34px trailing `›` chevron, `aria-hidden`, Loan Book precedent |

Column 6 renders `—` rather than `No` deliberately: "no field" is not "the LP has not supplied bank
details". Rendering `No` would fabricate a fact about the counterparty.

Rows are consumed in served order — `lp_repo::list()` is `ORDER BY created_at DESC, id DESC`
("newest first" per the OpenAPI annotation). No client-side sort.

### Account Status mapping (epic #1269 open question 1 — proposed resolution)

| served `kyb_status` | chip label | band |
|---|---|---|
| `NotStarted` | New | neutral |
| `InProgress` | KYB Pending | attention |
| `UnderReview` | KYB Pending | attention |
| `Passed` | Approved | positive |
| `Failed` | **Rejected** | negative |
| anything else | the raw string, verbatim | neutral |

`Failed → "Rejected"` is a **proposal for the user to veto**, not a guess dressed up as a fact.
Rationale: the requirements enumerate the happy path (New / KYB Pending / Approved) and are silent
on `Failed`; folding a failed KYB into any of those three would actively misinform the trustee
(showing a rejected LP as "New" invites a re-review; as "Approved" is worse). "Rejected" already
exists in this app's chip vocabulary with a negative band (the Origination table's
`OriginationRowStatus` `rejected` kind), so no new visual language is introduced. The
unknown → verbatim/neutral fallback mirrors the loan `statusToChip` rule
(`trustee-flows.md#status-chip-mapping-design-assignment-32`).

Band → colour, matching the one-off literals already used by the Loans/Loan-detail chips:
neutral `var(--color-pipeline-ink-muted)`, attention `#6e6400`, positive
`var(--color-pipeline-positive-primary)`, negative `#b20000`.

### Settled design decisions

- **Route:** `/lp-counterparties` (detail at `/lp-counterparties/$id`). Every existing trustee nav
  path is the kebab-cased nav label — `/origination`, `/loans`, `/cash-management`,
  `/risk-council`, `/audit-log` — so the label "LP Counterparties" gives `/lp-counterparties`.
  `/lps` would match the API path but break the app's own convention.
- **Sidebar position:** last item of the middle operational group, i.e. **after Cash Management**,
  before the divider that precedes Risk Council / Audit Log. It is a working queue like Origination
  and Loans, and it sits next to Cash Management because the LP bank-transfer recording (#1272)
  lands on its detail page. Implementation detail: `DIVIDER_AFTER_PATHS` in `TrusteeSidebar.tsx`
  moves from `"/cash-management"` to `"/lp-counterparties"` so the two-divider grouping is
  preserved.
- **Row click:** rows are fully clickable (pointer cursor, `tabIndex={0}`, Enter/Space, descriptive
  `aria-label`, trailing chevron) and navigate to `/lp-counterparties/$id` — a verbatim copy of
  `LoanRow` in `loans.index.tsx`. To keep that link live before #1271, this issue lands a thin
  placeholder `$id` route (LP legal name + a "Document review and KYB confirmation land in #1271"
  line, read from the same `useLps` cache). Inert-but-clickable-looking rows would be a QA defect;
  a dead route would be worse.
- **No ledger column.** `GET /v1/lp-ledger` (committed / repaid / balance) exists but the
  requirements' table does not list it; it belongs to the detail page's scope.
- **Polling:** `refetchInterval: 30_000`, the trustee-app convention for every list hook.

## Assumptions and Risks

1. **RISK — every row will read "New" on staging today.** TD-71: `kyb_status` never leaves
   `NotStarted` because no transition path exists (that is #1274). So the Account Status column is
   correct-but-monotone until #1274 lands, and columns 4 and 6 are both effectively placeholders.
   This must be written into the spec + user-stories doc so the QA agent does not file it as a bug.
2. **RISK — `country` is free text.** `RegisterLpRequest.country` is an optional trimmed string with
   no validation and no frontend writer yet (no caller of `POST /v1/lps` exists in
   `packages/frontend` — epic #1247's #1254 wiring is still pending). Rows may therefore show
   `"CH"`, `"Switzerland"`, or anything else. Render verbatim; do not normalise.
3. **RISK — the shared 403 copy is wrong for this page.** `toUserError`'s `matchApiStatus` maps
   403 → *"You are not authorized to review submissions."* A non-trustee staff JWT hitting
   `GET /v1/lps` would show that misleading sentence. Mitigation: the presenter checks
   `error instanceof ApiError && error.status === 403` **before** calling `toUserError` and returns
   page-specific copy. Log the underlying gap (page-specific copy hardcoded into a shared mapper)
   in `docs/exec-plans/tech-debt-tracker.md`; do not refactor the shared mapper here.
4. **ASSUMPTION — no Figma.** Confirmed: the design assignment
   (`docs/design-docs/trustee-dashboard-v3-design-assignment.md` §2/§4) has no LP-counterparties
   section or screen id. Styling is derived from the shipped `/loans` and `/origination` pages. No
   Figma verification step is possible or required for this issue.
5. **RISK — the nav glyph has no Figma export.** The six existing glyphs in `TrusteeNavIcons.tsx`
   are verbatim Figma asset exports. The seventh must be hand-authored (a two-person "counterparties"
   mark) in the same 20×20 / `fill="currentColor"` shape. Record the deviation in the spec doc so a
   future Figma delivery can replace it.
6. **ASSUMPTION — `/lp-counterparties` needs no extra auth wiring.** `__root.tsx`'s `beforeLoad`
   plus `TrusteeShell`'s render gate already cover every non-`/sign-in` route
   (`trustee-flows.md#two-layer-gating-1008`); the new route inherits both with no change.
7. **ASSUMPTION — `routeTree.gen.ts` is regenerated by `TanStackRouterVite()`** on `yarn dev` /
   `yarn build`. It must be committed with the route files (it is tracked and `@ts-nocheck`'d).
8. **Dependency note:** nothing blocks this issue. #1275 (bank info) and #1274 (KYB transitions)
   change what the data says, not the page's shape — neither is a prerequisite.

### Decisions recorded for the user to veto (not blockers)

- `Failed` → **Rejected** chip, negative band.
- Route `/lp-counterparties`; sidebar position after Cash Management.
- A thin placeholder `/lp-counterparties/$id` route ships here so the row click is live.

## Open Questions

_None_

## Implementation Steps

1. **Nav entry** — `packages/trustee/src/lib/nav.ts`: insert a `TrusteeNavItem` **after** the
   `/cash-management` entry:
   `{ path: "/lp-counterparties", navLabel: "LP Counterparties", heading: "LP Counterparties",
   description: "Registered LP counterparties and their KYB status." }`.

2. **Nav glyph** — `packages/trustee/src/components/TrusteeNavIcons.tsx`: add
   `LpCounterpartiesIcon(props: IconProps)` using the file's `baseProps(20, props)` helper and
   `fill="currentColor"` so it inherits active (brand) / inactive (on-dark) colour. Extend the
   file's one header docblock to note this glyph is hand-authored, not a Figma export (the file's
   single allowed header comment — do not add a second comment).

3. **Sidebar wiring** — `packages/trustee/src/components/TrusteeSidebar.tsx`: add
   `"/lp-counterparties": LpCounterpartiesIcon` to `NAV_ICONS`, and change `DIVIDER_AFTER_PATHS`
   from `new Set(["/", "/cash-management"])` to `new Set(["/", "/lp-counterparties"])`.

4. **Date formatter** — `packages/trustee/src/utils/formatDate.ts`: add
   `formatIsoDateUtc(rfc3339: string | null | undefined): string` → `"18 Jun 2026"` using
   `Intl.DateTimeFormat("en-GB", { ...DAY_MONTH_YEAR, timeZone: "UTC" })`;
   `null`/unparseable → `"—"`. Forcing UTC (unlike `formatEpochDate`) matches the served
   `created_at`, which is documented ISO-8601 **UTC** — a local-time format would shift the
   registration day for late-evening UTC registrations. Follow `formatAuditTimestamp`'s precedent.

5. **Data hook** — new `packages/trustee/src/api/useLps.ts`:
   - Hand-mirror `packages/api/src/routes/lps.rs`'s DTOs (TD-42 convention — the trustee app does
     not depend on `@pipeline/frontend`): `interface LpResponse` with `id: number`,
     `legal_name: string`, `country: string | null`, `contact_email: string`,
     `stellar_address: string | null`, `address_linked_at: string | null`, `kyb_status: string`,
     `owner_chain_id: number`, `owner_address: string`, `created_at: string`; and
     `interface LpsResponse { lps: LpResponse[] }`.
   - `useLps(): { data, isLoading, error, refetch }` — `useQuery<LpsResponse, Error>` with
     `queryKey: ["lps"]`, `queryFn: () => apiFetch<LpsResponse>("/v1/lps")`,
     `refetchInterval: 30_000`. No `chain_id` query param — the endpoint takes none.
   - One `// spec: docs/frontend/trustee-flows.md#lp-counterparties` header line, nothing else.

6. **Presenter** — new `packages/trustee/src/routes/-useLpCounterpartiesTable.ts` (mirrors
   `-useOriginationTable.ts`):
   - `export type AccountStatusBand = "neutral" | "attention" | "positive" | "negative"`.
   - `export interface AccountStatusChip { label: string; band: AccountStatusBand }`.
   - `export function mapKybStatus(kybStatus: string): AccountStatusChip` — the table in **Scope**
     above; default branch returns `{ label: safeString(kybStatus), band: "neutral" }`.
   - `export interface LpCounterpartyRow { key: string; lpId: string; legalName: string;
     jurisdiction: string; registeredOn: string; status: AccountStatusChip;
     blockchainAddress: "Yes" | "No"; bankInfo: string }` (`bankInfo` is always `"—"`).
   - `export function mapLpToRow(lp: LpResponse): LpCounterpartyRow` — pure, unit-testable, with the
     local `safeString` guard used by the other two presenters.
   - `export type LpCounterpartiesState = "loading" | "error" | "empty" | "ready"` and
     `useLpCounterpartiesTable(): { state, errorMessage, errorDetails, rows }`. Precedence:
     `isLoading` → `error` → `!data` (`empty`) → `rows.length === 0 ? "empty" : "ready"`.
   - Error branch: **first** `if (error instanceof ApiError && error.status === 403)` return
     `{ message: "Your trustee account is not authorized to view LP counterparties.",
     details: error.message }`; otherwise
     `toUserError(error, "Failed to load LP counterparties.")`.

7. **Layout route** — new `packages/trustee/src/routes/lp-counterparties.tsx`: pass-through
   `<Outlet/>`, a verbatim copy of `routes/loans.tsx`'s shape, with
   `createFileRoute("/lp-counterparties")`.

8. **List view** — new `packages/trustee/src/routes/lp-counterparties.index.tsx`
   (`createFileRoute("/lp-counterparties/")`). JSX + styling only; all logic from step 6. Copy the
   Loan Book table structure from `loans.index.tsx`:
   - `LINE_COLOR = "rgba(56, 55, 53, 0.18)"` applied via inline `style` (Tailwind v4 ordering).
   - `GRID_TEMPLATE_COLUMNS = "minmax(0,1.7fr) minmax(0,1fr) minmax(0,1.1fr) minmax(0,1.1fr)
     minmax(0,1.2fr) minmax(0,1fr) 34px"`.
   - `COLUMN_HEADERS = ["Legal Entity Name", "Jurisdiction", "First Registration Date",
     "Account Status", "Blockchain Address Available", "Bank Info Available"]`. These labels are
     longer than the Loans ones, so the header cell class **drops** `whitespace-nowrap` (keeping
     `overflow-hidden` + the Loans padding/typography) and is allowed to wrap to two lines.
   - Header row above the bordered body box; bordered body box with `borderTopWidth: "2px"` and a
     `borderTop` separator on every row but the first — identical to `LoansTable`.
   - Row: `data-testid="lp-counterparties-row"`, `role="row"`, `tabIndex={0}`,
     `aria-label={\`Open ${row.legalName}\`}`, `onClick`/`onKeyDown` (Enter + Space, with
     `preventDefault` on Space), `cursor-pointer`.
   - Status cell: `data-testid="lp-counterparties-status"`, `data-band={row.status.band}`,
     colour from the band → literal map in **Scope**.
   - Page shell: `<main className="mx-auto flex w-full max-w-[1200px] flex-col gap-[26px] px-4
     py-12 md:px-8">` with the 64px `rgba(56,55,53,0.3)` display `<h1>LP Counterparties</h1>`, and
     the table inside the white surface card
     (`rounded-[4px] bg-[color:var(--color-pipeline-surface)] pt-[36px] pr-[32px] pb-[32px]
     pl-[32px]`) — all verbatim from `loans.index.tsx`.
   - States, matching the Loans page exactly:
     - `error` → `<InlineError>` from `@pipeline/ui` in the negative-bordered wrapper,
       `data-testid="lp-counterparties-error"`.
     - `loading` → three `animate-pulse` skeleton bars, `aria-busy`,
       `aria-label="Loading LP counterparties"`, `data-testid="lp-counterparties-loading"`.
     - `empty` → bordered paragraph "No registered LP counterparties.",
       `data-testid="lp-counterparties-empty"`.
   - `navigate({ to: "/lp-counterparties/$id", params: { id: row.lpId } })` on row activation.
   - One `// spec: docs/frontend/trustee-flows.md#lp-counterparties` header line only.

9. **Placeholder detail route** — new `packages/trustee/src/routes/lp-counterparties.$id.tsx`
   (`createFileRoute("/lp-counterparties/$id")`): reads `useLps()`, finds the row by
   `String(lp.id) === id`, renders the same `<main>` shell with the LP's `legal_name` as the `<h1>`
   (falling back to `LP {id}` when not found — never fabricate), one muted line
   *"Document review and KYB confirmation land in issue #1271."*, and a `<Link to="/lp-counterparties">`
   back link. Keep it under ~40 lines — #1271 replaces the body.

10. **Route tree** — run `yarn workspace @pipeline/trustee dev` (or `build`) once so
    `TanStackRouterVite()` regenerates `packages/trustee/src/routeTree.gen.ts`; commit it.

11. **Spec doc** — `docs/frontend/trustee-flows.md`: add a top-level `## LP Counterparties` section
    immediately before `## Origination & review`, following the `## Loan book & tables` layout:
    **Sources** (the four new files), **Consumer route** (`/lp-counterparties`, issue #1270, epic
    #1269, *no Figma*), **Architecture** (view/logic split, hand-mirrored DTOs, 30 s poll),
    **Column mapping** (the Scope table), **Account Status mapping** (the chip table + the `Failed`
    rationale), **Never-fabricate notes** (Bank Info `—` until #1275; every row reads "New" until
    #1274/TD-71; `country` verbatim), **Row click & the #1271 seam**, **States & error copy**
    (including the 403 override), and **Sidebar placement** (position, divider move, hand-authored
    glyph).

12. **Utils catalogue** — `docs/frontend/utils.md`: add a `formatIsoDateUtc` (trustee) row in
    alphabetical order (import path `@/utils/formatDate`, one-line description), per
    `docs/FRONTEND.md` code-structure rule 4.

13. **Tech-debt entry** — `docs/exec-plans/tech-debt-tracker.md`: one entry noting that trustee
    `toUserError`'s 403 copy is hardcoded to the origination-review wording, forcing per-page
    pre-checks (first instance: `-useLpCounterpartiesTable.ts`).

14. **User stories** — new dir `docs/user-stories/epic-1269/` with
    `1270-trustee-lp-counterparties.md` (content in **Test Strategy** below), and a new
    `## Epic #1269 — Trustee LP Counterparties` table with its row in
    `docs/user-stories/index.md`.

15. **Verify** — `yarn workspace @pipeline/trustee test`,
    `yarn workspace @pipeline/trustee lint`, `yarn workspace @pipeline/trustee build`, and
    `npx tsx scripts/lint-docs.ts` from the repo root. All must pass before handing back.

## Test Strategy

Vitest + Testing Library, co-located with the `-` prefix, matching the Loans/Origination pairs.

**`packages/trustee/src/routes/-useLpCounterpartiesTable.test.ts`** (pure mappers — no DOM):

- `mapKybStatus` over all five served enum values → the exact label + band from the table.
- `mapKybStatus("Something")` → `{ label: "Something", band: "neutral" }`; `""` → `{ label: "—" }`.
- `mapLpToRow`: `country: null` → `"—"`; empty-string `country` → `"—"`; a real country string →
  verbatim (assert **no** code→name translation).
- `mapLpToRow`: `stellar_address: null` → `"No"`; `""` → `"No"`; a `G…` address → `"Yes"`.
- `mapLpToRow`: `bankInfo` is `"—"` for every input, including one where a future
  `bank_info_available` field is present on the payload but unmapped.
- `mapLpToRow`: `created_at: "2026-06-18T23:40:00Z"` → `"18 Jun 2026"`; garbage → `"—"`.
- `mapLpToRow`: `legal_name: ""` → `"—"`.

**`packages/trustee/src/utils/-formatDate.test.ts`** (extend the existing file): `formatIsoDateUtc`
— happy path, `null`/`undefined`, unparseable string, and a late-UTC timestamp asserting the UTC
day (the regression the util exists for; note the suite already runs `TZ=UTC`, so assert via an
explicit offset input such as `"2026-06-18T23:40:00+02:00"` → `"18 Jun 2026"`).

**`packages/trustee/src/routes/-lp-counterparties.index.test.tsx`** — copy the harness from
`-loans.index.test.tsx`: `vi.mock("@tanstack/react-router", …)` spreading `importActual` and
replacing `useNavigate` with a spy, plus `vi.mock("@/api/useLps", () => ({ useLps: vi.fn() }))`.
Render via the route's own component, exactly as that file does —
`const Page = Route.options.component as React.ComponentType; render(<Page />)` — so no component
export needs adding to the route module.

- Loading → `lp-counterparties-loading` present, no table.
- Error → `lp-counterparties-error` with the fallback copy.
- 403 `ApiError` → the authorization-specific copy, **not** the "review submissions" sentence.
- Empty `{ lps: [] }` → `lp-counterparties-empty` with "No registered LP counterparties."
- Two LPs → two `lp-counterparties-row`s, in served order, with the six expected cell values, the
  six column headers present, and the status cell's `data-band`.
- Row click and keyboard `Enter` each navigate to `/lp-counterparties/<id>`.
- A `Failed` LP renders "Rejected" with `data-band="negative"`.

**`packages/trustee/src/components/-TrusteeSidebar.test.tsx`** — the existing suite iterates
`TRUSTEE_NAV_ITEMS`, so it picks the item up automatically; add one assertion that the
"LP Counterparties" link points at `/lp-counterparties` and renders a glyph — this guards against
a missing `NAV_ICONS` entry, which today fails silently (`{Icon ? <Icon /> : null}`). The dividers
are `aria-hidden` decorative divs with no existing assertions; do not add one for them.

**User-stories doc** (`docs/user-stories/epic-1269/1270-trustee-lp-counterparties.md`) — QA-executable
against a signed-in trustee on the running app (`http://localhost:5174`), styling assertions
excluded per the index's convention:

1. The sidebar shows **LP Counterparties** between Cash Management and the divider; clicking it
   lands on `/lp-counterparties` and marks the item active.
2. With registered LPs on the backend, the table shows the six headers and one row per LP, newest
   first.
3. Account Status reads "New" for a `NotStarted` LP — **expected** while #1274/TD-71 is open; this
   is not a defect.
4. Bank Info Available reads "—" on every row — **expected** until #1275; a "No" here is a defect.
5. Blockchain Address Available reads "Yes" only for an LP with a linked Stellar address.
6. An LP with no `country` shows "—" in Jurisdiction.
7. Clicking a row opens `/lp-counterparties/<id>`, which shows the LP's legal name and the
   "#1271" placeholder line; the browser Back button returns to the list.
8. Keyboard: Tab to a row, press Enter — same navigation.
9. With no registered LPs, the empty message renders and no rows appear.

Not covered (deliberately): visual fidelity (no Figma exists for this screen), and any behaviour
that depends on #1273/#1274/#1275.

## Docs to Update

- `docs/frontend/trustee-flows.md` — new `## LP Counterparties` section (step 11). This is the
  product/behaviour spec for the page; no `docs/product-specs/` change is needed, since the epic
  body already carries the translated requirements and this issue adds no new product intent
  beyond the `Failed → Rejected` mapping (recorded in the spec section).
- `docs/frontend/utils.md` — `formatIsoDateUtc` (trustee) row.
- `docs/user-stories/epic-1269/1270-trustee-lp-counterparties.md` — new.
- `docs/user-stories/index.md` — new `## Epic #1269 — Trustee LP Counterparties` table + row.
- `docs/exec-plans/tech-debt-tracker.md` — the shared-403-copy entry.
- No change to `docs/design-docs/trustee-dashboard-v3-design-assignment.md` (v3 predates this
  epic; the epic body is the requirement source).
