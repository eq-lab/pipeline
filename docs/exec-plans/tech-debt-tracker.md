# Tech Debt Tracker

Shortcuts, structural gaps, and deferred cleanup. Log here, don't fix inline.

## Format

```
### TD-<N>: <short description>
- **Date:** YYYY-MM-DD
- **Location:** file, package, or area
- **Gap:** what's missing or suboptimal
- **Impact:** what breaks or degrades if left unresolved
- **Suggested fix:** approach when we address it
```

---

## Known Gaps

### TD-1: Lint command not yet configured
- **Date:** 2026-04-21
- **Location:** Root package.json, AGENTS.md
- **Gap:** No unified lint command across Rust (cargo clippy) and TypeScript (eslint). AGENTS.md references cargo clippy individually but no single `make lint` or script covers both.
- **Impact:** Agents cannot run a single lint step; minor friction.
- **Suggested fix:** Add a root `Makefile` or `justfile` with `lint` target calling both `cargo clippy --all -- -D warnings` and frontend eslint.

### TD-2: Architecture boundary linting not configured
- **Date:** 2026-04-21
- **Location:** packages/
- **Gap:** No automated enforcement of the layering model (worker must not import api, api must not import worker directly, etc.). Rust module visibility helps but is not sufficient.
- **Impact:** Dependency violations can creep in silently.
- **Suggested fix:** Evaluate `cargo deny` for dependency auditing; document module pub/priv visibility conventions in ARCHITECTURE.md.

### TD-3: Frontend component library not selected
- **Date:** 2026-04-21
- **Location:** packages/frontend
- **Gap:** Component library decision deferred (Shadcn/ui vs Radix UI primitives). package.json is empty of UI dependencies.
- **Impact:** Frontend sprint cannot begin without this decision.
- **Suggested fix:** Evaluate and select before first frontend feature implementation sprint.

### TD-4: MPC vendor not selected
- **Date:** 2026-04-21
- **Location:** packages/worker, docs/SECURITY.md
- **Gap:** Fireblocks vs BitGo RFI in progress. Worker cannot implement MPC signing until SDK is chosen.
- **Impact:** Loan disbursement, LP payout, and USYC rebalancing automation blocked.
- **Suggested fix:** Complete RFI, select vendor, add SDK dependency to worker Cargo.toml.

### TD-5: Storybook preview imports theme.css only as a commented TODO
- **Date:** 2026-05-12
- **Location:** packages/ui/.storybook/preview.ts
- **Gap:** `src/styles/theme.css` does not exist yet; the import line is commented out with a TODO so `yarn storybook` works without the file. Once the theme issue lands, the comment must be enabled.
- **Impact:** Stories won't pick up design tokens until theme.css is created and the import is uncommented.
- **Suggested fix:** Enable the import in preview.ts when the Phase-3 theme/token issue lands.

### TD-7: packages/frontend/tsconfig.tsbuildinfo not gitignored
- **Date:** 2026-05-12
- **Location:** packages/frontend/tsconfig.tsbuildinfo, .gitignore
- **Gap:** The `tsconfig.tsbuildinfo` build cache file is not listed in the root `.gitignore` or any package-level `.gitignore`. Git reports it as modified after every TypeScript build.
- **Impact:** The file can inadvertently be staged/committed, polluting history with binary build artifacts.
- **Suggested fix:** Add `**/tsconfig.tsbuildinfo` (or `tsconfig.tsbuildinfo`) to the root `.gitignore`.

### TD-6: No Foundation/Tokens Storybook story
- **Date:** 2026-05-12
- **Location:** packages/ui/src/stories/
- **Gap:** There is no Storybook story that previews every `--color-pipeline-*`, `--text-pipeline-*`, `--radius-pipeline-*` token so reviewers can compare values to Figma visually. Deferred from Issue #41 to keep that issue tightly scoped to the `@theme` declaration.
- **Impact:** Token verification is manual (DevTools console); visual regression is invisible until a consuming component breaks.
- **Suggested fix:** Add a `Foundation/Tokens.stories.tsx` that renders color swatches, type ramp samples, and radius examples alongside the token names and expected values.

### TD-7: Same-tab mock bridge not testable in jsdom
- **Date:** 2026-05-14
- **Location:** `packages/frontend/src/wallet/mock.ts` — `installSameTabMockBridge`
- **Gap:** jsdom's `localStorage` uses non-configurable property descriptors, so `localStorage.setItem` cannot be replaced via direct assignment or `vi.spyOn`. The bridge's patching behavior (dispatching `pipeline-mock:wallet` when a mock key is written from the DevTools console) cannot be verified in the vitest/jsdom test suite. Tests cover the observable result (hook re-renders when the custom event fires) but not the patch mechanism itself.
- **Impact:** The bridge works in real browsers (verified manually) but the unit-test coverage gap means a regression could slip through.
- **Suggested fix:** Add a Playwright/browser test in CI that opens the dev server, sets a mock key via DevTools evaluation, and asserts the UI updates without a reload. Alternatively, refactor the bridge to be injectable/mockable (e.g., accept a `storage` parameter in `installSameTabMockBridge` for test injection).

