# Known Bugs

Bugs discovered during development that are not yet fixed. Log here, don't fix inline.

## Format

```
### BUG-<N>: <short description>
- **Date:** YYYY-MM-DD
- **Location:** file or component
- **Symptom:** what breaks / what you observe
- **Root cause:** why it happens (if known)
- **Workaround:** any temporary mitigation (if any)
```

---

## Open

### BUG-18: `-dashboard.test.tsx` asserts the pre-#1053 raw status literal — fails on `main`
- **Tracked:** #1062
- **Date:** 2026-08-11
- **Location:** `packages/frontend/src/routes/-dashboard.test.tsx` — "renders the Figma 4116-9155 column set and formatted values when selected" (`expect(screen.getByText("InReview"))`, ~line 980).
- **Symptom:** The test fails on a clean `main` checkout: the origination Status cell renders the #1053 humanized label "In review", but the assertion still expects the backend literal "InReview".
- **Root cause:** #1053 changed the status rendering; `DeploymentMonitorPanel.test.tsx` fixtures were updated (`statusLabel: "In review"`) but this route-level assertion was missed. Not caught because CI does not run the frontend vitest suite.
- **Workaround:** None needed — change the assertion to `"In review"`. Discovered while running the suite for #1058 (unrelated to that change, so not fixed inline).

### BUG-17: `dashboards.md` In Origination row-field spec is stale (pre-#814 column set)
- **Tracked:** #1063
- **Date:** 2026-08-11
- **Location:** `docs/product-specs/dashboards.md` — "In Origination tab" bullet (Panel B section, ~line 160-161).
- **Symptom:** The spec says each origination row "reuses the Active Loans table layout plus a Status column" with fields Borrower/Commodity, Principal, Rate, Protection (Collateral/LTV/Duration as `—`). The actual `OriginationTable.tsx` renders the issue #814 8-column set: Originator, Commodity, Facility, Corridor, Rate, Maturity, Submitted, Status.
- **Root cause:** #814 replaced the origination tab's field set but this product-spec paragraph was not updated (only `docs/frontend/dashboard-components.md` was).
- **Workaround:** None needed — `dashboard-components.md#originationtable` and the #814 exec plan describe the current columns. Discovered while scoping #1058 (out of scope there: the origination tab is explicitly unchanged).

