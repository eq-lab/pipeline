# Issue #718: Panel A: Balance Sheet & Reconciliation UI

Source: https://github.com/eq-lab/pipeline/issues/718

Parent epic: #712 (Protocol Dashboard). Frontend flow. Backing API (#713 / PR #748)
`GET /v1/financial-position` is merged on `main`.

## Scope

Replace the "Coming soon" placeholder in
`packages/frontend/src/components/dashboard/BalanceSheetPanel.tsx` with the real
**Statement of Financial Position** panel (Panel A), wired to
`GET /v1/financial-position` and matching the Figma section (desktop node
`3283:14275`; mobile node `3283:72288`).

The panel renders a two-column balance sheet:

- **Assets** (left) with a muted section total, and two grouped sub-sections:
  - **Liquid** → Cash — stablecoins / Tokenized T-bills / Off-chain USD (trust company account)
  - **Deployed** → Secured loans outstanding / Accrued interest receivable
- **Liabilities** (right) with a muted section total, and two grouped sub-sections:
  - **Senior Claims** → PLUSD outstanding (with a `1:1 redeemable` caption)
  - **Subordinated Capital** → Junior tranche

Each leaf is a label→value row. Amounts are base-6 decimal strings rendered with
the existing `formatCompactUsd` helper (compact `$X.XM`), and **any `null` field
renders `—`** — the same graceful-null precedent as `liquid_cover` in the
Withdrawal Queue panel and `collateral` in the Loan Book.

Responsive behavior mirrors the shipped panels (#749): desktop = two equal
columns separated by a vertical divider; mobile (< `md`) = single column with
Assets card stacked above Liabilities card. The panel title steps down
`heading-m` → `heading-m-mobile` via `PanelContainer`.

### In scope

- New API hook `useFinancialPosition` (`packages/frontend/src/api/`), barrel export, README + mock-key doc.
- New co-located logic hook `useBalanceSheetPanel` (view = JSX only, per FRONTEND.md rule 2).
- Rewrite of `BalanceSheetPanel.tsx` to render the real content.
- Component/hook regression tests.

### Out of scope (v1 data not available — see Assumptions)

The #718 body lists sub-features whose backing data is `null`/absent in the v1
endpoint. These are **deferred**, not built now, and called out in Open Questions:

- **PLUSD / sPLUSD supply + sPLUSD→PLUSD exchange rate** — endpoint returns only
  `senior_claims.plusd_outstanding` and it is `null` in v1 (no reliable supply
  source; no sPLUSD field at all). The PLUSD row renders with a `—` value and the
  `1:1 redeemable` caption; sPLUSD/exchange-rate are omitted (no field, and the
  Figma section does not show them).
- **Capital Wallet reserves breakdown** (USDC / USYC NAV / deployed / in-transit
  as distinct line items) — the endpoint's `liquid` leaves (`cash_stablecoins`,
  `tokenized_tbills`, `off_chain_usd`) are all `null` in v1. We render the three
  Figma Liquid rows with `—` values (matching the Figma structure), but there is
  no separate "in transit" / units-vs-USD split — those are not in the contract.
- **Liquidity ratio vs 15% target with 10%/20% band indicators** — requires the
  Capital-Wallet USDC balance, which is `null`. **Omitted**; the Figma section
  does not contain a liquidity-ratio widget.
- **Reconciliation invariant status (green/amber/red)** — requires both
  `plusd_outstanding` (null) and the full liquid reserves (null); cannot be
  computed. **Omitted**; not present in the Figma section.

The plan renders exactly what the Figma "Statement of Financial Position" section
shows (which aligns 1:1 with the endpoint schema), with null-safe values.

## Assumptions and Risks

- **Endpoint is on `main`.** `GET /v1/financial-position` returns
  `{ assets: { total, liquid: {...}, deployed: {...} }, liabilities: { total,
  senior_claims: { plusd_outstanding }, subordinated_capital: { junior_tranche } } }`,
  every amount an `Option<String>` base-6 decimal string. Confirmed by reading
  `packages/api/src/routes/financial_position.rs`.
- **In v1, `assets.liquid.*` and `liabilities.senior_claims.plusd_outstanding` are
  all `null`;** `assets.deployed.*`, the two rolled-up `total`s, and
  `subordinated_capital.junior_tranche` are populated. So on real data the panel
  shows `—` for the three Liquid rows and PLUSD, and real figures for
  Deployed + Junior tranche + both section totals. This is expected and must not
  read as broken UI — the `—` treatment is deliberate.
- **Section totals are the endpoint's rolled-up `assets.total` / `liabilities.total`,
  not client-computed.** Do NOT sum leaves client-side (the backend already
  rolls up only the non-null leaves). Risk: because `liquid`/`plusd` are null,
  `assets.total` == deployed total and `liabilities.total` == junior tranche in
  v1 — they will NOT visually balance ($assets ≠ $liabilities), unlike the Figma
  mock where both read `$43.14M`. That is correct given v1 data; see Open Questions.
