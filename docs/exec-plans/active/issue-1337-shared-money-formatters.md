# Issue #1337: Deduplicate trustee/LP money formatters (formatCompactUsd/formatFullUsd)

Source: https://github.com/eq-lab/pipeline/issues/1337

Parent epic: #2029 (Frontend tech debt batch). Tech-debt source: TD-38. Related: #778 (open, `needs-feedback`), TD-42, TD-46, TD-52.

## Scope

Move the money formatters that are the same in both apps into one source-only workspace package. Both `packages/frontend` and `packages/trustee` import them from there and drop their local copies. **Neither app's rendered output changes.**

What the code looks like today (checked on this branch):

| Function | LP (`packages/frontend/src/utils/formatCompactUsd.ts`) | Trustee (`packages/trustee/src/utils/formatUsd.ts`) | Same? |
| --- | --- | --- | --- |
| `formatFullUsd` | defined; used only by its own test (no production caller left) | defined; 10 production callers | Logic is byte-identical |
| `formatBpsRate` | defined; used by `components/dashboard/originationRow.ts` | defined; 7 production callers | Logic is byte-identical |
| `formatCompactUsd` | always one decimal (`$8.0M`, `$500.0K`); below 1K it shows 2 dp with grouping (`$999.00`); no unit rollover | trims trailing zeros, up to 2 dp (`$96M`, `$4.95M`); rolls over to the next unit after rounding (`$1M` for 999,999) | **Different on purpose.** Each follows its own Figma precision (TD-38, `docs/frontend/utils.md`) |
| `formatCompactUsd2dp`, `formatUsdInputValue`, `parseUsdCentsInput`, `formatUsdDecimal`, `formatUsdExact` | — | trustee only | No duplication |
| `lib/usdc.ts` (`formatUsdc*`, bigint + viem) | LP only | — | No duplication. Out of scope: it depends on viem through `@/wallet` |

In scope:

1. Create the shared package (its home is Open Question Q1). It is source-only, has no React and no wallet SDK, and exports `formatFullUsd` and `formatBpsRate` from a `format/usd.ts` module.
2. Re-point every importer of those two functions in both apps to the package. Delete the local copies, and move the matching test cases into the package.
3. Wire up the new package: root `workspaces`, both apps' `dependencies`, the Dockerfile install and copy layers, CI typecheck and vitest, `scripts/check-changes.sh`, and `scripts/lint-comments.ts`.
4. Docs: `docs/frontend/utils.md`, `docs/FRONTEND.md`, `ARCHITECTURE.md`, `docs/RELIABILITY.md`, and TD-38.

Out of scope:

- Making the two `formatCompactUsd` variants behave the same. Both stay app-local and unchanged by default (see Q2).
- The other duplication families tracked by #778: dates (TD-42), `userError` (TD-52), env reader, `apiFetch`, `truncateAddress`, and the `loan_data` types. The LP `lib/usdc.ts` / `lib/format.ts` bigint formatters are also out.
- Fixing the LP `formatCompactUsd` unit-rollover gap (`"999999"` renders `"$1000.0K"`). Step 9 logs it in `known-bugs.md` and does not fix it.

## Assumptions and Risks

- **Overlap with #778.** #778's proposed plan (closed PR #1506, `docs/exec-plans/active/issue-778-trustee-shared-frontend-code.md` on branch `feat/778-trustee-shared-frontend-code`) proposes the same move: `formatFullUsd` and `formatBpsRate` go to `packages/web-shared/src/format/usd.ts` in a new `@pipeline/web-shared` package. That plan's Q1 asks exactly where the package should live, and the owner has not answered. If #1337 creates a package under one name and #778 later picks another, one of them has to rename or move the package across about 20 importers. **So the package home depends on #778 Q1, and this plan lists it as Q1 instead of guessing.**
- **Default if the owner accepts #778's default.** Use `packages/web-shared` / `@pipeline/web-shared`, seeded only with `format/usd.ts`. #778 then extends the same package and does not create a second one. The issue body's `@pipeline/format` name only makes sense if the package should stay limited to formatting.
- **Why not `@pipeline/ui`.** It is the design kit (React, Tailwind, Storybook devDeps). Pure formatters do not belong there, and #778's D1 argues the same. **Why not `@pipeline/wallet-connect`.** Both apps already depend on it, so it would add no new dependency. But it would tie pure formatting to the wallet-SDK package, and TD-52 / `error-handling.md` already decided (#1037 D1) against hoisting chain-generic code there.
- **Source-only package pitfalls.** These follow the existing `ui` / `wallet-connect` conventions:
  - The package must use **relative imports only**, never `@/…`. The consuming app resolves `@/` to its own `src`.
  - It must contain no `className`, so no Tailwind `@source` line is needed.
  - Every Dockerfile stage that runs `yarn install --immutable` must `COPY` the new `package.json` before installing and the package sources before building. Otherwise the image build fails.
