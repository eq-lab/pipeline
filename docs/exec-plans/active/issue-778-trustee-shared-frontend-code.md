# Issue #778: Trustee: extract shared frontend code (wallet / api / formatters) for reuse

Source: https://github.com/eq-lab/pipeline/issues/778

Parent epic: #775 (Trustee Admin Panel). Depends on #777 (closed). Blocks #1349 (re-point
`packages/frontend` at `@pipeline/wallet-connect`), which in turn unblocks TD-52.

No Figma reference. This is a refactor with no visual or behavioural change, so there is no
Figma verification step.

## Context: what is already there

The issue was written before most of epic #775 shipped. Since then:

- `@pipeline/wallet-connect` (`packages/wallet-connect`, created by #791) already holds the
  wallet and on-chain plumbing the trustee needs: connect/disconnect, the picker modal,
  `signMessage`, `getSacBalance`, and the trustee `LoanRegistry`/minter writes. The trustee
  imports it. The LP app does **not**. It still owns a **copy** that has drifted since #791
  (TD-35):
  - The LP has `isSettled` on `useEvmWallet` and `useStellarWallet`, plus the Stellar
    `connectionStore` settled flag (`markStellarConnectionSettled`,
    `useStellarConnectionSettled`). Neither exists in the shared package.
  - The LP `ConnectModalProvider` warms the hero image when the browser is idle. The shared one
    doesn't.
  - The LP checks `readTermsAcknowledged()` before calling `openGate`. The shared package always
    calls the injected `openGate`.
  - The shared package has `signMessage`, `onCancel`/`onWalletSelect`, `signMessageOnly` and
    `supportsSignMessage`, which the LP lacks.
  - The shared `useStellarConnectors` disconnect also clears the connection store
    (`setStellarConnectionAddress(undefined)`).
- `packages/trustee` has its own `src/api/client.ts` (`apiFetch` plus `ApiError(message, status)`
  plus `ApiUnauthorizedError`, with bearer injection), its own `src/lib/env.ts`, and its own
  `src/utils/*`. The `docs/frontend/utils.md` "Trustee app" note records these as deliberate
  duplicates. The tech-debt entries are TD-32 (env accessor), TD-38 (money formatters), TD-42
  (`loan_data` types and date/USD formatters), and TD-52 (the chain-generic half of
  `userError`).

The research established that these pieces are **byte-identical** across the two apps (diffed):

| Piece | LP location | Trustee location |
|---|---|---|
| `formatMaturityDate`, `formatSubmittedDate` | `frontend/src/utils/formatDate.ts` | `trustee/src/utils/formatDate.ts` |
| `formatFullUsd`, `formatBpsRate` | `frontend/src/utils/formatCompactUsd.ts` | `trustee/src/utils/formatUsd.ts` |
| `toError`, `parseSorobanContractErrorCode`, `REJECTION_PATTERNS` + `isWalletRejection`, `UserFacingError` | `frontend/src/utils/userError.ts` | `trustee/src/utils/userError.ts` |
| `normalizeOriginationSubmissionStatus` | `frontend/src/api/useLoanSubmissions.ts` | `trustee/src/api/useLoanSubmissions.ts` |
| `readString` / `readNumber` env readers, `withEnvOverride` | `frontend/src/lib/env.ts` | `trustee/src/lib/env.ts` |
| `truncateAddress` (LP adds a falsy guard; same output for every `string`) | `frontend/src/utils/truncateAddress.ts` | `trustee/src/lib/truncateAddress.ts` |
| mock lookup in `apiFetch` (LP `readMock(key, parseJson)` ≡ trustee `readMock`) | `frontend/src/api/client.ts` | `trustee/src/api/client.ts` |

These pieces are **not** identical, so they stay app-local:

- `formatCompactUsd`: the LP always shows 1 decimal (`$8.0M`). The trustee trims trailing zeros
  (`$8.4M`, `$96M`, `$4.95M`). Unifying would change one app's output.
- `toUserError`: each app has its own match order and copy (`docs/frontend/error-handling.md`).
- `economicsBaseUnitsToUsdDecimal`: the two implementations differ. It is shared only if the
  trustee's existing tests pass against the LP implementation (Step 4).

## Scope

### In scope

1. **New source-only workspace package `@pipeline/web-shared` (`packages/web-shared`)** for
   framework-light frontend code that both apps import. It has no React Query, no wallet SDKs,
   no JSX, and never reads `import.meta.env`. It is modelled on `@pipeline/ui`: the `exports`
   map points at `./src/index.ts` and there is no build step. The directory is not
   `packages/shared` because that is the Rust crate.
2. **API client core.** One `ApiError` class, plus a `createApiFetch(options)` factory that
   holds the shared mock lookup, the fetch, the error-body parsing and the empty-body handling.
   Each app keeps a thin `src/api/client.ts` that builds its `apiFetch` from the factory:
   - The LP injects its session-ended publisher (401 / 403 `account_suspended`).
   - The trustee injects bearer-token headers and its `ApiUnauthorizedError` mapping.
3. **Typed API surface.** Shared DTO types and pure helpers for the endpoints both apps read:
   - `/v1/loan-book`: `LoanBookSummary`, `LoanBookEntry`, `LoanBookResponse`,
     `TopConcentration`, `LoanDocumentDto`. The trustee's post-#833 superset is canonical.
   - `/v1/loan-book/submissions`: `SubmissionView`, `SubmitLoanRequest`, `EconomicsInput`,
     `LocationInput`, `OriginationSubmissionStatus`, `normalizeOriginationSubmissionStatus`.

   The React Query hooks stay app-local, as thin wrappers over each app's `apiFetch` (see
   D2 / Open Questions).
