# Issue #847: Trustee Loan detail page — full design with mock data (Figma 4116-10549)

Source: https://github.com/eq-lab/pipeline/issues/847

Sub-issue of Epic #775. Sibling of #845 (live-data build, `blocked`). This is the
**mock-first** full-design build so the visual can be reviewed while data-sourcing is
discussed. Per the trustee data-sourcing convention, a static Figma mock is acceptable
**only until the real endpoint lands**; each section migrates to its live source later.

## Scope

Implement the **entire** loan detail page (Figma node `4116-10549`) from a single typed,
in-module **static mock** — no live API calls, no localStorage, no fake network. Reachable by
clicking a loan row on `/loans` (#843).

Sections (all rendered, pixel/token-exact to the Figma):
1. **Hero** — `‹ Loans` · `Helios Metals · Lithium` · `Performing` chip · `Loan #4488 · Chile → Korea · matures 30 Jun 2026 · 9 days left`.
2. **Deal journey** stepper — 6 stages (4 done ✓, On-ramp active, Interest distribution pending), each with a sub-label.
3. **Three summary tiles** — Facility/disbursed, Repaid to date, Interest to distribute (each with a sub-line).
4. **Price & collateral** — 5 rows + freshness sub-header + the on-chain-write footnote.
5. **Registry state & derived** — 6 rows, each with a source tag (chain / computed / relayer).
6. **Current stage — on-ramp in transit** — paragraph + `monitor only` tag + `Open on-ramp & mint →` button.
7. **Other actions on this loan** — 4 buttons + the Risk-Council timelock note.

## Assumptions and constraints

- **Static mock only.** One typed fixture (`LoanDetailMock`) holding the exact Figma copy; the
  page renders it directly. No wiring, no network. All action buttons are inert (visual only).
- **Not `useLoanValuation`/`useLoanBook`** — this issue deliberately does not call live
  endpoints (that is #845's concern, parked). When real sources land, sections migrate
  off the mock per-section.
- Route `/loans/$id`; the `$id` is cosmetic for the mock (the fixture is the same regardless).
  Row-click passes no data dependency — the mock renders standalone. Direct URL works (mock is
  static). Back link → `/loans`.
- Pixel/token-exact: map Figma literals to `--color-pipeline-*` tokens; documented one-offs
  where none matches (green `#208000` = positive-primary; amber `#6e6400`, red `#b20000`,
  and the tab/stepper alphas are one-offs — same precedent as #843/#813).

## Implementation Steps

### 1. Mock fixture + presenter
`packages/trustee/src/routes/-loanDetailMock.ts` (route-private): a typed `LoanDetailMock`
interface + one `LOAN_DETAIL_MOCK` constant carrying every section's Figma copy (hero,
journey stages[], tiles[], priceCollateral rows, registry rows[], currentStage, actions[]).
Optionally a thin `useLoanDetail()` returning it, to keep the `.tsx` render-only
(FRONTEND.md rule 2) and leave a clean seam for a future live swap.

### 2. Route page `loans.$id.tsx`
`createFileRoute("/loans/$id")`, render-only. Renders all 7 sections from the mock, inside the
trustee shell, matching the Figma layout (max-w 1180, `px-[56px] pt-[39px] pb-[80px]`, card
grid). Sub-components per section (Hero, DealJourney, SummaryTiles, PriceCollateralCard,
RegistryCard, CurrentStageCard, OtherActions). Document the Figma node id + token map in the
header comment.

### 3. Wire row-click on `/loans`
`packages/trustee/src/routes/loans.tsx` (#843): each row / trailing chevron navigates
`{ to: "/loans/$id", params: { id: <row key> } }` (thread a per-row id/key through
`-useLoansTable.ts`). Keyboard (Enter/Space) + `cursor-pointer` + `aria-label`, mirroring the
Origination row-click precedent (#823).

### 4. Figma → token map (documented in `loans.$id.tsx`)
| Figma | Token / value |
|---|---|
| `‹ Loans` `Besley 18px / #262524` | `font-display text-[18px]` ink → `/loans` |
| Title `Besley 44px` | `font-display text-[44px] leading-[48.4px]` ink |
| Status chip Performing | positive-primary green pill (0.08 bg / 0.3 border) |
| Card `bg-white border rgba(56,55,53,0.18) rounded-[4px]` | surface + `LINE_COLOR` |
| Card title `Besley 26–28px`; row label `Inter 15px` ink-muted; value `Inter 16px` ink | tokens |
| Stepper done ✓ green `#208000`; active navy `#000080`; pending muted | positive-primary / brand / ink-muted |
| Primary button `#000080` white text | `--color-pipeline-brand` |
| Source tags (chain/computed/relayer), `monitor only` tag `Inter 12px` ink-muted | ink-muted |
| Negative spot change `#b20000` | documented one-off |

### 5. Tests + docs
- `-loans.$id.test.tsx` — renders every section (hero title/chip/meta, all 6 journey stages, 3
  tiles, the 5 price rows, the 6 registry rows, current-stage button, the 4 action buttons +
  note). Assert the mock copy is present.
- `-loans.test.tsx` (#843) — row-click navigates to `/loans/$id` (mock `useNavigate`).
- No new API hook ⇒ no hook test. Run `yarn workspace @pipeline/trustee test` + `build` + `lint`
  green; `npx tsx scripts/lint-docs.ts` after doc edits.

## Relationship to #845
#845 = live-data hero + Price & collateral (blocked). This = full-design mock. At review, decide
whether #847 supersedes #845 or the live sections replace mock sections incrementally. Noted,
not gating.

## Follow-up on this branch — live migration (unblocks #845)
Once `GET /v1/loan-book` began serving `loan_id`/`chain_id` (backend commit "add loan and chain
ids to loan-book endpoint", merged from `main`), the two blocked sections migrated off the mock
and the temporary in-page "fake navigation" was removed:

1. **Real routing.** `loans.tsx` is now a pass-through `<Outlet/>` layout (mirrors
   `origination.tsx`, #821); the list moved to `loans.index.tsx` and the detail page is the real
   `/loans/$id` route. Rows navigate with `{ to: "/loans/$id", params: { id: loan_id } }`
   (`-useLoansTable.ts` now keys rows on the served `loan_id`). The `detailOpen`/`onBack` hack is
   gone.
2. **Hero identity (live).** Sourced from the matching `/v1/loan-book` row (originator · commodity).
   The **status block follows design-assignment §3.2**: the backend serves the raw on-chain status
   as a string, and `statusToChip` maps it to the display chip + band on the frontend
   (`Performing`→Performing, `Watchlist`→Watchlist, `Matured`→**Past Due** rename, `Default`,
   `Closed`; ready before the backend emits `Matured`). The status bar carries **no dates** (maturity
   is a key number, not a status field — §S5); the meta is `Loan #<id> · on-chain <raw status>` (the
   raw status is always printed per §3.2). The `Disbursing` variant needs outbound-movement state
   not served here, so a Performing loan renders "Performing". Degrades to `Loan #<id>` when no
   active-book row matches (never fabricated).
3. **Price & collateral (live).** New `useLoanValuation(loanId)` hook →
   `GET /v1/loan-book/{loan_id}/valuations`; `-useLoanDetail.ts` builds the card view-model. Fields
   the endpoint does not serve are **not** carried over from the mock (per never-fabricate): the
   "feed 2h old" freshness note → real `price_provider` attribution; the on-chain-write footnote →
   dropped; absent inputs → `—` + a real `missing_inputs` "Awaiting:" note. **Scale:** the
   valuations endpoint returns plain-USD amounts, so the #840 ×1000 workaround is NOT applied here
   (see tech-debt tracker TD-42 fifth-hand-mirroring addendum).
4. **Loan-lifecycle stepper (live).** No longer the fabricated payment-journey mock (Funding /
   Coupon / …). `buildLifecycle` renders the fixed ordered stepper — **Origination · Disbursing ·
   Performing · Watchlist · Past Due · Default · Closed** — with the current step derived from the
   on-chain status via `statusToChip` (earlier = done, later = pending). **Origination** is the
   §3.1 In Review → Approved phase (before the loan exists on-chain), so it is always done for any
   loan the loan-book returns. Node labels + short descriptors are §3.1/§3.2 copy (content from the
   MD); the stepper **visual is kept from Figma** node `4116:10549`. The fabricated per-node dates
   (`5 Jan · batch #B-102`, …) are dropped. Data limit (documented in code): on-chain `Performing`
   maps to the **Performing** step, so **Disbursing** (approved on-chain, disbursement wire not yet
   sent) also shows as done and is never the current step until the off-chain "wire sent" movement
   signal is served.

Still mock (no backend source yet): summary tiles · registry state · current stage · other actions
(`-loanDetailMock.ts`, with the migrated `hero`/`priceCollateral`/`journey` slices removed).

## Docs to Update
- `loans.$id.tsx` header: Figma node id + token map (Step 4).
- No tech-debt entry needed (no new hand-mirrored API type — the mock has no backend counterpart).
