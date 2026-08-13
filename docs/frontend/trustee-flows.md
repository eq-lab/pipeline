# Trustee flows

Architecture and behavior specs for the Trustee admin panel in `packages/trustee/src/**` —
loan-book data, loan detail, cash movement, and lifecycle actions. This is the home for flow-shape
knowledge that previously lived as inline comments and docblocks — see
[`docs/FRONTEND.md` → Code structure rules, rule 6](../FRONTEND.md#code-structure-rules).

Trustee product intent lives in `docs/product-specs/` (see the Trustee panel note in
[`docs/FRONTEND.md`](../FRONTEND.md#application-structure)); this doc captures the frontend
*implementation* architecture.

> **Status:** migrated (#997, part of epic
> [#991](https://github.com/eq-lab/pipeline/issues/991)). Do not delete a source comment until its
> content lives in a section below. `lib/env.ts` and `routes/-loanDetailStatic.ts` keep their
> definition-site config/field docs by design (rule-6 compliant: short constraints at the
> definition, not flow narration).

## Audit Log

**Sources:** `packages/trustee/src/routes/audit-log.tsx` (view),
`packages/trustee/src/routes/-useAuditLog.ts` (presenter),
`packages/trustee/src/api/useAuditLog.ts` (data hook).
**Consumer route:** `/audit-log`. **Surface 17** of epic #775; issue #1004; Figma node
`4116:13770`.

Surface 17 is an append-only, reverse-chronological (newest-first) table — Time · Action · Loan /
scope · Reference — of on-chain Trustee actions.

### Architecture

Follows the `loans.index.tsx` design language and the view/logic split of
[`docs/FRONTEND.md` rule 2](../FRONTEND.md#code-structure-rules): the `.tsx` view is JSX-only and
reads a single presenter hook, `useAuditLogView`.

- `useAuditLog` (`api/`) — React Query hook over `GET /v1/audit-log`, Stellar-scoped `chain_id`,
  30 s poll. Its DTOs are a self-contained hand-mirror of the backend shape
  (`packages/api/src/routes/audit_log.rs`, #1000) — TD-42 convention, the trustee app does not
  depend on `@pipeline/frontend`.
- `useAuditLogView` (`routes/-useAuditLog.ts`) — presenter. The feed is the **source of truth for
  state**; the loan book (`useLoanBook`) is **enrichment only**: a loan-scoped row shows the
  friendly `"Originator — Commodity"` name, falling back to the server-supplied `scope.label`
  (`"Loan #<id>"` / `"Protocol"`) until the loan book loads or when an id isn't in it. Each item
  maps to a display row: `formatAuditTimestamp` time (UTC), resolved scope label, and a truncated
  tx-hash reference (`<first6>…<last4>`, full hash in the cell `title`).

### Scope — on-chain only (resolved with the issue author, #1004)

The endpoint serves on-chain loan-lifecycle + yield events only. **Rows are exactly what the
endpoint returns — never fabricated** ([[no-frontend-computed-metrics]]). Two consequences vs. the
Figma mock:

- The mock's off-chain rows ("Batch off-ramp co-signed", "Loan distributions wired (fiat)") and
  non-loan "Batch #B-102" scopes do **not** appear until the backend off-chain-audit follow-up
  lands (see the `audit_log.rs` header).
- The caption is adapted from the Figma copy (which promises fiat wire confirmations + MPC
  co-signatures "all land here") to describe what is actually served today — no over-claiming,
  matching the loans-page "never fabricate" precedent.

### Rendering (unpaginated feed)

`GET /v1/audit-log` returns the **full feed, not paginated**. The page bounds *rendering* — not the
payload:

- Render the newest `AUDIT_PAGE_SIZE` (50) rows; a "Show older (N more)" control reveals another
  page per click. A **visible** cap, never a silent truncation.
- The row is `memo()`-ised so the 30 s background poll does not re-render unchanged rows (TanStack
  Query structural-shares unchanged data → stable row identity).

Trimming the **payload** itself needs server-side `limit`/`cursor` pagination — backend follow-up
#1006. When it lands, "Show older" becomes a real `fetchNextPage` instead of revealing
already-downloaded rows.

### Figma → token / px mapping

Matches the `loans.index.tsx` precedent (raw Figma literals mapped to `--color-pipeline-*` tokens):

- Heading `font-display text-[64px] leading-[64px]`, `rgba(56,55,53,0.3)`.
- Card `bg-[--color-pipeline-surface] rounded-[4px] p-[32px]`.
- Header cells `14px` / ink-muted, `pb-[12px] px-[14px]`; the table draws borders **only** around
  the body box + inter-row separators (`LINE_COLOR` = `rgba(56,55,53,0.18)`, applied via inline
  `style` so it always paints regardless of Tailwind v4 utility ordering); the header row sits
  unbordered above the box.
- Body cells `16px`, `py-[20px] px-[14px]`: Time + Reference ink-muted, Action + scope `#262524`
  ink; Reference is monospace `14px`.
- Action + Loan/scope **wrap** (a deliberate deviation from the Figma's single-line `nowrap` cells):
  audit actions run long and must stay fully readable — never truncate served data.
- Caption `13px` / ink-muted, `leading-[18.2px]`, `pt-[16px]`.

## Cash Management — On/Off-ramp & T-Bills

**Sources:** `packages/trustee/src/routes/cash-management.tsx` (view — all three tabs +
`SwapDialog` / `TbillsSwapDialog`), `routes/-cash-management.ts` (On/Off-ramp presenter),
`routes/-cash-management-tbills.ts` (T-Bills swap presenter). Issue #943 (shell #943, extended
#944), Figma node `4116-11802` for styling. Source of truth:
`docs/product-specs/trustee-dashboard.md` (§Type 1 flow 2, §Type 4) + the working doc "Cash
management.md" — on mismatch the doc wins, Figma is styling only. (No Refunds tab — the working
doc has no such section.)

### On/Off-ramp tab

Two parts:

1. A **"New swap" button** opening the doc's swap form in a modal (`SwapDialog`, Transak-style) —
   off/on-ramp toggle, USDC amount + real on-chain balance (`useCapitalWalletBalance`), bank-wire
   method, ramp destination (`GET /v1/ramp/addresses`), and a 1:1 receive summary. This is a **UI
   shell**: off-ramp execution is a Capital-Wallet MPC 3-of-5 transfer with no backend endpoint yet
   (#781), and there is no ramp-quote endpoint, so submit is disabled and the fee shows `—` (never
   fabricated). USDC ↔ USD is 1:1, so "You receive" mirrors the amount — a disabled twin of the
   amount input.
2. The **review queue** below it — the pending ramp-boundary events (`GET /v1/ramp/events`, #936)
   the Trustee Approves/Rejects (`POST …/review`), which is what actually moves the on-chain
   state. Events are split by leg into **inbound** (`OnRamp`, ramp→custody) and **outbound**
   (`OffRamp`, custody→ramp), matching the Figma's INBOUND/OUTBOUND sections.

**Data-sourcing:** everything shown in the review queue is real — the served `RampEvent`
(id/type/to/from/amount/created_at). The Figma's richer per-loan tagging/batch grouping/progress
is not in the contract (#943) and is deliberately not fabricated.

### T-Bills tab (#944)

Same "New swap" modal UX as On/Off-ramp — a Buy/Sell USYC swap-form UI shell (`TbillsSwapDialog`).
Balances shown against the shared Capital Allocation section: **Buy** spends **USDC** — the real
on-chain Capital-Wallet balance; **Sell** spends **USYC** — the total T-Bills value at issuer NAV
(`useCapitalAllocation().buckets.tbills`), currently `null` → `—` (the bucket is hardcoded `None`
server-side, #931/#944). Buying/selling USYC is a Capital-Wallet MPC action (3-of-5, Type 2, flow
8) with no backend assembly/quote path yet (follow-up filed with #944) — submit is disabled, "You
receive" is a disabled twin of the amount input that stays empty (no USYC price/NAV served), and
the fee shows `—`.

## Cash Management — Withdrawal Queue

**Sources:** `packages/trustee/src/routes/cash-management.tsx` (view — the Withdrawal Queue tab +
`WithdrawalTopUpDialog`), `packages/trustee/src/routes/-cash-management-withdrawals.ts` (presenter),
`packages/trustee/src/api/useWithdrawalQueue.ts` (data hook).
**Behavior source:** the working doc `Cash management.md` §"Withdrawal queue". **Design:** Figma node
`4116-13974` (the top-up MPC dialog). On mismatch the **doc** wins; Figma is styling only.
Issue #945; the third tab of the Cash Management page (shell #943), alongside the On/Off-ramp and
T-Bills swap forms.

### Architecture

View/logic split per [`docs/FRONTEND.md` rule 2](../FRONTEND.md#code-structure-rules): the tab and
dialog are JSX-only and read `useWithdrawalQueueView`.

- `useWithdrawalQueue` (`api/`) — React Query hook over `GET /v1/withdrawal-queue`, 30 s poll. A
  self-contained hand-mirror of the backend shape (TD-42; the trustee app does not depend on
  `@pipeline/frontend`, whose `useWithdrawalQueue` reads the same endpoint). `in_queue_usd`/`amount`
  are base-6 decimal strings in human units — format with `@/utils/formatUsd`.
- `useWithdrawalQueueView` (`-cash-management-withdrawals.ts`) — presenter.

### Scope — visual-only shell (served vs. `—`)

Same "build the shell now, backend later" decision as the swap forms (#973/#983). Render **exactly
what is served**, never fabricated ([[no-frontend-computed-metrics]]):

- **Total claimable** (`in_queue_usd`, the doc's `totalClaimable`) and **request count**
  (`requests_count`) are served → shown.
- The doc also wants the **WithdrawalQueue wallet balance** (`USDC.balanceOf(WithdrawalQueueWallet)`),
  but the endpoint does not serve it → `walletBalanceDisplay = "—"`.
- **Top-up alert:** the doc shows it when `balance < totalClaimable + reserve`. Because the balance
  is unserved, that comparison can't be made — so `needsTopUp` is always `false` and the alert is
  **never fabricated** from missing data.
- The **top-up transfer** is a Capital-Wallet MPC action (3-of-5, Type 2, flow 9) with no backend
  path yet (#781) — the dialog's signature rows are static "not signed" and `Co-sign in MPC` is
  disabled. Coverage-after / oldest-pending have no served source → `—`.

Deferred backend (not blocking the UI): the WithdrawalQueue-wallet balance read + the Type-2
Capital-Wallet MPC assembly (#781).

### Figma → token / px mapping (top-up dialog, `4116-13974`)

Same design language as the sibling swap dialogs. Card `bg-white rounded-[6px] px-[30px] py-[28px]
w-[640px]`, `shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]`. Title Besley `26px/36.4px` `#262524`;
subtitle `14px` ink-muted. Summary rows `border-b LINE_COLOR pb-[13px] pt-[12px]`, label `15px`
ink-muted / value `16px` `#262524` right-aligned (Amount is a right-aligned input — the doc has the
Trustee specify it). Signature collection header `12px` uppercase `tracking-[0.96px]`; signer rows
a `9px` dot + name `15px` + optional `mandatory` chip + right-aligned "not signed" `13px`. Buttons
`h-[40px]`: Cancel white-bordered, Co-sign `BRAND` (disabled).

## Loan book & tables

**Sources:** `packages/trustee/src/api/useLoanBook.ts` (data hook),
`packages/trustee/src/routes/-useLoansTable.ts` (presenter),
`packages/trustee/src/routes/loans.index.tsx` (view).
**Consumer route:** `/loans`. Issue #843, Figma node `4116:9989`; CCR scale corrected by #888;
amount scaling fixed by #906.

### Architecture

View/logic split per [`docs/FRONTEND.md` rule 2](../FRONTEND.md#code-structure-rules): the `.tsx`
route is JSX/styling only; `useLoansTable` owns the `useLoanBook` call, the summary-card
view-model, the per-row mapping, CCR classification, and the client-side status filter — mirrors
`-useOriginationTable.ts`.

- `useLoanBook` (`api/`) — React Query hook over `GET /v1/loan-book`, Stellar-scoped `chain_id`,
  30 s poll. A self-contained hand-mirror of the backend shape
  (`packages/api/src/routes/loan_book.rs`, post-#833/#834) — TD-42 convention, a fourth
  hand-mirroring pair alongside the existing trustee/LP ones (see
  `docs/exec-plans/tech-debt-tracker.md`); the trustee app deliberately does not depend on
  `@pipeline/frontend` (epic #775 keeps the two apps separate). The LP frontend's own
  `packages/frontend/src/api/useLoanBook.ts` predates the Trustee-only summary fields below and is
  **not** extended with them — only this trustee copy carries them.
- `useLoansTable` (`routes/`) — presenter.

### Data scale — registry-sourced amounts served as-is (#906)

`deployed_senior`, `at_risk_wl_and_default_senior`, per-loan `senior_outstanding`/`principal`, and
`collateral`/`total_collateral` are **registry-sourced** base-6 decimal strings, already in human
units (e.g. `"1200000.000000"` = $1.2M). The former ×1000 workaround
(`scaleRegistryAmount`/`formatRegistryCompactUsd`/`formatRegistryCompact2dpUsd`, issue #840) has
been removed (#906) — render via plain `formatCompactUsd`/`formatCompactUsd2dp`.

`ccr_bps` and `ltv` both divide two registry-sourced amounts at the same scale, so the ×1000
cancels out of the ratio regardless — served **already correct**, never scale or divide them
frontend-side. `at_risk_wl_and_default_pct` mixes a registry-scaled numerator with a
correct-scale NAV denominator; rendered as served (no frontend correction is defined for it).

### Resolved Open Questions (#843, corrected by #888)

1. **CCR is used AS SERVED — no ÷1000 correction.** #843 originally assumed `collateral` was
   price-feed correct-scale while `senior_outstanding` was registry-sourced (1000× too small,
   #840), which would make the served `ccr_bps` exactly 1000× too big. A live payload (#888)
   disproved that: `collateral` is **also** registry-sourced, on the same scale as
   `senior_outstanding` — so the ×1000 cancels out of the ratio and the served `ccr_bps` is
   already the true CCR. The former `correctCcrBps` ÷1000 helper (which silently rendered CCR
   1000× too small — e.g. 0.21% instead of the true 209.87%) has been removed. The 120%
   maintenance-margin pre-default threshold applies directly to the served `ccr_bps`.
2. **Default & Closed tabs render per Figma but stay empty.** `/v1/loan-book` returns only the
   active set (Performing + WatchList); defaulted/closed loans are excluded backend-side, so
   client-side filtering yields 0 rows for those tabs. A backend follow-up is needed to serve them.
3. **The "Payments due" banner + "Record coupon" action are omitted** from this page — no
   `/v1/loan-book` data source (never fabricate).

### Never-fabricate defaults (exec-plan RISK 3)

Figma details with no backend field are dropped, not invented:

- Spot sub-line: the real 7-day change basis (`spot_change_7d`) only — no `/t` per-tonne unit, no
  "30d" relabel. `formatSpot` renders `$4,500 · −18% 7d`.
- Stage cell: the served `status` label only — no "· Risk Council" / "· feed stale" qualifier.
- CCR staleness: the age derived from `ccr_reported_at` only (`1h` / `26h`) — no "feed stale"
  label (its cutoff is not served).

Every field is read defensively → `—`, never fabricated.

### CCR classification & tab mapping

- **CCR bands** (4-level, trustee-risk-watchlist.md §CCR color bands, #939): `≥130%` healthy
  (green) · `120–130%` attention (yellow) · `110–120%` margin-call (orange) · `<110%` pre-default
  (red). Thresholds are frontend-owned policy constants (no backend flag — resolved decision #2 /
  #931): `MAINTENANCE_MARGIN_BPS = 12_000` (120%), `HEALTHY_MARGIN_BPS = 13_000` (130%),
  `HARD_MARGIN_CALL_BPS = 11_000` (110%). `null` CCR → `null` band (neutral render, no flag);
  staleness/age is handled separately from the band.
- **Tab → status mapping:** the backend serves `"WatchList"` (capital L); the tab reads
  `"Watchlist"` (Figma casing). **Performing** also includes **`"Disbursing"`** — a
  backend-derived, Performing-family display status (off-ramp not yet complete, #862) — so
  freshly-drawn loans surface there instead of vanishing from every tab. **Watchlist** groups the
  at-risk set: WatchList plus past-maturity loans (served `"Past Due"`, legacy `"Matured"`) —
  otherwise a matured loan would match no tab and disappear from the list (#867).
- **Nearest payment** (#941/#953): `next_payment_timestamp` is the rollover-aware maturity (for
  today's bullet loans this equals the current maturity, but it's a distinct field so the
  schedule can diverge later without a breaking change). Server-computed `days_overdue` non-null
  → "N days late" / "Due today"; otherwise the payment date; missing/zero timestamp → `—`.
- **Top concentration:** `CONCENTRATION_LIMIT_PCT = 10` is a frontend-owned policy limit (per the
  backend doc: "the policy limit is frontend-owned"), paired with the served
  `top_concentration.share`.

### Figma → token / px mapping (Loans page, `4116:9989`)

Follows the Origination-page precedent (raw literals mapped to `--color-pipeline-*` tokens,
one-offs documented):

- Heading `font-display text-[64px] leading-[64px]`, `rgba(56,55,53,0.3)` (ink-subtle, exact) —
  identical to the Origination h1.
- Summary card `bg-white`, `LINE_COLOR` border (`rgba(56,55,53,0.18)`), `rounded-[4px]
  px-[21px] py-[19px]`. Label `Inter 12.5px` ink-muted; value `Besley 26px` ink; sub `Inter
  12.5px` ink-muted, `pt-[6px]`.
- CCR band colors: healthy → `--color-pipeline-positive-primary` (`#208000`, token);
  attention/yellow → `ATTENTION_AMBER` `#6e6400` (one-off); margin-call/orange →
  `MARGIN_CALL_ORANGE` `#b35900` (one-off — a hue the prior 3-band scheme lacked, between the
  yellow and red); pre-default/red → `NEGATIVE_RED` `#b20000`, a documented one-off (**not**
  `--color-pipeline-negative` `#c0392b`) that matches the Figma exactly, same precedent as the
  Origination pills' alpha one-offs — also used for the At-risk headline value and negative spot.
- Tab-bar `bg rgba(191,189,187,0.12)`, `LINE_COLOR` border, `p-[4px] gap-[2px] rounded-[4px]`;
  buttons `px-[16px] py-[9px] gap-[8px]`; active `bg-white` + ink text, inactive ink-muted; count
  `14px` ink-muted.
- Table card `bg-white pt-[36px] pb-[32px] px-[32px] rounded-[4px]`. Header cells `Inter 14px`
  ink-muted, `pb-[12px] px-[14px]` (reuses the Origination `HEADER_CELL_CLASS` convention); the
  table draws borders **only** around the body box + inter-row separators (`LINE_COLOR`), no
  column dividers — the header row sits unbordered above the box (Origination precedent). Body
  cells `Inter 16px` `#262524`; originator semibold; stage + chevron ink-muted; CCR `Bold 16.5px`;
  spot/age subs `12–12.5px` ink-muted.
- Senior outst. + Collateral render two-decimal compact (`formatCompactUsd2dp`). Senior outst. is
  a deliberate deviation from the Figma (which shows full dollars `$1,840,000`) — the two amount
  columns were unified to the same 2-dp compact style during live review.
- Footnote (Figma node `4116:10111`) `Inter 13px` ink-muted, `leading-[18.2px]`, coloured band
  spans for the 4-level scheme (#939).

## Loan detail

**Sources:** `packages/trustee/src/routes/-useLoanDetail.ts` (presenter),
`packages/trustee/src/routes/loans.$id.tsx` (view), `routes/-loanDetailStatic.ts` (static action
config), `routes/-CcrTrendChart.tsx` (shared chart).
**Consumer route:** `/loans/$id`. Issues #845/#847, Figma node `4116:10549`.

### Architecture

View/logic split per rule 2: `useLoanDetail` owns the live fetches, the value→display mapping,
and the composition of live data + static actions, so the builders are unit-testable without a
DOM (mirrors `-useLoansTable.ts`).

**Data sources:**

- **Hero identity** ← the matching `/v1/loan-book` row (originator, commodity, on-chain status),
  keyed by `loan_id`. The status bar carries no dates (maturity is a key number, not a status
  field — design assignment §S5); the chip maps the raw on-chain status via `statusToChip` (§3.2).
- **Price & collateral** ← `GET /v1/loan-book/{loan_id}/valuations` (`useLoanValuation`).
- **Loan-lifecycle stepper** ← derived from the on-chain status (`buildLifecycle`); no longer a
  static fixture (design assignment §3.2).
- **Registry state & derived** ← `GET /v1/loan-book/{loan_id}/financials` (`useLoanFinancials`,
  #852), plus the loan-book row's `protection` for the Protection row (#1014).
- **Summary tiles** ← the matching `/v1/loan-book` row plus `/financials` for unminted
  yield / epoch APY (#874).
- **Documents** ← the matching `/v1/loan-book` row's `documents` array (#1040) — see
  [Documents](#documents).
- **Action availability / explanatory copy** ← static product configuration in
  `-loanDetailStatic.ts`.

### Never-fabricate ([[no-frontend-computed-metrics]])

The valuation endpoint drives Price & Collateral directly; fields it does not serve are not
carried over from the old fixture:

- the "feed 2h old · recalcs every 60 min" freshness note → replaced by the real `price_provider`
  attribution (or dropped when absent);
- the "Last on-chain write: CCR 135% · 12 May" footnote → dropped (no source);
- absent inputs surface as `—` plus a real `missing_inputs` "Awaiting:" note.

The one cross-source value is the spot 7-day change, taken from the loan-book row's served
`spot_change_7d` (same underlying price series as the valuation's `reference_price`) — a served
field, not a derived one.

### Status chip mapping (design assignment §3.2)

`statusToChip` maps the raw on-chain status to a display chip + colour band:

| on-chain status | chip label | band |
|---|---|---|
| `Performing` | Performing | positive |
| `Disbursing` | Disbursing | info (brand) |
| `Watchlist` / `WatchList` | Watchlist | attention |
| `Past Due` / `Matured` (legacy) | Matured | attention |
| `Default` | Default | negative |
| `Closed` | Closed | neutral |
| unknown | raw string verbatim | neutral |

`Disbursing` (a Performing loan whose outbound disbursement has not reached "Wired") is a
data-derived divergence that needs movement state not served to this page, so a Performing loan
simply renders "Performing" — the `Disbursing` case only fires from the explicit backend status.
Past-maturity loans: the backend serves `Past Due`, but the design renders this state as
**Matured** (chip + dedicated screen + rollover, #866/#867); the legacy `Matured` value maps the
same.

### Loan-lifecycle stepper (design assignment §3.2 status diagram)

`buildLifecycle` builds the stepper's happy-path spine — `Origination → Disbursing → (live) →
Closed` — **not** a linear list of every status. Watchlist / Past Due / Default are branch flows
off the live state, not sequential stages, so they are never shown as "upcoming" steps (#854): a
healthy Performing loan's only forward step is **Closed**.

The middle **live node** reflects where the loan actually is: while live it takes the current
status label (`Performing` / `Watchlist` / `Past Due` / `Default`, via `statusToChip`); once
`Closed` it reads as the completed `Performing` phase (there is no stored prior live status, so a
specific risk state is never fabricated for the label). Step states:

- `Origination` — done for any loan the loan-book returns (it exists on-chain).
- `Disbursing` — **active** when the served status is `Disbursing` (off-ramp not yet complete,
  #862); done once the loan is live/closed; pending when no status. (Now that the backend serves
  `Disbursing` directly, this step can be the current one — closes the #854 data gap.)
- live node — active while the loan is a live non-Disbursing status; done once Closed; pending
  while still Disbursing.
- `Closed` — active when the status is `Closed`, else pending.

An absent status (no loan-book row) leaves every step pending — never fabricated.

### Hero

Degrades to the loan id only when no matching loan-book row is found (e.g. a direct URL to a
non-active loan) — identity is never fabricated. The meta line prints the loan id + the
**maturity date** (both layouts, #859; a real served field, `entry.maturity`) plus the
**Nearest payment** clause (#941/#953): "next payment `<date>`" when upcoming, or "payment N days
late" / "payment due today" when overdue — dropped entirely when no next-payment timestamp is
served. The Figma hero corridor (`Colombia → Italy`) has no backend source and is omitted.

### Price & collateral card

`useLoanValuation` — `GET /v1/loan-book/{loan_id}/valuations`, Stellar-scoped, 30 s poll; a
self-contained port of the backend DTO (`packages/api/src/routes/collateral_valuation.rs`) — a
fifth TD-42 hand-mirroring pair. This endpoint recomputes collateral value and CCR in **plain
USD**, so its money fields (`collateral_value`, `ccr.collateral_value`,
`ccr.outstanding_senior_principal`) are correct-scale decimal strings — displayed as served, via
plain `formatCompactUsd` (no rescaling, project-wide since #906). `inputs.haircut_pct` is a
fraction in `[0,1]`; `ccr.ccr_pct` is a percent string (`"178.00"`). `PenaltyInput`'s
`level_pct`/`threshold_pct`/`step_pct` are percent-normalised by the backend (#966) — always
percent regardless of whether the tier was authored in percent or ppm (a `10` ppm tier echoes as
`0.001`, not `10`) — not currently surfaced anywhere in the Console (#986: no penalty display, no
offtake-authoring form yet); this documents the contract for when they are.

Its own load/error/ready/**empty** state, independent of the page-level `state`. A 404 from the
valuations endpoint means the loan has no valuation anchor on record — rendered as a neutral
`"empty"` note (`"No valuation on record for this loan."`), never a red error. Rows: Quantity,
Collateral value (+ haircut clause when a haircut fraction is served), Senior outstanding, CCR —
each independently `—` when its input is absent. The spot line pairs the valuation's
`reference_price` with the loan-book row's `spot_change_7d`.

### Registry state & derived (#852)

`useLoanFinancials` — `GET /v1/loan-book/{loan_id}/financials`, Stellar-scoped, 30 s poll; a
self-contained port of the backend DTO (`packages/api/src/routes/loan_financials.rs`) — a sixth
TD-42 hand-mirroring pair. Money fields display exactly as served, via plain `formatCompactUsd`
(no rescaling, project-wide since #906). `Epochs` formats as `"1 · 10.0% · 18 Jun 2026 → 19 Aug 2029"`
(number · APY · start → maturity); `—` when no epoch is on record (#857). `Custodian co-sig on
mint` has no field on `/financials` yet, so it renders `—` pending clarification (#852 open
question c) — never fabricated. `Unminted yield` (`not_minted_yield`) is shown as a single figure
(no vault/treasury split — open question b). `Protection` is the deal-level trade-finance
protection instrument (#1014), served on the loan-book row (relayer DB, from the submission
payload — never on-chain). A 404 from `/financials` renders a neutral `"empty"` note, mirroring
Price & Collateral.

### Summary tiles

Three tiles, built entirely from served backend fields (no static fixture):

- **Facility / disbursed** (performing/watchlist/disbursing) or **Facility / senior** (matured) —
  `entry.principal` paired with the disbursed amount or `original_senior_tranche`.
- **Repaid to date** — `entry.repaid_to_date`, sub "offtaker received".
- Variant-specific third tile: **watchlist** → "Days on watchlist"; **matured** → "Rate · epochs"
  (from `/financials`); otherwise → "Interest to distribute" (`not_minted_yield`).

### Status-conditional layout (#859/#862/#866)

The page branches on `detail.variant` (derived from the served display status):

- **performing** — lifecycle stepper + Price & collateral + Registry state.
- **watchlist** — no stepper; a CCR-trend chart beside Price & collateral, a "Days on watchlist"
  tile, and an escalation current-stage card (Figma node `4116:10803`).
- **disbursing** — the performing layout, but the current-stage card is the wired
  disbursement-complete action (`POST …/disbursement/complete`, #862); the lifecycle shows the
  Disbursing node active.
- **matured** — no stepper; a rollover card beside Price & collateral, the hero shows `<date> —
  passed`, and Roll over is the matured-only fast-path (Figma node `4116:10969`, #866). The served
  `Past Due` status maps here.

Shared live sections render in every variant: Hero + status chip (loan-book row), Price &
collateral (`/valuations`), Registry (`/financials`, performing only), and Documents
(loan-book row, #1040 — see [Documents](#documents)). Watchlist CCR trend and summary tiles are
live; action labels and explanatory copy are static product configuration unless a branch opens
a wired flow.

**Current-stage card is hidden for now (#938):** its real behavior is proposal-aware — a plain
"decision pending" title only once a Risk-Council proposal is submitted for the loan, otherwise a
warning + prompt to open an escalation — which needs a per-loan proposal-status feed the backend
doesn't serve yet. The static `WATCHLIST_CURRENT_STAGE` mock is not rendered until that lands; the
Performing "on-ramp in transit" card was removed entirely (#876). `currentStage` is `null` for
every variant today.

### CCR-trend chart (Watchlist variant, Figma node `4116:10868`)

Built from the real `/ccr-history` series (#879) — replaces the fixed-geometry fixture (#859).
`null` when the series has no points (never priced / empty window) so the card is simply omitted
rather than drawing a fabricated line. The series spans the loan's origination
(`maturity − duration_days`) through now, daily. Per-loan y-scale spans the series' CCR range
widened to the protocol watchlist thresholds (spec §9.6) — 120% maintenance-margin and 110%
margin-call dashed guide-lines (protocol-wide defaults; no endpoint serves per-loan overrides yet,
#879). The card is extracted to `-CcrTrendChart.tsx` (#782) so the Risk Council "Escalate to
Default" page can reuse the same chart embedded directly in its ledger card (without this card's
own border/title).

### Wired actions

- **Disbursement complete** (Disbursing variant, #862/#864) — `Complete off-ramp` is the one real,
  status-changing action on this card: `POST …/disbursement/complete` flips the loan out of
  `Disbursing` and refetches. Disbursing has no dedicated Figma flow, so the page keeps the
  Performing layout and only this "Next Step" card differs. The confirmation modal mirrors the
  shared dialog shell (`-RejectReasonDialog.tsx`): `role="dialog"`, `aria-modal`, Escape +
  backdrop-click cancel (never a stray confirm), navy confirm button; pending disables both
  buttons and a failure (404 = loan not indexed) surfaces inline.
- **Roll over** (Matured variant, S9, Figma node `4116:14050`, #870) — collects the new rate (bps)
  + new maturity, then submits the on-chain `LoanRegistry.rollover` via `useRollover`. The
  mint-ceiling delta is **not** previewed with a figure — the real ceiling change is computed
  on-chain at rollover, avoiding a fabricated transaction-effect number.
- **Update lifecycle** (S10, Figma node `4116:14087`, #872) — collects the non-economic mutable
  fields (status, CCR %, location, optional metadata URI), then submits the on-chain
  `LoanRegistry.updateMutable` via `useUpdateLifecycle`. Default/Closed are not offered (they route
  to the Risk Council / close flows); Past Due/Matured are derived, not settable here.
- **Past-Due attention notice** (#940) — a past-maturity loan renders under the Matured variant;
  its derived `Past Due` status is an attention signal, not a lock — per the backend, it exists
  "to draw the Trustee's attention that they either need to record the payment or escalate to
  default." The banner surfaces both paths directly (Record payment / Escalate to default), wired
  to the existing actions. Amber (attention) tokens — not red, which is reserved for Default.

### Figma → token / px mapping (`4116:10549`)

- `‹ Loans` `Besley 18px` `#262524`; title `Besley 44px`; both ink.
- Status chip → colour band (`chipStyle`): positive green (0.08 bg / 0.3 border), attention amber
  `#6e6400`, negative red `#b20000`, info brand navy `#000080`, neutral muted.
- Card `bg-white`, `LINE_COLOR` border (`rgba(56,55,53,0.18)`), `rounded-[4px]`. Card title
  `Besley 26px` ink; row label `Inter 15px` ink-muted; value `Inter 16px` ink.
- Lifecycle stepper (Figma node `4116:10560`): done ✓ green `#208000`
  (`--color-pipeline-positive-primary`) tint fill `rgba(32,128,0,0.08)` + 30%-green border (also
  colours the filled connector line); active filled navy `#000080` (`--color-pipeline-brand`) with
  a 12%-brand ring glow; pending muted ring.
- Primary button `#000080` white text (`--color-pipeline-brand`).
- Sub-line tones: positive green `#208000`; attention amber `#6e6400` (one-off); negative
  `#b20000` (one-off, ≠ `--color-pipeline-negative`); muted ink-muted.

### Documents

**Sources:** `packages/trustee/src/api/useLoanBook.ts` (`LoanBookEntry.documents`),
`packages/trustee/src/routes/-useLoanDetail.ts` (`buildDocuments`, `DocumentDisplay`),
`packages/trustee/src/routes/loans.$id.tsx` (`DocumentsCard`),
`packages/trustee/src/components/DocumentIcon.tsx`. Issue #1039.

The loan detail page renders a Documents section on **every** loan, regardless of lifecycle status.

- **Source.** The matching `GET /v1/loan-book` row's `documents` array —
  indexer-sourced from the loan's on-chain IPFS metadata document
  (`LoanMetadataJson.documents` → `LoanSnapshot.documents`), not the submissions payload. The
  submissions endpoint is deliberately **not** consulted: although a real join key exists
  (`SubmissionView.loan_id` matches `LoanBookEntry.loan_id`), reading `documents` off the
  loan-book row the page already fetches is strictly better — one fetch instead of two, no
  cross-endpoint consistency window, correct for loans whose submission row is absent, and
  sourced from the loan's *live* indexed metadata rather than the frozen submitted payload.
- **Placement.** Directly before the Other-actions section, in every §S5 status variant
  (performing, watchlist, disbursing, matured). The section **always renders**; only its
  contents vary — never hidden, never gated on `documents.length`.
- **Rendering.** Reuses the Origination detail page's documents-list markup verbatim
  (`DealDetailsCard` in `origination.$id.tsx`): a filled navy `DocumentIcon` in a 32px tinted
  square, the document name as a dashed-underline link, opening `uri` in a new tab
  (`target="_blank" rel="noopener noreferrer"`). A document with an empty `uri` renders inert
  (`aria-disabled`, no pointer events, no `href`) rather than a dead link. The zero-document
  empty state reads "No documents provided." The card *chrome* (26px `CardTitle`) follows the
  loan-detail page's own idiom rather than origination's 28px heading — the one deliberate
  divergence from the "reuse verbatim" rule.
- **Never-fabricate.** Served order is preserved; no filtering, sorting, deduping, or synthesized
  names. Loans whose snapshot was indexed before commit `f73d54d` (which introduced the
  `documents` field) legitimately show the empty state until re-indexed — see the known-bugs
  entry for the remedy.
- **Deferral.** The v3 design assignment (`docs/design-docs/trustee-dashboard-v3-design-assignment.md`
  §S5) places Documents in a tab strip (Ledger / Terms / Movements / Documents / Location /
  Activity) that this page does not implement — the card above is the author-approved interim
  until that larger tab-strip migration lands (tracked in the tech-debt tracker).

## Cash movement & lifecycle actions

**Sources:** `packages/trustee/src/routes/-record-coupon.ts` +
`routes/loans.$id_.record-coupon.tsx` (Record Coupon, issue #882, Figma node `4116-11452`);
`routes/-record-repayment.ts` + `routes/loans.$id_.record-repayment.tsx` (Record Repayment —
Principal, issue #884, Figma node `4116-11621`, the principal-repayment sibling of Record Coupon).

### Architecture

View/logic split per rule 2 (mirrors `-useLoanDetail.ts`'s split). `-record-repayment.ts`
**deliberately duplicates** several of `-record-coupon.ts`'s pure helpers (parse/scale
conversions, terminal-repayment detection, the coupon/final period computation) rather than
importing them — each `loans.$id_.*` route is a self-contained presenter (mirrors the project's
existing per-route hand-mirroring convention, e.g. TD-42's trustee/LP pairs), so the two flows can
diverge independently as either evolves.

### Record Coupon — scope (#882, read/UI only at introduction)

Previews the payment waterfall for a trustee-entered offtaker coupon via `useLoanWaterfall` (`GET
/v1/loan-book/{loan_id}/waterfall`). At introduction it did not perform the on-chain
`record_payment` write — that mutation (`useRecordPayment`) was deferred, so there was no
submit/confirm action, only the live preview.

### Scale handling (both flows; verified against `-useLoanDetail.ts` / `useLoanWaterfall.ts`)

- The `/waterfall` `amount` param and all response fields (`senior_principal_returned`,
  `senior_coupon_net`, `management_fee`, `performance_fee`, `oet_allocation`) are **raw base units
  at 7-decimal USDC (Stellar SAC) scale**. `usdToBaseUnits` multiplies the entered USD amount by
  10^7 before calling the endpoint; `baseUnitsToUsd` divides backend response fields by 10^7 for
  display. The `recordPayment` payload uses backend raw fields unchanged.
- `senior_outstanding` (`useLoanBook`) / `offtaker_outstanding` (`useLoanFinancials`) are
  displayed **exactly as the backend serves them** — no client-side rescaling (issue #906; the
  former ×1000 `scaleRegistryAmount` workaround has been removed).
- `Gross interest` is derived as `senior_coupon_net + management_fee + performance_fee` (summed in
  base units via `BigInt` — no float drift — then converted once to USD) — the interest before the
  fee carve-outs, not a separately-served field.
- The green summary's `"Components sum to received $<amount>"` prints the **entered** USD amount,
  not a re-derived sum of the five/six components (the waterfall has no equity field, so the
  components alone do not sum to the offtaker amount without the residual — see below).

### Record Coupon — interest-only, context-dependent third row

- The left card's third row is context-dependent (`hasCouponDue`): a simply-performing loan with
  no upcoming/past-due payment shows the backend-served **"Offtaker still owed after coupon"**
  (`offtaker_outstanding − entered`); otherwise it shows the **"Scheduled coupon"** — a
  **client-side projection** (`current_apy_bps × senior_outstanding × (days / 365)`,
  `computeScheduledCoupon`; the backend serves no scheduled-coupon figure), shown for reference
  only and never recorded on the ledger.
- This is the **interest-only coupon** flow: `buildRepaymentInput` always sets
  `senior_principal_repaid = "0"` (principal stays deployed), regardless of the waterfall's own
  `senior_principal_returned` (a principal-first `min(amount, outstanding)` figure, irrelevant to
  a coupon). Interest + fee carve-outs map 1:1; `equity_distributed` is the residual after
  interest + fees so the six components sum exactly to `offtaker_received` (clamped at 0 — never
  negative).
- **Terminal-close detection:** the Figma's "Next stage: principal repayment →" button is
  suppressed everywhere except the terminal case — when this coupon fully amortises the
  outstanding senior principal (`isTerminalRepayment`): the entered amount covers (≥) the loan's
  outstanding senior AND the waterfall's own `senior_principal_returned` equals it exactly (to the
  cent, guarding float drift from the two independent unit conversions). Otherwise no hint renders
  at all — this is an interest-only coupon page by default.

### Record Repayment — Principal (#884) — key difference from Record Coupon

This is a **principal repayment**: the waterfall's real `senior_principal_returned` is displayed
AND carried into `senior_principal_repaid` verbatim (the coupon flow forces it to `"0"`). Equity is
the residual after all five carve-outs (principal + interest + fees) — clamped at 0, never
negative — so the six components still sum exactly to `offtaker_received`. The amount input is
prefilled (one-shot, then read-only) to the full remaining `offtaker_outstanding` once financials
load — a principal repayment always pays it all; there are no partial principal repayments.

Once the loan is fully repaid, the page also exposes a **Close loan** action (`useCloseLoan`) that
moves the loan to `Closed`.

**Offtaker fully paid (#1090):** when the financials' `offtaker_outstanding` is `0` — the offtaker
owes nothing, e.g. the final coupon was recorded in the sibling flow — there is nothing left to
record. The presenter's `offtakerFullyPaid` collapses the entered amount (including a stale
pre-refetch prefill), keeps the waterfall query disabled, and forces `recordPaymentInput` to
`null`; the page replaces the amount/date fields, waterfall, and Record action with a fully-repaid
notice ("nothing left to record"). The state must hold **without a reload** — a refetch that
brings owed to `0` mid-session drops the stale form rather than leaving a recordable amount on
screen. It is suppressed while this page's own `record_payment` is pending/settled so the
"Payment recorded" confirmation flow stays intact. Whether Close-loan enables is decided by the
close checklist below, not by this state alone.

### Close-loan gating — the close checklist (#1090, supersedes the #884 gate)

The Close-loan action always renders as the full-width "Next step — close loan" item, above a
three-item checklist (`closeChecklist` on the presenter). The button enables only when **every**
item is green:

1. **Senior principal outstanding is zero** — hard gate. Green when the loan-book's
   `senior_outstanding` is `0`, or when this page's own `record_payment` write has just succeeded
   (`record.isSuccess` — the terminal principal payment zeroes it; the loan-book refetch lags the
   indexer). The unmet row shows the current outstanding amount.
2. **Nothing left to mint on either leg** — hard gate, **no manual override**. Green when the
   financials' `not_minted_yield` is `0` (the aggregate covers both mint legs — no per-leg field
   is served). After recording a final payment this stays red until the relayer mints the
   recorded yield; the unmet row shows the unminted amount.
3. **Remaining offtaker balance acknowledged** — auto-green when the received cash covers the
   contracted price (`offtaker_outstanding` is `0`). Otherwise (early payoff or waiver) the row
   renders a checkbox the trustee ticks manually; the tick is page-local and does not persist a
   reload.

`closureReason` picks `"ScheduledMaturity"` when `now >= maturity` (the loan-book's
rollover-aware `maturity`), else `"EarlyRepayment"`. The former `isTerminalRepayment` /
`alreadyRepaid` / `showCloseLoan` gate (#884) is removed from this flow — the checklist is the
single source of enablement. The full S15 benign close-loan checklist screen remains tracked in
#982; this checklist is its gating core, embedded on the Record Repayment page.

### Route registration & page shell

Both flows are full-screen pages, not modals, so each lives at its own route rather than inside
`loans.$id.tsx`: opened from the existing "Record coupon" / "Close loan" other-actions on the loan
detail page. Each is registered as a **non-nested** child of the `/loans` layout (`loans.tsx`'s
`<Outlet/>`) via the `$id_` trailing-underscore file-name escape — `loans.$id.tsx` is a leaf page
with no `<Outlet/>` of its own, so a plain `loans.$id.record-coupon.tsx` would try to nest under it
and fail to register (same class of issue `loans.tsx`'s own doc comment describes for `/loans/$id`
itself). Per `docs/FRONTEND.md` rule 2, each `.tsx` is JSX/styling only; all data wiring lives in
the colocated `-record-*.ts` view-model hook (mirrors `origination.$id.tsx` /
`-origination-detail.ts`).

The "Close loan" other-action does **not** close the loan directly — it opens the Record Repayment
page, where the trustee records the final principal repayment and only then closes the loan
(`useCloseLoan`, `close_loan`, with the resolved `ClosureReason`), navigating back to the loan
detail page on success.

**Chips (never-fabricate):** only the static "Your key · no cash moves" copy chip renders on
either page. The Figma's "Recorded · 31 Mar" / "Minted · 2 Apr" progress chips are omitted
entirely — no backend source ever marks a coupon/repayment "recorded"/"minted" in this session, so
they would be fabricated.

**Suppressed "Next stage: principal repayment" button** (Record Coupon only): per the issue's
explicit scope note, the Figma's button is never rendered. In its place, `view.isTerminal` gates a
plain text hint — only in the terminal case (see Terminal-close detection above). Every other
coupon (the common interest-only case) shows no principal-repayment copy at all.

### Waterfall error mapping (#916)

`mapWaterfallError` never surfaces the raw backend message or numbers. The backend's extended
waterfall validates the amount against the loan's terms and returns a client error (4xx) when it
doesn't fit (e.g. an amount too large for the loan's interest rate / outstanding) — mapped to
"This amount is too high for this loan. Enter a smaller amount." Anything else gets a generic
retry message. The date input is fixed to today and not editable (#916) — no calendar/date picker.

## Origination & review

**Sources:** `packages/trustee/src/api/useLoanSubmissions.ts` (data hook),
`routes/-useOriginationTable.ts` + `routes/origination.index.tsx` (submissions table, issue #813,
Figma node `4116:9155`), `routes/-origination-detail.ts` + `routes/origination.$id.tsx`
(details/review page, issue #821, Figma node `4116:9292`, supersedes closed #816),
`routes/-useOriginationReview.ts` + `api/useReviewSubmission.ts` (Approve/Reject/Request-changes
orchestration), `routes/-ApproveMintDialog.tsx` / `-RejectReasonDialog.tsx` /
`-RequestChangesDialog.tsx` / `-useRejectReasonDialog.ts` (confirmation dialogs).

### Architecture

View/logic split per rule 2, mirrored across both pages: `useLoanSubmissions` (data) →
`useOriginationTable` / `useOriginationDetail` (presenter, value→display mapping) → `.tsx`
(JSX-only). Review actions live in a third layer, `useOriginationReview`, composing
`useReviewSubmission` (DB decision) and `useDrawLoan` (on-chain mint) so the `.tsx` stays a pure
render function.

### Data layer (`useLoanSubmissions`)

`GET /v1/loan-book/submissions`, Stellar-scoped `chain_id`, 30 s poll — mirrors the LP frontend's
`useLoanSubmissions` conventions and the trustee's own `useCapitalAllocation.ts`. The trustee app
does not depend on `@pipeline/frontend` (epic #775), so the types are a self-contained port
(TD-42). Optional server-side `status` filter (#818) is included in the query key so filtered and
unfiltered variants cache independently.

`loan_data` is the verbatim submitted payload (`serde_json::Value` on the wire — declared as
`SubmitLoanRequest` for convenience but not guaranteed to match at runtime), returned as a nested
JSON object, not a JSON-encoded string. Its four monetary fields (`economics.
original_facility_size` / `original_senior_tranche` / `original_equity_tranche` /
`original_offtaker_price`) are served at the on-chain **7-decimal (10^7) base-unit scale** (e.g.
`"8000000000.000000"` = 8,000,000,000 base units = $800.00) — not human-unit dollars (#912).
Display consumers normalize ÷10^7 (BigInt-safe — never `Number`/`parseFloat` on the raw string)
via `economicsBaseUnitsToUsdDecimal` (`@/utils/stellarSacUnits`) before `formatFullUsd`/
`formatCompactUsd`. The `draw_loan` on-chain write sends these fields to the contract exactly as
served, with no re-scaling. Every nested field access must be defensive — missing/malformed values
render `—`, never fabricated.

**Status normalization (#892/#949/#950):** `normalizeOriginationSubmissionStatus` maps the
backend's merged submission/loan-lifecycle status into the Origination UI vocabulary. Once a
submission reports a loan-lifecycle status (`Performing`, `WatchList`, `Past Due`, `Default`,
`Closed`), the origination decision is already complete, so Origination displays it as
`Approved` — Origination keeps only the decision vocabulary. `ChangesRequested` is a genuine
**pre-decision** outcome (backend #949) — non-final, the submission stays open for the originator
to resubmit — so it is preserved, not folded into `Approved` (#950).

### Origination table (`/origination`, issue #813)

Columns: Originator · Commodity · Facility · Corridor · Rate · Maturity · Submitted ·
Status/action.

**Row set (#1056):** the table lists **all** submissions, newest first — `Approved` rows
(including backend merged/lifecycle statuses, which normalize to `Approved` per #892) render
with the green "Approved · `<date>`" chip alongside `InReview` / `ChangesRequested` / `Rejected`.
This reverses the short-lived #1044 in-flight filter: the approval history stays visible on the
origination surface, while the resulting loan also lives on the Loans surfaces.

- **Originator** ← `loan_data.originator` (the name as submitted), **not**
  `SubmissionView.originator` (the authenticated-submitter address) — distinct sources.
- **Commodity** ← `loan_data.commodity`. The Figma's valuation sub-line ("NSR · Net Smelter
  Return" / "Standard · price × quantity") is **omitted entirely** — no field in
  `loan_data`/`SubmissionView` carries a valuation mode for pre-mint submissions (`ValuationMode`
  lives in `loan_collateral_valuations`, keyed by an on-chain `loan_id` submissions don't have
  yet); resolved (human, #813 comment): do not infer it from the commodity name.
- **Facility** ← `economics.original_facility_size`, normalized ÷10^7 then `formatCompactUsd`
  (compact, e.g. `"$3.5M"` — switched from fully-expanded `"$3,500,000"` by #1015 to reclaim
  column width).
- **Corridor** ← `loan_data.corridor`, hyphen rendered as the Figma arrow glyph ("PE-CN" →
  "PE → CN").
- **Rate** ← `economics.senior_interest_rate_bps` via `formatBpsRate`. **Maturity** ←
  `economics.original_maturity_date` via `formatMaturityDate`. **Submitted** ←
  `SubmissionView.created_at` (RFC 3339) via `formatSubmittedDate`.
- **Status/action** (8th column, resolved human #813 comment, copy amended by #829):
  `Approved` → green "Approved · `<date>`" pill (deliberately **not** "Approved & minted" —
  #831's real on-chain mint ships later, and this compact pill stays short; "& minted" is
  restored only on the `/origination/$id` detail banner). `InReview` → a "Review" control
  navigating to `/origination/$id` (#821), passing the row's `SubmissionView` as router state.
  `Rejected` → red pill, `reason` on hover. `ChangesRequested` → sweet-orange "Changes requested"
  pill, `reason` on hover (#949/#950).
- The Figma's static footer note ("The document set adapts to the commodity…") is deliberately
  omitted per human review follow-up, even though present in the Figma reference.

**Row-click navigation (#823):** the entire row (not just the InReview "Review" control)
navigates to `/origination/$id`, for every status. Each row is a `role="row"` `div` with
`onClick`/`onKeyDown` (Enter/Space) — deliberately not an `<a>`/`<Link>` wrapper, since nesting the
row around the InReview cell's own `<Link>` would produce invalid nested anchors. The inner
`Link`'s `onClick` calls `stopPropagation()` so a click on it doesn't also fire the row handler
(both target the same URL — this just avoids a duplicated navigation/history entry).

**Layout:** a full-width CSS grid, not an HTML `<table>` — the Figma frame's fixed pixel widths
sum wider than the card (an export artifact: body cells total ~1038px inside a 945px box), so
seven flexible data tracks (`minmax(0,Nfr)`, ellipsis-truncating) plus a fixed 210px action column
replace them, summing to exactly 100% (no horizontal scroll/clip). The header row and each body
row are separate grid containers, so bounded-content columns (Facility, Rate, Maturity,
Submitted) get fixed pixel tracks sized to their worst case (content-driven `auto`/`max-content`
sizing would compute per-container and misalign columns); Originator/Commodity/Corridor split the
remaining width. Borders: a single rounded box around the body rows + horizontal separators only
(`LINE_COLOR` = `rgba(56,55,53,0.18)`, exact Figma literal, applied via inline `style`) — no
column dividers, header sits unbordered above the box. Approved pill uses
`--color-pipeline-positive-primary` text/icon with one-off alpha bg/border steps (no token match,
same precedent as the Capital Allocation legend colors); the check icon is redrawn inline
(Figma's asset is a localhost dev-server SVG, not fetchable at runtime). Rejected pill has no
Figma reference row — resolved via Open Questions as a token-consistent default, mirroring
Approved's shape with `--color-pipeline-negative`.

### Origination detail (`/origination/$id`, issue #821)

Supersedes closed #816, which included a Collateral Valuation card + `/valuations` wiring —
**explicitly dropped**: the Figma's valuation card is incorrect, since no submission is anchored
on-chain pre-mint, so there is no `loan_id` to call `GET /v1/loan-book/{loan_id}/valuations` with.

**Field mapping (resolved decisions, #821):**

- Heading/breadcrumb/Deal-Details "Originator" → `loan_data.originator` (the human name), **not**
  `SubmissionView.originator` — same distinction as the table.
- Start date → `economics.origination_date`. Maturity → `economics.original_maturity_date`.
  Facility/tranches/offtaker price → `economics.*` (÷10^7 via `formatEconomicsUsd`, #912). Rate →
  `senior_interest_rate_bps` + " p.a." suffix (Figma "14.0% p.a.").
- Corridor → `loan_data.corridor`, arrow-formatted (same regex as the table). Governing law →
  `loan_data.governing_law`. Protection → `loan_data.protection` (optional — `—` when absent).
- Location → `loan_data.initial_location` (#1014), rendered `{location_type} — {location_
  identifier}` (e.g. "Warehouse — SGS bonded stockpile, Callao, Peru"); a half missing on the wire
  renders alone, both missing renders `—`.
- Documents → the top-level `submission.documents` (**not** `loan_data.documents` — the backend
  already lifts it); `[]` renders a graceful empty state.
- Status chip → normalized status ("Awaiting your review" for `InReview`; `Approved`/`Rejected`
  for terminal decisions; "Changes requested" for the non-final `ChangesRequested`, #950). This is
  the **only** chip rendered — the Figma's "Your key · one click" static chip and "NSR · Net
  Smelter Return" valuation-mode chip are both dropped (no data source). The "All three mint
  invariants pass" and "Originator signature verified" banners are omitted entirely — not gated
  behind a flag, there is no path to ever showing them.

**Resolution precedence (fixed by #829 — load-bearing for Approve/Reject):** the presenter prefers
the **live** `useLoanSubmissions()` list copy over the router-navigation-state `SubmissionView`
whenever the list already contains a matching `id`; the nav-state copy is used only as an
initial-render fallback (first paint, before the list query resolves — e.g. a direct-URL/refresh
visit). Before #829, the nav-state copy always won when present, so after a successful
Approve/Reject the invalidated list would refetch a fresh (status-flipped) copy, but the memo kept
returning the stale snapshot — the footer would never flip to the Approved/Rejected banner until a
hard refresh dropped the router state.

### Status-conditional footer (#823, Figma node `4116:9656`; copy amended by #829, restored by #831)

The always-shown action-buttons block is replaced by a footer that branches on status:

- **InReview** → the action buttons, wired (#829, extended by #831): Approve now mints on-chain
  first (`useDrawLoan`), then calls the review endpoint; Reject is unchanged (pure DB call).
- **Approved** → a green banner: "Approved & minted · `<reviewedDate>`" (#829 dropped "& minted"
  pending the real mint; #831 restored it — Approve now performs a genuine trustee-wallet-signed
  on-chain `draw_loan` mint before this banner ever renders). The Figma's semibold navy "funded
  from batch #B-102 →" segment is omitted — no `batch` field exists on
  `SubmissionView`/`loan_data`.
- **Rejected** → a red banner: "Rejected · `<reviewedDate>` — `<rejectionReason>`".
- **ChangesRequested** → a sweet-orange banner: "Changes requested · `<reviewedDate>` —
  `<reason>`" (#950). Non-final (waiting on the originator to resubmit) — no action buttons.
- Backend merged/lifecycle statuses → the Approved banner (#892).

`reviewedDate` is `formatSubmittedDate(submission.updated_at)` — **not** `formatMaturityDate`
(which takes Unix seconds and adds the year; `updated_at` is RFC 3339) — mirroring the table's
Approved pill. `rejectionReason` is `safeString(submission.reason)`.

When the just-drawn `loanId` is known (#876 — captured from the mint tx in this session), the
Approved banner appends a "View loan →" deep-link to the loan's detail page. On a page reload the
id is gone (the mint mutation's data isn't persisted — same accepted residual as the idempotency
marker), so the link is simply omitted. `RejectedBanner` and the `ChangesRequestedBanner` mirror
`ApprovedBanner`'s container shape in their respective tokens (red / sweet-orange `#c2500a`
one-off, no token) — no Figma reference exists for either state.

**Out of scope (do not reintroduce):** `useCollateralValuation`, the `CollateralValuationResponse`
shape, `ValuationDisplay`/`ValuationInputRow`/`WaterfallRow`, `mapValuation`, `modeLabel`,
`usdOrDash`, `initial_ccr`/`formatInitialCcr`, `freshnessLabel` — see the (completed) exec plan
`docs/exec-plans/active/issue-821-trustee-origination-details-page.md` for why.

### Approve & mint confirmation dialog (#838, Figma node `4116:13943`)

`transactionPreview` formats the same `loan_data` payload already passed to `useDrawLoan` as the
dark code block shown inside the confirmation dialog. Fields are read defensively exactly like the
rest of the page (never fabricate; `—` on anything missing/malformed). The four green
mint-invariant checklist rows the Figma frame also shows are deliberately omitted — no backing
data (consistent with #821's omission of the "mint invariants pass"/"signature verified" banners).
The `initialLocation` line is `initial_location.location_identifier` **alone** — `loan_data`
carries no country field, so the Figma's "· PE" suffix is not reproducible and is dropped rather
than fabricated.

Before #838, clicking Approve fired the mint→review orchestration immediately. The dialog
introduces a pre-mint confirmation gate: Approve now **opens** the dialog; the orchestration only
runs when the trustee clicks "Mint loan" — unchanged otherwise. Cancel/Escape/backdrop-click are
**disabled while minting** — once "Mint loan" is clicked the on-chain sequence is in flight and
cannot be un-shown, a deliberately stricter contract than `RejectReasonDialog` (whose Cancel stays
enabled during submission, since a review-only mutation has no on-chain side effect to lose
visibility into). This also protects the idempotency guard below — the dialog cannot be dismissed
mid-mint in a way that would confuse a subsequent Approve click. `cancelApprove()` does **not**
reset the mint mutation once it has already succeeded — doing so would erase the "already minted
this session" marker and risk a second on-chain mint.

### Chain-first Approve ordering (#831)

Approve runs the trustee-wallet-signed on-chain `draw_loan` mint (`useDrawLoan`,
`@pipeline/wallet-connect`) **before** the DB review call (`useReviewSubmission`, `POST
.../review {decision:"Approved"}`):

1. `useDrawLoan().mutateAsync({ loanData })` — build → simulate (the "verify the loan" step) →
   wallet signature → submit → poll to a terminal status.
2. Only once that resolves does `useReviewSubmission` fire.

A wallet rejection, a failed simulate/send/poll, or an unconfigured registry/disconnected-wallet
guard all reject step 1 — the review call is skipped entirely, the submission stays `InReview`,
and a mapped, retryable error message renders. **No signature is ever requested when the simulate
step fails.** An already-`Approved` submission's `approve()` is a no-op (defensive — the
InReview-only footer shouldn't normally allow this call, but guards a stale render/race).

**Idempotency guard — re-click after a mint-succeeded/review-failed retry:** `useDrawLoan`'s
underlying mutation retains its `isSuccess`/`data` state for as long as the review hook instance
(keyed to one submission id) stays mounted — an in-session "minted" marker. If the mint (step 1)
succeeds but the review call (step 2) then fails, re-clicking Approve checks that marker first:
when already-successful for this submission, `approve()` skips step 1 entirely and re-fires only
the review call — no second on-chain mint is ever attempted on retry. **Accepted residual:** a
hard page reload between mint-success and finalize-failure loses this in-memory marker (React
Query cache is not persisted across reloads) — a subsequent Approve would attempt another on-chain
mint. No backend reconciliation exists to close this gap; a deliberately accepted bound (#831),
not a deferred follow-up.

**Known limitation (#831 Open Question 4, accepted scope):** if the mint succeeds but the
subsequent review call fails, the loan is minted on-chain while the DB submission stays
`InReview` — a distinct message warns against blindly retrying (a retry would attempt another
on-chain mint). Robust reconciliation (the worker already indexes `loan_drawn`) is deferred to a
follow-up backend issue — see `docs/exec-plans/tech-debt-tracker.md`.

### Review error copy

`useReviewSubmission` contract source of truth: `packages/api/src/routes/loan_book.rs`,
`review_submission` — Approve sends `{decision:"Approved"}` with **no** `reason` key (sending one
→ `400`); Reject/Request-changes send `{decision, reason: "<non-empty>"}` (missing/empty → `400`);
only `InReview`/`ChangesRequested` submissions are reviewable (already-decided → `409`). On
success, every `["loan-submissions", ...]` query is invalidated (key-prefix match) so the table
and detail page both refetch.

Mapped copy (#1041 / #1037): review-mutation errors (`401`/`403`/`409`/`400`/default) come from
the shared trustee `toUserError` status table — raw backend text is never rendered inline, only
via `errorDetails` behind the `InlineError` "View details" dialog. Mint errors (`useDrawLoan`)
run through the same trustee mapping layer (wallet rejection → preflight guard →
simulation-error shape → status table → fallback). Full mapping spec:
[`error-handling.md#trustee-mapping-layer`](./error-handling.md#trustee-mapping-layer).

### Reason-dialog shell & validation

`-RejectReasonDialog.tsx` and `-RequestChangesDialog.tsx` share the same shell (`role="dialog"`,
`aria-modal="true"`, `aria-labelledby` on the title, Escape + Cancel-button close, backdrop click
closes **without** submitting — mirrors Cancel, never a stray submit) and the same validation hook
(`-useRejectReasonDialog.ts`): the reason must be **at least 5 characters after trimming
whitespace** — submit is disabled and an inline error shows until satisfied; this is a
client-side UX guard, the backend also 400s on an invalid reason but is not the source of truth
for the message. Request Changes uses a multi-line `<textarea>`; Reject uses a single-line input
(re-skinned to Figma `4116:14123` by #838, replacing the original 3-row textarea). No Figma
reference exists for the Request-changes dialog — its styling simply follows Reject's.

### Request changes (#1017)

Mirrors Reject exactly: a pure DB review call (`{decision:"ChangesRequested", reason}`, backend
#949) — no on-chain step, non-final (the submission stays open for re-review). Opens
`RequestChangesDialog` (textarea reason, same min-5-trimmed-chars validation as Reject's
`RejectReasonDialog`, re-skinned to Figma `4116:14123` by #838 — "Send to originator" + Cancel).
The inert "Request changes" button and the "Approval mints the loan NFT…" footer note (both
present pre-#838) were removed by #838 — no backend endpoint existed for the former, and the
latter was redundant with the confirmation dialog's copy.

## Risk Council actions

**Sources:** `packages/trustee/src/routes/-risk-council-escalate.ts` + `risk-council.escalate.$id.tsx`
(Escalate, flow 10), `-risk-council-reterm.ts` + `risk-council.reterm.$id.tsx` (Amend economics /
off-cycle re-term, flow 11), `-risk-council-writedown.ts` + `risk-council.writedown.$id.tsx`
(Write-down close, flow 12), `risk-council.tsx` (pass-through layout), `risk-council.index.tsx`
(hub placeholder). Issue #782. Spec: `docs/product-specs/trustee-dashboard.md` §"Type 3 — RISK_COUNCIL
proposals"; escalation's proposal-builder shape: `docs/product-specs/trustee-risk-watchlist.md`.

### Routing

`risk-council.tsx` is a pass-through layout (`<Outlet/>`, no chrome of its own, mirrors
`loans.tsx` / `origination.tsx`, #821) so sibling pages can live under `/risk-council`:
`risk-council.index.tsx` (placeholder hub, pending a live Watchlist-candidates list), and the
three flow pages. Without this layout, TanStack's generated route tree would reference a parent
route with no `<Outlet/>`, so a child would fail to register — the same class of issue `loans.tsx`
fixes for `/loans/$id`. Escalate/reterm/writedown register at `/risk-council/{escalate,reterm,
writedown}/$id` without the `$id_` trailing-underscore escape (unlike
`loans.$id_.record-coupon.tsx`) because there is no leaf file they'd otherwise collide with.

### Escalate to Default (flow 10) — proposal builder, not a typed payload

Per the Risk & Watchlist spec (docs are the source of truth, Figma is styling), escalation is a
**generic proposal builder**: the Trustee reviews the loan's risk evidence (ledger card) and
writes a free-form proposal **name + text** for the Risk Council — **not** a type-specific
`setDefault` payload composed by the dashboard. The 3-of-5 Safe executes the underlying action
after the 24h timelock; the Trustee cannot execute. The read-only re-term / write-down frames are
the Risk-Council **display** screens for flows 11/12.

**Real vs. mock data:**

- **Real** (sourced live, per-loan): Originator / Facility (`principal`) / senior deployed
  (`senior_outstanding`) / Collateral (loan-book entry, served display-scale as-is, #906;
  `ccr_bps` used as-is); Repaid to date (`useLoanFinancials`, `offtaker − offtaker_outstanding`);
  CCR trend (`useLoanCcrHistory` + `buildCcrTrend`, reused from `-useLoanDetail.ts`); current
  at-risk % (`summary.at_risk_wl_and_default_pct`); concentration (`summary.top_concentration`,
  only when it names *this* loan's own commodity — the endpoint serves a single portfolio-wide top
  concentration, not a per-commodity share — `—` otherwise).
- **Mock** (no backend source, flagged, not per-loan): "Days on watchlist" (no "watchlist since"
  timestamp served anywhere, the same gap the Watchlist loan-detail page has, #859); the "→ Y% if
  defaulted" portfolio-impact projection (no projection endpoint, and `at_risk_wl_and_default_pct`
  already combines WatchList+Default so a same-loan transition barely moves the combined figure —
  no real formula to derive the Figma's forward-looking delta); the proposal builder itself (name +
  text form, Draft → Submitted, the 24h-timelock timer — no Safe/proposal/voting/timelock backend
  exists yet, `RiskCouncilSafe.propose` is RISK_COUNCIL-only, not Trustee-callable — local UI state
  only, no network/wallet).

The collateral sub-label uses the real 7-day spot-change basis (`spot_change_7d`), matching the
Loans page's never-fabricate rule (exec-plan RISK 3) rather than the Figma's "30d" literal; the
Figma's "unchanged · 3.9%" concentration qualifier has no trend/history source, so "unchanged" is
dropped — only the served share renders.

### Amend economics / off-cycle re-term (flow 11) — read-only review

A RISK_COUNCIL `amendEconomics` proposal. Unlike Escalate (which the Trustee drafts + submits),
this is a **read-only review** screen: the dashboard only shows the review, evidence, and voting
status — execution stays with the Risk Council Safe after the 24h timelock, GUARDIAN-cancelable.
"View Safe proposal" is a placeholder for the (unbuilt) Safe link. There is no submit action.

- **Real** — the loan's **current** terms, per-loan: Loan (originator — commodity), CCR
  (`ccr_bps`), Maturity (`maturity`) from the loan-book entry; current coupon — the current
  epoch APY (`useLoanFinancials` `epoch.current_apy_bps`), falling back to the loan-book `rate`
  when no epoch is on record, `—` when neither is available.
- **Mock** — the **proposed** amendment + the proposal timestamp. No Safe/proposal backend exists
  (`RiskCouncilSafe.propose(amendEconomics)` is RISK_COUNCIL-only), so the proposed coupon /
  maturity extension / covenant / expected status and the timestamp stamp are static Figma
  literals until that infra lands — the same convention as flow 10's proposal section.

### Write-down close / Default resolution (flow 12) — read-only, no action

A RISK_COUNCIL `closeLoan(reason: OtherWriteDown)` proposal. Like flow 11 (and unlike flow 10) a
**read-only review** screen — the Trustee has **no close button** on this flow ("PLUSD backing
impact and audit trail are shown before execution"). Execution stays with the Risk Council Safe
after the timelock, GUARDIAN-cancelable.

- **Real** — the loan's resolution ledger identity, per-loan: Loan (originator — commodity) and
  Principal outstanding (`senior_outstanding`, served display-scale as-is, #906).
- **Mock** — the write-down resolution + the Safe voting layer: recovery-received figure, the
  pending `closeLoan` proposal (`loanId` string / recoveryAmount / writeDown), per-signer voting
  status, and the queue timelock. Nothing serves any of these; `RiskCouncilSafe.propose(closeLoan)`
  is RISK_COUNCIL-only. Static Figma literals until that infra lands (same convention as flows
  10/11).

## Overview page

**Sources:** `packages/trustee/src/api/useCapitalAllocation.ts` (data hook),
`api/useCapitalWalletBalance.ts` (on-chain interim data hook),
`components/useCapitalAllocationCard.ts` + `components/CapitalAllocationCard.tsx` (Capital
Allocation card, issue #797, extended #805/#807/#811/#1020, Figma node `4116:8928`, frame
`4116-8854`), `components/useNeedsAttention.ts` + `components/NeedsAttention.tsx` (Needs
Attention section, issue #818, Figma node `4116:9004`).

### Capital Allocation card — data layer

`useCapitalAllocation` — `GET /v1/capital-allocation`, Stellar-scoped `chain_id` (the EVM chain
carries malformed test data, #765, so this hook always sends `chain_id` explicitly rather than
relying on the endpoint's default), 30 s poll. Every bucket and `total` is a base-6 decimal string
already in human units, or `null` when the backend has no source for that field yet (today only
`deployed` is indexer-sourced) — render `—` for `null`, never derive a value client-side
([[no-frontend-computed-metrics]]).

**Capital Wallet on-chain fold-in (#805, TD-41).** `useCapitalWalletBalance` reads the Capital
Wallet's USDC balance directly from the Stellar contract (`usdc.balance(ENV.
STELLAR_USDC_CUSTODY_ID)`, the same custody id the LP frontend's `useStellarUsdcCustodyBalance`
uses) as an interim substitute for the backend `capital_wallet` bucket (`null` until
`capital_allocation.rs` indexes it). It converts the raw i128 7-decimal-SAC bigint to the same
human-decimal-string shape as the backend buckets so it can feed straight into the existing
formatters/summing logic; a misconfigured custody id (pointing at the USDC issuer) surfaces as
`error` via `getSacBalance`'s own sentinel guard, never a fabricated ~$922B balance. Returns
`{data: undefined, isLoading: false, error: null}` when unconfigured — no RPC call is made.

**Guarded total (human-approved, #805) — a documented exception to
[[no-frontend-computed-metrics]]:**

- **Legend value:** prefer the backend `buckets.capital_wallet` when non-null (avoids stale
  on-chain data once the backend catches up); otherwise the on-chain balance; otherwise `—`.
- **Total:** `data.total` already includes `capital_wallet` once the backend sources it, so the
  on-chain balance is added **only** while `buckets.capital_wallet` is `null` — a double-count
  guard. If the backend total is `null` but the on-chain balance is known, the on-chain value is
  shown as the sole known total (real data, not fabricated); `—` only when neither source has
  anything.
- This is an interim client-side sum of two authoritative real sources, not a derived/estimated
  metric — remove once the backend serves `capital_wallet` (the guard already prefers it).
- A read error/loading/unset-id on the on-chain source degrades **only** the Capital-Wallet legend
  value (and the total's extra addend) to `—`/backend-only; it does not drive the card's overall
  `isError`/`isLoading` — only the backend `useCapitalAllocation` query does that (keeps the card
  resilient to a flaky RPC).

**Per-bucket percentage pills (Figma node `4116:8961`, human-requested scope addition, TD-41):**
each legend row shows `bucket_value ÷ displayed_total` (the same guarded total above), rounded to
the nearest whole percent — a deliberate, explicitly requested reversal of the original "no
client-computed percentages" deferral. A `null`/absent bucket, unknown total, or `<= 0` share
renders no pill (never a fabricated `0%`). A strictly-positive share under 1% renders `"< 1%"`
(human review follow-up, PR #811) — not rounded down to `"0%"` or up to `"1%"`. Percentages are
**not** normalized to sum to 100 — independent per-bucket rounding may total 99% or 101%, matching
the Figma reference.

**Proportional allocation bar (review follow-up on #805, PR #811, TD-41):** each legend row
carries `barFraction`, the exact unrounded share of the displayed total in `[0,1]`, sizing each
bar segment's width — superseding the original inert equal-width placeholder bar. A `null`
`barFraction` renders no segment for that bucket (filtered before mapping), using the raw fraction
(not the rounded/`< 1%` text) so segments sum to ~100% rather than drifting from rounding.

Six legend rows: Capital Wallet, In transit, Trust account, Withdrawal queue, Deployed, T-Bills
(USYC) — the Figma's five buckets plus the `withdrawal_queue` bucket the backend added later
(#933, rendered per #1020).

**Removed static mock chrome (#825):** the green reconciliation header ("RECONCILES TO PLUSD
BACKING · DRIFT < 0.01%") and the four provenance chips below the legend had no backing API field
and were removed per the "no fabricated/frontend-computed metrics" convention. If real
provenance/drift data ever lands, they can be re-added wired to that source.

**Net scope for the Overview page (#797, human-confirmed 2026-07-08)** — everything else in the
Figma frame is deferred/out of scope: no header timestamp (no `as_of`/`generated_at` API field
exists yet); no standalone Cash-in-Transit or Active Deal cards — removed entirely (the
`in_transit` bucket stays in the Capital Allocation legend). The Loans — Payments Due / Cash
Management / Risk Council groups of Needs Attention remain deferred to follow-up issue #799
(blocked on backend endpoints).

**`children` composition (#818, human review follow-up):** the Figma background node `4116:8928`
wraps the entire Overview page content — Capital Allocation **and** Needs Attention — in one
continuous white surface, not two separate stacked cards. Rather than duplicating the `Card`
wrapper in a second component (which would render a visible gap/second white block), the Overview
route passes `<NeedsAttention />` in as `children` to `CapitalAllocationCard`, rendered directly
after the card's own content, inside the same `Card`, separated by 48px (#825). `NeedsAttention`
itself renders plain content with no `Card` of its own, independent of the Capital Allocation
card's own loading/error state (it gates on its own hook).

Figma → token mapping: card white surface `rounded-[4px]` (`--radius-pipeline-card`) `p-[32px]`;
total Besley display `text-[58px]/leading-[81.2px]` ink; bar/legend colors `#000080` →
`--color-pipeline-brand` (exact), `#208000` → `--color-pipeline-positive-primary` (exact);
`#c9a200`, `#6666b3`, `#3d8f8f` (withdrawal_queue, postdates the Figma frame) have no matching
token — scoped one-offs (same precedent as `SignInCard`'s blur effect); the mid-grey segment
(`rgba(56,55,53,0.35)`) is a darker alpha step of the ink token family than any existing
muted/subtle token, likewise a scoped one-off. Percentage pill background `rgba(191,189,187,0.12)`
— same one-off as the nav badge background; percent text `rgba(56,55,53,0.6)`, another ink-family
alpha step with no exact token match.

### Needs Attention section

Two groups, both defensively read (`loan_data` is `serde_json::Value` on the wire):

- **Origination** — in-review + changes-requested submissions (#818, #1046). Title:
  `` `${friendlyOriginator} — ${commodity}: ${statusSuffix}` `` — the suffix is `"new request"`
  for `InReview` and `"changes requested"` for `ChangesRequested` (#1046, origination-table
  vocabulary) — where `friendlyOriginator` is `loan_data.originator` (the friendly name, e.g.
  "Open Mineral") — **not** the top-level `SubmissionView.originator` (the authenticated submitter
  address); the opposite field choice from the Origination table's Originator column, which
  intentionally uses the top-level field — both are correct for their own row shape. Subtitle:
  `"${commodity} · ${corridor} · submitted ${date}"` (backed fields only); the Figma subtitle also
  references the valuation mode and attached documents, neither backed pre-mint — omitted, not
  fabricated. Any missing segment is dropped cleanly rather than rendered as a bare `—` mid-string.
  Action: the Review button navigates to `/origination/$id`, passing the row's `SubmissionView` as
  router state (mirrors the Origination table's InReview cell) — same link for ChangesRequested
  rows, whose detail page renders the reason banner (#950).
  **Sourcing (#1046):** the submissions fetch is deliberately UNFILTERED — the group needs
  `InReview` + `ChangesRequested`, but the backend's `SubmissionsQuery.status` accepts a single
  status per request, so one unfiltered call filtered client-side (via
  `normalizeOriginationSubmissionStatus`, the origination table's #1044 pattern) beats two
  parallel filtered queries — one request, and it shares the
  `["loan-submissions", chainId, "all"]` cache with `useOriginationTable`. The group keeps exactly
  the normalized statuses `InReview` and `ChangesRequested`: merged/lifecycle statuses normalize
  to `Approved` (#892) and belong on the Loans surfaces, and `Rejected` is a terminal decision
  record with nothing left to act on. `ChangesRequested` was originally excluded as
  originator-actionable (#949/#950); #1046 reversed that — an origination awaiting a resubmit
  stays visible on the Overview.
- **Loans** — Watchlist + Matured loans from `useLoanBook` (#867): `WatchList`/`Watchlist` →
  "Watchlist"; past-maturity (`Past Due`, legacy `Matured`) → "Matured". Links to `/loans/$id`.

**Scope (#818, cross-linked to #799):** the Loans — Payments Due, Cash Management, and Risk
Council groups (Figma nodes `4116:9018`+) are deliberately omitted — no backend endpoints exist
for them yet. Only the Origination and (later, #867) Loans groups render.

**Empty/loading/error handling (resolved, human review):** the section — heading and all —
renders nothing unless there is at least one row in either group. No skeleton on loading, no
error surface — this is a supplementary block, not the page's primary content (unlike
`CapitalAllocationCard`, which does show loading/error states).

Figma → token mapping: section heading "Needs Attention" Besley display `text-[36px]
leading-[46px]` ink (a non-token one-off, same precedent as the card's `58px` total); group header
uppercase `text-[12px] leading-[16.8px] tracking-[0.96px]` ink-muted; row `bg-[rgba(211,235,117,
0.16)]` + `border-[rgba(56,55,53,0.18)]` (scoped one-offs, no matching token), `rounded-[4px]
min-h-[72px] px-[17px] py-[15px]`; icon circle 36px brand bg wrapping the sidebar's
`OriginationIcon` lightbulb glyph (reused rather than redrawing the Figma SVG asset — both are the
lightbulb glyph); Review/Open button brand bg, white text, `rounded-[4px] h-[40px] px-[16px]`
(human review follow-up: an earlier cut wrongly copied the Origination *table*'s disabled Review
button shape, a different Figma component — corrected).

## Session & auth

**Sources:** `packages/trustee/src/auth/**` (`TrusteeSessionProvider.tsx`, `sessionStore.ts`,
`authGate.ts`, `useAuthRedirect.ts`), `components/TrusteeShell.tsx`, `components/SignInOverlay.tsx`,
`components/SignInCard.tsx`, `routes/__root.tsx`, `routes/sign-in.tsx`.
Issues: #791 (flow), #793/#794/#795 (modal hardening), #921/#988/#1009 → **#1008** (gating
architecture). Backend contract: `docs/product-specs/api-authorization.md` /
`packages/api/src/routes/auth.rs`.

### Two-layer gating (#1008)

Auth is enforced in two independent layers:

1. **Correctness — render-level gate (cannot race).** `TrusteeShell` renders `SignInOverlay`
   (Figma `4174-31660`) whenever the session is not authenticated, **on any URL**, and never mounts
   protected route content (`<Outlet/>`) while signed out — so no authenticated API calls fire
   either. Whatever the address bar says, the content is always right.
2. **URL convention — redirects (not load-bearing).** `/sign-in` is the canonical logged-out URL.
   The root route's `beforeLoad` (`resolveAuthRedirect`) enforces it on hard navigations
   (unauthenticated on a protected path → `/sign-in`; authenticated on `/sign-in` → `/`), and
   `useAuthRedirect` enforces it on **mid-session** status changes (sign-in completing, sign-out,
   token expiry) that `beforeLoad` never sees. `signOut()` navigates to `/sign-in` explicitly. The
   `/sign-in` route itself renders `null` — the gate UI always comes from the shell.
   `useAuthRedirect` also **self-heals the address bar**: external history writes (observed on
   staging — e.g. the wallet modal restoring its pre-open URL on close) can overwrite
   `window.location` without the router noticing, leaving the URL on `/sign-in` while the app
   renders `/`. No router/React state reflects that divergence, so the hook compares
   `window.location.pathname` against router state on every status/path change (plus short delayed
   re-checks for late clobbers) and re-stamps the address bar via `history.replaceState` — router
   state is the source of truth.

If a redirect misfires, the failure mode is a briefly-wrong address bar — never wrong or blank
content. **History:** three URL-synchronization approaches raced in production builds and stranded
the URL on `/sign-in` — a render-phase `<Navigate>` (#921), `beforeLoad` + `router.invalidate()`
(#988, `invalidate()` does not re-run the root guard and `beforeLoad` only runs during
navigations), and a reactive navigate alone (#1009). The trigger — "status flipped while parked on
`/sign-in` with no navigation in flight" — is inherently racy to convert into a navigation, which
is why correctness no longer depends on one.

| Scenario | URL | Content |
|---|---|---|
| Visit `/` signed out | `/sign-in` | overlay |
| Deep-link `/loans` signed out | `/sign-in` | overlay |
| Sign in from `/sign-in` | `/` | dashboard |
| Logout from any page | `/sign-in` | overlay |
| Token expiry mid-session | `/sign-in` | overlay |

### Sign-in flow (#791, hardened #793/#794/#795)

`TrusteeSessionProvider` orchestrates; `SignInCard` is the UI (idle / "Connecting…" /
unauthorized-error states).

1. `signIn()` sets `status = "connecting"` and **always opens the wallet-connect modal** — sign-in
   must be driven by the user's deliberate chain pick, never ambient wallet state (#795: wagmi
   auto-reconnects a persisted EVM session on page load, which used to hijack sign-in and skip the
   modal, so Freighter/Soroban was never offered). The picked chain (`onWalletSelect`) becomes the
   sole driver: already connected → sign-in runs immediately (the kit treats same-address reconnect
   as a no-op, so a watch effect alone would miss this case, #794); not yet connected → a watch
   effect on the reactive wallet hooks runs it once that specific chain connects. A wallet on the
   *other* chain never triggers sign-in. Dismissing the modal with no pick resets to
   `unauthenticated` (#793 — no stuck "Connecting…"). An `orchestrating` ref makes the
   challenge/verify orchestration single-flight.
2. `GET /v1/auth/challenge?address=&chain_id=` — `401` = address not on the server allow-list →
   `unauthorized` + explanatory error (authorization is entirely server-side); other failures →
   "could not reach the sign-in service".
3. The wallet signs the challenge `message` (EVM `personal_sign` hex / Stellar SEP-0053 base64 via
   `@pipeline/wallet-connect`). A rejection returns to `unauthenticated` **silently** — a user
   choice, not an error.
4. `POST /v1/auth/verify` — on success the token is stored (`setSession`) and `status` flips to
   `authenticated`; **no navigation happens anywhere in the flow** (layer 1 swaps the UI, layer 2
   tidies the URL). A `401` here (nonce race / signature mismatch) surfaces as
   "verification failed".

`signOut()` clears the stored token, disconnects both wallets, and navigates to `/sign-in`. There
is no server logout endpoint (bearer-token transport, per the #791 Decision Log) — sign-out is
purely client-side.

### Session store (`sessionStore.ts`)

Module-level external store (the same pattern as `@pipeline/wallet-connect`'s Stellar
`connectionStore`), single source of truth for the backend-issued JWT:

- Persisted in **`sessionStorage`** (not `localStorage`) under `pipeline.trustee.session` — the JWT
  must not outlive the browser tab (#791 storage-choice rationale). Hydrated once at module load;
  expired stored sessions are dropped on hydrate.
- Exposes the reactive `useSessionState()` (via `useSyncExternalStore`) plus **non-hook accessors**
  (`getSessionToken()`, `getSessionState()`) for `apiFetch` and the router guard, which run outside
  React. `getSessionToken()` is deliberately pure — no writes/notifications, so a fetch reading the
  token never triggers a re-render (#795).
- **Reactive expiry:** a timer armed on every `setSession` (and at hydrate) evicts the session the
  instant its ~24 h token expires, so an idle trustee is re-gated without needing a failed API call
  (#795). Statuses: `unauthenticated | connecting | authenticated | unauthorized`.

### Trustee sidebar (Figma node `4116:8855` "Aside")

`TrusteeSidebar` is the persistent left nav panel, replacing the earlier topbar nav (#786). Full
trace: `docs/exec-plans/active/issue-786-trustee-app-shell.md` "Decisions" + "Exact layout spec".

- Active state is driven by TanStack Router (`activeProps`), not a hardcoded label. `Link`'s
  `className` and `activeProps`/`inactiveProps` classNames are **concatenated** (not swapped) by
  the router, so putting a `color` utility in both the base className and `activeProps` would
  leave two same-specificity Tailwind classes fighting over `color` at once — fragile, not
  reliably "active wins". Instead the base className carries only layout (no color/background);
  active/inactive surface + text color are mutually exclusive, only one ever present.
- **Count badge slot** renders nothing unless a backend-served count is supplied on the nav item
  (`TrusteeNavItem.badgeCount`) — there is no backend source for the Figma mock's 1/4/3 today
  (decision #786-2, [[no-frontend-computed-metrics]]).
- **Account chip**, pinned to the bottom: avatar circle, truncated address, "Trustee · connected"
  subtitle, and a `⋯` affordance opening a small popover menu with "Sign out" (decision #786-4),
  wired to `useTrusteeSession().signOut`. Renders nothing when `address` is undefined (never the
  string `"undefined"`).
- Desktop-only for this issue (decision #786-5) — no mobile drawer/collapse; responsive behavior
  is tracked in `docs/exec-plans/tech-debt-tracker.md`.
- Two dividers (`rgba(235,233,230,0.25)`, documented one-off — no theme token, same precedent as
  `SignInCard.tsx`): after Overview, and before the Risk Council / Audit Log group.
- **Network switcher (#1032):** a static current-network label sits next to "Trustee ·
  connected"; the `⋯` popover gains switch-network rows above "Sign out" when
  `VITE_NETWORK_LINKS` supplies sibling deployments. Full behavior:
  [`wallet-flows.md#network-switcher-cross-deployment-links`](./wallet-flows.md#network-switcher-cross-deployment-links).

### Sign-in card (Figma node `4174:33891`, frame `4174-31660` "Unauthenticated Overlay")

`SignInCard` renders the "Connect Wallet" prompt inside `SignInOverlay`. "Connect Wallet" wires to
the sign-in flow above; the `unauthorized` status (backend `401` — address not on the allow-list)
renders inline as an error state on the card. There is no client-side on-chain role check —
authorization is entirely server-side.

Figma → token mapping: card white surface, border matches `--color-pipeline-line`, `rounded-[24px]`
(no existing radius token is 24px — `--radius-pipeline-card-lg` is 16px — a documented one-off),
`p-[32px] gap-[24px]`, fixed `w-[520px]`, a subtle `backdrop-blur` (Figma "Blur" effect, radius 32,
no shared token, scoped to this card only). Icon badge: navy circle `size-[56px] rounded-[28px]`
(a perfect circle at this size), `--color-pipeline-brand` fill (exact token match), centered white
`LockIcon`. Heading Besley display serif `36px/46px` ink; subtext body `16px/22px` ink-muted.
Actions: full-width black pill button (`--color-pipeline-cta` fill, `--radius-pipeline-pill`
radius, 48px tall) labelled "Connect Wallet"; the `!` override on its className overrides the
`Button` component's built-in radius/`min-w-12` (Tailwind v4 equal-specificity hazard, #357 — the
same pattern `Button` itself uses for its `compact` size override); caption footer ink-muted,
centered.

## App bootstrap & providers

**Sources:** `packages/trustee/src/main.tsx`, `lib/nav.ts`, `api/auth.ts`. Issues: #786 (nav),
#791 (sign-in flow / provider stack).

`main.tsx` configures the shared `@pipeline/wallet-connect` slice (`setWalletConnectConfig`)
before rendering `EvmWalletProvider`/`StellarWalletProvider` — those providers initialise AppKit /
the Stellar kit lazily on first render (not at module load), so the call only needs to precede
`createRoot(...).render(...)`, not any particular import (#791). The `QueryClient` is a module-
level singleton so React StrictMode's double-mount doesn't create two clients (`EvmWalletProvider`
mounts its own internal `QueryClientProvider` for wagmi; this one is for Trustee-owned fetching).

Provider order mirrors the LP frontend's `main.tsx`, minus `WalletGateProvider` — the Trustee
omits the LP first-connection terms gate (internal operators; see the #791 exec plan's Decision
Log). Without a `WalletGateContext.Provider` mounted, `@pipeline/wallet-connect`'s gate hooks
default to a no-op (immediate proceed). `TrusteeSessionProvider` is NOT mounted in `main.tsx` —
it calls `useNavigate()`, which needs router context, so it mounts inside the root route
(`routes/__root.tsx`), below `<RouterProvider>`.

### Nav sections (`lib/nav.ts`)

`TRUSTEE_NAV_ITEMS` defines the six nav sections per Figma node `4116:8855` ("Aside") and
`docs/product-specs/trustee-dashboard.md` (spec #453): Overview, Origination, Loans, Cash
Management, Risk Council, Audit Log. This replaced the #777 scaffold's `TRUSTEE_FLOW_TYPES`
(Type-1..4 taxonomy) — the Figma nav is the real product navigation (#786). `badgeCount` is
intentionally unpopulated: there is no backend source for the counts in the Figma mock (1/4/3),
and per [[no-frontend-computed-metrics]] the badge slot renders only when a count is supplied
(see [Trustee sidebar](#trustee-sidebar-figma-node-41168855-aside)); wiring a real count is
tracked in `docs/exec-plans/tech-debt-tracker.md`.

### Auth endpoint wrappers (`api/auth.ts`)

Typed wrappers over `GET /v1/auth/challenge` / `POST /v1/auth/verify` (#791). Contract source of
truth: `packages/api/src/routes/auth.rs` and `docs/product-specs/api-authorization.md`. A `401`
from `challenge` means the address is not on the server allow-list — the sign-in flow renders it
as "not authorized" (see [Sign-in card](#sign-in-card-figma-node-417433891-frame-4174-31660-unauthenticated-overlay));
a `401` from `verify` means an unknown address, no outstanding challenge, or a bad signature
(usually an expired or already-consumed nonce).