4. **Formatters and shared utils** from the identical-pieces table above, moved into the shared
   package. Their tests move with them.
5. **Env-reader factory.** `createEnvReader(buildTimeEnv)` returns `readString`/`readNumber`,
   plus a generic `withEnvOverride`. Each app's `src/lib/env.ts` stays the only file that touches
   `import.meta.env`, and keeps its own `ENV` key set.
6. **Close the wallet-connect drift so #1349 becomes a mechanical re-point.** Port into
   `@pipeline/wallet-connect`, as **additive** changes that do not change trustee behaviour:
   `isSettled` (EVM and Stellar), the Stellar `connectionStore` settled flag, and the
   `ConnectModalProvider` hero-image idle warm-up. Then record in TD-35 the exact remaining
   deltas #1349 must handle on the LP side.
7. **Both apps import the shared code.** The trustee drops its local copies. **The LP also
   re-points** its imports for items 2–5. This is the only way the duplication actually goes
   away, and for these items it is behaviour-neutral (identical code). The LP's **wallet**
   imports are **not** re-pointed here. That is #1349.
8. Build and CI wiring:
   - Dockerfile: both the `frontend-build` and `trustee-build` stages copy the new package.
   - CI: typecheck and vitest for `@pipeline/web-shared`.
   - ESLint and Prettier config for the new package.
9. Docs updates (see Docs to Update).

### Out of scope

- Trustee flow logic: routes, presenters, `toUserError` copy tables, the trustee-only
  formatters (`formatCompactUsd` trustee variant, `formatCompactUsd2dp`, `formatIsoDateUtc`,
  `formatAuditTimestamp`, `stellarSacUnits.ts`, and others).
- Re-pointing `packages/frontend/src/wallet/**` at `@pipeline/wallet-connect` and deleting the
  LP copies. That is **#1349**.
- LP-only on-chain plumbing: deposit, withdraw and stake contract hooks, `useTermsAcknowledgement`,
  `WalletGateProvider`, the LP `lib/usdc.ts` and `lib/format.ts` bigint formatters. The trustee
  doesn't use any of them.
- The two `networkSwitcher.ts` glue files. They are thin per-app compositions of each app's
  `ENV` and `@pipeline/wallet-connect`, and the logic is already shared.
- Generating the Docker entrypoint `__ENV__` writer (shell; the TD-32 remainder).
- TD-46 (`formatFractionPct`, trustee-internal), TD-109 (clipboard hook), TD-22.
- Any change to rendered output, network calls or mock-key names in either app.

## Assumptions and Risks

