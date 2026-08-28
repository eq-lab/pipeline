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

### BUG-17: trustee `yarn lint` fails — three unused `_input` mock params in `-origination-new-page.test.tsx`
- **Date:** 2026-08-19
- **Location:** `packages/trustee/src/routes/-origination-new-page.test.tsx` lines 9, 106, 274 (shipped with #1101, commit `069c4e2`).
- **Symptom:** `yarn lint` in `packages/trustee` exits non-zero: `@typescript-eslint/no-unused-vars` × 3 — `'_input' is defined but never used`.
- **Root cause:** Mock callbacks declare an `_input` parameter they never read; the trustee eslint config doesn't set `argsIgnorePattern: "^_"`, so the underscore convention isn't honored.
- **Workaround:** None needed for CI (found while running the lint gate for #1119, which doesn't touch this file). Fix is either dropping the params or adding `argsIgnorePattern` to the eslint config.

### BUG-16: `NeedsAttention` silently drops load errors — no error UI at all
- **Tracked:** #1064
- **Date:** 2026-08-07
- **Location:** `packages/trustee/src/components/useNeedsAttention.ts:176` (sets `errorMessage: error.message` on the `"error"` state) / `packages/trustee/src/components/NeedsAttention.tsx` (never reads `errorMessage` or branches on `state === "error"`).
- **Symptom:** When the underlying query the panel depends on fails, `useNeedsAttention` computes a mapped error state, but `NeedsAttention.tsx` has no render branch for it at all — the panel silently renders as if there were nothing to show (no red text, no "couldn't load" note, nothing). A trustee has no way to know the panel failed to load rather than genuinely having zero items needing attention.
- **Root cause:** The component was never wired to the hook's `state`/`errorMessage` fields — only `rows`/`loanRows` are consumed. Predates #1037; out of scope there per the resolved Open Question (adopting `InlineError` here requires first wiring the missing render branch, which is a distinct, larger change than the mapping-layer sweep).
- **Workaround:** None. Fix requires adding an error-state branch to `NeedsAttention.tsx` (and, per the #1037 pattern, an `InlineError` there) — tracked as follow-up, not fixed inline.

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

### BUG-9: `KycRepo::GroupedRequest::from_row` formats `amount`/`assets`/`shares` as raw on-chain integers, not dollar strings
- **Tracked:** #1071
- **Date:** 2026-07-21
- **Location:** `packages/shared/src/kyc_repo.rs` — `GroupedRequest::from_row` (~line 122-127).
- **Symptom:** `amount: row.amount.map(|a| a.to_string()).unwrap_or_default()` (and the equivalent for `assets`/`shares`) calls `.to_string()` directly on the raw `BigDecimal` pulled from `contract_logs.params`, never through `base6_to_decimal_string`. If ever consumed by an API response, this would render e.g. `"1200000000"` instead of `"1200.000000"` — for both EVM and Stellar rows, unrelated to the #901 decimal-scale fix.
- **Root cause:** Missing `base6_to_decimal_string` call. Discovered while auditing every `base6_to_decimal_string` consumer for #901's Stellar-scale bug; `GroupedRequest` is currently unused by any API route or worker consumer (confirmed via repo-wide grep) so there is no live user-visible impact today.
- **Workaround:** None needed while unconsumed. Fix before wiring `GroupedRequest` to any endpoint.

## Resolved

### BUG-18: frontend vitest suite broken on Node ≥20.19 — `localStorage` is undefined in jsdom tests
- **Resolved:** 2026-08-27 by #1003 — a probe-and-repair storage shim in each jsdom workspace's `test-setup.ts` (frontend, wallet-connect, trustee): if the `localStorage`/`sessionStorage` global is missing or throwing (Node 20.19+/22+/26 defines an experimental WebStorage global that shadows jsdom's), it is replaced with a real `Storage` from a fresh `JSDOM` window (passes jsdom's `StorageEvent` IDL check), falling back to a Map-backed store. Flag-based fixes proved version-fragile: `NODE_OPTIONS=--no-experimental-webstorage` is rejected by CI's Node 20 ("not allowed in NODE_OPTIONS"), and worker `execArgv` behaved differently across Node 20/26 (locally masked by Homebrew yarn running its own newer Node — the BUG-6 quirk). All three suites green (1532 + 160 + 898); the two lingering `-deposit.test.tsx` toast failures were stale pre-#1142 title assertions, updated in the same PR. A `js-unit-tests` vitest job now runs the suites in CI.
- **Date:** 2026-08-24
- **Location:** all `packages/frontend` tests that touch `localStorage` (e.g. `useStellarSacToken.test.tsx`, `-deposit.test.tsx`); found while running the test gate for #1196.
- **Symptom:** `TypeError: Cannot read properties of undefined (reading 'clear'/'setItem')` on bare `localStorage`, plus Node's `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided`.
- **Root cause:** Node 20.19+/22+ defines an experimental `globalThis.localStorage` that is non-functional without `--localstorage-file`; because the key already exists on `globalThis`, vitest's jsdom environment does not install jsdom's own `localStorage` over it. Repo pins no Node version (`engines`/`.nvmrc` absent).
- **Workaround:** run vitest with `NODE_OPTIONS="--localstorage-file=<tmpfile>"` (note: that file is shared across worker processes — pair with `--no-file-parallelism` to avoid cross-file pollution). Proper fix: pin a Node version for the repo or add `vite.config.ts` test setup that force-installs a storage shim.
- Separately observed on this machine (all reproduce at branch HEAD with no working-tree changes, unrelated to #1196): 2 flaky failures in `-deposit.test.tsx` "Deposit page — toast emissions" (the toast never appears within the 3 s window), and 57 failures across `-index.test.tsx` / `useTermsAcknowledgement.test.tsx` — `[vitest] No "usePositionsHistory" export is defined on the "@/api" mock`. The `-index.test.tsx` half was a genuinely missing mock export, fixed with #1186; the `useTermsAcknowledgement.test.tsx` failures are this bug's `localStorage` symptom itself (pass with the `--localstorage-file` workaround).

### BUG-6: Frontend vitest suite — widespread `localStorage` undefined failures
- **Resolved:** 2026-08-27 by #1003 — a probe-and-repair storage shim in each jsdom workspace's `test-setup.ts` (frontend, wallet-connect, trustee): if the `localStorage`/`sessionStorage` global is missing or throwing (Node 20.19+/22+/26 defines an experimental WebStorage global that shadows jsdom's), it is replaced with a real `Storage` from a fresh `JSDOM` window (passes jsdom's `StorageEvent` IDL check), falling back to a Map-backed store. Flag-based fixes proved version-fragile: `NODE_OPTIONS=--no-experimental-webstorage` is rejected by CI's Node 20 ("not allowed in NODE_OPTIONS"), and worker `execArgv` behaved differently across Node 20/26 (locally masked by Homebrew yarn running its own newer Node — the BUG-6 quirk). All three suites green (1532 + 160 + 898); the two lingering `-deposit.test.tsx` toast failures were stale pre-#1142 title assertions, updated in the same PR. A `js-unit-tests` vitest job now runs the suites in CI.
- **Tracked:** #1003 (consolidated with the two `localStorage` BUG-8 entries)
- **Date:** 2026-06-30 (root cause identified 2026-07-10, issue #814)
- **Location:** `packages/frontend` — wallet store tests, prominently `src/wallet/stellar/useStellarWallet.test.tsx` (21 failures) and broadly across the suite (`yarn workspace @pipeline/frontend test` reports ~615 failed / ~489 passed).
- **Symptom:** Tests crash in `beforeEach`/`afterEach` with `TypeError: Cannot read properties of undefined (reading 'clear')` at `localStorage.clear()` — i.e. the `localStorage` global is undefined in the jsdom test environment for these files. `useStellarWallet.test.tsx` fails identically (21/21) when run in isolation. Confirmed pre-existing: reproduces with the #716 working tree stashed, so it is unrelated to the dashboard route work. Test files that don't touch `localStorage` (e.g. the new `-dashboard.test.tsx`, `HomeStatsStrip.test.tsx`) pass.
- **Root cause (found 2026-07-10, this machine's dev environment):** On this machine, `which yarn` resolves to `/opt/homebrew/bin/yarn`, whose shebang is `#!/opt/homebrew/opt/node/bin/node` — an **absolute path** to Homebrew's Node (v26.0.0 at the time of writing), bypassing the shell's `PATH`-selected nvm Node (v20.20.2, per `.nvmrc`) entirely. Node v26 ships an experimental built-in `globalThis.localStorage`; when vitest's `jsdom` environment (via `yarn` → the Homebrew Node process) tries to install its own `window.localStorage`, the two collide and the global is left `undefined` in the test's `globalThis`. Confirmed: running the exact same test file's `vitest` binary directly with the nvm-pinned Node 20 binary (bypassing yarn's shebang) — `node <nvm-path>/node ../../node_modules/.bin/vitest run <file>` — makes every one of these failures disappear; the entire suite goes from ~615 failed to 1 pre-existing unrelated flake (BUG-7). This is a **local dev-machine toolchain issue**, not a code defect — CI and any correctly-`nvm`'d shell are unaffected.
- **Workaround:** Invoke `vitest`/`tsc`/`eslint` via the nvm-selected Node binary explicitly (e.g. ``$(command -v node) node_modules/.bin/vitest run`` from the workspace root, or `nvm use` before `yarn ...`) rather than through a `yarn` whose shebang hardcodes a different Node install. Longer-term: `yarn` should resolve Node via `PATH`/`env` rather than an absolute Homebrew path — outside this repo's control (a local Homebrew/yarn install detail), but worth flagging to anyone hitting mysteriously-failing frontend tests on macOS.

### BUG-8: `@pipeline/wallet-connect` — `localStorage` undefined in several jsdom test files
- **Resolved:** 2026-08-27 by #1003 — a probe-and-repair storage shim in each jsdom workspace's `test-setup.ts` (frontend, wallet-connect, trustee): if the `localStorage`/`sessionStorage` global is missing or throwing (Node 20.19+/22+/26 defines an experimental WebStorage global that shadows jsdom's), it is replaced with a real `Storage` from a fresh `JSDOM` window (passes jsdom's `StorageEvent` IDL check), falling back to a Map-backed store. Flag-based fixes proved version-fragile: `NODE_OPTIONS=--no-experimental-webstorage` is rejected by CI's Node 20 ("not allowed in NODE_OPTIONS"), and worker `execArgv` behaved differently across Node 20/26 (locally masked by Homebrew yarn running its own newer Node — the BUG-6 quirk). All three suites green (1532 + 160 + 898); the two lingering `-deposit.test.tsx` toast failures were stale pre-#1142 title assertions, updated in the same PR. A `js-unit-tests` vitest job now runs the suites in CI.

- **Tracked:** #1003 (consolidated; see comment there)
- **Date:** 2026-07-10
- **Location:** `packages/wallet-connect/src/evm/mock.test.ts`, `packages/wallet-connect/src/evm/useEvmWallet.test.tsx`, `packages/wallet-connect/src/stellar/useStellarWallet.test.tsx` (39 tests across these 3 files).
- **Symptom:** `yarn workspace @pipeline/wallet-connect test` (and each file run standalone, e.g. `vitest run src/stellar/useStellarWallet.test.tsx`) fails with `TypeError: Cannot read properties of undefined (reading 'clear')` at `localStorage.clear()` in `beforeEach`/`afterEach` hooks, and similar `localStorage` accesses inside the hooks under test. Reproduces on a clean checkout of this branch's base commit (`4f742af`, before any #831 work), confirming it is pre-existing and unrelated to issue #831.
- **Root cause:** Not investigated. `vite.config.ts`'s `test.environment` is `"jsdom"` with `globals: true`, so `localStorage` should be jsdom-provided; something in this package's `test-setup.ts` or dependency versions leaves the global `localStorage` unset for these three files specifically (other test files in the same package, e.g. `sacBalance.test.ts`, `loanRegistry.test.ts`, `connectionStore.test.ts`, pass cleanly).
- **Workaround:** None applied. Run the unaffected files individually to validate unrelated changes (as done for issue #831's `loanRegistry.test.ts`).

### BUG-8: LP frontend tests using `localStorage` fail on Node ≥ 22 (`Cannot read properties of undefined (reading 'clear')`)
- **Resolved:** 2026-08-27 by #1003 — a probe-and-repair storage shim in each jsdom workspace's `test-setup.ts` (frontend, wallet-connect, trustee): if the `localStorage`/`sessionStorage` global is missing or throwing (Node 20.19+/22+/26 defines an experimental WebStorage global that shadows jsdom's), it is replaced with a real `Storage` from a fresh `JSDOM` window (passes jsdom's `StorageEvent` IDL check), falling back to a Map-backed store. Flag-based fixes proved version-fragile: `NODE_OPTIONS=--no-experimental-webstorage` is rejected by CI's Node 20 ("not allowed in NODE_OPTIONS"), and worker `execArgv` behaved differently across Node 20/26 (locally masked by Homebrew yarn running its own newer Node — the BUG-6 quirk). All three suites green (1532 + 160 + 898); the two lingering `-deposit.test.tsx` toast failures were stale pre-#1142 title assertions, updated in the same PR. A `js-unit-tests` vitest job now runs the suites in CI.
- **Tracked:** #1003 (consolidated; see comment there)
- **Date:** 2026-08-10
- **Location:** any `packages/frontend` test touching `localStorage` (observed: `useDeploymentMonitorPanel.test.tsx`, all cases fail in `beforeEach` → `localStorage.clear()`)
- **Symptom:** With current Node (warning: `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided`), Node's built-in experimental `localStorage` global resolves to `undefined` inside vitest and shadows the jsdom environment's implementation, so every test in the file errors before running. Pre-existing on `main`; unrelated to any code change.
- **Root cause:** Node 22+ ships an experimental WebStorage global; vitest's jsdom environment does not override it.
- **Workaround:** run with `NODE_OPTIONS="--no-experimental-webstorage"` — all tests pass. Fix candidates: add that flag to the package `test` script, or set `--localstorage-file`.

---

### BUG-10: `capital_allocation.rs::normalize_to_canonical` does non-truncating division
- **Tracked:** #1070
- **Date:** 2026-07-21
- **Resolved:** 2026-08-14 by #1070 — the `asset_decimals > CANON` branch now floors the quotient with `.with_scale_round(0, RoundingMode::Down)`, mirroring `shared::chains::normalize_usdc_amount`. Regression-tested through the public `compute_capital_allocation` (`packages/api/tests/capital_allocation.rs::normalize_floors_sub_base_unit_fractions_not_rounds`): a 7-decimal amount ending in `…5` leaves a half-base-unit fraction that truncates below the 6-dp display in any single bucket, but the un-floored `in_transit` and `withdrawal_queue` fractions would sum to a phantom whole base unit in `total`; with truncation `total` is exact.
- **Location:** `packages/api/src/routes/capital_allocation.rs` — `normalize_to_canonical` (~line 239-248).
- **Symptom:** `raw / BigDecimal::from(10i128.pow(asset_decimals - CANON))` used plain `BigDecimal` division, which did not floor to a whole base-unit integer — `123456789 / 10 = 12345678.9`, not `12345678`.

### BUG-15: Origination detail page has no error state — a failed submissions fetch renders "not found"
- **Tracked:** #1065
- **Date:** 2026-08-07
- **Resolved:** 2026-08-13 by the #1065 PR — `-origination-detail.ts` gains an `error` state (loading → error → not-found precedence, reading `useLoanSubmissions().error`), surfaced per the #1037 pattern: friendly "Failed to load the submission." with the raw failure behind View details. A router-state submission still renders `ready` when the list query errors.
- **Location:** `packages/trustee/src/routes/-origination-detail.ts` / `origination.$id.tsx`.
- **Symptom:** A failed `useLoanSubmissions` fetch fell through to the same "Submission not found." UI as a truly-missing id, discarding the failure entirely.

### BUG-18: `-dashboard.test.tsx` asserts the pre-#1053 raw status literal — fails on `main`
- **Tracked:** #1062
- **Date:** 2026-08-11
- **Resolved:** 2026-08-11 by #1060 (the #1058 follow-up), which changed the assertion to the humanized "In review" label and deliberately removed this entry — it was fixed before ever landing on `main`. The entry was re-introduced by the #1080 tracking-annotation carry-over from the `docs/998` branch, and #1062 was filed from the stale text. Confirmed 32/32 passing on `main` 2026-08-13.
- **Location:** `packages/frontend/src/routes/-dashboard.test.tsx` (assertion now at ~line 979).
- **Symptom:** The origination Status cell renders the #1053 humanized "In review" label, but the assertion expected the backend literal "InReview".

### BUG-17: `dashboards.md` In Origination row-field spec is stale (pre-#814 column set)
- **Tracked:** #1063
- **Date:** 2026-08-11
- **Resolved:** 2026-08-11 by #1060 (the #1058 follow-up), which rewrote the In Origination bullet to describe the #814 8-column set (Originator, Commodity, Facility, Corridor, Rate, Maturity, Submitted, Status) and the #1053 humanized status labels. Same carry-over story as BUG-18: the entry re-entered `main` via #1080 after the fix, and #1063 was filed from the stale text.
- **Location:** `docs/product-specs/dashboards.md` — "In Origination tab" bullet (Panel B section).
- **Symptom:** The spec described the pre-#814 row fields ("Active Loans table layout plus a Status column").

### BUG-13: pre-commit `frontend lint` stage fails on pre-existing prettier debt
- **Tracked:** #1066
- **Date:** 2026-07-29
- **Resolved:** 2026-08-12 by the #1066 formatting-only PR — `prettier --write` on the 7 frontend files still failing (`TopBar.tsx`/`TopBar.test.tsx` had healed since the entry) plus 2 `packages/ui` files found during #1072 (`Button.stories.tsx`, `CoinIcon.tsx`). `yarn lint` is clean in both packages; trustee and wallet-connect were checked and carried no debt.
- **Location:** `packages/frontend` + `packages/ui` committed files failing repo-wide `prettier --check`.
- **Symptom:** The husky pre-commit hook's lint stage exited 1 for any commit, since the debt predated the commit under way (bypassed with `--no-verify` by #953).

### BUG-2: `swap-vertical.svg` is an SVG wrapper around a base64 PNG
- **Tracked:** #1073
- **Date:** 2026-05-18
- **Resolved:** 2026-08-12 by the #1073 PR — replaced with true vector geometry (two 1.5px round-cap stroke arrows, ink `#262524` = `--color-pipeline-ink`), traced pixel-exactly from the embedded 22×22 raster since the Figma MCP used by #246 was not available; verified by rasterising the new SVG and diffing masks against the original PNG. It was the last raster-in-SVG asset in `packages/ui/src/assets/icons/`.
- **Location:** `packages/ui/src/assets/icons/swap-vertical.svg` — imported by `ConversionCard.tsx`.
- **Symptom:** The swap-arrows icon wrapped a base64 PNG (`<image href="data:image/png;base64,…">`), same stale-raster pattern #246 fixed for `coin-usdc.svg`.

### BUG-1: `Typography.stories.tsx` fails strict TS check with unused `React` import
- **Tracked:** #1072
- **Date:** 2026-05-12
- **Resolved:** 2026-08-12 by the #1072 PR — dropped the unused `import React` there and in `ConversionCard.stories.tsx`, which had developed the identical TS6133 since the entry was logged; `npx tsc --noEmit` from `packages/ui` is clean again.
- **Location:** `packages/ui/src/typography/Typography.stories.tsx:2`, `packages/ui/src/components/ConversionCard/ConversionCard.stories.tsx:1`
- **Symptom:** `npx tsc --noEmit` from `packages/ui` reported `TS6133: 'React' is declared but its value is never read` (`noUnusedLocals`; React 19's JSX runtime needs no explicit import). Storybook builds were unaffected.

### BUG-8: `-deposit.test.tsx` Stellar voucher mocks nest `signatureBytes` under `data` instead of top-level
- **Tracked:** #1074
- **Date:** 2026-07-09
- **Resolved:** 2026-08-12 by the #1074 PR — `signatureBytes` moved to the mock's top level (matching `UseStellarDepositVoucherResult`/`UseStellarWithdrawalVoucherResult`), `deadline` added under `data` (required since #800), and two click-triggers-write tests added for the Stellar deposit and withdrawal claim paths, asserting `write(requestId, signatureBytes, deadline)`.
- **Location:** `packages/frontend/src/routes/-deposit.test.tsx` — the `@/api` mock factory for `useStellarDepositVoucher` / `useStellarWithdrawalVoucher`.
- **Symptom:** The mock nested `signatureBytes` inside `data`, but the real hooks expose it top-level; the Stellar claim `onAction` read the top-level field, so `sig` was always `undefined`. Latent because no test clicked the Stellar Claim button.

### BUG-4: `-deposit.test.tsx` — "step 2 shows loading affordance" test fails
- **Tracked:** #1075
- **Date:** 2026-06-19
- **Resolved:** 2026-06-19 by #690 (test-harness gaps sweep). Confirmed on `main` 2026-08-12 while triaging #1075: 107/107 pass, including both PendingVerification loading-affordance tests.
- **Location:** `packages/frontend/src/routes/-deposit.test.tsx` > "step 2 shows loading affordance (not greyed) when request status is PendingVerification"
- **Symptom:** 1 failure — the expected spinner element was not found in the rendered output.

### BUG-5: `-index.test.tsx` — "clicking Connect calls useWallet().connect()" test fails
- **Tracked:** #1076
- **Date:** 2026-06-19
- **Resolved:** 2026-06-19 by #690, which rewrote the test as "clicking Connect opens the shared ConnectWalletModal via useConnectModal().open()" — asserting the `ConnectModalProvider` indirection instead of expecting `useAppKit().open` directly (modal-opening behaviour is covered by `ConnectModalProvider.test.tsx`). Confirmed on `main` 2026-08-12 while triaging #1076: 57/57 pass.
- **Location:** `packages/frontend/src/routes/-index.test.tsx` > "Home page — disconnected state"
- **Symptom:** `mockOpen` (from `useAppKit`) expected once, called 0 times — the button's `onConnect` went through `useConnectModal().open`, a no-op without a `ConnectModalProvider` in the test wrapper.

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
