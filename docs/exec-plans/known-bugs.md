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

### BUG-11: EVM yield-mint phase has no "nothing to mint" skip (potential retry-forever)
- **Date:** 2026-07-29
- **Location:** `packages/worker/src/relayer/yield_mint/mod.rs` + `packages/shared/src/yield_mint_outbox_repo.rs::discover_pending` (EVM path).
- **Symptom:** The Stellar phase was fixed (`skip_nothing_to_mint_stellar`, discovered 2026-07-29) to skip pure-principal repayments before submit, because `yield_minter.mint_yield` reverts with `ZeroAmounts` when there is no yield to distribute, and that revert also rolls back the in-tx `consume_yield` mark, so the row retries every cycle forever. The EVM path has **no equivalent skip** — a `pending` row for a zero-yield repayment would submit repeatedly.
- **Root cause:** The fix was scoped to Stellar (the confirmed live symptom). Whether EVM actually loops depends on the EVM `YieldMinter` contract's behaviour on zero amounts (separate contract, not confirmed here). The EVM `PaymentRecorded` params carry the same fields, so the same worker-side sweep is portable if needed.
- **Workaround:** None. If EVM zero-yield repayments appear stuck in `pending`, port `skip_nothing_to_mint_stellar` to the EVM discover path (checksum-address variant).

### BUG-12: Stellar yield-mint nothing-to-mint skip has no on-chain backstop
- **Date:** 2026-07-29
- **Location:** `packages/shared/src/yield_mint_outbox_repo.rs::skip_nothing_to_mint_stellar`.
- **Symptom:** The nothing-to-mint detection is now **worker-side only** (SQL over the `PaymentRecorded` event in `contract_logs`); the earlier contract-error fallback (`Error(Contract, #1)` → skip at submit) was intentionally removed. If a zero-yield row is ever *not* caught by the sweep — a NULL/missing amount field in the event, a `loan_registry` address mismatch, or the event field names drifting from `senior_interest / mgmt_fee / perf_fee / oet_alloc` — the row stays `pending` and retries forever with no backstop. The sweep is conservative (`NULL = 0` is unknown → not skipped), so the failure mode is "loops" not "wrongly skipped".
- **Root cause:** Design choice (worker-side only, no on-chain call) trades the authoritative contract guard for avoiding an RPC round-trip. The Stellar parser (`loan_registry_parsers.rs:236-246`) always writes all seven fields, so NULLs shouldn't occur in practice — but nothing enforces that at the sweep. Also unrelated: the sweep duplicates the contract's mint rule in SQL, so if `pipeline-stellar-contracts` changes what counts as mintable, the sweep could skip a row that should mint (uncaught, since the mint is no longer attempted).
- **Workaround:** None needed while the parser guarantees the fields. If robustness is required, re-add a submit-time contract-error fallback, or add a monitor that alerts on `pending` rows older than N cycles.

### BUG-10: `capital_allocation.rs::normalize_to_canonical` does non-truncating division
- **Date:** 2026-07-21
- **Location:** `packages/api/src/routes/capital_allocation.rs` — `normalize_to_canonical` (~line 157-170).
- **Symptom:** `raw / BigDecimal::from(10i128.pow(asset_decimals - CANON))` (the `asset_decimals > CANON` branch) uses plain `BigDecimal` division, which does not floor to a whole base-unit integer — `BigDecimal::from(123456789) / BigDecimal::from(10) = 12345678.9`, not `12345678`. Every raw on-chain amount is a whole integer at its native scale, so the normalized result should be too.
- **Root cause:** Same defect class discovered and fixed in `shared::chains::normalize_usdc_amount` during #901's code review (see `normalize_usdc_amount_stellar_truncates_not_rounds` test, `packages/shared/tests/chains.rs`) — that fix appended `.with_scale_round(0, RoundingMode::Down)`. This function needs the identical fix but was out of scope for #901 (pre-existing, untouched code).
- **Workaround:** None. Impact is likely small (sub-base-unit precision only) but affects Capital Allocation's `in_transit` bucket for any Stellar `AssetTransfer` amount not evenly divisible by the scale factor.