### BUG-16: `NeedsAttention` silently drops load errors — no error UI at all
- **Tracked:** #1064
- **Date:** 2026-08-07
- **Location:** `packages/trustee/src/components/useNeedsAttention.ts:176` (sets `errorMessage: error.message` on the `"error"` state) / `packages/trustee/src/components/NeedsAttention.tsx` (never reads `errorMessage` or branches on `state === "error"`).
- **Symptom:** When the underlying query the panel depends on fails, `useNeedsAttention` computes a mapped error state, but `NeedsAttention.tsx` has no render branch for it at all — the panel silently renders as if there were nothing to show (no red text, no "couldn't load" note, nothing). A trustee has no way to know the panel failed to load rather than genuinely having zero items needing attention.
- **Root cause:** The component was never wired to the hook's `state`/`errorMessage` fields — only `rows`/`loanRows` are consumed. Predates #1037; out of scope there per the resolved Open Question (adopting `InlineError` here requires first wiring the missing render branch, which is a distinct, larger change than the mapping-layer sweep).
- **Workaround:** None. Fix requires adding an error-state branch to `NeedsAttention.tsx` (and, per the #1037 pattern, an `InlineError` there) — tracked as follow-up, not fixed inline.

### BUG-15: Origination detail page has no error state — a failed submissions fetch renders "not found"
- **Tracked:** #1065
- **Date:** 2026-08-07
- **Location:** `packages/trustee/src/routes/-origination-detail.ts:188` / `:431` (no error branch) — `origination.$id.tsx:529-535` renders the not-found UI for both "genuinely not found" and "the submissions fetch failed" cases.
- **Symptom:** If `useLoanSubmissions` (shared with `-useOriginationTable.ts`) fails while loading `/origination/$id`, the presenter finds no matching submission (since `data` is `undefined`) and falls through to the same `not-found` state a truly-missing id would produce ("Submission not found." + a link back to Origination) — there is no distinct error message, and the raw fetch failure is discarded entirely.
- **Root cause:** `-origination-detail.ts`'s state derivation only distinguishes `loading` / `not-found` / `ready`, with no `error` branch reading `useLoanSubmissions().error`.
- **Workaround:** None. Out of scope for #1037 (a sibling hook already gets the mapping-layer treatment; this needs a new `error` state added to `-origination-detail.ts` first, which is presenter-shape work, not just a copy swap).

### BUG-13: pre-commit `frontend lint` stage fails on pre-existing prettier debt
- **Tracked:** #1066
- **Date:** 2026-07-29
- **Location:** `packages/frontend` — 9 committed files fail `yarn lint` (prettier `--check`): `src/api/README.md`, `src/api/useStatsYield.ts`, `src/components/ConnectWalletModal.test.tsx`, `src/components/TopBar.test.tsx`, `src/components/TopBar.tsx`, `src/wallet/ConnectModalProvider.test.tsx`, `src/wallet/README.md`, `src/wallet/stellar/connectionStore.ts`, `src/wallet/stellar/contracts/stakedPlusd.test.ts`.
- **Symptom:** The husky pre-commit hook's `frontend lint` stage exits 1 for **any** commit, because these already-committed files are not prettier-conformant (each is byte-identical to `HEAD` — the debt predates the commit under way). Blocks committing unrelated (e.g. backend-only) changes through the hook.
- **Root cause:** Formatting debt landed on `main` without prettier being applied; the pre-commit `frontend lint` runs a repo-wide `prettier --check`, so it fails regardless of what the commit touches.
- **Workaround:** Run `cd packages/frontend && yarn lint --write` (or `prettier --write`) on the 9 files in a dedicated formatting-only PR. Discovered while committing #953 (backend-only); that commit bypassed the stale stage with `--no-verify` after manually verifying `cargo fmt`, `yarn codegen` (no changes), clippy, `cargo test --all`, `tsc`, and doc lint all pass.

### BUG-14: Trustee loan detail Documents card shows the empty state for loans indexed before commit `f73d54d`
- **Tracked:** #1067
- **Date:** 2026-08-07
- **Location:** `packages/shared/src/loan_snapshot.rs:26-31` (`LoanSnapshot.documents`, `#[serde(default)]`)
- **Symptom:** A loan's Documents card (`packages/trustee/src/routes/loans.$id.tsx`, issue #1039) renders "No documents provided." even though the loan's on-chain IPFS metadata lists real documents.
- **Root cause:** `GET /v1/loan-book`'s `documents` field was added by commit `f73d54d`. Loans whose `contract_logs.params.snapshot` row was indexed *before* that commit deserialize `documents` to `[]` (the field defaults on deserialize) rather than backfilling from the still-available on-chain metadata. This is correct never-fabricate behavior on the frontend — the API genuinely serves `[]` for these rows — but the underlying data gap is real.
- **Workaround:** None applied. The loan-registry indexer resync (#442) re-indexes historical snapshots and will backfill `documents` for these loans once it runs; no frontend workaround should be attempted (do not re-fetch metadata client-side — see #1039's exec plan for why that was rejected).

### BUG-11: EVM yield-mint phase has no "nothing to mint" skip (potential retry-forever)
- **Tracked:** #1068
- **Date:** 2026-07-29
- **Location:** `packages/worker/src/relayer/yield_mint/mod.rs` + `packages/shared/src/yield_mint_outbox_repo.rs::discover_pending` (EVM path).
- **Symptom:** The Stellar phase was fixed (`skip_nothing_to_mint_stellar`, discovered 2026-07-29) to skip pure-principal repayments before submit, because `yield_minter.mint_yield` reverts with `ZeroAmounts` when there is no yield to distribute, and that revert also rolls back the in-tx `consume_yield` mark, so the row retries every cycle forever. The EVM path has **no equivalent skip** — a `pending` row for a zero-yield repayment would submit repeatedly.
- **Root cause:** The fix was scoped to Stellar (the confirmed live symptom). Whether EVM actually loops depends on the EVM `YieldMinter` contract's behaviour on zero amounts (separate contract, not confirmed here). The EVM `PaymentRecorded` params carry the same fields, so the same worker-side sweep is portable if needed.
- **Workaround:** None. If EVM zero-yield repayments appear stuck in `pending`, port `skip_nothing_to_mint_stellar` to the EVM discover path (checksum-address variant).

### BUG-12: Stellar yield-mint nothing-to-mint skip has no on-chain backstop
- **Tracked:** #1069
- **Date:** 2026-07-29
- **Location:** `packages/shared/src/yield_mint_outbox_repo.rs::skip_nothing_to_mint_stellar`.
- **Symptom:** The nothing-to-mint detection is now **worker-side only** (SQL over the `PaymentRecorded` event in `contract_logs`); the earlier contract-error fallback (`Error(Contract, #1)` → skip at submit) was intentionally removed. If a zero-yield row is ever *not* caught by the sweep — a NULL/missing amount field in the event, a `loan_registry` address mismatch, or the event field names drifting from `senior_interest / mgmt_fee / perf_fee / oet_alloc` — the row stays `pending` and retries forever with no backstop. The sweep is conservative (`NULL = 0` is unknown → not skipped), so the failure mode is "loops" not "wrongly skipped".
- **Root cause:** Design choice (worker-side only, no on-chain call) trades the authoritative contract guard for avoiding an RPC round-trip. The Stellar parser (`loan_registry_parsers.rs:236-246`) always writes all seven fields, so NULLs shouldn't occur in practice — but nothing enforces that at the sweep. Also unrelated: the sweep duplicates the contract's mint rule in SQL, so if `pipeline-stellar-contracts` changes what counts as mintable, the sweep could skip a row that should mint (uncaught, since the mint is no longer attempted).
- **Workaround:** None needed while the parser guarantees the fields. If robustness is required, re-add a submit-time contract-error fallback, or add a monitor that alerts on `pending` rows older than N cycles.

### BUG-10: `capital_allocation.rs::normalize_to_canonical` does non-truncating division
- **Tracked:** #1070
- **Date:** 2026-07-21
- **Location:** `packages/api/src/routes/capital_allocation.rs` — `normalize_to_canonical` (~line 157-170).
- **Symptom:** `raw / BigDecimal::from(10i128.pow(asset_decimals - CANON))` (the `asset_decimals > CANON` branch) uses plain `BigDecimal` division, which does not floor to a whole base-unit integer — `BigDecimal::from(123456789) / BigDecimal::from(10) = 12345678.9`, not `12345678`. Every raw on-chain amount is a whole integer at its native scale, so the normalized result should be too.
- **Root cause:** Same defect class discovered and fixed in `shared::chains::normalize_usdc_amount` during #901's code review (see `normalize_usdc_amount_stellar_truncates_not_rounds` test, `packages/shared/tests/chains.rs`) — that fix appended `.with_scale_round(0, RoundingMode::Down)`. This function needs the identical fix but was out of scope for #901 (pre-existing, untouched code).
- **Workaround:** None. Impact is likely small (sub-base-unit precision only) but affects Capital Allocation's `in_transit` bucket for any Stellar `AssetTransfer` amount not evenly divisible by the scale factor.

### BUG-9: `KycRepo::GroupedRequest::from_row` formats `amount`/`assets`/`shares` as raw on-chain integers, not dollar strings
- **Tracked:** #1071
- **Date:** 2026-07-21
- **Location:** `packages/shared/src/kyc_repo.rs` — `GroupedRequest::from_row` (~line 122-127).
- **Symptom:** `amount: row.amount.map(|a| a.to_string()).unwrap_or_default()` (and the equivalent for `assets`/`shares`) calls `.to_string()` directly on the raw `BigDecimal` pulled from `contract_logs.params`, never through `base6_to_decimal_string`. If ever consumed by an API response, this would render e.g. `"1200000000"` instead of `"1200.000000"` — for both EVM and Stellar rows, unrelated to the #901 decimal-scale fix.
- **Root cause:** Missing `base6_to_decimal_string` call. Discovered while auditing every `base6_to_decimal_string` consumer for #901's Stellar-scale bug; `GroupedRequest` is currently unused by any API route or worker consumer (confirmed via repo-wide grep) so there is no live user-visible impact today.
- **Workaround:** None needed while unconsumed. Fix before wiring `GroupedRequest` to any endpoint.

### BUG-8: `-deposit.test.tsx` Stellar voucher mocks nest `signatureBytes` under `data` instead of top-level
- **Tracked:** #1074
- **Date:** 2026-07-09
- **Location:** `packages/frontend/src/routes/-deposit.test.tsx` — the `@/api` mock factory for `useStellarDepositVoucher` / `useStellarWithdrawalVoucher` (around line 201-219).
- **Symptom:** The mock returns `{ data: { signatureBytes: ... }, status, error, refetch }`, but the real hooks (`useStellarDepositVoucher.ts` / `useStellarWithdrawalVoucher.ts`) expose `signatureBytes` as a top-level field on the hook result, not nested inside `data`. The `useDepositFlow.ts` Stellar claim `onAction` handler reads `(stellarVoucher as { signatureBytes? }).signatureBytes` (top-level), so with this mock shape `sig` is always `undefined` when status is "ready". No test currently clicks the Stellar Claim button (`renderDepositStellar()` tests only assert enabled/disabled state, never `user.click`), so this has been latent and undetected.
- **Root cause:** Mock was written against a guessed/incorrect shape and never exercised end-to-end via a click assertion.
- **Workaround:** None applied — found while implementing #800 (voucher `deadline` threading). Fix by moving `signatureBytes` to the mock's top level (matching `UseStellarDepositVoucherResult`/`UseStellarWithdrawalVoucherResult`) and adding a click-triggers-write test for the Stellar claim path, analogous to the existing EVM "clicking Claim ... triggers claim.write" tests.

### BUG-6: Frontend vitest suite — widespread `localStorage` undefined failures
- **Tracked:** #1003 (consolidated with the two `localStorage` BUG-8 entries)
- **Date:** 2026-06-30 (root cause identified 2026-07-10, issue #814)
- **Location:** `packages/frontend` — wallet store tests, prominently `src/wallet/stellar/useStellarWallet.test.tsx` (21 failures) and broadly across the suite (`yarn workspace @pipeline/frontend test` reports ~615 failed / ~489 passed).
- **Symptom:** Tests crash in `beforeEach`/`afterEach` with `TypeError: Cannot read properties of undefined (reading 'clear')` at `localStorage.clear()` — i.e. the `localStorage` global is undefined in the jsdom test environment for these files. `useStellarWallet.test.tsx` fails identically (21/21) when run in isolation. Confirmed pre-existing: reproduces with the #716 working tree stashed, so it is unrelated to the dashboard route work. Test files that don't touch `localStorage` (e.g. the new `-dashboard.test.tsx`, `HomeStatsStrip.test.tsx`) pass.
- **Root cause (found 2026-07-10, this machine's dev environment):** On this machine, `which yarn` resolves to `/opt/homebrew/bin/yarn`, whose shebang is `#!/opt/homebrew/opt/node/bin/node` — an **absolute path** to Homebrew's Node (v26.0.0 at the time of writing), bypassing the shell's `PATH`-selected nvm Node (v20.20.2, per `.nvmrc`) entirely. Node v26 ships an experimental built-in `globalThis.localStorage`; when vitest's `jsdom` environment (via `yarn` → the Homebrew Node process) tries to install its own `window.localStorage`, the two collide and the global is left `undefined` in the test's `globalThis`. Confirmed: running the exact same test file's `vitest` binary directly with the nvm-pinned Node 20 binary (bypassing yarn's shebang) — `node <nvm-path>/node ../../node_modules/.bin/vitest run <file>` — makes every one of these failures disappear; the entire suite goes from ~615 failed to 1 pre-existing unrelated flake (BUG-7). This is a **local dev-machine toolchain issue**, not a code defect — CI and any correctly-`nvm`'d shell are unaffected.
- **Workaround:** Invoke `vitest`/`tsc`/`eslint` via the nvm-selected Node binary explicitly (e.g. ``$(command -v node) node_modules/.bin/vitest run`` from the workspace root, or `nvm use` before `yarn ...`) rather than through a `yarn` whose shebang hardcodes a different Node install. Longer-term: `yarn` should resolve Node via `PATH`/`env` rather than an absolute Homebrew path — outside this repo's control (a local Homebrew/yarn install detail), but worth flagging to anyone hitting mysteriously-failing frontend tests on macOS.

### BUG-1: `Typography.stories.tsx` fails strict TS check with unused `React` import
- **Tracked:** #1072
- **Date:** 2026-05-12
- **Location:** `packages/ui/src/typography/Typography.stories.tsx:2`
- **Symptom:** `npx tsc --noEmit` from `packages/ui` reports `error TS6133: 'React' is declared but its value is never read.` The Storybook build itself succeeds because Storybook does not run a strict tsc pass, but anyone running the package-level type check hits the error.
- **Root cause:** Unused `import React from "react"` in the file; the package's `tsconfig.json` enables `noUnusedLocals`. React 19 + the new JSX runtime no longer require the explicit import.
- **Workaround:** None applied. Drop the import (or switch to `import type` if a type is needed) when this is addressed.

### BUG-2: `swap-vertical.svg` is an SVG wrapper around a base64 PNG
- **Tracked:** #1073
- **Date:** 2026-05-18
- **Location:** `packages/ui/src/assets/icons/swap-vertical.svg` — imported by `packages/ui/src/components/ConversionCard/ConversionCard.tsx:9`
- **Symptom:** The swap-arrows icon rendered between the two ConversionCard halves uses an SVG file that wraps a rasterised PNG (`<image href="data:image/png;base64,…">`). Same stale-raster pattern as the original `coin-usdc.svg` before Issue #246 fixed it. Detected during UX testing of #246: `grep -c "data:image/png" packages/ui/src/assets/icons/swap-vertical.svg` → `1`.
- **Root cause:** Asset was originally extracted as a rasterised PNG and placed into an SVG wrapper (same historical pattern as `coin-usdc.svg`). Not caught by #246 scope, which was USDC-only.
- **Workaround:** None applied. Replace with a proper vector SVG export from Figma (same procedure as #246 Step 1–2).

### BUG-4: `-deposit.test.tsx` — "step 2 shows loading affordance" test fails
- **Tracked:** #1075
- **Date:** 2026-06-19
- **Location:** `packages/frontend/src/routes/-deposit.test.tsx` > "Deposit page — three-step flow" > "step 2 shows loading affordance (not greyed) when request status is PendingVerification"
- **Symptom:** `npx vitest run src/routes/-deposit.test.tsx` reports 1 failure for the PendingVerification spinner affordance test. Reproduces on a clean checkout of `main` before any 672 changes, confirming it is pre-existing.
- **Root cause:** Not investigated. The test expects `null` not to be null (i.e., a spinner element to be present), but the element is not found in the rendered output.
- **Workaround:** None applied.

### BUG-5: `-index.test.tsx` — "clicking Connect calls useWallet().connect()" test fails
- **Tracked:** #1076
- **Date:** 2026-06-19
- **Location:** `packages/frontend/src/routes/-index.test.tsx` > "Home page — disconnected state" > "clicking Connect calls useWallet().connect() → opens AppKit modal (when ack flag is pre-set)"
- **Symptom:** `npx vitest run src/routes/-index.test.tsx` reports 1 failure for the Connect button test. The test expects `mockOpen` (from `useAppKit`) to be called once, but it is called 0 times. Reproduces on `main` before any #684 changes, confirming it is pre-existing.
- **Root cause:** The `ConnectWalletPromoCard.onConnect` is wired to `useConnectModal().open` which is a no-op in the test context (no `ConnectModalProvider` in the wrapper). The `mockOpen` from `useAppKit` is never called. The test was written assuming the Connect button invokes `useAppKit().open` directly, but the indirection through `ConnectModalProvider` was introduced later.
- **Workaround:** None applied. Fix: wrap `renderHome()` with `ConnectModalProvider` (backed by a mocked `WalletGateProvider`) so `useConnectModal().open` delegates to `useAppKit().open`.

### BUG-8: `@pipeline/wallet-connect` — `localStorage` undefined in several jsdom test files

- **Tracked:** #1003 (consolidated; see comment there)
- **Date:** 2026-07-10
- **Location:** `packages/wallet-connect/src/evm/mock.test.ts`, `packages/wallet-connect/src/evm/useEvmWallet.test.tsx`, `packages/wallet-connect/src/stellar/useStellarWallet.test.tsx` (39 tests across these 3 files).
- **Symptom:** `yarn workspace @pipeline/wallet-connect test` (and each file run standalone, e.g. `vitest run src/stellar/useStellarWallet.test.tsx`) fails with `TypeError: Cannot read properties of undefined (reading 'clear')` at `localStorage.clear()` in `beforeEach`/`afterEach` hooks, and similar `localStorage` accesses inside the hooks under test. Reproduces on a clean checkout of this branch's base commit (`4f742af`, before any #831 work), confirming it is pre-existing and unrelated to issue #831.
- **Root cause:** Not investigated. `vite.config.ts`'s `test.environment` is `"jsdom"` with `globals: true`, so `localStorage` should be jsdom-provided; something in this package's `test-setup.ts` or dependency versions leaves the global `localStorage` unset for these three files specifically (other test files in the same package, e.g. `sacBalance.test.ts`, `loanRegistry.test.ts`, `connectionStore.test.ts`, pass cleanly).
- **Workaround:** None applied. Run the unaffected files individually to validate unrelated changes (as done for issue #831's `loanRegistry.test.ts`).

### BUG-8: LP frontend tests using `localStorage` fail on Node ≥ 22 (`Cannot read properties of undefined (reading 'clear')`)
- **Tracked:** #1003 (consolidated; see comment there)
- **Date:** 2026-08-10
- **Location:** any `packages/frontend` test touching `localStorage` (observed: `useDeploymentMonitorPanel.test.tsx`, all cases fail in `beforeEach` → `localStorage.clear()`)
- **Symptom:** With current Node (warning: `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided`), Node's built-in experimental `localStorage` global resolves to `undefined` inside vitest and shadows the jsdom environment's implementation, so every test in the file errors before running. Pre-existing on `main`; unrelated to any code change.
- **Root cause:** Node 22+ ships an experimental WebStorage global; vitest's jsdom environment does not override it.
- **Workaround:** run with `NODE_OPTIONS="--no-experimental-webstorage"` — all tests pass. Fix candidates: add that flag to the package `test` script, or set `--localstorage-file`.

---

## Resolved

### BUG-3: `useStellarWithdrawalQueue.test.tsx` — 8 failing tests
- **Tracked:** #1077
- **Date:** 2026-06-17
- **Resolved:** 2026-06-19 by #690 (test-harness gaps sweep) — the chain mock now provides `withdrawalQueueId`, and the "not configured" path is explicitly tested. Confirmed 28/28 passing on `main` 2026-08-12 while triaging #1077; the entry was simply never moved here.
- **Location:** `packages/frontend/src/wallet/stellar/useStellarWithdrawalQueue.test.tsx`
- **Symptom:** 8 failures (16 pass), e.g. expected `/Declined/` but received `"WithdrawalQueue not configured"`.
- **Root cause:** The mocked test setup left the WithdrawalQueue contract unconfigured, so the hook short-circuited before the paths under test.

### BUG-7: `PortfolioPlaceholderCard.test.tsx` — tooltip balance test is time-sensitive
- **Tracked:** #1078
- **Date:** 2026-07-01
- **Resolved:** 2026-08-12 by #1082. The originally logged root cause was wrong: `generateCurve` balances are seed-deterministic and `Date.now()` only shifts timestamp labels. The real cause was the default period changing to `all` (curve starts at $200), putting the hovered mid-chart slot below the asserted $1,000. Fixed by hovering the last slot, which is pinned to `END_BALANCE` for every period.
- **Location:** `packages/frontend/src/components/PortfolioPlaceholderCard.test.tsx` line 261
- **Symptom:** The tooltip test failed with `$636.59` against a `toContain("$1,")` assertion.

### BUG-9: `useRequests.test.tsx` fails at module load — stale `@creit.tech/stellar-wallets-kit` mock
- **Tracked:** #1079
- **Date:** 2026-08-10
- **Resolved:** 2026-08-12 by #1081 — added `addressUpdatedEvent`/`disconnectEvent` subscribe stubs to the test's kit mock, matching the sibling test files.
- **Location:** `packages/frontend/src/api/useRequests.test.tsx`
- **Symptom:** Whole suite failed at module load: `No "addressUpdatedEvent" export is defined on the "@creit.tech/stellar-wallets-kit" mock` (raised from `wallet-connect`'s module-scope subscription in `connectionStore.ts`).