- **D1: package home.** Use a new `@pipeline/web-shared`, not `@pipeline/ui` or
  `@pipeline/wallet-connect`:
  - `@pipeline/ui` is presentational. TD-52 rejected it, and it has no test runner.
  - `@pipeline/wallet-connect` carries wagmi, AppKit and the Stellar SDK. Making the LP depend on
    it only to get `formatFullUsd` or `ApiError` would drag the wallet bundle into the
    dependency edge ahead of #1349.

  TD-52's suggested fix named `wallet-connect`. This plan deviates and records the reason in
  TD-52 (see Open Questions Q1).
- **D2: hooks.** Types and pure helpers are shared. The `useQuery` wrappers are not, because:
  - Each app's hook binds a different `apiFetch` (auth), query key, and polling/`enabled`
    policy. The trustee `useLoanSubmissions` takes a status filter. The LP one has none.
  - Sharing them would put React Query into `web-shared`, which conflicts with the package's
    framework-light boundary.

  See Open Questions Q2.
- **D3: `ApiError` signature.** Standardise on the LP shape:
  `new ApiError(status, message, payload?)`. LP call sites (8 files) are unchanged. Trustee
  `new ApiError(message, status)` call sites (8 files, mostly tests) get their arguments
  swapped. `ApiUnauthorizedError extends ApiError` moves into the shared package as well, but
  only the trustee's client throws it. LP `instanceof ApiError` checks keep working because
  there is one class.
- **Trustee-side edge changes (accepted, not LP).**
  - The shared core extracts `payload.error` only when it is a `string` (LP rule). The trustee
    accepts any truthy value. A non-string `error` on a malformed body now falls back to
    `statusText` in the trustee.
  - Trustee `ApiError`s gain `.payload`.
  - Empty bodies (202/204) resolve to `undefined` in both apps, as before.

  Each change is called out in the PR body.
- **LP behaviour-neutrality is the main risk.** Mitigations:
  - Re-point one module group per step.
  - Run the full LP vitest suite, `tsc --noEmit`, lint and `vite build` after each group.
  - Keep every moved function body byte-identical, and move the tests verbatim.
  - The coder does **not** touch `packages/frontend/src/wallet/**` except where Step 3 needs an
    import-path change. It should need none.
- **Wallet-connect additions must not change trustee behaviour.** `isSettled` is a new return
  field and the hero warm-up is a side-effect-only `<img>` preload. The trustee test suite must
  stay green.
- **Docker.** If `packages/web-shared/package.json` is not added to the Dockerfile install layer
  in **both** stages (lines ~74–79 and ~108–113) and the source to both copy layers (~84–86,
  ~119–121), `yarn install --immutable` or the build fails in CI images. `yarn.lock` changes
  when the workspace is added, so commit the lockfile.
- **Tailwind.** `web-shared` must contain no `className`, so no `@source` line is needed in
  either app's `index.css`. If anything that renders ever lands there, both apps must add
  `@source "../../web-shared/src/**/*.{ts,tsx}"` (otherwise styles silently vanish).
- **Comment policy.** `AGENTS.md` asks for comment-minimal code: one 2–3-line spec-pointer
  header per new file, and nothing else. The existing long LP/trustee docblocks on moved
  functions are **not** carried over. Their substance goes into the new
  `docs/frontend/web-shared.md` spec in the same commit ("extract-then-trim",
  `docs/FRONTEND.md` rule 6).
- **Dependency:** none open. #777 is closed. #1349 depends on this issue, not the reverse.
- **Prettier drift** (TD-47/TD-53) may make `yarn workspace @pipeline/frontend lint` red on
  untouched files. Run `prettier --write` only on files this issue touches, and do not
  reformat unrelated files.

## Open Questions

- **Q1 (package home):** is a new `@pipeline/web-shared` package acceptable, or should the
  shared non-wallet code be hoisted into `@pipeline/wallet-connect` as TD-52 originally
  suggested? The planner's default is a new package (D1). That keeps the LP free of a
  wallet-SDK dependency edge until #1349.
- **Q2 (typed hooks):** the issue says "API client + typed hooks". Is sharing the **DTO types +
  pure helpers + client core** enough, with each app keeping its thin `useQuery` wrapper? Or
  do you want shared React Query hook factories, which would put React Query into
  `web-shared`? The planner's default is types only (D2).