### TD-8: LoanMintedMapper does metadata fetch inside the indexer transaction, blocking forward progress on URI outage
- **Date:** 2026-05-22 (policy revised 2026-05-25)
- **Location:** `packages/worker/src/indexer/loan_mapper.rs` — `LoanMintedMapper::populate_details`, called from `index_once` inside `repo.pool.begin()` ... `tx.commit()`.
- **Gap:** Each `LoanMinted` event triggers (a) an `eth_call tokenURI(loanId)` and (b) an `https://` or `ipfs://` JSON fetch with 1s/5s/30s retry. The current policy is "never skip `loan_details`": any unrecoverable failure propagates out of `insert(...)`, the indexer's outer transaction rolls back, and the entire block range is retried on the next polling cycle. While the URI source is unavailable the indexer literally does not advance past the affected range — and because all event types share the same `index_once` transaction, deposit/withdrawal/staking indexing is also stalled.
- **Impact:** Strict consistency (every `contract_logs` LoanMinted has a matching `loan_details` row), at the cost of liveness. A prolonged IPFS gateway outage halts the indexer entirely. Operator mitigation: point `JOB_INDEXER_IPFS_GATEWAY_URL` at a private pinned gateway.
- **Suggested fix:** Lift the fetch out of the indexer transaction. The mapper writes only the `contract_logs` row (and enqueues a backfill record). A separate worker consumes the queue, performs `tokenURI` + fetch + upsert into `loan_details` with its own retry budget. The indexer always advances; `loan_details` arrives eventually. This is a meaningful change to the failure model — adopt it when the volume of `LoanMinted` events or the unreliability of the URI source justifies the engineering cost.

### TD-9: Outdated loans-data product spec — references non-existent on-chain reader
- **Date:** 2026-05-22
- **Location:** `docs/product-specs/loans-data.md`
- **Gap:** The spec documents a `LoanRegistry.getImmutable(loanId)` reader returning a Solidity `ImmutableLoanData` struct. Neither exists on the deployed `LoanRegistryUpgradeable` contract (verified — it inherits ERC-721 and exposes `tokenURI(uint256)` only; the immutable data lives in the off-chain JSON document `tokenURI` points at).
- **Impact:** New readers will trust the spec, look for `getImmutable`, find nothing, and either implement against a fictional ABI or get blocked. Issue #363 deliberately left the spec untouched (scope creep) and added the correct design in this tracker plus the active exec plan.
- **Suggested fix:** Rewrite the "ImmutableLoanData" section of `loans-data.md` to describe (1) the off-chain JSON schema fetched via `tokenURI(loanId)`, (2) the indexer's `loan_details` table materialisation, (3) ops query for failed fetches: `contract_logs LEFT JOIN loan_details WHERE event_name='LoanMinted' AND loan_details.loan_id IS NULL`. File a separate `documentation,backlog` Issue and link it here.

### TD-10: Extract Modal + Switch UI primitives into `@pipeline/ui`
- **Date:** 2026-05-25
- **Location:** `packages/frontend/src/components/FirstConnectionModal.tsx`
- **Gap:** The inline `Toggle` (Switch) component and the portal overlay pattern used by `FirstConnectionModal` are implemented inline with no reusable primitive in `@pipeline/ui`. If a second consumer needs a modal or toggle, it will duplicate the styles.
- **Impact:** Style drift risk if the design token values change (`#208000`, `rgba(56,55,53,0.18)`, scrim opacity) — two places must be updated. Low severity until a second consumer appears.
- **Suggested fix:** When a second modal or toggle consumer appears in the codebase, extract `Switch` (role="switch", off/on colour tokens) and `Modal` / `ModalOverlay` (portal + focus trap + scrim + `role="dialog"`) into `@pipeline/ui` and update all consumers.

### TD-11: Dual `@stellar/stellar-sdk` versions (15.1.0 direct + 14.4.3 via blend-sdk)
- **Date:** 2026-06-02
- **Location:** `packages/frontend/package.json`, `node_modules/@blend-capital/blend-sdk/node_modules/@stellar/stellar-sdk`
- **Gap:** `@blend-capital/blend-sdk@3.2.2` bundles its own `@stellar/stellar-sdk@14.4.3` in a nested `node_modules`, while the app directly depends on `15.1.0`. Two copies are shipped in the bundle. The Soroban RPC lifecycle in `blendPool.ts` uses the direct `15.1.0` import; blend-sdk uses its own `14.4.3` internally. There is no version conflict today — both resolve correctly via Yarn's hoisting — but bundle size increases and type mismatches are possible if the two diverge further.
- **Impact:** Mild bundle size increase from dual stellar-sdk copies. Low risk in practice since both packages use the SDK only internally and types are not shared across the boundary.
- **Suggested fix:** When blend-sdk releases a version that declares `@stellar/stellar-sdk@^15` as a peer/dependency range, upgrade blend-sdk and verify the direct install deduplications. Track with `yarn why @stellar/stellar-sdk` to confirm dedup. File a follow-up issue if that version ships.