### BUG-9: `KycRepo::GroupedRequest::from_row` formats `amount`/`assets`/`shares` as raw on-chain integers, not dollar strings
- **Date:** 2026-07-21
- **Location:** `packages/shared/src/kyc_repo.rs` — `GroupedRequest::from_row` (~line 122-127).
- **Symptom:** `amount: row.amount.map(|a| a.to_string()).unwrap_or_default()` (and the equivalent for `assets`/`shares`) calls `.to_string()` directly on the raw `BigDecimal` pulled from `contract_logs.params`, never through `base6_to_decimal_string`. If ever consumed by an API response, this would render e.g. `"1200000000"` instead of `"1200.000000"` — for both EVM and Stellar rows, unrelated to the #901 decimal-scale fix.
- **Root cause:** Missing `base6_to_decimal_string` call. Discovered while auditing every `base6_to_decimal_string` consumer for #901's Stellar-scale bug; `GroupedRequest` is currently unused by any API route or worker consumer (confirmed via repo-wide grep) so there is no live user-visible impact today.
- **Workaround:** None needed while unconsumed. Fix before wiring `GroupedRequest` to any endpoint.

### BUG-8: `-deposit.test.tsx` Stellar voucher mocks nest `signatureBytes` under `data` instead of top-level
- **Date:** 2026-07-09
- **Location:** `packages/frontend/src/routes/-deposit.test.tsx` — the `@/api` mock factory for `useStellarDepositVoucher` / `useStellarWithdrawalVoucher` (around line 201-219).
- **Symptom:** The mock returns `{ data: { signatureBytes: ... }, status, error, refetch }`, but the real hooks (`useStellarDepositVoucher.ts` / `useStellarWithdrawalVoucher.ts`) expose `signatureBytes` as a top-level field on the hook result, not nested inside `data`. The `useDepositFlow.ts` Stellar claim `onAction` handler reads `(stellarVoucher as { signatureBytes? }).signatureBytes` (top-level), so with this mock shape `sig` is always `undefined` when status is "ready". No test currently clicks the Stellar Claim button (`renderDepositStellar()` tests only assert enabled/disabled state, never `user.click`), so this has been latent and undetected.
- **Root cause:** Mock was written against a guessed/incorrect shape and never exercised end-to-end via a click assertion.
- **Workaround:** None applied — found while implementing #800 (voucher `deadline` threading). Fix by moving `signatureBytes` to the mock's top level (matching `UseStellarDepositVoucherResult`/`UseStellarWithdrawalVoucherResult`) and adding a click-triggers-write test for the Stellar claim path, analogous to the existing EVM "clicking Claim ... triggers claim.write" tests.