- **`yarn.lock` changes.** Adding a workspace changes the lockfile. Commit it together with the package.
- **Comment rules.** `formatCompactUsd.ts` and both test files appear in `scripts/lint-comments.baseline.json`. Editing them means shrinking those entries. The new package files carry one spec-pointer header each and no JSDoc. The LP `formatFullUsd` / `formatBpsRate` JSDoc blocks are deleted, not copied.
- **Risk if Q2 is answered "unify".** That is a visible change in one app, and it needs a design decision on which precision wins. It is not a refactor.

## Open Questions

- **Q1 (blocks the plan, depends on #778 Q1):** Where should the shared formatters live? Options: (a) a new `@pipeline/web-shared` (`packages/web-shared`), which #778 later extends. This is the planner's default and matches #778's default. (b) A new formatting-only `@pipeline/format`, as #1337's body says. #778's other shared code would then need yet another package. (c) Inside `@pipeline/wallet-connect`, as TD-52 suggested. (d) Inside `@pipeline/ui`, which is not recommended. The answer should be given once, for both #778 Q1 and this issue.
- **Q2:** Should the two `formatCompactUsd` variants stay app-local, with each app keeping its own Figma precision? This is the default, and only the byte-identical `formatFullUsd` / `formatBpsRate` move. Or should both variants also move into the package under explicit names (for example `formatCompactUsdFixed1` and `formatCompactUsdTrimmed`) so that rounding lives in one file? That option renames about 20 call sites but changes no output. A third option is to merge them into one behaviour, which is a visible change in one app and needs design input.
- **Q3:** Ordering against #778. Should #1337 create the package now, seeded with the money formatters, and have #778 build on it? This is the default. Or should #1337 be folded into #778 and closed as a duplicate once #778 is unblocked?

## Implementation Steps

`<pkg>` / `<pkg-name>` below means the Q1 answer. Default: `packages/web-shared` / `@pipeline/web-shared`.

1. **Scaffold `<pkg>`**, modelled on `packages/wallet-connect` but without React or wallet deps.
   - `package.json`:
     - `"name": "<pkg-name>"`, `"version": "0.1.0"`, `"private": true`, `"type": "module"`
     - `"exports": { ".": "./src/index.ts" }`
     - scripts: `lint` (`eslint . && prettier --check .`), `test` (`vitest run`), `test:watch`
     - devDeps pinned to the versions already in `packages/wallet-connect/package.json`: `@eslint/js`, `eslint`, `globals`, `prettier`, `typescript`, `typescript-eslint`, `vite`, `vitest`. No runtime dependencies.
   - `tsconfig.json`: copy `packages/wallet-connect/tsconfig.json`, drop `"jsx"`, and keep `"lib"` with `DOM` because `Intl` typings are already in ES2023.
   - `vite.config.ts`:
     - `test: { environment: "node" }`
     - `process.env.TZ = "UTC"`, matching the other packages
     - no React plugin
   - `eslint.config.js`:
     - `js.configs.recommended` + `tseslint.configs.recommended`
     - a `no-restricted-imports` rule banning `react`, `wagmi`, `viem`, `@reown/*`, `@stellar/*`, `@creit.tech/*`, `@tanstack/*` and `@/*`, so the package stays pure and uses relative imports only
   - `.prettierrc`, if `packages/wallet-connect` has one (copy it). Otherwise the root config applies.
   - `src/index.ts`: one spec-pointer header (`// spec: docs/frontend/utils.md#shared-formatters`), then `export { formatFullUsd, formatBpsRate } from "./format/usd";`.
2. **`<pkg>/src/format/usd.ts`.**
   - One spec-pointer header.
   - `formatFullUsd(base6Decimal: string | null | undefined): string` and `formatBpsRate(bps: number | null | undefined): string`, copied byte-for-byte from `packages/trustee/src/utils/formatUsd.ts`. The two copies' logic is identical.
   - No JSDoc.
3. **Wire the workspace.**
   - Root `package.json` `workspaces`: add `"<pkg>"`.
   - `packages/frontend/package.json` and `packages/trustee/package.json` `dependencies`: add `"<pkg-name>": "workspace:^"`.
   - Run `yarn install` from the worktree root and commit the `yarn.lock` change.
4. **Re-point the trustee.**
   - Remove `formatFullUsd` and `formatBpsRate` from `packages/trustee/src/utils/formatUsd.ts`.
   - In each of these files, split the import so the two moved names come from `<pkg-name>` and the rest stay on `@/utils/formatUsd`:
     - `components/useCapitalAllocationCard.ts`
     - `routes/-cash-management-withdrawals.ts`
     - `routes/-cash-management.ts`
     - `routes/-loanSecurity.ts`
     - `routes/-loanSecurityRecords.ts`
     - `routes/-origination-detail.ts`
     - `routes/-record-coupon.ts`
     - `routes/-record-repayment.ts`
     - `routes/-risk-council-escalate.ts`
     - `routes/-risk-council-pending.ts`
     - `routes/-risk-council-reterm.ts`
     - `routes/-useLoanDetail.ts`
     - `routes/-useOriginationTable.ts`
   - Re-run `grep -rlw "formatFullUsd\|formatBpsRate" packages/trustee/src` to catch any importer added since planning.
   - Tests that import these functions only through the presenters (`-origination-detail.test.ts`, `-risk-council-reterm.test.ts`) need no change unless they import from `@/utils/formatUsd` directly.
   - **No re-export shim** from `@/utils/formatUsd`. Call sites import the package directly.
5. **Re-point the LP.**
   - Delete `formatFullUsd` and `formatBpsRate`, and their JSDoc, from `packages/frontend/src/utils/formatCompactUsd.ts`.
   - Update the stale header comment that lists sibling helpers to a single spec-pointer header, because the file is in the comment-lint baseline.
   - `components/dashboard/originationRow.ts`: import `formatBpsRate` from `<pkg-name>` and keep `formatCompactUsd` from `@/utils/formatCompactUsd`.
   - `formatFullUsd` has no LP production caller. Nothing to re-point.
   - Check `packages/frontend/src/api/README.md` for references to the moved names and update it.
6. **Move the tests.**
   - Create `<pkg>/src/format/usd.test.ts`. Take the union of the `formatFullUsd` and `formatBpsRate` cases from `packages/frontend/src/utils/formatCompactUsd.test.ts` and `packages/trustee/src/utils/-formatUsd.test.ts`, de-duplicated.
   - Delete those `describe` blocks from both app test files, and remove the now-unused imports.
   - Write no comments in test bodies.
7. **Tooling and CI.**
   - `Dockerfile`, both `frontend-build` and `trustee-build` stages:
     - `COPY <pkg>/package.json <pkg>/package.json` next to the other manifest copies
     - `COPY <pkg>/ <pkg>/` next to the `ui` / `wallet-connect` source copies
   - `.github/workflows/lint.yml`: add a `lint-<pkg>` typecheck job (`cd <pkg> && npx tsc --noEmit`), mirroring `lint-wallet-connect`.
   - `.github/workflows/tests.yml`: add `yarn workspace <pkg-name> test` to `js-unit-tests`.
   - `scripts/check-changes.sh`:
     - add a `<pkg>/*` case that sets a new flag
     - add a graph edge `<flag> -> frontend, trustee`
     - add a "`<pkg>` tests" step and a `kinds` entry
     - update the header comment's dependency-graph line
   - `scripts/lint-comments.ts`: add `"<pkg>/src"` to `PACKAGES`.
8. **Shrink `scripts/lint-comments.baseline.json`** for the entries of `packages/frontend/src/utils/formatCompactUsd.ts`, `formatCompactUsd.test.ts` and `packages/trustee/src/utils/-formatUsd.test.ts`. Run `npx tsx scripts/lint-comments.ts` to get the new counts.
9. **Log the LP rollover gap** in `docs/exec-plans/known-bugs.md`:
   - Location: `packages/frontend/src/utils/formatCompactUsd.ts::formatCompactUsd`
   - Symptom: `"999999"` → `"$1000.0K"`, `"999950"` → `"$1000.0K"`
   - Root cause: the unit is picked before rounding
   - The trustee variant already handles this case.
   - Do not fix it here.
10. **Docs** (see Docs to Update), in the same commit as the code.
11. **Verify** (see Test Strategy).

## Test Strategy

- **New package unit tests** (`<pkg>/src/format/usd.test.ts`, run with `yarn workspace <pkg-name> test`), using the existing cases from both apps:
  - `formatFullUsd`:
    - `"115190000.000000"` → `"$115,190,000"`
    - `"3500000.000000"` → `"$3,500,000"`
    - `"0.000000"` → `"$0"`
    - fractional rounding, e.g. `"1234.56"` → `"$1,235"`
    - a negative value
    - `null` / `undefined` / `"abc"` → `"—"`
  - `formatBpsRate`:
    - `1120` → `"11.2%"`, `1170` → `"11.7%"`, `0` → `"0.0%"`
    - `null` / `undefined` / `NaN` / `Infinity` → `"—"`
- **No-behaviour-change guard.** The full app suites must pass unchanged apart from the moved `describe` blocks: `yarn workspace @pipeline/frontend test` and `yarn workspace @pipeline/trustee test`. This covers presenter tests that assert the rendered strings, such as `-origination-detail.test.ts`, `-risk-council-reterm.test.ts` and the LP dashboard panel tests.
- **Builds:**
  - `yarn workspace @pipeline/frontend build` and `yarn workspace @pipeline/trustee build` (`tsc -b && vite build`). These prove that the source-only package resolves through `exports`.
  - `cd <pkg> && npx tsc --noEmit`, and `yarn workspace <pkg-name> lint`.
- **Docker smoke** (if Docker is available locally): `docker build --target frontend-build .` and `docker build --target trustee-build .`. These prove the new COPY lines are complete.
- **Repo gates:** `npx tsx scripts/lint-docs.ts`, `npx tsx scripts/lint-comments.ts`, and `scripts/check-changes.sh`. Confirm that a `<pkg>/*`-only change selects the package tests plus frontend and trustee.
- **Grep guard:** `grep -rn "function formatFullUsd\|function formatBpsRate" packages/frontend/src packages/trustee/src` returns nothing.
- **Visual check:** none required, because output is unchanged. If Q2 is answered "unify", this plan must be revised to add a live visual check of the affected pages.

## Docs to Update

- `docs/frontend/utils.md`:
  - Add a "Shared formatters (`<pkg-name>`)" section with the `#shared-formatters` anchor that the headers point to. It lists `formatFullUsd` and `formatBpsRate` with their contracts.
  - Remove the trustee-local `formatFullUsd` row, and point readers to the shared section.
  - Reword the "Trustee app" intro paragraph: identical formatters now live in `<pkg-name>`, and only divergent or app-specific ones stay duplicated.
- `docs/FRONTEND.md` (the two-apps section): add a paragraph for the new shared package, describing it as source-only, pure TS, no React or wallet deps, and relative imports only.
- `ARCHITECTURE.md`: add a `### <pkg>` subsection next to `### packages/ui`, with what it holds, its consumers, and its dependency direction (apps → `<pkg>`; `<pkg>` depends on nothing in the workspace).
- `docs/RELIABILITY.md` "Selective verification" table: add a `<pkg>` row ("tests, plus everything for `frontend`, `trustee`").
- `docs/exec-plans/tech-debt-tracker.md` TD-38:
  - Mark it resolved by #1337 for `formatFullUsd` / `formatBpsRate`.
  - Record that the two `formatCompactUsd` variants stay app-local on purpose, as different Figma precision, according to the Q2 answer.
  - Cross-reference the new known-bugs entry.
  - Update the TD-42 / TD-52 "precedent" wording that cites TD-38.
- `docs/exec-plans/known-bugs.md`: the LP rollover entry from step 9.
- No product-spec change, because there is no user-facing behaviour change.
