# Issue #797: Trustee: implement the Overview page (Figma 4116-8854)

Source: https://github.com/eq-lab/pipeline/issues/797

Sub-issue of epic #775 (Trustee Admin Panel). Builds on #786 (MERGED) — the app
shell (320px `TrusteeSidebar` + `flex-1` main region in `TrusteeShell`) and the
`/` Overview route already exist as a placeholder
(`packages/trustee/src/routes/index.tsx`). This issue replaces that placeholder
body with the real Overview page.

Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=4116-8854&m=dev
Design artifacts already extracted (do NOT re-fetch — the Figma MCP does not
hot-load): `/tmp/figma-overview/get_screenshot_0.png` (source of truth),
`/tmp/figma-overview/get_design_context.txt` (exact spacing/hex + React/Tailwind
reference to convert), `/tmp/figma-overview/get_metadata.txt` (bounding boxes).
Figma variable defs were empty (`{}`) → the export is raw hex; map to theme
tokens exactly as #786 / SignInCard did.

## Scope

**In scope — the Overview page body inside the shell's `<main>` region:**

1. **Header** — "Overview" title (Besley display, Figma `text-[64px]` on a
   muted/subtle ink — the Figma export uses `rgba(56,55,53,0.3)` which is
   exactly `--color-pipeline-ink-subtle`) + a right-aligned timestamp row.
   See Open Question #6 — the timestamp is **deferred** (no API field backs it),
   so ship the header title now and omit the timestamp string until a backend
   `as_of`/`generated_at` field exists.
