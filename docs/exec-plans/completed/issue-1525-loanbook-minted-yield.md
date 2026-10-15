# Issue #1525: LoanBook financials: per-loan minted yield from CashRepaid (YieldMinted is no longer indexed)

Source: https://github.com/eq-lab/pipeline/issues/1525

Parent epic: #1520. Siblings (parallel): #1523, #1524, #1526. Standalone consumer: #1533 (dashboard
cumulative yield) will reuse the shared row type and repo query designed here.

## Scope

`GET /v1/loan-book/{loan_id}/financials` serves `minted_yield` from
`ContractLogsRepo::minted_yield_for_loan` (`packages/shared/src/contract_logs_repo.rs:732`), which
only sums `YieldMinted` rows joined through `yield_mint_outbox`. Neither arm parses `YieldMinted`
any more (#1433, #1434, TD-130), so the figure is frozen and `not_minted_yield` keeps growing.

After this change, per-loan minted yield =

- **legacy leg**: the existing `YieldMinted` ⨝ `yield_mint_outbox` sum (kept for history), plus
- **minter leg**: for every Minter `CashRepaid` row of the loan that has no matching
  `CashRepaymentReversed`, `interest_minted` + the `PaymentRecorded` fee leg (resolved decision 1),

summed raw, then normalised once to the canonical 6-dp scale per chain kind
(`shared::chains::normalize_usdc_amount`: EVM as-is, Stellar ÷10 rounding down).

The minter-leg query and the netting/normalising arithmetic live in `packages/shared` so #1533 can
reuse them with `loan_id = None` and a time bound.

Contract facts verified (both arms, `pipeline-contracts` @ `3b74e98`
`src/minter/MinterUpgradeable.sol:285-357`; `pipeline-stellar-contracts` @ `b4d4a57`
`contracts/minter/src/lib.rs:284-406`):

- `repay` mints `interest` PLUSD atomically (to sPLUSD, or to the Pocket for a carved-out loan) and
  `fees = mgmt_fee + perf_fee + oet_alloc` PLUSD, which it stakes into sPLUSD for the treasury.
  `CashRepaid.interest_minted` is that PLUSD amount (USDC-equivalent units: 6 dp EVM, 7 dp Stellar).
- **`CashRepaid.fee_shares` is the sPLUSD share count returned by the vault deposit, not a USDC /
  PLUSD amount.** The PLUSD fee amount itself is not in the event. sPLUSD shares are not 1:1 with
  PLUSD (exchange rate drifts upward), and the Stellar vault has a configurable `decimals_offset`.
- `CashRepaymentReversed` identifies the reversed repayment by `(loan_id, repayment_id)`
  (`loan_id` topic + `repayment_id` field). A reversal undoes the whole repayment: interest PLUSD
  is absorbed / un-released, fee shares are burned. Stellar rejects a second reversal
  (`AlreadyReversed`); repayment ids are monotonic per loan on both registries
  (`nextRepaymentId++`), so an id is never reused after a reversal.
- The LoanRegistry `PaymentRecorded` row of the same repayment carries `params.loan_id` and
  `params.event {repayment_id, mgmt_fee, perf_fee, oet_alloc, ...}` as decimal strings on both arms
  (`parsers.rs`, `stellar/loan_registry_parsers.rs`). Its USDC amounts and `interest_minted` (PLUSD)
  share one scale per chain (6 dp EVM, 7 dp Stellar), so the fee leg is exact (resolved decision 1).

Out of scope:

- Dashboard cumulative yield (`dashboard.rs`, `list_yield_mints`) — #1533. Do not touch it.
- Changing the `LoanFinancialsResponse` shape or the `not_minted_yield` formula
  (`(interest + fees) − minted_yield`, clamped at 0). Note `fees` there excludes `oet_alloc`
  while the minted fee leg includes it; the clamp absorbs that (see Assumptions).
- Scoping minter rows to a configured Minter address: they stay chain-scoped (resolved decision 3;
  #1526 handles LoanRegistry scoping only).
- Relayer / `yield_mint_outbox` cleanup; frontend code.

## Assumptions and Risks

- **No double count between legs.** `YieldMinted` came from the pre-#33 Stellar yield-minter and
  the retired EVM `PipelineYieldMinter`; post-rework minters emit `CashRepaid` and never
  `YieldMinted` (`docs/references/backend.md` "no deployment emits both"). A loan whose repayments
  span both eras is summed correctly. If a pre-#33 repayment also had a `CashRepaid` row (it cannot —
  the event did not exist) we would double count; noted only for completeness.
- **Carved-out loans.** `interest_minted` is minted to the Pocket rather than sPLUSD for a
  carved-out loan. The plan counts it as minted (the trustee "nothing left to mint" close gate in
  `docs/frontend/trustee-flows.md` needs `not_minted_yield = 0` once the repayment is booked). See
  Resolved decision 2.
- **Fee-leg join (resolved decision 1).** Joins `PaymentRecorded` on `chain_id`, `tx_hash`,
  `loan_id` and `event.repayment_id`, taking `mgmt_fee + perf_fee + oet_alloc`. If no row matches,
  the fee leg counts as 0 and the route logs a single `warn` with the count of live repayments
  without a record, so `not_minted_yield` over-reports rather than silently under-reports.
- **Reversal bound.** For the "now" financials read, a reversal at any time removes the repayment.
  The row carries `reversed_at` so #1533 can evaluate as-of a past instant.
- **Rounding.** Raw legs are summed first and normalised once, so the Stellar total loses at most
  one base unit (matches today's `minted_yield_for_loan`). #1533 may normalise per row for a time
  series; tiny cross-endpoint differences (≤ 1 base unit per row) are acceptable.
- **Malformed rows.** `COALESCE(…, 0)` on `interest_minted` / `fee_shares` so one bad row cannot
  fail-decode the whole query (same guard pattern as `list_yield_mints`).
- **Parallel siblings.** #1523 / #1524 / #1526 edit other functions in `contract_logs_repo.rs` and
  `loan_financials.rs`-adjacent files; expect trivial merge conflicts in doc comments only. #1526
  may add a LoanRegistry-address filter to snapshot queries; this issue's minter queries do not take
  part in that.
- No DB-backed tests are allowed, so the SQL itself is only exercised by `cargo sqlx`-free compile
  and manual verification; all arithmetic is pushed into a pure function that is unit-tested.

## Resolved decisions (human, 2026-10-15)

1. **Fee leg from `PaymentRecorded` (human, 2026-10-15; supersedes option A).** Exact on-chain
   fees replace the heuristic `StakingDeposit` match. `CashRepaid.fee_shares` is an sPLUSD share
   count, so it is never summed. The fee leg is `mgmt_fee + perf_fee + oet_alloc` from
   `params->'event'` of the LoanRegistry `PaymentRecorded` row matched on `chain_id`, `tx_hash`,
   `loan_id`, `repayment_id`. USDC and PLUSD share one scale per chain, so raw sums are safe. A
   live repayment with no matching row counts 0 fees and the route logs a single `warn`. A
   reversed repayment drops both interest and fees.
2. **Carved-out loans: yes.** `interest_minted` minted to the Pocket for a carved-out loan counts as
   minted yield; no per-repayment `carved_out` lookup is needed.
3. **No address scoping for Minter rows.** #1526 adds a LoanRegistry-address filter to LoanBook loan
   queries; `list_repayment_mints` reads Minter rows (a different contract) and stays chain-scoped.
   The reversal join still matches on the same `contract_address` as its `CashRepaid` row.

## Open Questions

_None_

## Implementation Steps

1. **Row type + repo query** — `packages/shared/src/contract_logs_repo.rs`:
   - Add `#[derive(Debug, Clone, sqlx::FromRow)] pub struct RepaymentMintRow { loan_id: BigDecimal,
     repayment_id: BigDecimal, block_timestamp: i64, interest_minted: BigDecimal,
     fee_amount: Option<BigDecimal>, reversed_at: Option<i64> }`
     (all amounts raw on-chain scale; `pub` fields) next to `YieldMintRow`.
   - Add `pub async fn list_repayment_mints<'e, E>(&self, executor: E, chain_id: i64,
     loan_id: Option<&BigDecimal>, to_unix: i64) -> anyhow::Result<Vec<RepaymentMintRow>>`:
     ```sql
     SELECT (r.params->>'loan_id')::numeric               AS loan_id,
            (r.params->>'repayment_id')::numeric          AS repayment_id,
            r.block_timestamp,
            COALESCE((r.params->>'interest_minted')::numeric, 0) AS interest_minted,
            pr.fee_amount,
            rv.reversed_at
     FROM contract_logs r
     LEFT JOIN LATERAL (
         SELECT (p.params->'event'->>'mgmt_fee')::numeric
              + (p.params->'event'->>'perf_fee')::numeric
              + (p.params->'event'->>'oet_alloc')::numeric AS fee_amount
         FROM contract_logs p
         WHERE p.chain_id = r.chain_id AND p.tx_hash = r.tx_hash
           AND p.event_name = 'PaymentRecorded'
           AND (p.params->>'loan_id')::numeric = (r.params->>'loan_id')::numeric
           AND (p.params->'event'->>'repayment_id')::numeric = (r.params->>'repayment_id')::numeric
         ORDER BY p.log_index DESC LIMIT 1
     ) pr ON true
     LEFT JOIN LATERAL (
         SELECT MIN(v.block_timestamp) AS reversed_at
         FROM contract_logs v
         WHERE v.chain_id = r.chain_id
           AND v.contract_address = r.contract_address
           AND v.event_name = 'CashRepaymentReversed'
           AND (v.params->>'loan_id')::numeric = (r.params->>'loan_id')::numeric
           AND (v.params->>'repayment_id')::numeric = (r.params->>'repayment_id')::numeric
           AND v.block_timestamp <= $3
     ) rv ON true
     WHERE r.chain_id = $1
       AND r.event_name = 'CashRepaid'
       AND ($2::numeric IS NULL OR (r.params->>'loan_id')::numeric = $2)
       AND r.block_timestamp <= $3
     ORDER BY r.block_number, r.log_index
     ```
     Bind `loan_id` as `Option<&BigDecimal>`. Verify the `contract_address` column type/format
     against the table (cast `::text` if needed). No normalisation here — raw values.
   - Replace `minted_yield_for_loan` with `pub async fn legacy_yield_minted_raw_for_loan` — same
     SQL, but returns the **raw** sum (drop the `normalize_usdc_amount` call; normalisation moves to
     step 2). Its only caller is `loan_financials.rs`. Fix the doc comment accordingly (and drop the
     outdated "flat params" wording only where it describes these functions).

2. **Pure arithmetic** — new `packages/shared/src/minted_yield.rs` (one 2–3-line spec-pointer
   header, no other comments), registered in `packages/shared/src/lib.rs`:
   - `pub fn is_live_at(row: &RepaymentMintRow, as_of: i64) -> bool` —
     `row.block_timestamp <= as_of && row.reversed_at.map_or(true, |t| t > as_of)`.
   - `pub fn net_repayment_minted_raw(rows: &[RepaymentMintRow], as_of: i64) -> BigDecimal` —
     Σ over live rows of `interest_minted + fee_amount.unwrap_or(0)`. `fee_shares` is never summed.
   - `pub fn repayments_without_payment_record(rows: &[RepaymentMintRow]) -> usize` — non-reversed
     rows with `fee_amount.is_none()`.
   - `pub fn loan_minted_yield(kind: ChainKind, legacy_raw: &BigDecimal,
     rows: &[RepaymentMintRow], as_of: i64) -> BigDecimal` —
     `normalize_usdc_amount(kind, &(legacy_raw + net_repayment_minted_raw(rows, as_of)))`.
   These are the reuse points for #1533 (it will call `list_repayment_mints(.., None, to)` and
   `is_live_at` / per-row normalisation itself).

3. **Route** — `packages/api/src/routes/loan_financials.rs`:
   - Replace the `minted_yield_for_loan` call with a `tokio::try_join!` of
     `legacy_yield_minted_raw_for_loan(&state.pool, chain_id, &loan_id)` and
     `list_repayment_mints(&state.pool, chain_id, Some(&loan_id), now)`, then
     `let kind = shared::chains::parse_chain_type(chain_id)?;`
     `let minted_yield = shared::minted_yield::loan_minted_yield(kind, &legacy, &rows, now);`
   - If `repayments_without_payment_record(&rows) > 0`, `tracing::warn!` with `chain_id`, `loan_id` and the count.
   - `build_response` signature is unchanged.
   - Update the module header and the `minted_yield` / `not_minted_yield` field doc comments to
     state the new source (legacy `YieldMinted` + Minter `CashRepaid` net of
     `CashRepaymentReversed`); keep them to the existing pointer style.

4. **Lint/build** — `cargo clippy --all -- -D warnings`, `cargo test -p shared -p pipeline-api`
   (package names as in the workspace `Cargo.toml`).

## Test Strategy

New `packages/shared/tests/minted_yield.rs` (pure, no DB, no env vars; spec-pointer header to this
plan). Build `RepaymentMintRow` fixtures directly:

- EVM, legacy only: `legacy_raw = 40_000_000`, no rows → `40_000_000`.
- EVM, one live repayment: `interest_minted = 50_000_000`, `fee_amount = Some(50_000_000)` →
  `100_000_000`.
- EVM, legacy + minter legs combined.
- Stellar, 7-dp raw: `interest_minted = 500_000_005`, `fee_amount = Some(5)` → sum then ÷10 →
  `50_000_001`; and legacy + minter summed before normalising.
- Reversal: repayment with `reversed_at = Some(t)` and `as_of >= t` → excluded; with `as_of < t`
  → included (time-bounded view for #1533).
- Repayment with `block_timestamp > as_of` → excluded.
- No `PaymentRecorded`: `fee_amount = None` → fee contributes 0 and
  `repayments_without_payment_record == 1`; a reversed row with `None` is not counted.
- Reversed repayment with fees drops interest and fees together.
- Multiple repayments on one loan, one reversed → only the live ones summed.

`packages/api/tests/loan_financials.rs`: existing `build_response` tests stay valid (signature
unchanged). Add one case asserting `not_minted_yield = 0` when `minted_yield` (passed in) equals
`interest + mgmt + perf + oet` (oet over-count clamps to zero).

Parser coverage for `CashRepaid` / `CashRepaymentReversed` / `PaymentRecorded` already exists from
#1480 / #1483; no new parser tests. Manual check (coder, optional, against a dev DB only by hand —
never from tests): call `/financials` for a Hoodi/Stellar testnet loan with a recent repayment and
confirm `not_minted_yield` drops to ~0.

## Docs to Update

- `docs/product-specs/loans.md` — after the "API-derived display statuses" paragraph, add a short
  "Minted yield" paragraph: `/financials.minted_yield` = legacy `YieldMinted` (history) + Minter
  `CashRepaid.interest_minted` + fee leg (`mgmt_fee + perf_fee + oet_alloc` of the same repayment's
  `PaymentRecorded`, since `fee_shares` is an sPLUSD share count), net of `CashRepaymentReversed` by
  `(loan_id, repayment_id)`, normalised to 6 dp per chain.
- `docs/references/backend.md` — in the Minter events paragraph, note that `fee_shares` is in
  sPLUSD share units and that `/financials` consumes `CashRepaid` / `CashRepaymentReversed`.
- `docs/frontend/trustee-flows.md:675-677` — the close-gate text "stays red until the relayer mints
  the recorded yield" is stale: minter repayments mint atomically, so the gate clears once the
  repayment is indexed. Docs-only wording fix.
- `docs/exec-plans/tech-debt-tracker.md` — add an entry: `not_minted_yield` is structurally ~0 for
  minter-era repayments and the `fees` field excludes `oet_alloc` while the minted fee leg includes
  it; the field's semantics should be revisited (likely retired) in a later issue.

## Addendum (human, 2026-10-15, integration review)

OET counts on both sides of `not_minted_yield`. `minted_yield` already includes the `oet_alloc` fee leg, while `realized_gross` was `senior_interest + mgmt_fee + perf_fee`, so the difference compared unlike sets. `realized_gross` in `packages/api/src/routes/loan_financials.rs` is now `senior_interest + mgmt_fee + perf_fee + oet_alloc`. The only response field affected is `not_minted_yield`; `interest` and `fees` keep excluding `oet_alloc`. The module doc, `docs/references/backend.md` "Minted yield" and the tech-debt entry were updated. Registry-address scoping of minted yield is the next addendum.

## Addendum (human, 2026-10-15): minted yield scoped to the configured LoanRegistry

After a LoanRegistry redeploy on the same chain loan ids restart, so loan N on the new registry must not pick up loan N's yield from an old registry. `routes::common::loan_registry_address` is passed to both minted-yield queries (supersedes the earlier "stays chain-scoped" note):

- `list_repayment_mints` takes the registry address (bound last, `$4`). The `PaymentRecorded` lateral join is now an inner join and requires `p.contract_address = <registry>` (plus the existing `chain_id`, `tx_hash`, `loan_id`, `repayment_id` match). A `CashRepaid` row with no `PaymentRecorded` on the configured registry is excluded entirely, interest included. The "CashRepaid without PaymentRecorded" warning and `repayments_without_payment_record` are removed: such rows are now filtered out in SQL, so the count would always be 0.
- `legacy_yield_minted_raw_for_loan` takes the registry address (`$3`). A confirmed `yield_mint_outbox` row (keyed by `chain_id`, `yield_minter_address`, `loan_id`, `repayment_id`; it stores no registry) counts only when a `PaymentRecorded` row on the configured registry exists for the same `(chain_id, loan_id, repayment_id)`.
- Tests are pure SQL-text assertions in `packages/shared/tests/contract_logs_repo.rs`.