- **Q3 (#778 vs #1349 split):** confirm that #778 only makes `@pipeline/wallet-connect` a
  superset of the LP slice (adds `isSettled`, settled store, hero warm-up), and **#1349** does
  the actual LP wallet re-point and deletion. The alternative is folding #1349 into this
  issue.

## Implementation Steps

1. **Scaffold `packages/web-shared`.**
   - `package.json`: name `@pipeline/web-shared`, `private`, `type: module`,
     `exports: { ".": "./src/index.ts" }`, scripts `lint` / `test` (`TZ=UTC vitest run`).
     Copy the devDeps and versions from `packages/wallet-connect/package.json`, minus the React
     testing libraries if unused. There are no runtime dependencies.
   - `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `vite.config.ts`
     (vitest, `environment: "jsdom"` because the mock reader touches `localStorage`), and
     `src/test-setup.ts` if needed. Mirror `packages/wallet-connect`.
   - ESLint guards in the new package:
     - `no-restricted-imports` for `wagmi`, `viem`, `@reown/*`, `@tanstack/react-query`,
       `@creit.tech/*`, `@stellar/*`, and `react`.
     - `no-restricted-syntax` banning `import.meta.env`.
     - `no-restricted-globals` `fetch` everywhere except `src/api/**`.
   - Root `package.json` `workspaces`: add `packages/web-shared`. Run `yarn install` and commit
     the `yarn.lock` change.
   - Add `"@pipeline/web-shared": "workspace:^"` to `dependencies` in `packages/frontend` and
     `packages/trustee`.
   - `src/index.ts` barrel: one spec-pointer header, then re-exports only.
2. **Formatters and utils** (`packages/web-shared/src/format/`, `src/errors/`,
   `src/address/`).
   - `format/date.ts`: `formatMaturityDate`, `formatSubmittedDate`. Function bodies are copied
     byte-for-byte from `packages/frontend/src/utils/formatDate.ts`.
   - `format/usd.ts`: `formatFullUsd`, `formatBpsRate`, copied from
     `packages/frontend/src/utils/formatCompactUsd.ts`.
   - `errors/userError.ts`: `UserFacingError`, `toError`, `parseSorobanContractErrorCode`,
     `isWalletRejection` (now exported) with the private `REJECTION_PATTERNS`.
   - `address/truncateAddress.ts`: the LP implementation.
   - Move the corresponding test cases from `packages/frontend/src/utils/*.test.ts` and
     `packages/trustee/src/utils/-*.test.ts` into co-located `*.test.ts` files. Take the
     **union** of both apps' cases and de-duplicate. Every case must still pass unchanged.
   - Re-point the LP:
     - `packages/frontend/src/utils/formatDate.ts` keeps only its LP-only axis functions
       (`formatAxisDate`, `formatAxisDateRange`, `sampleAxisDates`) and drops the two moved
       functions.
     - `formatCompactUsd.ts` drops `formatFullUsd` and `formatBpsRate`.
     - `userError.ts` imports `toError`, `parseSorobanContractErrorCode`, `isWalletRejection`
       and `UserFacingError` from `@pipeline/web-shared`, keeping its own `toUserError` and copy
       tables.
     - `utils/truncateAddress.ts` is deleted.
     - Update every LP import site (`grep -rn` for each moved name). Importing straight from
       `@pipeline/web-shared` is preferred over a re-export shim.
   - Re-point the trustee the same way: `src/utils/formatDate.ts`, `src/utils/formatUsd.ts`,
     `src/utils/userError.ts`. Delete `src/lib/truncateAddress.ts` and update its importers
     (`TrusteeSidebar` and others).
   - Gate: LP and trustee vitest, `tsc --noEmit`, and lint are all green.
3. **`economicsBaseUnitsToUsdDecimal` (conditional).**
   - Move the LP implementation to `web-shared/src/format/usd.ts`.
   - Run the trustee's existing test cases for it (in `-formatUsd.test.ts` or the
     `stellarSacUnits` tests) against the shared function.
   - If **all** pass, re-point the trustee's `stellarSacUnits.ts` export and the LP
     `formatCompactUsd.ts` at it.
   - If **any** expectation differs, leave both app-local, revert the move, and record why in
     TD-42.
4. **Env-reader factory** (`web-shared/src/env/createEnvReader.ts`).
   - `createEnvReader(buildTimeEnv: Record<string, unknown>)` returns
     `{ readString, readNumber }`. The bodies are byte-identical to today's, with
     `import.meta.env[key]` replaced by `buildTimeEnv[key]` and the `window.__ENV__` lookup
     kept.
   - `withEnvOverride<T extends object>(target: T, overrides, fn)` is the generic form of
     today's helper.
   - `packages/frontend/src/lib/env.ts` and `packages/trustee/src/lib/env.ts` call
     `createEnvReader(import.meta.env)` and keep their `ENV` objects **verbatim** (same keys,
     same defaults). Each keeps an app-local `withEnvOverride` wrapper with the same signature,
     so no test call site changes.
   - Unit-test the factory: runtime `window.__ENV__` wins over the build-time value, empty
     string falls through to the default, a missing key with no default throws, and a
     non-numeric number throws.
5. **API client core** (`web-shared/src/api/client.ts`, `src/api/errors.ts`).
   - `ApiError(status, message, payload?)` (LP shape), and
     `ApiUnauthorizedError extends ApiError` (status 401).
   - `createApiFetch({ getBaseUrl, prepareInit?, onErrorResponse?, toError? })` returns
     `apiFetch<T>(path, init?)` and preserves the LP algorithm exactly:
     - mock key 1, then mock key 2 (`pipeline.mock.api.<METHOD>.<path>` with and without the
       query string), using a local `localStorage` + `JSON.parse` reader with try/catch. This
       is equivalent to the LP `readMock(key, parseJson)`.
     - `fetch(getBaseUrl() + path, prepareInit ? prepareInit(init) : init)`.
     - On a non-2xx response: message = string `payload.error`, falling back to `statusText`.
       Call `onErrorResponse?.({ status, message, init })`, then throw
       `(toError ?? defaultApiError)(status, message, payload)`.
     - 204/202 resolve to `undefined`. Any other response reads text and parses JSON only when
       non-empty.
   - LP `packages/frontend/src/api/client.ts` becomes:
     - re-exports of `ApiError`, `ACCOUNT_SUSPENDED`, `SessionEndReason` and
       `subscribeSessionEnded` (the session-ended publisher stays LP-local);
     - `export const apiFetch = createApiFetch({ getBaseUrl: () => ENV.API_BASE_URL, onErrorResponse })`,
       where `onErrorResponse` holds today's 403-`account_suspended` / 401 +
       `requestIsAuthenticated` logic unchanged.

     It no longer imports `readMock`/`parseJson` from `@/wallet`.
   - Trustee `packages/trustee/src/api/client.ts`:
     - `prepareInit` does today's `Headers` + bearer-token injection from `getSessionToken()`.
     - `toError` maps 401 to `ApiUnauthorizedError`.
     - It re-exports `ApiError` / `ApiUnauthorizedError` from `@pipeline/web-shared`.
     - Swap the constructor arguments at the trustee `new ApiError(message, status)` sites
       (`grep -rn "new ApiError(" packages/trustee/src`).
   - Keep `packages/frontend/src/api/client.test.ts` and `packages/trustee/src/api/-client.test.ts`
     as app-level tests, updating only the constructor order in trustee assertions. Add
     `web-shared/src/api/client.test.ts` covering:
     - mock key precedence;
     - query-stripped fallback;
     - string vs non-string `error`;
     - `statusText` fallback on non-JSON;
     - 202/204/empty-200 → `undefined`;
     - `prepareInit`, `onErrorResponse` and `toError` hooks are invoked.
6. **Shared DTO types** (`web-shared/src/api/loanBook.ts`, `src/api/loanSubmissions.ts`).
   - Move the trustee's `LoanBookSummary` / `LoanBookEntry` / `LoanBookResponse` /
     `TopConcentration` / `LoanDocumentDto` (the post-#833 superset), plus `SubmissionView`,
     `SubmitLoanRequest`, `EconomicsInput`, `LocationInput`, `OriginationSubmissionStatus` and
     `normalizeOriginationSubmissionStatus`. The last two are byte-identical in both apps.
   - Both apps' `useLoanBook.ts` / `useLoanSubmissions.ts` import these types and keep only
     their hook, their `Use…Result` / options types, and their query keys and policies.
   - The LP picks up the superset fields as **types only**. There is no runtime change. Run
     LP `tsc` to confirm that no LP code narrowed on the old subset (for example an object
     literal fixture missing the new required fields in tests). Fix any such fixtures by adding
     fields, never by loosening the shared types.
   - `@pipeline/wallet-connect`'s `stellar/contracts/loanRegistry.ts` also exports
     `SubmitLoanRequest`, `EconomicsInput` and `LocationInput` (the TD-43 third copy). Leave it
     untouched in this issue: `wallet-connect` must not depend on `web-shared` yet. Record it in
     TD-43 as the remaining copy.
7. **Close the `@pipeline/wallet-connect` drift (additive only).** Back-port from the LP:
   - `packages/wallet-connect/src/stellar/connectionStore.ts`: the `settled` flag,
     `markStellarConnectionSettled`, `isStellarConnectionSettled`,
     `useStellarConnectionSettled`, and resetting `settled` in the test-reset helper. Copy
     these from `packages/frontend/src/wallet/stellar/connectionStore.ts`.
   - `stellar/useStellarWallet.ts`: `isSettled` on `StellarWalletState`, and
     `markStellarConnectionSettled()` in the mount-hydration `finally`. Mocked means settled.
   - `evm/useEvmWallet.ts`: `isSettled` from wagmi `useAccount().status`
     (not `connecting`/`reconnecting`, or mocked).
   - `ConnectModalProvider.tsx`: the hero-image idle warm-up `useEffect`
     (`requestIdleCallback`, falling back to `setTimeout(…, 500)`).
   - Export any new symbols from `src/index.ts`.
   - Port the matching LP test cases into `connectionStore.test.ts`, `useStellarWallet.test.tsx`,
     `useEvmWallet.test.tsx` and `ConnectModalProvider.test.tsx`.
   - Do not touch the LP wallet files.
   - Append to TD-35 a "Remaining LP-side deltas for #1349" list:
     - the terms check: the LP must make `WalletGateProvider.openGate` short-circuit when
       `readTermsAcknowledged()`, because the shared provider always calls `openGate`;
     - the shared disconnect path clears the connection store;
     - the `ConnectWalletModal` `onDismiss` ordering on the Trust-wallet path;
     - the LP `stellar/chain.ts` contract-id exports and LP mock write keys stay LP-local;
     - `packages/frontend/src/index.css` needs
       `@source "../../wallet-connect/src/**/*.{ts,tsx}"`.
8. **Build and CI wiring.**
   - `Dockerfile`: in both `frontend-build` and `trustee-build`, add
     `COPY packages/web-shared/package.json packages/web-shared/package.json` before
     `yarn install --immutable`, and `COPY packages/web-shared/ packages/web-shared/` before the
     build.
   - `.github/workflows/lint.yml`: add a `lint-web-shared` job (`cd packages/web-shared && npx tsc --noEmit`),
     mirroring `lint-wallet-connect`.
   - `.github/workflows/tests.yml`: add `yarn workspace @pipeline/web-shared test`.
9. **Docs** (see Docs to Update). Do this in the same commit as the code moves, per
   `docs/frontend/index.md` "How to add an entry".
10. **Final verification** (see Test Strategy). Run `npx tsx scripts/lint-docs.ts`.

## Test Strategy

- **Moved-unit tests.** Every moved function's existing LP and trustee test cases now run in
  `packages/web-shared` (union, de-duplicated, assertions unchanged). This proves byte-level
  behaviour parity for both former owners.
- **New unit tests** for code that is new in shape:
  - `createEnvReader`: runtime over build-time, empty → default, missing → throws, NaN →
    throws.
  - `createApiFetch`: mock precedence, query-stripped alias, string vs non-string `error`,
    `statusText` fallback, 202/204/empty-200 → `undefined`, hooks invoked with the right
    arguments, `toError` override.
  - `ApiUnauthorizedError instanceof ApiError`.
- **App suites unchanged and green.** These must pass with no test assertions edited except
  the trustee `ApiError` argument order and LP fixtures gaining superset DTO fields:
  - `yarn workspace @pipeline/frontend test`
  - `yarn workspace @pipeline/trustee test`
  - `yarn workspace @pipeline/wallet-connect test`
  - `yarn workspace @pipeline/web-shared test`

  `packages/frontend/src/api/client.test.ts` is the key guard for LP session-ended and 401/403
  behaviour.
- **wallet-connect additions:** new `isSettled` cases (EVM: connecting/reconnecting → false,
  connected/disconnected → true, mocked → true; Stellar: false until hydration settles, true
  after resolve or reject, mocked → true), plus a hero warm-up test using fake timers when
  `requestIdleCallback` is absent.
- **Typecheck, lint and build** for each of frontend, trustee, wallet-connect and web-shared:
  `npx tsc --noEmit` and `yarn lint` (Prettier only on touched files; see the TD-53 risk).
  Also run `yarn workspace @pipeline/frontend build` and `yarn workspace @pipeline/trustee build`.
- **Docker smoke:** `docker build --target frontend .` and `docker build --target trustee .`
  both succeed.
- **LP no-behaviour-change smoke (human):** with the user's own dev server running (don't
  start, restart or drive it), ask the user to hard-refresh the LP home, dashboard and
  transactions pages. They should see the same API calls in the Network tab and the same
  rendered values (loan book, origination tab dates and amounts, truncated addresses). Ask the
  same for the trustee sign-in, Origination and Loans pages.
