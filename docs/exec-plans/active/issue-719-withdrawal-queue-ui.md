# Issue #719: Panel C: Withdrawal Queue UI

Source: https://github.com/eq-lab/pipeline/issues/719

## Scope

Build **Panel C — Withdrawal Queue** on the Protocol Dashboard (`/dashboard`),
replacing the current placeholder (`WithdrawalQueuePanel.tsx`, `state="empty"`,
"Coming soon"). It consumes the merged `GET /v1/withdrawal-queue` endpoint
(#714) and follows the panel conventions established by #717 (Loan Book /
Deployment Monitor) and #720 (Yield History).

Panel content (Figma section `3283:14893`, screenshot verified):

- **Title** "Withdrawal Queue" (heading section, same treatment as Loan Book).
- **Four summary cards** (272px each on desktop, 144px tall, 16px gap):
  1. **In Queue** — `summary.in_queue_usd`, formatted compact USD (`$1.85M`).
  2. **Requests** — `summary.requests_count`, plain integer (`6`).
  3. **Estimated wait** — `summary.estimated_wait_days`, rendered `~3.2 days`
     (`"—"` when `null`).
  4. **Liquid Cover** — `summary.liquid_cover`, rendered `5.6x` via
     `formatCoverage`. The API serves this as `null` today (pending the Panel A
     reserves endpoint), so it renders `"—"` — a labelled seam, not fabricated.