### BUG-6: Frontend vitest suite — widespread `localStorage` undefined failures
- **Date:** 2026-06-30 (root cause identified 2026-07-10, issue #814)
- **Location:** `packages/frontend` — wallet store tests, prominently `src/wallet/stellar/useStellarWallet.test.tsx` (21 failures) and broadly across the suite (`yarn workspace @pipeline/frontend test` reports ~615 failed / ~489 passed).
- **Symptom:** Tests crash in `beforeEach`/`afterEach` with `TypeError: Cannot read properties of undefined (reading 'clear')` at `localStorage.clear()` — i.e. the `localStorage` global is undefined in the jsdom test environment for these files. `useStellarWallet.test.tsx` fails identically (21/21) when run in isolation. Confirmed pre-existing: reproduces with the #716 working tree stashed, so it is unrelated to the dashboard route work. Test files that don't touch `localStorage` (e.g. the new `-dashboard.test.tsx`, `HomeStatsStrip.test.tsx`) pass.
- **Root cause (found 2026-07-10, this machine's dev environment):** On this machine, `which yarn` resolves to `/opt/homebrew/bin/yarn`, whose shebang is `#!/opt/homebrew/opt/node/bin/node` — an **absolute path** to Homebrew's Node (v26.0.0 at the time of writing), bypassing the shell's `PATH`-selected nvm Node (v20.20.2, per `.nvmrc`) entirely. Node v26 ships an experimental built-in `globalThis.localStorage`; when vitest's `jsdom` environment (via `yarn` → the Homebrew Node process) tries to install its own `window.localStorage`, the two collide and the global is left `undefined` in the test's `globalThis`. Confirmed: running the exact same test file's `vitest` binary directly with the nvm-pinned Node 20 binary (bypassing yarn's shebang) — `node <nvm-path>/node ../../node_modules/.bin/vitest run <file>` — makes every one of these failures disappear; the entire suite goes from ~615 failed to 1 pre-existing unrelated flake (BUG-7). This is a **local dev-machine toolchain issue**, not a code defect — CI and any correctly-`nvm`'d shell are unaffected.
- **Workaround:** Invoke `vitest`/`tsc`/`eslint` via the nvm-selected Node binary explicitly (e.g. ``$(command -v node) node_modules/.bin/vitest run`` from the workspace root, or `nvm use` before `yarn ...`) rather than through a `yarn` whose shebang hardcodes a different Node install. Longer-term: `yarn` should resolve Node via `PATH`/`env` rather than an absolute Homebrew path — outside this repo's control (a local Homebrew/yarn install detail), but worth flagging to anyone hitting mysteriously-failing frontend tests on macOS.

### BUG-1: `Typography.stories.tsx` fails strict TS check with unused `React` import
- **Date:** 2026-05-12
- **Location:** `packages/ui/src/typography/Typography.stories.tsx:2`
- **Symptom:** `npx tsc --noEmit` from `packages/ui` reports `error TS6133: 'React' is declared but its value is never read.` The Storybook build itself succeeds because Storybook does not run a strict tsc pass, but anyone running the package-level type check hits the error.
- **Root cause:** Unused `import React from "react"` in the file; the package's `tsconfig.json` enables `noUnusedLocals`. React 19 + the new JSX runtime no longer require the explicit import.
- **Workaround:** None applied. Drop the import (or switch to `import type` if a type is needed) when this is addressed.

### BUG-2: `swap-vertical.svg` is an SVG wrapper around a base64 PNG
- **Date:** 2026-05-18
- **Location:** `packages/ui/src/assets/icons/swap-vertical.svg` — imported by `packages/ui/src/components/ConversionCard/ConversionCard.tsx:9`
- **Symptom:** The swap-arrows icon rendered between the two ConversionCard halves uses an SVG file that wraps a rasterised PNG (`<image href="data:image/png;base64,…">`). Same stale-raster pattern as the original `coin-usdc.svg` before Issue #246 fixed it. Detected during UX testing of #246: `grep -c "data:image/png" packages/ui/src/assets/icons/swap-vertical.svg` → `1`.
- **Root cause:** Asset was originally extracted as a rasterised PNG and placed into an SVG wrapper (same historical pattern as `coin-usdc.svg`). Not caught by #246 scope, which was USDC-only.
- **Workaround:** None applied. Replace with a proper vector SVG export from Figma (same procedure as #246 Step 1–2).

### BUG-4: `-deposit.test.tsx` — "step 2 shows loading affordance" test fails
- **Date:** 2026-06-19
- **Location:** `packages/frontend/src/routes/-deposit.test.tsx` > "Deposit page — three-step flow" > "step 2 shows loading affordance (not greyed) when request status is PendingVerification"
- **Symptom:** `npx vitest run src/routes/-deposit.test.tsx` reports 1 failure for the PendingVerification spinner affordance test. Reproduces on a clean checkout of `main` before any 672 changes, confirming it is pre-existing.
- **Root cause:** Not investigated. The test expects `null` not to be null (i.e., a spinner element to be present), but the element is not found in the rendered output.
- **Workaround:** None applied.

### BUG-5: `-index.test.tsx` — "clicking Connect calls useWallet().connect()" test fails
- **Date:** 2026-06-19
- **Location:** `packages/frontend/src/routes/-index.test.tsx` > "Home page — disconnected state" > "clicking Connect calls useWallet().connect() → opens AppKit modal (when ack flag is pre-set)"
- **Symptom:** `npx vitest run src/routes/-index.test.tsx` reports 1 failure for the Connect button test. The test expects `mockOpen` (from `useAppKit`) to be called once, but it is called 0 times. Reproduces on `main` before any #684 changes, confirming it is pre-existing.
- **Root cause:** The `ConnectWalletPromoCard.onConnect` is wired to `useConnectModal().open` which is a no-op in the test context (no `ConnectModalProvider` in the wrapper). The `mockOpen` from `useAppKit` is never called. The test was written assuming the Connect button invokes `useAppKit().open` directly, but the indirection through `ConnectModalProvider` was introduced later.
- **Workaround:** None applied. Fix: wrap `renderHome()` with `ConnectModalProvider` (backed by a mocked `WalletGateProvider`) so `useConnectModal().open` delegates to `useAppKit().open`.

### BUG-3: `useStellarWithdrawalQueue.test.tsx` — 8 failing tests
- **Date:** 2026-06-17
- **Location:** `packages/frontend/src/wallet/stellar/useStellarWithdrawalQueue.test.tsx`
- **Symptom:** `npx vitest run src/wallet/stellar/useStellarWithdrawalQueue.test.tsx` reports 8 failures (16 pass). Example: the "declined signature sets error" case expects `error.message` to match `/Declined/` but receives `"WithdrawalQueue not configured"`. Reproduces on a clean `main` checkout, so unrelated to any in-flight change.
- **Root cause:** Not investigated. The mocked test setup appears to leave the WithdrawalQueue contract unconfigured, so the hook short-circuits with a "not configured" error before reaching the signature-decline / submission paths the tests assert on.
- **Workaround:** None applied.

### BUG-8: `@pipeline/wallet-connect` — `localStorage` undefined in several jsdom test files

- **Date:** 2026-07-10
- **Location:** `packages/wallet-connect/src/evm/mock.test.ts`, `packages/wallet-connect/src/evm/useEvmWallet.test.tsx`, `packages/wallet-connect/src/stellar/useStellarWallet.test.tsx` (39 tests across these 3 files).
- **Symptom:** `yarn workspace @pipeline/wallet-connect test` (and each file run standalone, e.g. `vitest run src/stellar/useStellarWallet.test.tsx`) fails with `TypeError: Cannot read properties of undefined (reading 'clear')` at `localStorage.clear()` in `beforeEach`/`afterEach` hooks, and similar `localStorage` accesses inside the hooks under test. Reproduces on a clean checkout of this branch's base commit (`4f742af`, before any #831 work), confirming it is pre-existing and unrelated to issue #831.
- **Root cause:** Not investigated. `vite.config.ts`'s `test.environment` is `"jsdom"` with `globals: true`, so `localStorage` should be jsdom-provided; something in this package's `test-setup.ts` or dependency versions leaves the global `localStorage` unset for these three files specifically (other test files in the same package, e.g. `sacBalance.test.ts`, `loanRegistry.test.ts`, `connectionStore.test.ts`, pass cleanly).
- **Workaround:** None applied. Run the unaffected files individually to validate unrelated changes (as done for issue #831's `loanRegistry.test.ts`).

### BUG-7: `PortfolioPlaceholderCard.test.tsx` — tooltip balance test is time-sensitive
- **Date:** 2026-07-01
- **Location:** `packages/frontend/src/components/PortfolioPlaceholderCard.test.tsx` line 261
- **Symptom:** The test "pointerMove on chart wrap shows tooltip with '$1,' balance prefix" fails because the synthetic chart curve's balance at the hovered slot is currently sub-$1000 (e.g. `$636.59`). The test was written when `Date.now()` was earlier in the deployment lifetime, causing the synthetic curve to land in a different balance range.
- **Root cause:** The chart curve is generated deterministically from `Date.now()` as the anchor. As real time advances, the same seeded pseudo-random curve produces lower intermediate balances at the test's hardcoded hover position. The assertion `toContain("$1,")` assumed the value always exceeds $1 K.
- **Workaround:** None applied. Fix: mock `Date.now()` in the test, or change the assertion to a looser regex (e.g. `/\$[\d.,]+/`).

---

## Resolved

_None yet._
