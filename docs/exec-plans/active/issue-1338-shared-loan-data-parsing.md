# Issue #1338: Extract a shared loan_data parsing package (trustee + LP hand-mirrored extractors)

Source: https://github.com/eq-lab/pipeline/issues/1338

Parent epic: #2029 (Frontend tech debt batch). Tech-debt entry: TD-42 (`docs/exec-plans/tech-debt-tracker.md`).

## Scope

Both apps read `GET /v1/loan-book/submissions` and keep their own copies of the `loan_data` types and parsing logic. The copies have already drifted:

| Item | Trustee | LP | Drift |
| --- | --- | --- | --- |
| `SubmissionView` | `trustee/src/api/useLoanSubmissions.ts` | `frontend/src/api/useLoanSubmissions.ts` | Trustee has `documents`, `draw_loan`, `data_room_id`, optional chain fields. LP has the deprecated `to` / `initial_ccr` / `initial_location` as required fields. |
| `EconomicsInput` money units | Human units (#1620) | Doc comments still say 7-decimal base units (#912, superseded) | Doc drift only. Both `economicsUsdDecimal`s already pass through without scaling. |
| `economicsUsdDecimal` | `trustee/src/utils/stellarSacUnits.ts` (takes `unknown`) | `frontend/src/utils/formatCompactUsd.ts` (takes `string \| null \| undefined`) | Signature |
| `normalizeOriginationSubmissionStatus` | Identical copy | Identical copy | None yet |
| `safeString` / `safeNumber` / corridor `-` → `→` | `-useOriginationTable.ts`, `-origination-detail.ts`, `useNeedsAttention.ts` (returns `undefined`) | `originationRow.ts` | Four copies |
| `formatMaturityDate` / `formatSubmittedDate` | `trustee/src/utils/formatDate.ts`, UTC (#1626) | `frontend/src/utils/formatDate.ts`, browser time zone | **Behavior drift.** The LP can show a UTC-midnight maturity one day early. |
| `formatBpsRate` | `trustee/src/utils/formatUsd.ts` | `frontend/src/utils/formatCompactUsd.ts` | None yet |
| `LoanDocumentDto` | Declared in both `useLoanSubmissions.ts` and `useLoanBook.ts` | n/a | Duplicate inside the trustee |

**In scope.** Create a new source-only, framework-agnostic workspace package `@pipeline/loan-data` (`packages/loan-data`). It contains no React, no React Query, no wallet SDKs, no JSX, no env reads and no app aliases. It holds:

1. **Types:** the submissions-endpoint wire types (`SubmissionView`, `LoanData` (the `loan_data` payload, formerly `SubmitLoanRequest`), `EconomicsInput`, `LocationInput`, `LoanDocumentDto`, `DrawLoanEconomics`, `ServedDrawLoanArgs`, `OriginationSubmissionStatus`, `SubmissionStatusFilter`). They mirror `packages/api/src/routes/loan_book.rs`.
2. **Status:** `normalizeOriginationSubmissionStatus`.
3. **Defensive readers:**
   - `textOrNull` and `displayText` (the `—` fallback)
   - `finiteNumberOrUndefined`
   - `corridorText`, which turns `-` into ` → `
   - `economicsUsdDecimal(raw: unknown)`
   - `readLoanData(submission)`, which returns `{ loanData: Partial<LoanData>, economics: Partial<EconomicsInput> }` and never throws
4. **Loan-field formatters:**
   - `formatBpsRate`
   - `formatMaturityDate` (UTC)
   - `formatSubmittedDate` (UTC)

Both apps import these from the package and delete their local copies. The per-app React Query hooks (`useLoanSubmissions`), the row mappers (`mapSubmissionToRow` in each app) and the per-app row shapes stay in the apps. Only their internals switch to the shared helpers.

**Out of scope:**

- **USD money formatters** (`formatCompactUsd`, `formatFullUsd`). #1337 owns these, and the two app versions differ on purpose today ("$8.0M" vs "$8M"). This plan does not touch or depend on #1337.
- **The #840 `scaleRegistryAmount` ×1000 workaround.** It is already removed from code. Only stale comments remain in LP tests and in `frontend/src/api/useLoanBook.ts`, and they are left as is. Note this in TD-42.
- **`targetChainLabel`.** It is env- and app-specific, and the two apps resolve chains differently.
- **Trustee `useSubmitLoan.ts` POST input types.** They are a different shape (request body with valuation and fee blocks).
- **The `@pipeline/wallet-connect` `DrawLoanArgs` mirror (TD-43).**
- **`/v1/loan-book` types** (`LoanBookEntry` etc.), apart from `LoanDocumentDto`.
- **The rest of `formatDate.ts` in each app** (axis, epoch and audit formatters).
- **Hook factories.**

## Assumptions and Risks

- **Overlap with #778.** The unmerged #778 plan (branch `feat/778-trustee-shared-frontend-code`) proposes a broader `@pipeline/web-shared` package that would also receive the submission types and the date formatters. Its Q1 (the package's home) is still unanswered.
  - This plan picks a narrow `@pipeline/loan-data` package so that #1338 can land on its own.
  - If #778 later lands `web-shared`, `loan-data` can either stay as a leaf package that `web-shared` re-exports or be folded in. Both are mechanical.
  - See Open Question Q1.
- **Parallel #1337 branch.** `feat/1337-shared-money-formatters` edits `trustee/src/utils/formatUsd.ts` and `frontend/src/utils/formatCompactUsd.ts`. This plan only deletes `formatBpsRate` (both files) and `economicsUsdDecimal` (LP file) from them. Whichever branch merges second resolves a small conflict. This plan does not import anything from #1337's package.
- **LP date behavior change.** Moving to the trustee's UTC formatters changes what LP users in non-UTC zones see: the In-Origination table's Maturity and Submitted cells, plus the other two LP call sites of each formatter. This removes a known drift and follows the #1626 rationale (dates are entered as UTC midnight). Still, it is user-visible. See Open Question Q2.
- **Type tightening.** The shared `SubmissionView` follows the trustee's superset:
  - `documents: LoanDocumentDto[]` is required.
  - `target_chain_id` / `chain_id` / `loan_id` / `draw_loan` are optional (stale router-state copies, per `docs/frontend/trustee-flows.md#data-layer-useloansubmissions`).
  - `LoanData` marks `to`, `initial_ccr`, `initial_location`, `data_room_id`, `protection`, `secondary_metadata_uri` and `documents` as optional, matching `loan_book.rs`. It also adds the optional `collateral_valuation` / `fee_schedule` blocks only if a consumer reads them (none does today), so leave them out.
  - LP fixtures in `originationRow.test.ts`, `useDeploymentMonitorPanel.test.tsx` and `-dashboard.test.tsx` need `documents: []` added, plus any field the stricter type now requires. LP code that reads `target_chain_id` already tolerates `undefined` (`targetChainLabel(number | null | undefined)`).
- **Build wiring.** The new package must be added to:
  - root `workspaces`
  - both apps' `dependencies`
  - the Dockerfile `frontend-build` and `trustee-build` stages (both the `package.json` COPY in the install layer and the source COPY, mirroring `wallet-connect` at Dockerfile lines ~79/86/113/121)
  - `yarn.lock`
  - CI typecheck and test jobs

  If any one of these is missed, CI or the image build breaks. No Tailwind `@source` is needed because there are no `className`s.
- **`lint-comments` scope.** `scripts/lint-comments.ts` `PACKAGES` must include `packages/loan-data/src` so the comment-minimal rule applies to it.

## Implementation Steps

1. **Scaffold `packages/loan-data`** by mirroring `packages/wallet-connect` minus the React and wallet dependencies.
   - **`package.json`:** `"name": "@pipeline/loan-data"`, `private`, `type: module`, `exports: { ".": "./src/index.ts" }`, and scripts `lint` (`eslint . && prettier --check .`), `test` (`vitest run`) and `test:watch`. There are no runtime `dependencies`. Copy these devDeps at the exact versions in `packages/wallet-connect/package.json`: `@eslint/js`, `eslint`, `typescript-eslint`, `globals` (if wallet-connect lists it), `prettier`, `typescript`, `vite`, `vitest`.
   - **`tsconfig.json`:** same as wallet-connect but without `jsx`, `types: ["vite/client"]` and the `paths` alias. Use relative imports only.
   - **`vite.config.ts`:** `process.env.TZ = "UTC"` and `test: { environment: "node" }`.
   - **`eslint.config.js`:** the recommended configs plus `no-restricted-imports` banning `react`, `react/*`, `@tanstack/*`, `wagmi*`, `viem*`, `@reown/*`, `@creit.tech/*`, `@stellar/*` and `@pipeline/*`, so the package stays a leaf.
   - **Prettier config:** copy whatever wallet-connect uses (`.prettierrc` or the root config).
   - **Root `package.json`:** add `"packages/loan-data"` to `workspaces`. Add `"@pipeline/loan-data": "workspace:^"` to `dependencies` in `packages/frontend/package.json` and `packages/trustee/package.json`. Run `yarn install` from the worktree root and commit `yarn.lock`.
2. **Types** (`packages/loan-data/src/types.ts`).
   - **Sources:** port from the trustee's `useLoanSubmissions.ts` (the canonical superset) and reconcile with `packages/api/src/routes/loan_book.rs` (`EconomicsInput`, `LocationInput`, `SubmitLoanRequest`, `SubmissionView`, `DrawLoanArgs`).
   - **Field rules:** the money fields are human-unit decimal strings (#1620). `LoanData` carries the optional fields listed in Assumptions. Rename `SubmitLoanRequest` to `LoanData` to avoid clashing with the POST input naming.
   - **No JSDoc.** Follow the comment-minimal rule: one 2–3-line spec-pointer header only, pointing at `docs/frontend/loan-data.md`.
3. **Status** (`src/status.ts`). Add `normalizeOriginationSubmissionStatus`, identical to today's logic.
4. **Readers** (`src/read.ts`). Add the following:
   - `textOrNull(value: unknown): string | null`
   - `displayText(value: unknown): string` (`textOrNull ?? "—"`)
   - `finiteNumberOrUndefined(value: unknown): number | undefined`
   - `corridorText(value: unknown): string | null` (`textOrNull(value)?.replace(/\s*-\s*/g, " → ") ?? null`)
   - `economicsUsdDecimal(raw: unknown): string | null`, using the trustee semantics: a trimmed non-negative decimal, otherwise `null`, with no scaling
   - `readLoanData(submission: Pick<SubmissionView, "loan_data">)`, which returns the defensive `{ loanData, economics }` pair that the four call sites build inline today
5. **Formatters** (`src/format.ts`). Add `formatBpsRate` (byte-identical to today), `formatMaturityDate` and `formatSubmittedDate`. The two date formatters are the trustee UTC versions (`timeZone: "UTC"`, `en-GB`), and the module includes the `DAY_MONTH_YEAR` / `DAY_MONTH` option constants.
6. **Barrel** (`src/index.ts`). Export everything above (types via `export type`).
7. **Trustee migration** (`packages/trustee`):
   - **`src/api/useLoanSubmissions.ts`:** delete the types and `normalizeOriginationSubmissionStatus`, and import them from `@pipeline/loan-data`. Keep `useLoanSubmissions`, `UseLoanSubmissionsResult` and `UseLoanSubmissionsOptions`. Do not add re-exports. Re-point every importer of the moved names, found with `grep -rn 'from "@/api/useLoanSubmissions"' src` (about 14 non-test files plus tests), at `@pipeline/loan-data`.
   - **`src/api/useLoanBook.ts`:** delete the duplicate `LoanDocumentDto` and import it from the package.
   - **`src/routes/-useOriginationTable.ts`, `src/routes/-origination-detail.ts`, `src/components/useNeedsAttention.ts`:** delete the local `safeString` / `safeNumber` / `formatCorridor` and the inline `loanData` / `economics` destructuring, and use `readLoanData`, `displayText`, `textOrNull`, `finiteNumberOrUndefined` and `corridorText`.
     - `-origination-detail.ts` exports `safeString`. Check its importers with grep and point them at `displayText`.
     - `useNeedsAttention`'s `undefined`-returning variant maps to `textOrNull(...) ?? undefined` (or adjust the filter to `null`).
     - Keep the `-useLoansTable.ts` / `-useLpCounterpartiesTable.ts` `safeString` copies unless they read `loan_data`. They read other DTOs, so leave them.
   - **`src/utils/stellarSacUnits.ts`:** delete `economicsUsdDecimal` and re-point its importers (`-record-repayment.ts`, `-useOriginationTable.ts`, `-origination-detail.ts`, and others found with grep).
   - **`src/utils/formatUsd.ts`:** delete `formatBpsRate` and re-point its importers (about 10 files).
   - **`src/utils/formatDate.ts`:** delete `formatMaturityDate` and `formatSubmittedDate` (and `DAY_MONTH` if it becomes unused) and re-point their importers (about 12 and 7 files). The remaining functions stay.
   - **Tests:** move the corresponding cases out of `-formatDate.test.ts`, `-formatDate-utc.test.ts` and `-formatUsd.test.ts` into the package (Step 9).
8. **LP migration** (`packages/frontend`):
   - **`src/api/useLoanSubmissions.ts`:** delete the types and `normalizeOriginationSubmissionStatus`, import them from the package, and drop the stale #912 base-unit module comment, leaving one spec-pointer header.
   - **`src/api/index.ts`:** remove the moved names from its re-exports (lines ~104–114). Grep `from "@/api"` for any consumer of those names and re-point it to `@pipeline/loan-data`.
   - **`src/components/dashboard/originationRow.ts`:** use `readLoanData`, `displayText`, `corridorText`, `finiteNumberOrUndefined`, `economicsUsdDecimal`, `formatBpsRate`, `formatMaturityDate` and `formatSubmittedDate` from the package. `formatCompactUsd` stays the LP-local import (#1337 scope). `STATUS_LABELS`, `targetChainLabel` and the row shape stay.
   - **`src/utils/formatCompactUsd.ts`:** delete `formatBpsRate` and `economicsUsdDecimal`, and re-point their importers.
   - **`src/utils/formatDate.ts`:** delete `formatMaturityDate` and `formatSubmittedDate`, plus the TD-42 "hand-mirrored" header text, and keep the axis functions. Re-point the importers.
   - **Test fixtures:** update LP `SubmissionView` fixtures to the shared type, adding `documents: []` and anything else the compiler flags.
9. **Package tests** (`packages/loan-data/src/*.test.ts`). See Test Strategy.
10. **Build and CI wiring:**
    - **`Dockerfile`:** in both the frontend and trustee build stages, add `COPY packages/loan-data/package.json packages/loan-data/package.json` next to the wallet-connect manifest copy, and `COPY packages/loan-data/ packages/loan-data/` next to the wallet-connect source copy.
    - **`.github/workflows/lint.yml`:** add a `lint-loan-data` job (`cd packages/loan-data && npx tsc --noEmit`) mirroring `lint-wallet-connect`.
    - **`.github/workflows/tests.yml`:** add `yarn workspace @pipeline/loan-data test`.
    - **`scripts/lint-comments.ts`:** add `"packages/loan-data/src"` to `PACKAGES`.
11. **Verify:**
    - `yarn workspace @pipeline/loan-data test`, `yarn workspace @pipeline/loan-data lint` and `cd packages/loan-data && npx tsc --noEmit`
    - `cd packages/trustee && npx tsc --noEmit && yarn workspace @pipeline/trustee test && yarn workspace @pipeline/trustee lint`
    - the same for `packages/frontend`
    - `npx vite build` then `yarn build` in both apps (route-tree regeneration rule)
    - `npx tsx scripts/lint-docs.ts` and `npx tsx scripts/lint-comments.ts`
    - Final check: `grep -rn 'function safeString\|economicsUsdDecimal\|normalizeOriginationSubmissionStatus' packages/frontend/src packages/trustee/src` shows only imports, apart from the out-of-scope non-`loan_data` `safeString`s.

## Test Strategy

- **Package unit tests** (vitest, node env, `TZ=UTC` in config):
  - `status.test.ts`:
    - the four decision statuses map to themselves
    - `Performing` / `WatchList` / `Past Due` / `Default` / `Closed` / unknown map to `Approved`
  - `read.test.ts`:
    - `displayText`: `""`, `null`, numbers and objects give `—`
    - `corridorText`: `"PE-CN"`, `"PE - CN"` and multi-hop `"PE-CN-US"` all get arrows, and a missing value gives `null`
    - `economicsUsdDecimal`: trims, rejects negative, `"1e6"`, `"abc"` and non-string input, and passes `"1200000.000000"` through unchanged
    - `finiteNumberOrUndefined`: `NaN`, `Infinity` and string input give `undefined`
    - `readLoanData`: `loan_data` that is `null` / `undefined`, has no `economics`, or is a non-object returns empty partials and never throws
  - `format.test.ts`:
    - move the existing `formatBpsRate`, `formatMaturityDate` and `formatSubmittedDate` cases from both apps
    - port the trustee `-formatDate-utc.test.ts` guard (force `TZ=America/New_York` and assert that a UTC-midnight maturity renders as the UTC day) so a local-zone regression fails
- **App tests:**
  - Existing `-useOriginationTable.test.ts`, `-origination-detail*.test.ts`, `-useNeedsAttention.test.ts`, `-NeedsAttention.test.tsx`, `originationRow.test.ts`, `useDeploymentMonitorPanel.test.tsx` and `-dashboard.test.tsx` must pass with only import and fixture-shape edits. No expected-string changes are allowed, except LP date expectations if they assumed a local zone. LP vitest already runs with `TZ=UTC`, so none are expected.
  - Add one LP `originationRow.test.ts` case asserting that the Maturity cell renders the UTC day under a non-UTC `TZ`. This covers the Q2 behavior change.
- **Builds:** typecheck and build both apps, and do a Docker build sanity check if feasible locally (`docker build --target <frontend stage>`), or rely on CI.

## Docs to Update

- **New `docs/frontend/loan-data.md`.** This is the spec that the package's file headers point to. It covers:
  - the package boundary (leaf, no React or env, what belongs here vs #1337 money formatters vs app-local code)
  - the `loan_data` wire contract (human-unit money #1620, bps, Unix-second UTC dates, `—` fallback, corridor arrow)
  - status normalization
  - the export table

  Link it from `docs/frontend/index.md` (Area specs).
- **`docs/frontend/trustee-flows.md`:**
  - `#data-layer-useloansubmissions`: replace the "self-contained port (TD-42)" text and the `@/utils/stellarSacUnits` pointer with `@pipeline/loan-data`.
  - `#dates`: note that `formatMaturityDate` / `formatSubmittedDate` now come from the package.
- **`docs/frontend/dashboard-components.md#originationtable`:** point the field mapping at the shared readers and note the UTC dates.
- **`docs/frontend/utils.md`:** remove the moved util rows (or re-point them to the package) and add rows for the package exports.
- **`ARCHITECTURE.md`:** add a `packages/loan-data` section next to `packages/ui` / `wallet-connect` (source-only leaf, consumed by both apps).
- **`docs/exec-plans/tech-debt-tracker.md` TD-42:**
  - Mark the `loan_data` extractor, types and date/bps-formatter duplication resolved by #1338.
  - Leave the money-formatter half open for TD-38/#1337, plus the `wallet-connect` `DrawLoanArgs` mirror (TD-43) and the `useChainServed`/`useChains` pair.
  - Note that the #840 `scaleRegistryAmount` workaround is already gone.

## Open Questions

- **Q1 (package home, depends on #778 Q1):** Is a narrow new `@pipeline/loan-data` package OK now? The alternatives are to wait for #778's proposed `@pipeline/web-shared` and put this under `web-shared/src/loan-data/`, or to put it into `@pipeline/wallet-connect` (TD-52's suggestion).
  - Planner default: a new `@pipeline/loan-data` leaf package, which #778 can re-export or absorb later.
- **Q2 (LP date time zone):** OK to switch the LP's `formatMaturityDate` / `formatSubmittedDate` to UTC (the trustee's #1626 behavior) as part of sharing them? This changes the displayed day for LP users west or east of UTC near midnight.
  - Planner default: yes, adopt UTC. The alternative is to leave the date formatters app-local and share only types and parsers.