- **Table** (3 columns: Holder / Amount / Status) from `items[]`:
  - **Holder** — truncated `account` address (`0x7a…3f1`).
  - **Amount** — `amount`, compact USD (`$0.62M`).
  - **Status** — badge/text: `Queued` (muted ink) or `Completed`. See Open
    Questions re: the Figma "Processing" label vs the API `Completed` value.
  - Responsive: desktop `<table>`, mobile stacked cards (per #717's pattern).

**In scope:** the `useWithdrawalQueue` API hook + types, the panel view + its
co-located logic hook, the responsive table sub-component, a shared address-
truncation util (extracted per FRONTEND.md rule 3), formatting reuse, and tests.

**Out of scope:**
- Backend changes (endpoint is merged; `liquid_cover` and any richer fill
  metadata are backend follow-ups, not this issue).
- Wiring a live `liquid_cover` value (depends on the Panel A reserves endpoint —
  render `"—"` until then).
- Per-request "fully pending vs partially filled" split and per-fill
  time-in-queue rows: the merged endpoint's `items[]` only exposes
  `account`/`amount`/`status`, so the panel renders what the API serves. The
  spec's richer breakdown is deferred to a backend follow-up (see Assumptions).

## Assumptions and Risks

- **Endpoint shape is authoritative and merged.** `GET /v1/withdrawal-queue`
  (commit b4b4325, `packages/api/src/routes/withdrawal_queue.rs`) returns
  `{ summary: { in_queue_usd, requests_count, estimated_wait_days, liquid_cover },
  items: [{ account, amount, status }] }`. `in_queue_usd` and `amount` are base-6
  decimal strings **already in human units** — format with `formatCompactUsd`,
  NOT `formatUsdc`/`parseUnits` (same rule as loan-book). `estimated_wait_days`
  is a 1-decimal string or `null`; `liquid_cover` is currently always `null`;
  `status ∈ {"Queued","Completed"}`; items are newest-first.
- **`liquid_cover` is always `null` today** — the "Liquid Cover" card renders
  `"—"`. This matches the endpoint doc-comment and the spec. Do not compute it
  client-side; the numerator/denominator source does not exist yet.
- **Figma vs API status-label mismatch (RISK).** The Figma screenshot shows a
  green **`Processing`** label and a muted **`Queued`** label, but the API's two
  values are `Queued` and `Completed`. The spec (dashboards.md) codifies
  `{Queued, Completed}`. See Open Questions — the mapping/label decision must be
  resolved before the coder picks status copy.
- **Figma "Show N more" row (RISK).** The design shows 5 rows then a
  "Show 1 more" expand affordance. The endpoint returns *all* items (no server
  pagination), so this is a client-side truncate/expand. See Open Questions on
  whether to implement the expand now or render all rows.
- **Address truncation form.** Figma shows `0x7a…3f1` (≈4+3). The existing
  in-app convention (`useAccountDropdown.ts`) is 6+4 (`0xXXXX…XXXX`). Extracting
  a shared util and using the established 6+4 form is the safe default; the exact
  glyph count is a minor visual detail for UX review, not a blocker.
- **No wallet gating.** This is a protocol-wide view; the hook is always enabled
  (like `useLoanBook`), 30s poll per FRONTEND.md "Real-time updates".
- **Panel is already slotted** into `routes/dashboard.tsx` (4th, after Loan
  Book) — no route or nav change needed.

## Open Questions

1. **Status label copy.** The API returns `status: "Completed"` for claimed
   requests, but the Figma design labels the green state **`Processing`**. Which
   wins — render the API value verbatim (`Completed`), or map `Completed →
   "Processing"` to match the design? (Recommendation: render the API value
   `Completed` and treat the Figma "Processing" copy as the discrepancy, but this
   is a product/design call.) Also: which status gets the green treatment —
   `Completed` (as "done", matching Figma's green `Processing`) or `Queued`?
2. **"Show N more" expand.** Implement the client-side row-limit + expand
   affordance now (e.g. show first 5, "Show N more" toggles the rest), or render
   all `items[]` rows and defer the expand to a follow-up? The endpoint returns
   the full list with no server-side cap.

## Implementation Steps

1. **API hook — `packages/frontend/src/api/useWithdrawalQueue.ts`.**
   Model on `useLoanBook.ts`. Export:
   - `WithdrawalQueueSummary` — `{ in_queue_usd: string; requests_count: number;
     estimated_wait_days: string | null; liquid_cover: string | null }`.
   - `WithdrawalQueueItem` — `{ account: string; amount: string; status:
     "Queued" | "Completed" }` (use a string-literal union; keep it permissive
     with a fallback so an unexpected status string still renders).
   - `WithdrawalQueueResponse` — `{ summary; items: WithdrawalQueueItem[] }`.
   - `UseWithdrawalQueueResult` and `useWithdrawalQueue()` — `useQuery`,
     `queryKey: ["withdrawal-queue"]`, `queryFn: () =>
     apiFetch<WithdrawalQueueResponse>("/v1/withdrawal-queue")`,
     `refetchInterval: 30_000`, always enabled. Include the doc-comment note that
     `in_queue_usd`/`amount` are base-6 human-unit strings (use `formatCompactUsd`).

2. **Barrel export — `packages/frontend/src/api/index.ts`.** Export
   `useWithdrawalQueue` and the four types, following the existing block style.

3. **Shared address-truncation util — `packages/frontend/src/utils/truncateAddress.ts`.**
   Per FRONTEND.md rule 3 (helper now needed in a 2nd place), extract the 6+4
   truncation currently inlined in `useAccountDropdown.ts`
   (`\`${address.slice(0,6)}…${address.slice(-4)}\``) into
   `truncateAddress(address: string): string` (handle empty/short input
   gracefully). Refactor `useAccountDropdown.ts` to import it (keeps behavior
   identical). Add the util to `docs/frontend/utils.md` in the same change.

4. **Number formatter — reuse existing utils, add one small helper.**
   - `formatCompactUsd` for `in_queue_usd` and `amount`.
   - `formatCoverage` for `liquid_cover` (`"1.5x"`, `"—"` on null) — already
     exactly the format the card needs.
   - `requests_count` renders as a plain string.
   - **Estimated wait** needs `~3.2 days` from a 1-decimal string. Add
     `formatEstimatedWaitDays(days: string | null | undefined): string` to
     `formatCompactUsd.ts` (or a co-located helper) → `"~3.2 days"`, `"—"` on
     null/non-numeric. Ship a unit test (rule 3). Catalogue it in
     `docs/frontend/utils.md`.

5. **Logic hook — `packages/frontend/src/components/dashboard/useWithdrawalQueuePanel.ts`.**
   Mirror `useDeploymentMonitorPanel.ts`. Call `useWithdrawalQueue()`; derive:
   - `state`: `"loading"` while `isLoading`; `"error"` on `error`; `"empty"` when
     `!data || data.items.length === 0`; else `"ready"`.
   - `summary`: pre-formatted `{ inQueue, requests, estimatedWait, liquidCover }`
     strings (all `"—"` in the non-ready branches).
   - `rows`: `items.map` → `{ holder: truncateAddress(account), amount:
     formatCompactUsd(amount), status }`.
   - `errorMessage`, `refetch`.
   - If Open Question 2 resolves to "implement expand": also expose the
     first-N/rest split + an `expanded` toggle here (view stays JSX-only).

6. **Table sub-component —
   `packages/frontend/src/components/dashboard/WithdrawalQueueTable.tsx`.**
   Model on `LoanBookTable.tsx`. Desktop `<table>` (3 columns: Holder / Amount /
   Status) wrapped in `overflow-x-auto`; mobile stacked cards below `md`. Reuse
   the same caption/body typography token classes and `border-collapse` row
   divider treatment. Status cell: muted ink for `Queued`, green
   (`--color-pipeline-*` success/positive token — confirm the exact token in
   `theme.css`) for the "done" state, per the resolved Open Question 1. Add
   stable `data-testid`s (`withdrawal-queue-table`, `-desktop`, `-mobile`).

7. **Summary cards.** Reuse the card token treatment from `LoanBookSummary.tsx` /
   the Yield-History `MetricCard` (white surface, asymmetric depth border,
   `--radius-pipeline-card`, 16px padding, 144px tall to match Figma frame
   `3283:14895` card-horizontal height=144). Either add a small local
   `SummaryCard` in this panel or reuse an existing presentational card — prefer
   reuse if `LoanBookSummary`'s `SummaryCard` can be lifted without churn;
   otherwise keep a local one consistent with #720's `MetricCard`. Four cards:
   In Queue / Requests / Estimated wait / Liquid Cover.

8. **Panel view — rewrite
   `packages/frontend/src/components/dashboard/WithdrawalQueuePanel.tsx`.**
   Replace the placeholder. Use `PanelContainer` with `title="Withdrawal Queue"`,
   `state`, `onRetry={refetch}`, `errorMessage`, preserve
   `data-testid="dashboard-panel-withdrawal-queue"` and
   `data-node-id="3283:14893"`. Body: summary cards grid + `WithdrawalQueueTable`,
   spaced per the Figma frame (cards at y=88 under the 56px heading, table at
   y=264 → `gap-8` between cards and table, matching Loan Book's spacing rhythm).
   Keep the view JSX-only (FRONTEND.md rule 2).

9. **Lint.** Run `npx tsx scripts/lint-docs.ts` (docs structure) and the
   frontend lint/typecheck (`yarn workspace @pipeline/frontend lint` + `tsc`) —
   no raw hex/font values, token discipline, `no-restricted-globals` (never call
   `fetch` outside `src/api/`).

## Test Strategy

- **`useWithdrawalQueue.test.tsx`** (model on `useLoanBook.test.tsx`): mock-key
  path returns fixture without calling `fetch`
  (`pipeline.mock.api.GET./v1/withdrawal-queue`); real-fetch path hits
  `/v1/withdrawal-queue`; 500 → `error` populated; always-enabled (fires with no
  wallet). Fixtures: one with items (`Queued` + `Completed`, non-null
  `estimated_wait_days`, `liquid_cover: null`) and one empty (`items: []`).
- **`useWithdrawalQueuePanel` test** (model on `useYieldHistoryPanel.test.tsx`):
  assert the four state transitions (loading/error/empty/ready) and that ready
  produces correctly-formatted `summary` strings + `rows` (truncated holder,
  compact amount, mapped status), and `"—"` for `liquid_cover` when `null`.
- **`truncateAddress` unit test** — EVM + Stellar + short/empty inputs (rule 3).
- **`formatEstimatedWaitDays` unit test** — `"3.2"` → `"~3.2 days"`, `null` →
  `"—"`, non-numeric → `"—"`.
- **Panel render test** (optional, if a component test fits the existing pattern):
  renders the table headers + a row + all four card labels; empty state shows the
  empty caption.
- **Figma verification (required, per planner skill).** After implementation,
  verify the rendered `/dashboard` Panel C against Figma section `3283:14893`
  (desktop) and the responsive frame — card labels/values, table columns, status
  colours, spacing, and the address-truncation form. Reconcile any pixel/label
  gaps or file them (the mobile responsive node under `3283-72387` governs the
  stacked layout; confirm the exact mobile node during QA).

## Docs to Update

- `docs/frontend/utils.md` — add `truncateAddress` and
  `formatEstimatedWaitDays` (import path + one-line description), same commit as
  the code (FRONTEND.md rule 4).
- `docs/product-specs/dashboards.md` — Panel C section already documents the
  endpoint and `{Queued, Completed}`; **no spec change needed** unless Open
  Question 1 resolves to a `Completed → "Processing"` UI relabel, in which case
  add a one-line note that the UI displays "Processing" for the `Completed`
  state.
- No `docs/frontend/hooks.md` entry — `useWithdrawalQueuePanel` is a
  component-local hook (rule 2), and `useWithdrawalQueue` is an API hook (lives
  in the api barrel, not the shared-hooks catalogue), consistent with how
  `useLoanBook` is treated.
