# Issue #2128: LP Dashboard: Active Loans counts Closed/Default, Liquid Cover shows 0.0x on null liquid figures

Source: https://github.com/eq-lab/pipeline/issues/2128

Parent epic: #2129 (Math correctness, 2026-11-19 review). Flow: frontend (`packages/frontend`, LP app).

## Scope

Two display fixes on the LP Protocol Dashboard. Both are hook-only changes. The views (`DeploymentMonitorPanel.tsx`, `WithdrawalQueuePanel.tsx`) and the layout do not change.

1. **Active Loans count** (`useDeploymentMonitorPanel.ts`). `GET /v1/loan-book` returns active loans first, then terminal `Default` / `Closed` loans (#933, `LoanBookResponse.loans` in `packages/api/src/routes/loan_book.rs`). Every `summary` aggregate covers active loans only. Today the hook sets `activeLoansCount: loans.length`, so the "Active Loans" tab badge counts terminal loans too.
   - Fix: `activeLoansCount` counts only loans whose `status` is not in `TERMINAL_STATUSES` (`Default`, `Closed`). This is the same set the LTV header mean already excludes.
   - Rows: no change. Every served row is still listed in the served order (active first, terminal after), as the issue allows ("terminal rows may stay listed after the active ones … but are not counted as active"). The per-row LTV and the LTV-mean exclusion stay as they are (#2077).
   - Reuse the same "is active" filter for the LTV mean and the count so the two cannot drift.
2. **Liquid Cover** (`useWithdrawalQueuePanel.ts`). Today a `null` or non-finite `assets.liquid.cash_stablecoins` / `tokenized_tbills` becomes `0`, so the card reads `0.0x` whenever the queue is non-empty. `GET /v1/financial-position` serves both as `null` today (#770).
   - Fix: Liquid Cover is `"—"` unless **both** `cash` and `tbills` parse to finite numbers **and** `in_queue_usd` parses to a finite number `> 0`. Only then does it compute `formatCoverage(((cash + tbills) / queue).toFixed(2))`.
   - A missing financial-position payload (still loading, or error, so `fp` is `undefined`) reads the same as `null`: `"—"`.

**Out of scope**
- Filling the liquid figures (#770: on-chain USDC custody / USYC sources). That issue is planned and needs feedback, and it is not ours. Because no USYC source exists on either chain, `tokenized_tbills` stays `null`, so Liquid Cover shows `"—"` until #770 (or a later issue) serves both figures. This is the intended "honest about nulls" result.
- Backend changes to `GET /v1/loan-book` or `GET /v1/financial-position`, and the served `summary.liquid_cover` field.
- Hiding terminal rows or styling them differently on the Active Loans tab, and adding a Status column.
- The trustee app (`packages/trustee`), which has its own loan-book views.

## Assumptions and Risks

- **Status literals.** Terminal statuses arrive on the wire as exactly `"Default"` and `"Closed"` (`packages/shared/src/loan_status.rs`). The hook already relies on this for the LTV mean. If a new terminal status appears later, both the count and the mean need the set extended. That is one constant.
- **All-terminal book.** If every served loan is terminal, the badge shows `0` while the table still lists the terminal rows. The view's inline "No active loans" empty state keys on `rows.length`, so it will not show. The issue explicitly accepts terminal rows staying listed, so the plan leaves the view's empty-state condition alone. If the reviewer wants "No active loans" there, that is a one-line follow-up in the view. Noted, not blocking.
- **Header vs rows total.** The Principal header (`summary.total_deployed`, active-only) still differs from the sum of listed rows when terminal rows exist (the issue's "$13M rows under an $8M header"). That gap is inherent to listing terminal rows, and the issue accepts it. The fix makes the **count** honest.
- **#770 wording conflict.** #770's scope says "Keep the null → 0 rule" for Liquid Cover. This issue reverses that rule. Whoever implements #770 must follow the updated spec section (null → `"—"`). The manager may want to leave a note on #770. The planner does not edit other issues.
- **Lint-comments baseline.** `useWithdrawalQueuePanel.test.tsx` (header 18) and `useDeploymentMonitorPanel.test.tsx` (header 13) are baselined in `scripts/lint-comments.baseline.json`. Both test-file header comments must shrink, because the Withdrawal Queue one states the now-wrong "null → 0 → 0.0x" rule. Shrink the baseline with `--update-baseline` after editing (AGENTS.md lint rule).
- No blocking dependencies. #770 is independent. This change makes the panel correct whether or not #770 lands.

## Open Questions

_None_

## Implementation Steps

1. **`packages/frontend/src/components/dashboard/useDeploymentMonitorPanel.ts`**
   - Add a small predicate next to `TERMINAL_STATUSES`, for example `const isActiveLoan = (loan: LoanBookEntry) => !TERMINAL_STATUSES.has(loan.status);`.
   - In the ready branch, compute `const activeLoans = loans.filter(isActiveLoan);`. Build `validBps` from `activeLoans` instead of re-filtering inline, so the behavior matches today's.
   - Set `activeLoansCount: activeLoans.length`.
   - Keep `rows: loans.map(formatRow)` unchanged, so all served rows still show in served order.
   - Update or remove the stale field comment on `activeLoansCount` (`loans.length when ready`). Follow the comment-less rule: prefer deleting the field JSDoc over rewording it. The behavior lives in the spec (step 4).
   - Remove the inline comment block above `TERMINAL_STATUSES` only if its content moves to the spec. Otherwise leave it as it is. Do not add new body comments.
2. **`packages/frontend/src/components/dashboard/useWithdrawalQueuePanel.ts`**
   - Replace the three IIFEs with one module-level helper, `function parseFinite(raw: string | null | undefined): number | null`. It returns `null` for `null`/`undefined` or a non-finite `parseFloat`.
   - Compute `cash = parseFinite(fp?.assets.liquid.cash_stablecoins)`, `tbills = parseFinite(fp?.assets.liquid.tokenized_tbills)`, and `queue = parseFinite(data.summary.in_queue_usd)`.
   - Set `liquidCover = cash !== null && tbills !== null && queue !== null && queue > 0 ? formatCoverage(((cash + tbills) / queue).toFixed(2)) : "—"`.
   - Leave the other summary fields, the state machine and the row handling untouched.
   - Remove the obsolete inline comments around the calc (`// Liquid Cover calc — spec: …`, `// Liquid Cover numerator — spec: …`) only if needed to keep the file's comment count within its baseline. Do not add comments.
3. **Tests (co-located, Vitest).** See Test Strategy for the cases.
   - `packages/frontend/src/components/dashboard/useDeploymentMonitorPanel.test.tsx`: add count cases.
   - `packages/frontend/src/components/dashboard/useWithdrawalQueuePanel.test.tsx`: flip the `"0.0x"` expectation to `"—"` and add the null/partial/real cases.
   - Shrink both files' header comments to a short spec pointer (≤ 3 lines, including `spec: docs/frontend/dashboard-components.md#…`). This removes the now-wrong "null → 0 → 0.0x" narrative.
4. **Spec: `docs/frontend/dashboard-components.md`** (docs-first, so edit this before or with the code):
   - `### DeploymentMonitorPanel`, **Tabs** bullet: change "Active Loans → `loans.length` from `GET /v1/loan-book`" to the count of loans whose `status` is not terminal (`Default` / `Closed`). Add that terminal rows stay listed after the active ones (served order) but are not counted (#2128).
   - `### useDeploymentMonitorPanel`: add one sentence that the Active Loans count and the LTV mean use the same active set (non-terminal), and that rows include terminal loans.
   - `### useWithdrawalQueuePanel`, **Liquid Cover calc**: replace the `null/non-finite → 0` bullets and the "reads `0.0x` today" sentence with this rule: `cash` and `tbills` must both be finite numbers and `queue` a finite number > 0, otherwise `"—"`. A missing financial-position payload counts as null. Both liquid figures are `null` today (#770: no USDC custody source in the REST payload, no USYC deployment), so the card reads `"—"` until both are served.
5. **Lint and checks** (from the worktree root):
   - `cd packages/frontend && yarn test src/components/dashboard/` (or `npx vitest run src/components/dashboard`)
   - `cd packages/frontend && yarn lint` (eslint + prettier) and `npx tsc --noEmit -p packages/frontend` (or the package's typecheck/build)
   - `npx tsx scripts/lint-comments.ts --update-baseline`, then `npx tsx scripts/lint-comments.ts` (must pass, baseline only shrinks)
   - `npx tsx scripts/lint-docs.ts`
6. **Figma check (no visual change expected).**
   - Loan Book panel `https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14431`: the Active Loans tab badge stays a plain integer in the same chip.
   - Withdrawal Queue `https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14893`: the Liquid Cover card value slot renders `"—"` in the same Heading-20 value style the other cards use for no-value. Confirm in the running app (`yarn dev` with the `pipeline.mock.api.*` localStorage fixtures) that only the badge number and the Liquid Cover string change.

## Test Strategy

All tests use the existing `pipeline.mock.api.*` localStorage mock layer and `renderHook` patterns already in the two test files. They are pure unit tests with no backend.

`useDeploymentMonitorPanel.test.tsx` (new `describe("… — active loans count (#2128)")`):
- A mix of `Performing`, `WatchList`, `Closed` and `Default` loans. Expect `activeLoansCount === 2`, `rows.length === 4`, and rows in served order (terminal rows still present, after the active ones).
- Every loan terminal (`Closed`, `Default`). Expect `activeLoansCount === 0`, `state === "ready"`, and both rows still listed.
- No loans. Expect `activeLoansCount === 0`. This is the existing behavior, so assert it explicitly.
- The existing "is ready with formatted active-loan rows" (count 1) and the terminal-LTV-mean test must still pass unchanged.

`useWithdrawalQueuePanel.test.tsx`:
- Change the existing `"0.0x"` case. With both liquid figures `null` and the queue > 0, `liquidCover === "—"`.
- `cash` real, `tbills` `null`: `"—"` (computes only when both are real). This replaces the current "real cash → 1.0x" case, which today relies on `tbills` null → 0.
- `cash` and `tbills` both real, for example `"1000000.000000"` + `"850000.000000"` over `in_queue_usd` `"1850000.000000"`: `"1.0x"`. Add a second ratio, for example `"3700000"` total over `"1850000"`: `"2.0x"`.
- Non-finite string (for example `"abc"`) in either liquid figure: `"—"`.
- Financial-position payload missing (no FP mock key, fetch pending or 500): `"—"` while the queue is ready.
- Both liquid figures real with `in_queue_usd` `"0.000000"` but items present: `"—"` (divide-by-zero guard kept).
- The loading, error and empty states still return `"—"` (existing tests, unchanged).

## Docs to Update

- `docs/frontend/dashboard-components.md`: the `### DeploymentMonitorPanel` (Tabs), `### useDeploymentMonitorPanel` and `### useWithdrawalQueuePanel` (Liquid Cover calc) sections, as described in step 4.
- `scripts/lint-comments.baseline.json`: shrink the entries for the two touched test files (and the hooks if their counts drop) using `--update-baseline`.
- No product-spec change. `docs/product-specs/dashboards.md` describes the served API (`liquid_cover` served `null`, terminal rows visible), not the LP count/calc, so it stays accurate. `docs/user-stories/epic-712/719-withdrawal-queue-ui.md` already expects Liquid Cover `"—"` today, so it becomes accurate again.