2. **Capital Allocation card** wired to `GET /v1/capital-allocation?chain_id=99000001`:
   - Card header row: "Capital Allocation" label (left). The green
     reconciliation header on the right is **deferred** (Open Question #3 — no
     backing field; do not hardcode "DRIFT < 0.01%").
   - Big total (`total`) rendered with a full whole-dollar format (`$115,190,000`).
   - Segmented horizontal allocation bar — **values only, no percentages/fill
     proportions in this issue** (Open Question #1; the endpoint returns no
     percentages and `bucket/total` is a client-derived metric, forbidden by
     [no frontend-computed metrics]). See Assumptions for the deferred bar
     treatment.
   - Per-bucket legend: Capital Wallet / In transit / Trust account / Deployed /
     T-Bills (USYC), each with its compact value (`$8.4M`, `$96M`, …). Percentages
     are **omitted** (deferred, same reason). The `in_transit` bucket **stays**
     in the bar/legend (only the standalone Cash-in-Transit card is removed).
   - Provenance chips (4× "on-chain balance · current block", etc.) — **deferred**
     (Open Question #3 — no backing field).
3. Pixel/token-exact per the Figma frame, reusing `@pipeline/ui` (`Card`) + theme
   tokens; document any scoped raw-hex one-offs inline (SignInCard/#786 precedent).
4. Desktop-first, consistent with #786 (the shell already provides the sidebar +
   scroll container; the main region has its own `<main>` — see `TrusteeShell`
   note that the route owns the `<main>` landmark).

**Explicitly OUT of scope (remove from the Figma layout entirely):**

- The standalone **Cash in Transit** card (Figma node `4116:8980`) — removed.
  (The `in_transit` **bucket** inside the Capital Allocation bar/legend STAYS.)
- The **Active Deal** card (Figma node `4116:8991`) — removed.

**Deferred to follow-up sub-issues (do NOT mock — see Open Questions):**

- The **Needs Attention** section (Origination / Loans-payments-due / Cash
  Management / Risk Council action items with Review / Record coupon / Roll over
  / Track / Top up buttons). No endpoint exists (Open Question #4). Recommendation:
  render **nothing** for it now (not even an empty-state — there is no query to be
  "empty" against) and file a follow-up sub-issue. Confirm with the human gate.
- The timestamp, reconciliation header, and provenance chips (Open Questions #3, #6).

## Assumptions and Risks

- **Endpoint contract is authoritative and already implemented** (backend WIP for
  *data*, not shape). Verified in `packages/api/src/routes/capital_allocation.rs`:
  ```
  GET /v1/capital-allocation?chain_id=<i64 optional; defaults to DEFAULT_CHAIN_ID>
  200 → {
    "total": string | null,                    // Σ of available buckets
    "buckets": {
      "capital_wallet": string | null,
      "in_transit":     string | null,
      "trust_account":  string | null,
      "deployed":       string | null,
      "tbills":         string | null
    }
  }
  ```
  **Every field is nullable** (Rust `Option<String>`). Today only `deployed` is
  sourced from the indexer; the other four buckets and often `total` come back
  `null`. The UI MUST render `—` for any `null`/missing value (per
  [no frontend-computed metrics]), not `$0`.
- **Value format = base-6 decimal strings already in human units** (e.g.
  `"96000000.000000"` = $96M), confirmed via `base6_to_decimal_string` in
  `packages/api/src/formatting.rs`. This resolves Open Question #2: the strings
  are NOT pre-formatted — the coder needs a formatter.
- **Two number formats are needed** (from the Figma): the big total is
  **fully-expanded** whole dollars (`$115,190,000`); the legend values are
  **compact** (`$8.4M`, `$96M`, `$4.95M`). The LP frontend has both
  (`packages/frontend/src/utils/formatCompactUsd.ts` = compact;
  `packages/frontend/src/lib/usdc.ts` = whole/currency), but those live in
  `@pipeline/frontend`, which the trustee package does **not** depend on and
  should not (epic-#775 separation). Trustee has **no `utils/` dir and no money
  formatter today**. → The coder adds trustee-local formatters (see Steps) with
  colocated tests, mirroring the LP implementations (do not import across
  packages; do not compute derived metrics).
- **Data-fetching stack is TanStack Query** (`@tanstack/react-query` is a trustee
  dep; a singleton `QueryClient` is already mounted in
  `packages/trustee/src/main.tsx`). No hook exists yet in trustee. Mirror the LP
  pattern in `packages/frontend/src/api/useDashboardSummary.ts` (queryKey,
  `apiFetch`, `URLSearchParams`, `refetchInterval`). All calls go through
  `packages/trustee/src/api/client.ts::apiFetch` (which attaches the bearer
  token from `sessionStore`) — direct `fetch` outside `src/api/` is ESLint-banned
  (TD-33).
- **chain_id:** send `chain_id=99000001` explicitly (`ENV.STELLAR_CHAIN_ID`),
  matching every other Stellar-scoped dashboard call (`useDashboardSummary` uses
  `ENV.STELLAR_CHAIN_ID`; #751 header does the same). The endpoint defaults to
  `DEFAULT_CHAIN_ID` if omitted, but the LP EVM chain carries malformed test data
  (#765) — be explicit.
- **Segmented bar without percentages is the main visual risk.** The Figma bar is
  a 5-segment proportional fill driven by percentages the API does not serve.
  Rendering it "value-only" (Open Question #1, recommended option b) means the
  bar cannot show real proportions without a client-side `bucket/total`
  computation (forbidden). Coder must NOT compute the split. Deferred treatment:
  render the legend (value chips) and either (i) omit the coloured proportional
  bar entirely until the backend serves percentages, or (ii) render a static
  placeholder bar with equal/inert segments clearly not implying real
  proportions. **This is gated on Open Question #1 — do not pick without the
  human answer.**
- **Auth gating already handled** by `RouteGate` in `TrusteeShell` — the Overview
  route only renders when authenticated, so the bearer token is present for the
  fetch. No extra gating needed.
- Backend `total` is currently `Σ(deployed)` only (not the true grand total)
  while other buckets are null — so the rendered total may look "too small"
  versus the Figma's $115M until the backend populates the other buckets. This
  is expected; the UI renders what the API serves.

## Open Questions

1. **Segmented bar + per-bucket percentages.** The endpoint returns values + total
   only — no percentages. Figma shows 7% / 4% / 1% / 83% / 4% and a proportional
   fill. Computing `bucket/total` client-side violates [no frontend-computed
   metrics]. Options: (a) backend adds percentage fields → defer the % + bar-fill
   until served; (b) render bar/legend with **values only**, omit % now; (c) treat
   the bar as pure inert visual. **Recommend (b)** — render legend values, omit
   percentages, and either drop the proportional coloured bar or render an inert
   placeholder bar until the backend serves proportions. Do NOT compute
   percentages. Which option?
2. **Value format** — RESOLVED by code inspection (no longer open): base-6 decimal
   strings in human units; coder adds trustee-local compact + whole-dollar
   formatters. (Listed here for the manager's audit trail; no human input needed.)
3. **Reconciliation header + provenance chips** ("RECONCILES TO PLUSD BACKING ·
   DRIFT < 0.01%" and the 4 chips). No endpoint field backs these. Recommend
   **deferred / out of scope** for this issue (do not hardcode a drift number or
   fake "refreshed 2m ago" timestamps). Confirm.
4. **Needs Attention section.** No endpoint (backend WIP). Recommend **defer the
   whole section to a follow-up sub-issue** and render nothing now (there is no
   query to show an empty-state against; a hardcoded empty-state would still be
   inventing UI with no data contract). File the follow-up. Confirm defer vs.
   scaffold-empty-state.
5. **Loading / error / empty states** for the Capital Allocation fetch. Proposed
   (confirm acceptable): loading → a token-styled skeleton on the total + legend
   region; error → an inline error surface inside the card (reuse the SignInCard
   error-surface pattern / `Card variant="danger"`); per-field `null` → `—`. This
   is a planner recommendation, not a blocker — flagged for completeness.
6. **Header timestamp source.** No `as_of`/`generated_at` field in the response.
   A client-clock timestamp would be a derived/non-backend value. Recommend
   **omit the timestamp** until the API provides one. Confirm.

## Implementation Steps

1. **Add trustee-local money formatters** in a new
   `packages/trustee/src/utils/formatUsd.ts` (creates the `utils/` dir), mirroring
   the LP implementations but self-contained (no cross-package import):
   - `formatCompactUsd(base6Decimal: string | null | undefined): string` — compact
     notation for legend values (`"96000000.000000"` → `"$96M"`,
     `"8400000.000000"` → `"$8.4M"`, `null` → `"—"`). Port from
     `packages/frontend/src/utils/formatCompactUsd.ts` (the `formatCompactUsd`
     function only). Match the Figma legend precision (Figma shows `$96M`,
     `$8.4M`, `$4.95M`, `$4.64M`, `$1.2M` — note 2 sig-figs on `$4.95M`; confirm
     the exact rounding rule against the screenshot during Figma verification and
     adjust `toFixed` accordingly).
   - `formatFullUsd(base6Decimal: string | null | undefined): string` — whole-dollar
     expanded notation for the big total (`"115190000.000000"` → `"$115,190,000"`,
     `null` → `"—"`). Use `Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })`
     with a `$` prefix.
   - Add colocated unit test `packages/trustee/src/utils/-formatUsd.test.ts`
     (per the `-*.test.ts(x)` convention) covering: M/K/sub-K compact cases,
     `null`/`undefined` → `—`, non-numeric → `—`, zero, and the whole-dollar
     grouping. (FRONTEND.md rule 3: every extracted util ships a test.)
   - Catalogue the util in `docs/frontend/utils.md` (FRONTEND.md rule 4) — note it
     is trustee-scoped (a deliberate duplicate of the LP `formatCompactUsd`;
     cross-package sharing of formatters is a future consolidation, log in
     `docs/exec-plans/tech-debt-tracker.md` if not already tracked).

2. **Add the data hook** `packages/trustee/src/api/useCapitalAllocation.ts`,
   mirroring `packages/frontend/src/api/useDashboardSummary.ts`:
   - Export a `CapitalAllocation` type matching the contract exactly (all fields
     `string | null`, buckets nested).
   - `useQuery<CapitalAllocation, Error>` with `queryKey: ["capital-allocation", chainId]`,
     `queryFn` building `?chain_id=${ENV.STELLAR_CHAIN_ID}` via `URLSearchParams`
     and calling `apiFetch<CapitalAllocation>("/v1/capital-allocation?…")`.
   - `refetchInterval: 30_000` (dashboard polling convention, FRONTEND.md
     "Real-time updates").
   - Return `{ data, isLoading, error, refetch }` like `useDashboardSummary`.
   - Colocated test `packages/trustee/src/api/-useCapitalAllocation.test.tsx`:
     assert the URL includes `chain_id=99000001`, a success path returns parsed
     data, an error path populates `error`, and `refetchInterval` is 30s. Mock
     `@/lib/env` and `apiFetch` the way the LP test mocks them (see
     `useDashboardSummary.test.tsx`); render the hook under a `QueryClientProvider`.

3. **Build the Capital Allocation card component**
   `packages/trustee/src/components/CapitalAllocationCard.tsx` (+ colocated
   `useCapitalAllocationCard.ts` hook per FRONTEND.md rule 2: the `.tsx` is
   JSX/styling only; the hook owns the query wiring and the value→display mapping,
   so the view is unit-test-friendly):
   - Use `@pipeline/ui` `Card` (`variant="white"`, appropriate padding) as the
     surface. Do not inline raw hex — map every colour to a theme token; for the
     bar-segment/legend-dot colours the Figma uses raw hex (`#000080` = brand,
     `#c9a200`, `rgba(56,55,53,0.35)` = surface-muted-ish, `#208000` =
     positive-primary, `#6666b3`). Map to tokens where an exact match exists
     (`--color-pipeline-brand`, `--color-pipeline-positive-primary`); for the
     others (`#c9a200`, `#6666b3`) that have no token, document them as scoped
     one-offs inline (SignInCard precedent) OR add new tokens if the human wants
     them reusable — coder's judgement, documented. Flag in the PR.
   - Header row: "Capital Allocation" label (Inter/body, ink). Reconciliation
     header slot omitted (Open Question #3).
   - Total: Besley display, Figma `text-[58px]/leading-[81.2px]`, ink token,
     rendered via `formatFullUsd(data.total)`.
   - Legend: five rows/chips (Capital Wallet / In transit / Trust account /
     Deployed / T-Bills (USYC)), each a coloured dot + label + `formatCompactUsd`
     value, `—` when the bucket is `null`.
   - Segmented bar: **implement per the answer to Open Question #1.** Default
     assumption pending confirmation: render the legend value chips; omit the
     proportional coloured bar (or render an inert placeholder) — no client-side
     percentage computation.
   - Loading / error / empty per Open Question #5 (skeleton / inline error /
     `—` per field).
   - Colocated test `packages/trustee/src/components/-CapitalAllocationCard.test.tsx`:
     render with a mocked hook returning (a) full data → asserts formatted total +
     legend values, (b) partial data (some buckets `null`) → asserts `—` for the
     nulls, (c) loading → skeleton present, (d) error → error surface present.

4. **Replace the Overview route body** in
   `packages/trustee/src/routes/index.tsx`:
   - Keep `createFileRoute("/")`. Render the `<main>` region (the shell provides
     the sidebar + outer layout; keep the route's own `<main>` landmark as today).
   - Header block: "Overview" title (Besley, `text-title` 64px token on
     `--color-pipeline-ink-subtle` to match the Figma's faded title) + the
     timestamp slot omitted (Open Question #6).
   - Render `<CapitalAllocationCard />`.
   - Do NOT render Cash in Transit, Active Deal, or Needs Attention (out of
     scope / deferred).
   - Keep the container max-width / padding consistent with the Figma Main region
     (`px-[56px] pt-[40px] pb-[80px]`, `max-w-[1180px]`) but map spacing to the
     Tailwind 4px scale and keep it consistent with #786's existing main padding
     — reconcile with what `TrusteeShell` already applies so padding isn't doubled.

5. **Update the existing route smoke test**
   `packages/trustee/src/routes/-index.test.tsx`: it currently asserts the
   placeholder body. Update it to reflect the new body — assert the "Overview"
   heading still renders and the Capital Allocation card mounts. Because the route
   now issues a query, wrap the render in a `QueryClientProvider` and mock
   `useCapitalAllocation` (or `apiFetch`) so the smoke test stays deterministic
   and does not hit the network.

6. **Update `packages/trustee/src/lib/nav.ts`** (optional / minor): the Overview
   `description` placeholder copy ("Content lands in a later sub-issue…") is no
   longer accurate for the page body, but `navLabel`/`heading` are still used by
   the sidebar. Leave `navLabel`/`heading`; the `description` field is only used
   by placeholder route bodies — Overview no longer uses it, so no change is
   strictly required. Do not remove the field (other placeholder routes still use
   it). Note in the PR.

7. **Figma verification pass.** Compare the rendered page against
   `/tmp/figma-overview/get_screenshot_0.png` and the `get_metadata.txt` bounding
   boxes: title size/colour, card padding, total type scale, legend dot colours
   and spacing, chip radii. Adjust token mappings to pixel/token-exact. (The user
   reviews UI live — start the dev server per the "always start dev server"
   convention: `yarn workspace @pipeline/trustee dev`, port 5174.)

8. **Lint + tests.** Run the trustee ESLint config (no raw `fetch`, no raw
   `import.meta.env`, no inline hex where a token exists) and the colocated tests.
   Sandbox test quirk (per the issue): if the workspace test runner breaks, run
   `node node_modules/.bin/vitest run` under Node 20. Also run
   `npx tsx scripts/lint-docs.ts` (AGENTS.md) after the docs/util-catalogue edit.

## Test Strategy

- **Util tests** (`-formatUsd.test.ts`): compact M/K/sub-K formatting, whole-dollar
  grouping, `null`/`undefined`/non-numeric → `—`, zero handling. Mirror the LP
  `formatCompactUsd.test.ts` cases.
- **Hook test** (`-useCapitalAllocation.test.tsx`): URL carries
  `chain_id=99000001`; success returns parsed data; error populates `error`;
  `refetchInterval` = 30s; renders under `QueryClientProvider` with mocked
  `apiFetch` + `@/lib/env` (LP `useDashboardSummary.test.tsx` is the template).
- **Card test** (`-CapitalAllocationCard.test.tsx`): full data → formatted total +
  five legend values; partial/`null` buckets → `—`; loading → skeleton; error →
  error surface. Mock the hook so no network.
- **Route smoke test** (`-index.test.tsx`, updated): Overview heading renders +
  card mounts, wrapped in `QueryClientProvider` with the hook/`apiFetch` mocked;
  no Cash-in-Transit / Active Deal / Needs-Attention nodes present.
- **Edge cases:** all-`null` response (fresh protocol) → total `—`, every legend
  `—`, no crash; `deployed`-only response (current backend reality) → deployed
  value shown, other buckets `—`.
- No E2E/QA phase for frontend (AGENTS.md Flow B); QA runs later at the epic level.

## Docs to Update

- `docs/frontend/utils.md` — catalogue the new trustee-scoped `formatCompactUsd` /
  `formatFullUsd` (import path + one-line description), noting the deliberate
  duplication of the LP util pending cross-package consolidation.
- `docs/exec-plans/tech-debt-tracker.md` — log the formatter duplication
  (trustee vs. LP) as consolidation debt if not already tracked; and note the
  deferred Capital-Allocation percentage/bar-fill (pending a backend percentage
  field).
- `docs/FRONTEND.md` — no change required (the Trustee app + capital-allocation
  are already implied by the epic); add a one-line note under the Trustee section
  only if the human wants the Overview page documented there. Optional.
- **No product-spec change** — this is a frontend rendering of an existing,
  already-specced endpoint; behaviour is not newly introduced here. (The endpoint
  and Trustee dashboard are specced in `docs/product-specs/trustee-dashboard.md`
  / spec #453.)
- **Follow-up issue to file** (per Open Question #4): a new `frontend` sub-issue
  of #775 for the Needs Attention section, blocked on its backend endpoint.