- **The Figma section total uses the muted (`content-test/secondary`) ink color** —
  match with `--color-pipeline-ink-muted`, not full-ink.
- **Money formatting.** Values are base-6 decimal strings already in human units
  (same convention as Withdrawal Queue `amount`). Use `formatCompactUsd`; do NOT
  use `formatUsdc`/`parseUnits`. `formatCompactUsd(null)` already returns `—`.
- **Panel-level empty/error state.** If the whole request fails → `error` state
  (retry). There is no meaningful "empty" state (the balance sheet always has a
  shape); a fully-null-but-successful response still renders the labelled rows
  with `—`. Treat success as `ready`.
- Risk: the epic frame is too large to fetch whole; node IDs above were drilled
  into individually and are load-bearing for the coder.

## Open Questions

1. **v1 assets vs liabilities will not balance on-screen** (assets.total = deployed
   only; liabilities.total = junior tranche only; both other sides are null). The
   Figma mock shows both totals equal at `$43.14M`. Is it acceptable to ship the
   panel with visibly-unequal section totals in v1 (correct per available data),
   or should we add a caption/footnote explaining that liquid reserves & PLUSD
   supply are not yet indexed so the sheet is partial? (Recommend: ship as-is with
   a small muted footnote noting "Liquid reserves and PLUSD supply pending data
   source"; needs product confirmation.)
2. **PLUSD `1:1 redeemable` caption** — the Figma shows this static caption under
   the PLUSD outstanding row even though the value is `—` in v1. Keep the caption
   rendered regardless of null value? (Recommend: yes, it is a static descriptor,
   not data.)
3. Confirm the deferred sub-features (liquidity ratio, band indicators,
   reconciliation status, sPLUSD exchange rate) should be tracked as a follow-up
   sub-issue of #712 gated on the "Panel A reserves source" (the same source that
   unblocks `liquid_cover` in Panel C), rather than attempted now.

## Implementation Steps

1. **API hook** — create `packages/frontend/src/api/useFinancialPosition.ts`,
   modeled on `useWithdrawalQueue.ts`:
   - Types: `LiquidAssets`, `DeployedAssets`, `Assets`, `SeniorClaims`,
     `SubordinatedCapital`, `Liabilities`, `FinancialPositionResponse`,
     `UseFinancialPositionResult`. Every amount is `string | null`.
   - `useFinancialPosition()` uses `useQuery` with `queryKey: ["financial-position"]`,
     `queryFn: () => apiFetch<FinancialPositionResponse>("/v1/financial-position")`,
     `refetchInterval: 30_000` (FRONTEND.md "Real-time updates: poll every 30s").
     Always enabled (protocol-level, no wallet).
   - Doc-comment the base-6-string / null convention (mirror the `useWithdrawalQueue`
     header note; point at `formatCompactUsd`, warn off `formatUsdc`).
2. **Barrel export** — add `useFinancialPosition` + its types to
   `packages/frontend/src/api/index.ts`.
3. **API README + mock key** — in `packages/frontend/src/api/README.md` add a
   `useFinancialPosition()` section and the mock key
   `pipeline.mock.api.GET./v1/financial-position` (follow the `useLoanBook` /
   `useWithdrawalQueue` mock-key table entries).
4. **Logic hook** — create
   `packages/frontend/src/components/dashboard/useBalanceSheetPanel.ts`
   (co-located, per FRONTEND.md rule 2), modeled on `useWithdrawalQueuePanel.ts`:
   - Map raw response → a formatted view model:
     `{ state, assetsTotal, liabilitiesTotal, liquid: {cashStablecoins,
     tokenizedTbills, offChainUsd}, deployed: {securedLoans, accruedInterest},
     seniorClaims: {plusdOutstanding}, subordinated: {juniorTranche},
     errorMessage, refetch }`.
   - All money fields formatted via `formatCompactUsd` (null → `—`).
   - `state`: `loading` while `isLoading`; `error` on error (with `refetch`);
     otherwise `ready` (no `empty` state — see Assumptions).
