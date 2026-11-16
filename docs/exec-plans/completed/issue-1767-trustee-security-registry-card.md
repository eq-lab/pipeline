# Issue #1767: Trustee loan detail: security registry state — LTV, advance / margin-call ratios, cure period, margin call, security records and inspections (read-only)

Source: https://github.com/eq-lab/pipeline/issues/1767

## Scope

Finish the read-only SecurityRegistry view on the Trustee loan detail (`/loans/$id`), on top of what #1906 and #1858 already shipped. Everything is shown verbatim from `GET /v1/loan-book/{loan_id}/security?chain_id=<id>` (spec `docs/product-specs/loan-security-state.md`, handler `packages/api/src/routes/loan_security.rs`, DTOs `packages/api/src/security_state.rs`). Values that are not served show "—".

Already on `main`, so not redone here:

- `api/useLoanSecurity.ts`: the hook, Stellar-only, 30 s poll; a 404 `security_registry_not_configured` means hidden (#1906). It already types `records[]` and `inspections[]` partly (#1858).
- `routes/-loanSecurity.ts` + `SecurityCard` in `routes/loans.$id.tsx`: the summary card with LTV (tone), advance ratio, margin-call ratio, security value, amount owed, margin call, the price-stale chip, refresh note and "Security actions" link (#1906, #1858).
- The 130 / 120 / 110 % CCR bands, `haircut_pct`, `/valuations` and `/ccr-history` are already gone from the Trustee card and table (#1906). Nothing CCR is reintroduced.

This issue adds:

1. **Summary card (extend `SecurityCard`)**
   - A **Cure period** row from `terms.cure_period`.
   - Margin-call copy aligned to the user docs:
     - an overdue cure is "cure period ended", with a note that default is not automatic;
     - `open_call_curable` and `ltv_above_ratio_no_onchain_call` each get a note;
     - a stale price gets a note that it does not open a margin call.
2. **New "Security records" card**, full width below the Security / Registry row on every layout.
   - One block per served record:
     - instrument type (`protection`, verbatim), commodity and unit, status;
     - counted quantity, value, and price (benchmark, value per unit, last update);
     - attested (date, by) with stale and flagged chips, and "Not counted" when `counts_toward_value` is false.
   - Each record block has its **inspections** table:
     - kind, inspected date, quantity, grade;
     - entered by / at and approved by / at (or "Awaiting approval");
     - the three variances in bps, the variance flag and the resolution.
3. **Attention copy**:
   - The Past-Due notice no longer says or implies that default follows by itself.
   - The Overview **Needs Attention** Loans group lists a loan with an open margin call, using the served loan-book `margin_call_open`. The backend sidebar badge (`GET /v1/attention-counts` `loans.margin_call_open`) already counts these loans, so the list and the badge agree.

Out of scope:

- Any write. Set terms, flag resolution and consent release stay on `/risk-council/security/$id` (#1858). `revalue` (marks) is #1859, and Security Agent / inspection-operator flows are not in the Trustee app.
- Mark suggestions (`suggested_mark`, `mark_due`, `prices.marks_due`, #1783). They feed the Trustee's `revalue` flow (#1859), not this read-only view.
- `extension_consents`, record `docs`, `repayments`, `agent_release`, `margin_call.events`, `valuation.stale_value` / `flagged_value` / `coverage_bps`, `pending_operations` (PR #1928, open).
- EVM loans. They have no SecurityRegistry (the API answers 404, and the hook does not even fetch for non-Stellar chains), so they show neither card and no "—" placeholder (#1906 rule).
- `haircut_pct` in the origination submission form (`-origination-new.ts`). That is an off-chain submission input, not this card.
- Removing the CCR text from `collateral-valuation.md` / `price-feed.md`. That belongs to backend #1786 Phase 2 (in progress); this issue changes only the Trustee-facing pointer paragraph, to avoid a merge conflict.
- Loans-table tab mapping: a margin-call loan stays in its status tab. The LTV column already marks it red (#1906).

Design: no Figma frame exists for a records table or an inspections list, and the Trustee v3 design doc (`docs/design-docs/trustee-dashboard-v3-design-assignment.md`) predates the registry (it still speaks of CCR badges). Both cards are therefore built from the existing loan-detail primitives: `CARD_CLASS` / `cardStyle()` / `CardTitle` / `KeyValueRow` / `chipStyle` / `AddressText` from `components/detail/`. The table styling follows the loan-detail and Loans table tokens (`LINE_COLOR` row borders, Inter 15/16 px, `INK_MUTED` headers). No Figma verification step applies.

## Assumptions and Risks

- **Served shape.** The plan follows `security_state.rs`. Times (`opened_at`, `cure_by`, `attested_at`, `mark.at`, `inspected_at`, `entered_at`, `approved_at`) are unix-second decimal strings. Amounts, quantities, grades and `value_per_unit` are exact 7-decimal strings (`"1250.0000000"`). bps values and variances are JSON numbers. Every new field is typed optional and read with a type check, so a partial 200 never throws: this is the #1906 defensive-parsing rule, because the old `/valuations` hook crashed on such a response.
- **Formatting is not computation.** Trimming trailing zeros and grouping thousands on a 7-dp string, `formatFullUsd` on USD values (as the card already does for `valuation.value`), and unix-seconds to date are display formatting only. Nothing is rescaled or derived. Record values are served per record (`records[].valuation.value`) and are not summed client-side; the spec notes they can sum a few raw units above `valuation.value`, which is expected.
- **Nulls.**
  - `records[].valuation` is `null` when the record does not count or there is no snapshot. Counted quantity and value then show "—".
  - `attestation_stale` / `inspection_stale` are `null` unless the record is `Active`. No chip is shown for `null`.
  - `mark` is `null` for non-goods records. The price shows "—".
  - Inspections with `complete === false` (view-seeded) may lack `approved_by`. "Awaiting approval" is shown only when `approved_by` is null **and** `complete !== false`; otherwise "—".
- **Staging has no registry data yet.** On 2026-11-16, `GET /v1/loan-book/{0..8}/security?chain_id=99000001` on `api.pipeline.stage.eqlab.net` answered `terms: null`, `records: []` for every loan, and the loan book had `ltv_bps: null` everywhere. Unit tests cover the full shape from the spec's example. Live verification of records and inspections needs:
  - the Risk Council to set terms (`/risk-council/security/$id`, 24 h schedule);
  - the Security Agent to register and attest records and the inspection operators to enter and approve inspections (contracts-repo CLI; not available in the Trustee app).
  
  QA should note that this setup is needed; it is not a blocker for implementation.
- **Needs Attention change.** Adding margin-call loans to the Overview list is a behaviour change on another page, read from an already-served flag (`LoanBookEntry.margin_call_open`, #1786 Phase 1, typed by #1906). It mirrors the backend attention-count rule: skip `Closed` and `Default`, and count a loan once. It is in scope because the Issue asks for "margin call open → attention".
- **Overlap with #1786 Phase 2 (backend, open).** That issue owns removing the CCR text from `collateral-valuation.md` and `price-feed.md`. This issue edits only the one pointer paragraph (around line 118), so both can merge in either order with at most a trivial rebase.
- **Overlap with PR #1928 (open).** It adds `pending_operations` to `/security` and touches `docs/product-specs/loan-security-state.md` / `trustee-dashboard.md`. No conflict, because this issue does not edit `loan-security-state.md`, and its only edit to `trustee-dashboard.md` is a same-line wording change.
- **`trustee-dashboard.md` is 199/200 lines.** Edit it in place only (same line count) or not at all.
- **File size.** `routes/loans.$id.tsx` is about 1,540 lines. The records card goes in its own route-local view file, `routes/-SecurityRecordsCard.tsx` (JSX only, per `docs/FRONTEND.md` rule 2), with a pure presenter in `routes/-loanSecurityRecords.ts`.

## Open Questions

_None_

## Implementation Steps

Comment rule: at most one 2–3-line `// spec:` header per touched or new file, and no other comments (no JSDoc, no body or test comments). When you edit a block that carries narrative comments, remove them. Run `npx tsx scripts/lint-comments.ts` and shrink `scripts/lint-comments.baseline.json` for every touched file it lists (for example `components/-useNeedsAttention.test.ts`).

1. **Widen the client type** in `packages/trustee/src/api/useLoanSecurity.ts`. Add these served fields, all optional, and keep the existing ones:
   - `LoanSecurityMarginCall`: `open_call_curable?: boolean | null`.
   - `LoanSecurityRecord`:
     - `reference_grade?: string | null`, `perfected_at?: string | null`;
     - `attested_by?: string | null`, `attested_at?: string | null`;
     - `counts_toward_value?: boolean`;
     - `attestation_stale?: boolean | null`, `inspection_stale?: boolean | null`, `mark_stale?: boolean | null`;
     - `mark?: { value_per_unit?: string | null; at?: string | null; benchmark?: string | null } | null`;
     - `valuation?: { counted_quantity?: string; value_per_unit?: string; mark_at?: string; value?: string; stale?: boolean; flagged?: boolean } | null`;
     - `lot?: { latest_inspection_id?: string | null; latest_inspected_at?: string | null; latest_quantity?: string | null } | null`.
   - `LoanSecurityInspection`:
     - `inspected_at?: string | null`;
     - `entered_by?: string | null`, `entered_at?: string | null`;
     - `approved_by?: string | null`, `approved_at?: string | null`;
     - `resolved_at?: string | null`;
     - `is_lot_latest?: boolean`, `complete?: boolean`.
   - No behaviour change to the hook.

2. **Summary-card presenter** in `packages/trustee/src/routes/-loanSecurity.ts`:
   - Export `formatUnixDate` (already there, private) so the records presenter reuses it.
   - Add a **Cure period** row after Margin-call ratio: `formatServedDuration(sec.terms.cure_period ?? undefined)` from `@/utils/securityTermsUnits`, which gives "7 d" / "36 h" / "—".
   - `formatMarginCall`: when `cure_overdue === true`, replace the `" (overdue)"` suffix with `" · cure period ended"`.
   - Add exported copy constants and push them into `notes` in this order, only when the served flag is exactly `true`:
     - `CURE_ENDED_NOTE` = "The cure period has ended. Default is not automatic: the Risk Council decides whether to declare it." (`margin_call.open === true && margin_call.cure_overdue === true`).
     - `CURABLE_NOTE` = "LTV is back at or below the advance ratio. The registry cures the margin call at its next coverage check." (`margin_call.open === true && margin_call.open_call_curable === true`).
     - `ABOVE_RATIO_NO_CALL_NOTE` = "LTV is above the margin-call ratio. The registry has not opened a margin call yet." (`margin_call.ltv_above_ratio_no_onchain_call === true`).
     - `PRICE_STALE_NOTE` = "A stale price does not open a margin call; it alerts the Risk Council." (when `priceStale(sec)`). The existing chip stays.
   - The existing "No valuation yet." and refresh-failed notes keep their positions: no-valuation first, refresh-failed last.
   - `ltvTone`, `formatLtvBps`, `formatLtvLine` and `ltvRowText` stay unchanged; Risk Council Escalate and Reterm use them.

3. **Records presenter**, new file `packages/trustee/src/routes/-loanSecurityRecords.ts` (header `// spec: docs/frontend/trustee-flows.md#security-records-card`). Pure functions only:
   - `formatDecimal7(value: unknown): string`:
     - "—" unless the value is a string matching `/^-?\d+(\.\d+)?$/`;
     - otherwise group the integer part with `,` and trim trailing fractional zeros and a trailing `.` (`"1250.0000000"` → `"1,250"`, `"12.5000000"` → `"12.5"`).
     - String math only, no `parseFloat`.
   - `formatQuantity(value, unit)` = `formatDecimal7(value)` plus `" " + unit` when the unit is a non-empty string and the value is not "—".
   - `formatVariance(bps: unknown)` = `"{n} bps"` for a finite number, else "—" (same output as `-risk-council-security.ts` `variance`).
   - `formatActor(address: unknown, at: unknown)` returns `{ address: string | null; date: string }`, using `formatUnixDate` from `-loanSecurity.ts`.
   - Types:
     - `SecurityRecordChip = { label: string; tone: "attention" | "negative" | "neutral" }`.
     - `SecurityInspectionRow = { id; kind; inspected; quantity; grade; entered: {address,date}; approved: {address,date} | "awaiting" | null; varianceReference; variancePrevious; varianceGrade; flagged: boolean; resolution: string; latest: boolean }`.
     - `SecurityRecordView = { key; title; status; chips: SecurityRecordChip[]; rows: SecurityRow[]; attestedBy: string | null; inspections: SecurityInspectionRow[] }`.
     - `SecurityRecordsView = { state: "hidden" | "empty" | "ready"; records: SecurityRecordView[] }`.
   - `buildSecurityRecords(result: UseLoanSecurityResult): SecurityRecordsView`:
     - **hidden** when `buildSecurityCard(result).state !== "ready"`, which covers EVM / not configured / loading / error / no-terms. The summary card already shows those states.
     - **empty** when `records` is missing or `[]`. The view shows "No security records are registered for this loan."
     - **ready** otherwise, records in **served order** (no client sort).
   - Per record:
     - `title` = `"Record #{record_id} · {protection}"`; `protection` is verbatim, or "—".
     - `status` = `status` verbatim.
     - `chips`, each only on an exact `true`, or exact `false` for "Not counted":
       - "Flagged" (negative) when `flagged_by != null || valuation.flagged === true`;
       - "Attestation stale" (attention) when `attestation_stale === true`;
       - "Inspection stale" (attention) when `inspection_stale === true`;
       - "Price stale" (attention) when `mark_stale === true || valuation.stale === true`;
       - "Not counted" (neutral) when `counts_toward_value === false`;
       - "Closed" (neutral) when `open === false`.
     - `rows` (label → value):
       - Commodity → `commodity`;
       - Document quantity → `formatQuantity(reference_quantity, unit)`;
       - Counted quantity → `formatQuantity(valuation.counted_quantity, unit)`;
       - Value → `formatFullUsd(valuation.value)`;
       - Price → `"{benchmark} · {formatUsdExact(trimmed value_per_unit)} per {unit}"` from `mark`, or "—" when `mark` or its `value_per_unit` is missing; the benchmark and unit parts are dropped when missing;
       - Price updated → `formatUnixDate(mark.at)`;
       - Attested → `formatUnixDate(attested_at)`.
     - `attestedBy` = `attested_by` or `null`. The view renders it with `AddressText`.
   - Per inspection (served order):
     - `kind` and `grade` verbatim, or "—";
     - `quantity` = `formatQuantity(quantity, record.unit)`;
     - `inspected` = `formatUnixDate(inspected_at)`;
     - `entered` = `formatActor(entered_by, entered_at)`;
     - `approved` = `formatActor(approved_by, approved_at)` when `approved_by` is a string; `"awaiting"` when `approved_by == null && complete !== false`; else `null` ("—");
     - the three variances via `formatVariance`;
     - `flagged` = `flagged === true`;
     - `resolution` = verbatim or "—";
     - `latest` = `is_lot_latest === true`.

4. **Loan-detail presenter** in `packages/trustee/src/routes/-useLoanDetail.ts`: add `securityRecords: SecurityRecordsView` to `UseLoanDetailResult`, set to `buildSecurityRecords(security)` next to `security: buildSecurityCard(security)` (around line 558). No new fetch.

5. **Records view**, new file `packages/trustee/src/routes/-SecurityRecordsCard.tsx` (JSX only; header `// spec: docs/frontend/trustee-flows.md#security-records-card`):
   - `SecurityRecordsCard({ view }: { view: SecurityRecordsView })` returns `null` when hidden.
   - Card shell: `CARD_CLASS` + `cardStyle()`, `p-[26px]`, `CardTitle` "Security records", test id `loan-detail-security-records`.
   - Empty: a muted 14 px line, test id `loan-detail-security-records-empty`.
   - Ready: one block per record (test id `loan-detail-security-record`, `data-record-id`), separated by a `LINE_COLOR` top border:
     - header: title in Inter 16 px ink, the status verbatim in muted text, and the chips as `chipStyle(tone)` pills (12 px, test id `loan-detail-security-record-chip`);
     - the `rows` as `KeyValueRow`s, and "Attested by" as an `AddressText` row when `attestedBy` is set;
     - an "Inspections" sub-heading (Inter 15 px muted), then a horizontally scrollable table (`overflow-x-auto`, header row in `INK_MUTED` 13 px, body 14 px, `LINE_COLOR` row borders). Columns: Inspection (`#id`, with a muted "latest" tag when `latest`), Kind, Inspected, Quantity, Grade, Entered (address + date), Approved (address + date / "Awaiting approval" / "—"), Variance ref / prev / grade, Flag ("Flagged" negative pill or "—"), Resolution;
     - test ids `loan-detail-security-inspection` per row; "No inspections." when the list is empty.
   - Mobile: the record header wraps (`flex-wrap`), and the table scrolls inside the card, never the page.

6. **Mount the card** in `packages/trustee/src/routes/loans.$id.tsx`:
   - Render `<SecurityRecordsCard view={detail.securityRecords} />` directly after the Security row `div` in all three layouts (watchlist, matured, performing/disbursing), before the current-stage / disbursement cards.
   - Remove the narrative JSX comments in the layout blocks you edit.

7. **Past-Due notice copy** in `packages/trustee/src/routes/loans.$id.tsx` `PastDueNotice`:
   - Body → "Maturity has passed. If the payment arrived, record it. If it didn't, escalate the loan to the Risk Council. Default is never automatic."
   - Escalate button label → "Escalate to Risk Council". Test id unchanged; it still calls `onOtherAction("Escalate to Risk Council")`.
   - The title "Past due — this loan needs a decision" is unchanged.

8. **Watchlist static copy** in `packages/trustee/src/routes/-loanDetailStatic.ts` `WATCHLIST_CURRENT_STAGE.body` (not rendered, #938, but kept accurate) → "A margin call is open or the LTV is above the margin-call ratio. The borrower has the cure period to bring the LTV back to the advance ratio. The end of the cure period does not trigger default by itself: if the loan is past recovery, escalate it to the Risk Council."

9. **Needs Attention**, in `packages/trustee/src/components/useNeedsAttention.ts`. Collapse the file's comments to one spec header.
   - `loanAttentionLabel(status: string, marginCallOpen: boolean | null | undefined = null): string | null`:
     - `Closed` / `Default` → `null`;
     - the status label as today (`Watchlist` / `Matured`);
     - when `marginCallOpen === true`: the label is "Margin call open", or `"{status label} · margin call open"` when a status label exists.
   - The hook passes `entry.margin_call_open`.
   - A loan yields at most one row. EVM rows carry `null`, so they are unchanged.

10. **Lint and build** (from the repo root unless noted):
    - `npx tsx scripts/lint-comments.ts` and `npx tsx scripts/lint-docs.ts`;
    - `yarn workspace @pipeline/trustee lint`;
    - `yarn workspace @pipeline/trustee build`. There are no new routes, so `routeTree.gen.ts` does not change.
    - Acceptance grep `rg -iw 'ccr|haircut' packages/trustee/src/routes/-loanSecurity*.ts packages/trustee/src/routes/-SecurityRecordsCard.tsx packages/trustee/src/routes/loans.\$id.tsx` returns nothing.

## Test Strategy

Run vitest from inside `packages/trustee` (`cd packages/trustee && npx vitest run <files>`), then the full trustee suite.

- **`routes/-loanSecurity.test.ts`** (extend):
  - Cure period row: `"604800"` → "7 d", `null` / missing → "—".
  - `formatMarginCall` with `cure_overdue: true` → "… · cure period ended" (update the old "(overdue)" expectation).
  - Notes:
    - `CURE_ENDED_NOTE` appears only for open plus overdue;
    - `CURABLE_NOTE` appears only for open plus curable;
    - `ABOVE_RATIO_NO_CALL_NOTE` appears for the no-on-chain-call flag;
    - `PRICE_STALE_NOTE` appears through either price flag;
    - none of them appears for `null` / `false` / missing flags;
    - the note order is as specified.
  - A partial `{ terms: {...} }` with no `margin_call` does not throw.
- **`routes/-loanSecurityRecords.test.ts`** (new):
  - `formatDecimal7`: `"1250.0000000"` → "1,250"; `"0.5000000"` → "0.5"; `"-3.1000000"` → "-3.1"; `"1e5"` / `null` / `12` → "—".
  - `buildSecurityRecords`:
    - hidden for notConfigured / loading / error / `terms: null`;
    - empty for `records: []` and for a missing `records`;
    - ready keeps the served order.
  - A goods record with the full spec-example shape maps title, status, every row, the price string and `attestedBy`.
  - Non-goods records:
    - a record with `mark: null` → Price "—";
    - a record with `valuation: null` → counted quantity and value "—".
  - Chips: each chip appears only on the exact served flag. `attestation_stale: null` gives no chip; `counts_toward_value: false` gives "Not counted"; `open: false` gives "Closed".
  - Inspections: approved (address + date); `approved_by: null, complete: true` → "awaiting"; `approved_by: null, complete: false` → `null`; variances "120 bps" / "—"; `flagged: true`; `is_lot_latest`.
  - A record `{}` and an inspection `{}` do not throw.
- **`routes/-useLoanDetail-hook.test.ts`**: with `useLoanSecurity` mocked as ready with records, `securityRecords.state === "ready"`; EVM gives hidden.
- **`routes/-loans.$id.test.tsx`**:
  - Stellar ready with two records (one goods with inspections, one cash cover with no mark or valuation): the records card renders in the performing, watchlist and matured layouts; the record blocks, chips, inspection rows and the "Awaiting approval" text are present; the "Cure period" row and the notes are present.
  - `records: []` shows the empty line.
  - An EVM loan, `terms: null`, and a 404-hidden security show no `loan-detail-security-records`.
  - The Past-Due notice shows the new body text and the "Escalate to Risk Council" label, and still navigates to the escalate route (update the existing assertions around line 764).
- **`components/-useNeedsAttention.test.ts`** and **`components/-NeedsAttention.test.tsx`**:
  - `Performing` + `margin_call_open: true` → "Margin call open";
  - `WatchList` + `true` → "Watchlist · margin call open", one row;
  - `Closed` / `Default` + `true` → no row;
  - `margin_call_open: null` / missing → as today;
  - a margin-call row links to `/loans/$id` with `chain`.
- **Gates**: trustee lint, build (`tsc`) and the full vitest pass; `lint-comments` and `lint-docs` pass.

## Docs to Update

- **`docs/frontend/trustee-flows.md`**:
  - §"Security card" (`#security-card`):
    - add the Cure period row;
    - the new margin-call copy ("cure period ended") and the four notes with their exact text and flags;
    - replace the "Extension point" bullet with a pointer to the records card.
  - New §"Security records card" (`#security-records-card`), right after it:
    - served fields per record and per inspection;
    - the states (hidden / empty / ready), the served order, the chip rules, the null rules (`valuation`, `mark`, the stale flags, `complete`);
    - 7-dp formatting without rescaling;
    - test ids;
    - "no Figma frame: built from the loan-detail primitives";
    - out-of-scope fields (mark suggestions, consents, docs, repayments, events).
  - §"Loan detail" intro sources: add `-loanSecurityRecords.ts` and `-SecurityRecordsCard.tsx`.
  - §"Status-conditional layout": the records card sits below the Security row in every variant.
  - §"Wired actions" Past-Due notice: the new copy and the "Escalate to Risk Council" button.
  - §"Needs Attention section", Loans group: margin-call rows, the label rule, `Closed` / `Default` skipped, aligned with `GET /v1/attention-counts`.
- **`docs/product-specs/collateral-valuation.md`**: rewrite only the paragraph at line 118 ("The Stellar SecurityRegistry state … This CCR flow is unchanged (#1786)."). New text: the Trustee console shows the SecurityRegistry state on the loan detail (LTV = amount owed / security value, no haircut; terms, margin call, records and inspections; #1906, #1767), it no longer shows this record's CCR or `haircut_pct`, and retiring the CCR parts of this spec is #1786 Phase 2. Line count stays at or under 124 (cap 200).
- **`docs/product-specs/trustee-risk-watchlist.md`**:
  - §"LTV and margin-call state": add a bullet that the borrower has the cure period to bring the LTV back to the advance ratio, and that the end of the cure period does not trigger default by itself (the Risk Council decides), plus a pointer to the records card.
  - §"Past Due": the escalation path goes to the Risk Council, and default is never automatic.
  - Mention that an open margin call surfaces in Needs Attention.
- **`docs/product-specs/trustee-dashboard.md`** (199/200): edit in place only. Change Flow 3's trigger "Price-feed threshold crossing" to "SecurityRegistry margin call", without adding lines. If that is not possible, leave the file unchanged.
- **`docs/exec-plans/tech-debt-tracker.md`** TD-42 (around line 617): note that the `useLoanSecurity` hand-mirror now also covers the record and inspection display fields.
- **`docs/user-stories/epic-1795/1767-trustee-security-registry-card.md`** (new), plus its row in `docs/user-stories/index.md` under epic 1795. Stories:
  1. A Stellar loan with terms shows LTV, the ratios, the cure period and the margin-call state verbatim.
  2. An open margin call shows the cure deadline. After the deadline it reads "cure period ended" with the not-automatic note, and the loan appears in Needs Attention.
  3. A stale price shows the chip and the note.
  4. The records card lists each record with counted quantity, value, price (benchmark, last update) and attestation, plus stale and flagged chips.
  5. Inspections show entered / approved (or awaiting) and variances, with a flag.
  6. A loan with terms but no records shows the empty line.
  7. EVM and `terms: null` loans show no records card.
  8. The Past-Due notice offers Record payment / Escalate to Risk Council.
  
  The stories doc notes the testnet setup that is needed (set terms via #1858, register and attest records and approve inspections via the contracts CLI); staging served no terms on 2026-11-16.