- **Docs:** `npx tsx scripts/lint-docs.ts` passes.

## Docs to Update

- `ARCHITECTURE.md` → Packages:
  - add `packages/trustee` and `packages/wallet-connect` (both currently undocumented);
  - add `packages/web-shared` (what belongs there, no wallet SDKs or React Query, consumed by
    both apps);
  - change `packages/ui`'s "consumed by `packages/frontend`" to both apps.
- **New** `docs/frontend/web-shared.md` area spec: the package boundary and its ESLint
  guards, the `createApiFetch` contract (mock lookup order, error-body rules, empty-body rule,
  the three hooks and how each app wires them), `createEnvReader`, and the shared DTO
  conventions. The text moved out of the LP and trustee `client.ts` / `env.ts` docblocks lands
  here. Link it from `docs/frontend/index.md` → Area specs.
- `docs/frontend/utils.md`:
  - re-point the rows for `formatFullUsd`, `formatBpsRate` (add it if missing),
    `formatMaturityDate` / `formatSubmittedDate` (add), `toError`,
    `parseSorobanContractErrorCode` (add), `truncateAddress` and possibly
    `economicsBaseUnitsToUsdDecimal` to `@pipeline/web-shared`;
  - delete the matching "(trustee)" duplicate rows;
  - rewrite the "Trustee app" paragraph: the app now shares through `@pipeline/web-shared`, and
    only the intentionally divergent helpers (`formatCompactUsd` trustee variant, `toUserError`)
    stay local;
  - add `createEnvReader` and `createApiFetch` rows.