### TD-12: `yarn workspace @pipeline/frontend lint` fails on `main` (Prettier drift in 11 files)
- **Date:** 2026-06-04
- **Location:** `packages/frontend/src` — 11 files including `StartHereCard.tsx`, `TopBar.test.tsx`, `WelcomeHeader.tsx`, `routes/index.tsx`, `routes/-index.test.tsx`
- **Gap:** The frontend lint script's Prettier check exits 1 on a clean `main` checkout — formatting drifted without the gate catching it (CI does not currently fail on it).
- **Impact:** The local lint gate is permanently red, so agents cannot use `lint` exit status as a pass/fail signal for their own changes; per-file checks are needed instead. New drift accumulates silently.
- **Suggested fix:** One-shot `prettier --write` pass over the workspace in a dedicated chore PR, then make CI run the same lint script so drift fails fast.

### TD-14: Replace `STELLAR_VERIFIER_SECRET` with KMS/BitGo provisioning
- **Date:** 2026-06-11
- **Location:** `packages/api/src/config.rs`, `.env.example`
- **Gap:** The Stellar ed25519 signing key is provisioned via a flat `STELLAR_VERIFIER_SECRET` env var (Strkey `S…` seed in plaintext). For production this should be backed by KMS or BitGo key management, mirroring the EVM `SIGNER_KEY` path.
- **Impact:** The seed is exposed in environment configuration; key rotation requires a restart. Acceptable for the initial iteration (Issue #555), not for mainnet production use.
- **Suggested fix:** Introduce a per-chain `CHAIN_<id>_STELLAR_VERIFIER_SECRET` var alongside a KMS/BitGo integration path (matches the future per-chain naming scheme for mainnet).

### TD-15: `STELLAR_VERIFIER_SECRET` is chain-agnostic (flat)
- **Date:** 2026-06-11
- **Location:** `packages/api/src/config.rs`
- **Gap:** A single `STELLAR_VERIFIER_SECRET` is shared across all Stellar chains. If testnet and mainnet ever need different signing keys (e.g., after a `set_verifier` rotation on one but not the other), the config cannot express that.
- **Impact:** On-chain verifier rotations must be applied atomically to all chains simultaneously if the flat var is used.
- **Suggested fix:** Rename to `CHAIN_<id>_API_STELLAR_VERIFIER_SECRET` per chain. Track against TD-14 above.

### TD-16: Stellar `lp_profiles` whitelist path not seeded [RESOLVED 2026-06-15 / #562]
- **Date:** 2026-06-11
- **Location:** `packages/shared/src/kyc_repo.rs`, `is_on_chain_allowed`
- **Gap:** `is_on_chain_allowed` runs identical SQL for Stellar and EVM (Decision #4 in exec plan #555). Stellar voucher requests will 403 until `lp_profiles` rows exist for the wallet on the Stellar chain. No tooling or migration seeds those rows.
- **Impact:** Stellar voucher signing is technically implemented but operationally inert until an ops process or separate Issue populates `lp_profiles` for Stellar wallets.
- **Resolved by #562:** Issue #562 added `KycRepo::populate_profiles_from_deposits_stellar` (case-sensitive Strkey insert) and `fetch_profiles_to_allow_stellar` (case-sensitive lookup, no Crystal gate). The Stellar relayer job calls them every cycle so `lp_profiles` is now seeded the same way the EVM path seeds itself.

### TD-17: Stellar relayer signer is a plaintext `S…` seed
- **Date:** 2026-06-15
- **Location:** `packages/worker/src/relayer/config.rs::StellarRelayerSettings`, `.env.example::CHAIN_<id>_RELAYER_STELLAR_SIGNER_SECRET`
- **Gap:** The Stellar relayer's ed25519 signing key is provisioned via a flat `CHAIN_<id>_RELAYER_STELLAR_SIGNER_SECRET` env var (Strkey `S…` seed in plaintext). Parallel to TD-14 (the API voucher key). For production this should be backed by KMS or BitGo key management, mirroring the EVM `SIGNER_KEY` path.
- **Impact:** The seed is exposed in environment configuration; key rotation requires a restart. Acceptable for the initial iteration (Issue #562), not for mainnet production use. The relayer signer also holds the `executor` role on the access-manager, so a leak lets an attacker whitelist arbitrary addresses.
- **Suggested fix:** Introduce a KMS-backed signer behind the `StellarRelayerSettings.signing_key` field (e.g. fetch the seed from AWS KMS at startup). Pair with TD-14 in a single migration if possible.

### TD-13: CI does not run the frontend unit test suite (vitest)
- **Date:** 2026-06-04
- **Location:** `.github/workflows/` — Lint workflow runs docs lint, Rust clippy, TS typecheck; Tests workflow runs Rust unit tests only
- **Gap:** `yarn workspace @pipeline/frontend test` (778 vitest tests) is not executed by any CI check, so PRs can merge with a red frontend suite.
- **Impact:** Already happened: #476 (PR #488) merged green CI but broke `src/routes/-index.test.tsx` ("clicking Sell navigates…") — tracked as Issue #492. Regressions surface only when someone runs the suite locally.
- **Suggested fix:** Add a frontend-tests job (`yarn workspace @pipeline/frontend test --run`) to the Tests workflow and make it a required check.

### TD-18: Stellar price-poller uses Utc::now() instead of canonical ledger close-time
- **Date:** 2026-06-16
- **Location:** `packages/worker/src/price_poller/stellar/poller.rs` — `StellarPricePoller::fetch_share_price`
- **Gap:** `simulateTransaction` returns the `latestLedger` sequence but not its close-time. The current implementation uses `Utc::now()` at sample time, introducing at most `poll_interval_secs` (≤60s) skew relative to the actual ledger close-time.
- **Impact:** The `block_timestamp` column for Stellar rows in `share_prices` is wall-clock sample time rather than ledger close-time. The skew is well below the API's hour/day bucketing granularity — no user-visible impact at current polling cadences. Exact timestamps matter if sub-minute granularity is ever needed.
- **Suggested fix:** Fetch the canonical ledger close-time via `getLedgerEntries(LedgerHeader)` using the `latestLedger` sequence returned by simulate. This adds one extra RPC round-trip per poll tick. Implement when downstream consumers require exact-to-the-ledger timestamps.

### TD-19: StepRow still uses raw className override instead of Button size="compact"
- **Date:** 2026-06-18
- **Location:** `packages/ui/src/components/StepRow/StepRow.tsx` (~lines 170–178)
- **Gap:** `StepRow` uses `className="!h-8 ..."` to override the `primary-dark` button height.
  Issue #608 introduced a first-class `size="compact"` prop on `Button` — `StepRow` should
  migrate to that prop for consistency and to remove the raw `!important` override.
- **Impact:** No user-visible regression; purely a code-quality inconsistency between two call
  sites of the same component.
- **Suggested fix:** Replace `className="!h-8 ..."` in `StepRow.tsx` with `size="compact"` on
  the `Button` prop; adjust any test assertions that relied on the className value directly.

### TD-20: `ConnectChooserModal` is dead code — superseded by `ConnectWalletModal`
- **Date:** 2026-06-18
- **Location:** `packages/frontend/src/components/ConnectChooserModal.tsx` (and its test)
- **Gap:** `ConnectChooserModal` is no longer imported from any non-test production file since `ConnectWalletModal` replaced it (Issue #558). Its own test file exercises it in isolation only.
- **Impact:** Dead code accumulates maintenance overhead; any future token or style changes must be applied in two places.
- **Suggested fix:** Delete `ConnectChooserModal.tsx` and `ConnectChooserModal.test.tsx` after confirming via `grep -rn ConnectChooserModal` that no production import exists. Update the `ConnectWalletModal.tsx` JSDoc comment that still references it.

### TD-21: `packages/frontend/src/wallet/evm/WalletGateContext.ts` is dead code — legacy no-arg `openGate()` variant
- **Date:** 2026-06-18
- **Location:** `packages/frontend/src/wallet/evm/WalletGateContext.ts`
- **Gap:** This file defines a different `WalletGateContextValue` interface (no `onProceed` callback) from the live one at `packages/frontend/src/wallet/WalletGateContext.ts`. `useEvmWallet.ts` imports from `../WalletGateContext` (the correct live path). The `evm/WalletGateContext.ts` file is not imported by anything except itself.
- **Impact:** Confusing dual-file situation; the dead file could mislead future contributors.
- **Suggested fix:** Confirm with `grep -rn "evm/WalletGateContext"` that no import exists, then delete the file.

---

## Post-MVP

- Automated bank integration (repayment identification currently manual)
- On-chain LTV oracle writes and automated enforcement triggers
- Withdrawal queue 4-tier mechanism (MVP is simple FIFO)
- Multiple Loan Originators
- Public bug bounty programme
- GenTwo MTN issuance
