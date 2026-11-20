# Issue #799: Trustee: Overview "Needs Attention" section (deferred from #797)

Source: https://github.com/eq-lab/pipeline/issues/799

## Scope

The Origination group (#818, #1046) and a Loans group (Watchlist / Matured / margin call, #867,
#1767, #1942) already ship in `packages/trustee/src/components/NeedsAttention.tsx` +
`useNeedsAttention.ts`. This issue adds the three groups that were deferred for lack of data,
**each only where a real served source exists today**. Source audit (2026-11-20):

| Group (Figma `4116:9018`+) | Served source today | Verdict |
|---|---|---|
| Loans: Payments Due | `GET /v1/loan-book` rows carry `next_payment_timestamp` (#953) and server-computed `days_overdue` (`null` = not yet due) | **Build the overdue half**: rows with `days_overdue != null`. "Due soon" (not yet overdue) needs a look-ahead window the backend does not serve, so it is not built (see Open Questions). |
| Cash Management | `GET /v1/cash-book?chain_id=` (Trustee-only, Stellar minter chains; `404 minter_not_configured` elsewhere): `wire_ins[].status === "Escrowed"`, `wire_outs[].status === "Pending"`, `ramps[].status === "Open"`. Same filters the Cash Management tabs already apply (`-escrowed-wires.ts`, `-wire-outs.ts`), and they match `GET /v1/attention-counts` `escrowed_wire_ins` / `pending_wire_outs` / `open_ramps` | **Build** escrowed wire-ins, pending wire-outs, open ramps (session chain only). |
| Cash Management: "Top up" (queue coverage low) | `GET /v1/withdrawal-queue` serves balances but no "coverage low" flag | **Deferred**: deciding "low" is a client-side threshold (frontend-computed metric). |
| Risk Council | `pending_operations[]` on each `GET /v1/loan-book` row (#1922/#1941), each with served `state` (`waiting` / `ready` / `expired`), `function`, `ready_at` | **Build**: one row per served pending operation, session chain only. |

Out of scope: pending ramp events / pending bank deposits rows (served as counts only, not in the
Figma group; can follow up), the withdrawal-queue Top up row, any "due soon" window, the
design-doc v3 worklist events with no served source (Mint pending past SLA, CCR stale, Refund
owed, Ready to close, etc.), the session-local executed/scheduled merge the Risk Council hub
does (the Overview shows served operations only), backend changes.

## Assumptions and Risks

- `docs/user-docs/**` has no Trustee Overview / worklist content, so behavior comes from
  `docs/frontend/trustee-flows.md` "Needs Attention section" and the v3 design doc S1 worklist
  table (`docs/design-docs/trustee-dashboard-v3-design-assignment.md`). Figma is styles only.
- Chain scope (memory rule): Origination/Loans are cross-network (all chains, chain label in the
  subtitle — existing behavior). Cash Management and Risk Council are per-network pages, so their
  groups read `useSessionState().chainId` (fallback `ENV.STELLAR_CHAIN_ID`, as
  `-escrowed-wires.ts` does) and the group subtitle names the chain. Linking a cross-chain Risk
  Council op to `/risk-council` would land on the wrong chain, hence the session filter.
- `useCashBook` must be `enabled` only on a Stellar session chain (`chainKindOf(chainId) ===
  "stellar"`); on EVM the group is simply absent. A cash-book error (incl. 404) hides only the
  Cash Management group, not the whole section — change today's all-or-nothing error gate to a
  per-group gate so a Trustee-only cash-book failure cannot hide Origination rows.
- Payment overdue vs. existing "Matured": for bullet loans `next_payment_timestamp == maturity`,
  so an overdue loan is usually also `Past Due` and already in the Loans group. To avoid two rows
  for one loan the Payments Due row is emitted only when the loan is NOT already in the Loans
  group (one row per loan per event, v3 worklist rule) — flagged in Open Questions.
- Amount strings are base-6 USDC served as decimal strings; render with the existing trustee
  amount formatter verbatim (no rescaling). Missing fields render `—`.
- Stale spec line `docs/frontend/trustee-flows.md` ~587 ("Payments due … no `/v1/loan-book`
  data source") predates #953; update it.

## Open Questions

1. Payments Due: build only "Payment overdue" (served `days_overdue`), or does the product want a "due within N days" row too? That needs a backend-served flag/window; the planner defaults to overdue-only.
2. Payment overdue overlapping a Past Due/Matured loan already in the Loans group: suppress the duplicate (planner default) or show it in both groups (Figma shows both "Matured" and "Record coupon" rows)?
3. Risk Council rows: show `expired` operations (they can still be canceled on EVM) or only `waiting` + `ready`? Planner default: all three, with the state in the subtitle.
4. Withdrawal-queue "Top up" row stays deferred until the backend serves a coverage-low flag (e.g. on `/v1/attention-counts`) — confirm, and should a backend follow-up issue be filed (backend issues are not claimed by this flow)?

## Implementation Steps

1. `packages/trustee/src/components/useNeedsAttention.ts`
   - Add row types: `PaymentDueRow { key, loanId, chainId, title, subtitle, daysOverdue }`,
     `CashRow { key, kind: "escrow" | "wireout" | "ramp", title, subtitle, tab }`,
     `RiskCouncilRow { key, loanId, chainId, operationId, title, subtitle }`.
   - `mapLoanToPaymentDueRow(entry)`: only when `entry.days_overdue != null` and status not
     `Closed`/`Default` and `loanAttentionLabel(...)` is `null` (dedupe, OQ2). Title
     `${originator} · ${commodity}`; subtitle `Payment overdue · ${days_overdue} days late ·
     loan #${id} · ${chainLabel}` (served integer verbatim, "1 day" singular).
   - `useCashBook(sessionChainId, { enabled: stellar, refetchMs: 30_000 })` (shares the
     `["cash-book", chainId]` cache with the tabs). Map: Escrowed wire-in → title `Escrowed
     wire-in #${id}`, subtitle `${amount} USDC · value date ${value_date} · ${chainLabel}`, tab
     `escrow`; Pending wire-out → title `Wire-out #${id} — ${lp_legal_name ?? "—"}`, subtitle
     amount · requested date · chain, tab `wireouts`; Open ramp → title `${direction label} ramp
     #${id}`, subtitle amount · opened date · chain, tab `onofframp`. Reuse the existing date and
     amount formatters used by those sections (`formatSubmittedDate`, the cash-management amount
     helper) — no new math.
   - Risk Council: from `useLoanBook()` data (already fetched) take loans with
     `chain_id === sessionChainId`, flatMap `pending_operations ?? []`. Title
     `${canonicalPendingFunction(op.function)} — loan #${loan_id}` using the hub's existing
     human label helper if one exists in `-risk-council-shared.ts` / `RiskCouncilParts.tsx`
     (reuse; do not duplicate); subtitle `${state} · ready ${formatted ready_at} · ${chainLabel}`.
     Sort by `ready_at` then `operation_id` (hub order). Key `${chain}:${operation_id}`.
   - Replace the global error gate with per-group results: each group is `[]` while its own
     query loads or errors; `state` is `ready` if any group has rows, else `empty`/`loading`.
     Keep the existing return fields (`rows`, `loanRows`) and add `paymentRows`, `cashRows`,
     `riskRows`.
2. `packages/trustee/src/components/NeedsAttention.tsx`
   - Extract the repeated group markup into a local `Group` component (label + rows) to avoid a
     fifth copy; keep classes/tokens identical.
   - Render groups in Figma order: Origination, Loans, Payments Due (label per Figma group
     header), Cash Management, Risk Council.
   - Actions: Payments Due → `Link to="/loans/$id_/record-coupon"` params `{ id }` search
     `{ chain }` label "Record coupon"; Cash → `Link to="/cash-management" search={{ tab }}`
     label "Review" for escrow/wire-out, "Track" for ramps; Risk Council → `Link
     to="/risk-council"` label "Review". Check the record-coupon route's actual search schema
     and param name before wiring.
   - Icon per group: reuse the sidebar glyphs from `TrusteeNavIcons` (Loans / Cash / Risk
     Council icons) if exported; otherwise keep `OriginationIcon`.
   - Keep the file to one spec-pointer header comment (comment-minimal rule).
3. Docs (see below), then `yarn workspace @pipeline/trustee lint`, `test`, `build`.

## Test Strategy

- `packages/trustee/src/components/-useNeedsAttention.test.ts`: unit-test the new mappers —
  overdue row emitted only for `days_overdue != null`, suppressed when the loan is already a
  Watchlist/Matured/margin-call row, skipped for Closed/Default; cash mapping filters exactly
  `Escrowed` / `Pending` / `Open` and ignores Direct/Assigned/Returned/Settled/Cancelled/Closed;
  missing `lp_legal_name` renders `—`; Risk Council keeps only session-chain loans, sorts by
  `ready_at`, handles missing `pending_operations`.
- Hook tests (mocked `apiFetch`, existing pattern): cash-book not requested on an EVM session
  chain; cash-book 404/500 hides only that group while Origination rows still render; loan-book
  error hides Loans/Payments/Risk groups only.
- `-NeedsAttention.test.tsx`: each new group renders with its testid
  (`needs-attention-payments`, `needs-attention-cash`, `needs-attention-risk-council`), correct
  link targets/search (`tab=escrow`, `chain=`), and the section still returns `null` when all
  groups are empty.
- Live check on staging (user's own browser, no automation): rows match the Cash Management
  tabs and Risk Council hub for the same chain; Network tab shows real `/v1/cash-book` and
  `/v1/loan-book` calls. Figma verification of group header / row styling against node
  `4116-8854` (groups `4116:9018`+), styles only.

## Docs to Update

- `docs/frontend/trustee-flows.md` "Needs Attention section": add Payments Due, Cash Management
  and Risk Council bullets (sources, chain scope, dedupe rule, links, per-group error gate);
  replace the "Scope (#818, cross-linked to #799)" paragraph with what stays deferred (due-soon
  window, Top up) and why; fix the stale "Payments due … no data source" line (~587).
- `docs/design-docs/trustee-dashboard-v3-design-assignment.md`: no change (worklist table is the
  target design).
- `docs/exec-plans/tech-debt-tracker.md`: add an entry for the deferred Top up / due-soon rows
  pending backend-served flags.