- `docs/FRONTEND.md` → Code structure rules: widen "applies to `packages/frontend/` and
  `packages/ui/`" to include `packages/trustee/`, `packages/wallet-connect/` and
  `packages/web-shared/`. Rule 3 names `@pipeline/web-shared` as the home for cross-app utils.
- `docs/frontend/trustee-flows.md` and `docs/frontend/error-handling.md`:
  - update `@/utils/...` / `@/lib/truncateAddress` paths for the moved helpers;
  - note that `ApiError` is shared;
  - in the trustee mapping-layer section, note that the chain-generic half now comes from
    `@pipeline/web-shared`.
- `docs/exec-plans/tech-debt-tracker.md`:
  - TD-32: partially resolved (env reader shared; the entrypoint script remains).
  - TD-38: `formatFullUsd` and `formatBpsRate` resolved; the `formatCompactUsd` divergence is
    intentional and stays.
  - TD-42: shared DTO types and date/full-USD formatters resolved; the row mappers
    (`originationRow.ts` vs `-useOriginationTable.ts`) remain.
  - TD-43: note the remaining `wallet-connect` copy.
  - TD-52: resolved, with the D1 rationale for not using wallet-connect.
  - TD-35: add the remaining-deltas list for #1349.
- `packages/frontend/src/api/README.md`: the mock-key schema is unchanged. Add one line saying
  the lookup now lives in `@pipeline/web-shared`'s `createApiFetch`.
- No product-spec change: the refactor changes no user-facing behaviour.