5. **Panel view** — rewrite
   `packages/frontend/src/components/dashboard/BalanceSheetPanel.tsx` to consume
   `useBalanceSheetPanel` and render via `PanelContainer`:
   - `PanelContainer` with `title="Balance Sheet"`, `state`, `onRetry`,
     `errorMessage`, `borderless` (the section frame carries no outer card border;
     chrome lives on the two inner Card Body boxes — matches Figma `3283:14282` /
     `3283:14303` and the Withdrawal Queue precedent), keep
     `data-testid="dashboard-panel-balance-sheet"` and `data-node-id="3283:14275"`.
   - Body: a responsive two-column container — `flex flex-col md:flex-row`
     with `gap-8` (32px, Figma `size-32` between columns and between the two
     stacked mobile cards); each column `md:flex-1`. Desktop divider: a 1px
     vertical rule between columns (`content-test/secondary` →
     `--color-pipeline-line`); rendered `md:` only (mobile stacks with no divider).
   - **Column heading row**: `Assets` / `Liabilities` at `heading-m` (display
     font) on the left, section total at `heading-m` in **muted** ink on the right,
     `items-baseline justify-between` (Figma `3283:14281` / `3283:14302`).
   - **Card Body box** per column: white surface, asymmetric depth border
     (`border-t border-l border-b-[3px] border-r-[3px]`,
     `--color-pipeline-line`), `rounded-[var(--radius-pipeline-card,4px)]`,
     `p-4`, `flex flex-col gap-8` between the two sub-sections (Figma `size-32`).
   - **Sub-section** (Liquid / Deployed / Senior Claims / Subordinated Capital):
     a `heading-s`/Heading-20 title (display font, 20px/28px — reuse the
     `LoanBookSummary` value-token treatment) followed by a `flex flex-col gap-4`
     list of rows.
   - **Row** (extract a small presentational `BalanceSheetRow` — label +
     optional caption + right-aligned value): `flex items-center gap-3`,
     `border-t border-[--color-pipeline-line]`, `pt-4`, label in body font at
     `--color-pipeline-ink-muted` (Figma rows use secondary ink for labels),
     value right-aligned in body font at `--color-pipeline-ink`. Optional caption
     (`1:1 redeemable`) at caption size, muted, under the label.
   - Token discipline: no raw hex/font/size literals except layout pixel hints;
     all colors/typography via the `--color-pipeline-*` / `--text-pipeline-*`
     custom props already used by the sibling panels. Attach stable
     `data-testid`s (e.g. `balance-sheet-assets-total`,
     `balance-sheet-row-secured-loans-outstanding`, etc.) for tests/QA.
6. **Lint/build** — `npx tsc --noEmit` (frontend), run the frontend ESLint/lint
   and `npx tsx scripts/lint-docs.ts` for the README/doc edits. Fix all warnings.

## Test Strategy

Regression/component coverage is required (DoD). Follow the existing patterns in
`useWithdrawalQueuePanel.test.tsx` and `useYieldHistoryPanel.test.tsx`
(Vitest + React Testing Library, mock the API hook).

1. **API hook test** — `packages/frontend/src/api/useFinancialPosition.test.tsx`
   (mirror `useWithdrawalQueue.test.tsx`): mock-key path returns parsed JSON;
   real-fetch path calls `apiFetch` with `/v1/financial-position`; loading→data
   transition; error surfaces.
2. **Logic-hook / panel test** —
   `packages/frontend/src/components/dashboard/useBalanceSheetPanel.test.tsx`
   (or a `BalanceSheetPanel.test.tsx`), mocking `useFinancialPosition`:
   - **Loading** → `PanelContainer` shows `panel-loading`.
   - **Error** → `panel-error` + retry calls `refetch`.
   - **Ready, v1-shaped data** (deployed + junior tranche populated; liquid +
     PLUSD `null`): asserts Deployed rows and Junior tranche render formatted
     `$X.XM`; the three Liquid rows and PLUSD outstanding render `—`; both
     section totals render the endpoint's `total` values (not client-summed);
     the `1:1 redeemable` caption is present.
   - **Fully-populated data** (all fields non-null, e.g. the Figma mock numbers):
     every row renders formatted values and totals equal — guards the formatter
     wiring and the "when reserves land, it just works" path.
   - **Formatter edge**: a `"0.000000"` value renders `$0` (not `—`), and `null`
     renders `—` — locks the null-vs-zero distinction.
3. Ensure the new tests run in the existing frontend Vitest suite (no new runner
   config needed).

## Docs to Update

- `packages/frontend/src/api/README.md` — add `useFinancialPosition()` + mock-key
  entry (step 3).
- `docs/frontend/hooks.md` — add a `useFinancialPosition` row (the sibling API
  hooks `useLoanBook` / `useStatsYield` / `useWithdrawalQueue` are catalogued
  there, so this one belongs too). The component-local `useBalanceSheetPanel`
  logic hook stays OUT per FRONTEND.md rule 5.
- `docs/product-specs/dashboards.md` Panel A — already documents the endpoint
  and the v1 null gaps (updated by #748); no behavioral spec change is introduced
  by this UI work, so no further edit is required beyond confirming the rendered
  panel matches the documented "field with no source is `—`" behavior. Note any
  deferred sub-features (liquidity ratio / reconciliation) here only if Open
  Question 3 is resolved to track them explicitly.
