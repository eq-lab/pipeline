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

### TD-22: Active-chain `isConnected` derivation is duplicated across three files

- **Date:** 2026-06-19
- **Location:** `packages/frontend/src/api/useRequests.ts`, `packages/frontend/src/routes/transactions.tsx`, `packages/frontend/src/components/RecentActivityCard.tsx`
- **Gap:** The three-line active-chain `isConnected` derivation (`kind === "stellar" ? isStellarConnected : isEvmConnected`) was intentionally inlined at the two render sites (Issue #644 Option A) to keep the bug fix minimal and low-risk. It now exists in three places.
- **Impact:** Any future change to chain-selection logic (e.g. a third chain) must be applied in three places.
- **Suggested fix:** Extract a small `useActiveChainConnection()` hook (e.g. in `packages/frontend/src/wallet/`) returning `{ kind, isConnected, address }` and have all three files consume it.

### TD-21: `packages/frontend/src/wallet/evm/WalletGateContext.ts` is dead code — legacy no-arg `openGate()` variant

- **Date:** 2026-06-18
- **Location:** `packages/frontend/src/wallet/evm/WalletGateContext.ts`
- **Gap:** This file defines a different `WalletGateContextValue` interface (no `onProceed` callback) from the live one at `packages/frontend/src/wallet/WalletGateContext.ts`. `useEvmWallet.ts` imports from `../WalletGateContext` (the correct live path). The `evm/WalletGateContext.ts` file is not imported by anything except itself.
- **Impact:** Confusing dual-file situation; the dead file could mislead future contributors.
- **Suggested fix:** Confirm with `grep -rn "evm/WalletGateContext"` that no import exists, then delete the file.

### TD-23: `discover_pending_stellar` SQL has no automated coverage; silent-failure mode [PARTIALLY REALIZED 2026-06-23]

- **Date:** 2026-06-22 (incident 2026-06-23)
- **Location:** `packages/shared/src/yield_mint_outbox_repo.rs` — `YieldMintOutboxRepo::discover_pending_stellar`
- **Gap:** The Stellar discovery query is the one piece of the yield-mint phase (Issue #683) with zero automated coverage — the project's no-DB-test rule precludes a unit test, and the orchestration tests exercise the trait surface via an in-memory store, not the SQL. Its correctness depends on an invisible coupling to the indexer's stored `PaymentRecorded` `params` shape and the loan-registry `C…` strkey in `contract_logs.contract_address`.
- **What happened (2026-06-23):** the coupling broke exactly as predicted. The original SQL read `repayment_id` from **top-level** `params->>'repayment_id'`, derived from reading only the raw parser (`indexer/stellar/loan_registry_parsers.rs`). But the indexer also runs `LoanEventMapper` enrichment (`indexer/loan_mapper.rs:448-465`) which nests it under `params->'event'`. Discovery inserted `repayment_id = NULL` → `null value in column "repayment_id" ... violates not-null constraint`, aborting every relayer cycle. Fixed by switching both `repayment_id` references to `params->'event'->>'repayment_id'` (now identical to EVM `discover_pending`). Not silent in the end (NOT-NULL caught it) — but only because the column happens to be NOT NULL; a nullable column would have silently never minted.
- **Impact:** Still no regression guard. A future change to the indexer's JSON path or address format would re-break discovery with no test catching it.
- **Suggested fix:** Add a DB-backed (or fixture-driven `contract_logs` → outbox) integration test that inserts a `PaymentRecorded` row in the indexer's exact enriched shape and asserts a pending outbox row is discovered with non-null `loan_id`/`repayment_id`. Gate it to skip gracefully when no test DB is available, matching the existing `discover_*` test convention.
- **Dedup note:** post-fix, `discover_pending_stellar` is byte-identical to `discover_pending` (only the caller's `contract_address` bind value differs). Candidate to collapse into one method; kept separate for now (deliberate choice 2026-06-23) — fold into the integration-test work above.

### TD-24: `confirm_submitted_stellar` NULL `tx_hash` branch is a perpetual no-op

- **Date:** 2026-06-22
- **Location:** `packages/worker/src/relayer/stellar/yield_mint.rs` — `confirm_submitted_stellar`, the `row.tx_hash` `None` arm
- **Gap:** A `submitted` row with `tx_hash IS NULL` logs an error and `continue`s every cycle with no path to resolution. Unreachable today (the Stellar `mark_submitted_stellar` always sets `tx_hash`), so it is defensive-only — not a live bug.
- **Impact:** If the invariant is ever broken, the row sticks in the active set forever, re-logging an error each cycle, never failing out for operator review.
- **Suggested fix:** Change the branch to `mark_failed(&key, "submitted row missing tx_hash")` so the row leaves the active set and surfaces for operator review instead of looping.

### TD-26: Loan Book table rows missing Figma-specified `border-radius: 4px`

- **Date:** 2026-07-01
- **Location:** `packages/frontend/src/components/dashboard/LoanBookTable.tsx` (`DesktopTable`)
- **Gap:** Figma node 3704:1095 (`.row`) specifies `border-radius: var(--radius-radius-l, 4px)` on each row. The HTML table rendering model does not support `border-radius` on `<tr>` elements — browsers ignore it. The value exists in the design system as `--radius-pipeline-card: 4px` but cannot be applied to a semantic `<table>/<tr>` structure.
- **Impact:** Cosmetic only — row corners are square instead of 4px rounded as in Figma. No functional or accessibility impact.
- **Suggested fix:** If the rounded corners are required, replace the semantic `<table>` with a `<div>`-based grid layout (role="table", role="row", role="cell" for accessibility). This is a layout restructure, not a one-liner, and should be a separate issue.

### TD-25: Duplicated Soroban simulate-fee constant (`SIM_FEE` vs `VIEW_PRECHECK_FEE`)

- **Date:** 2026-06-22
- **Location:** `packages/worker/src/relayer/stellar/yield_mint.rs` (`SIM_FEE = 1_000_000`), `packages/worker/src/relayer/stellar/whitelist.rs` (`VIEW_PRECHECK_FEE = 1_000_000`)
- **Gap:** Two modules define differently-named constants for the same concept (the simulate-only fee that is never charged), with identical values. Issue #683 created `relayer/stellar/sim_decode.rs` as the shared simulate home but left the fee constant duplicated to avoid touching the stable whitelist module.
- **Impact:** No bug today (values match). Drift risk: a future change to one is silently not reflected in the other.
- **Suggested fix:** Move the simulate fee into `sim_decode.rs` (e.g. `pub const SIMULATE_FEE: u32 = 1_000_000;`) and point both `whitelist.rs` and `yield_mint.rs` at it; reconcile the two names.

### TD-27: Panel D (Yield History) lacks by-source / T-bill / decomposed-trailing series

- **Date:** 2026-07-01
- **Location:** `packages/frontend/src/components/dashboard/YieldHistoryPanel.tsx`, `useYieldHistoryPanel.ts`
- **Gap:** Three of the four series described in the original #715 spec are NOT served by
  the API despite that issue being closed: (a) cumulative PLUSD minted split by source
  (loan-repayment vs T-bill); (b) real-time T-bill accrual (rolling since last weekly USYC
  distribution); (c) trailing-30d yield split into loan-yield vs T-bill contributions.
  `GET /v1/stats/yield` returns only a single blended `accrued` series and a blended `apy`.
  Backend follow-up issue: **#738**. Seams are clearly labelled with `TODO(#738)` comments.
- **Impact:** Dashboard shows blended cumulative yield and blended APY only; the by-source
  breakdown promised in the Figma spec is not shown.
- **Suggested fix:** Land #738 (backend endpoint delivering decomposed APY + by-source accrued),
  then wire the new series into `useYieldHistoryPanel` and `YieldHistoryPanel`.

### TD-28: YieldBarChart has no hover/tooltip interaction

- **Date:** 2026-07-01
- **Location:** `packages/frontend/src/components/dashboard/YieldBarChart.tsx`
- **Gap:** The home chart (`PortfolioPlaceholderCard`) supports hover → vertical cursor line +
  tooltip. `YieldBarChart` is v1 only (no hover), mirroring the deferred touch interaction
  in the home chart.
- **Impact:** Users cannot inspect individual bar values on the Yield History chart.
- **Suggested fix:** Add `onPointerMove` / `onPointerLeave` and a floating tooltip component
  to `YieldBarChart` when the interaction UX is prioritised (follow-up issue under epic #712).

### TD-29: Footer nav links are placeholder stubs — real URLs not yet wired

- **Date:** 2026-07-01
- **Location:** `packages/frontend/src/components/Footer.tsx` — `FOOTER_LINKS` const
- **Gap:** All five footer links (Docs · White Paper · GitHub · X (Twitter) · Telegram) are rendered with `href="#"` and `aria-disabled="true"`. No real URLs were available at the time of implementation (Issue #746, Open Question 1 resolved as "stub for now"). The links do not navigate.
- **Impact:** Footer is presentationally complete but not functionally wired. No broken/misleading destinations ship; the links simply do nothing.
- **Suggested fix:** Once the real URLs are confirmed (e.g. `https://docs.pipeline.one/`, White Paper PDF, GitHub org link, X profile, Telegram channel), update the `href` values in `FOOTER_LINKS`, remove `aria-disabled="true"`, add `target="_blank" rel="noopener noreferrer"`, and remove this entry.

### TD-30: `fetch_unverified_transfers` is not chain-scoped

- **Date:** 2026-07-06
- **Location:** `packages/shared/src/kyc_repo.rs` — `fetch_unverified_transfers`
- **Gap:** The original (EVM/Crystal) `fetch_unverified_transfers` selects unscreened
  `DepositRequested`/`WithdrawalRequested` rows across **all** chains (no `chain_id` filter).
  In a mixed EVM+Stellar deployment an EVM relayer could pick up Stellar rows (and would
  lowercase their case-sensitive Strkey addresses). The new Stellar Elliptic phase uses a
  chain-scoped `fetch_unverified_transfers_for_chain`, so Stellar is safe; the EVM path
  should be scoped too.
- **Impact:** Latent cross-chain screening in mixed deployments; no impact in single-chain
  or EVM-only deployments today.
- **Suggested fix:** Add a `chain_id` parameter/filter to `fetch_unverified_transfers` and
  pass the EVM relayer's `chain_id`, mirroring `fetch_unverified_transfers_for_chain`.

### TD-31: Stellar KYT disallow is DB-only (no on-chain deauthorize)

- **Date:** 2026-07-06
- **Location:** `packages/worker/src/relayer/stellar/whitelist.rs` — `phase_sync_whitelist_stellar` disallow pass
- **Gap:** When a Stellar profile becomes KYT-failed (`kyt_status = 2`), the relayer sets
  `on_chain_allowed = FALSE` in the DB but submits no on-chain `set_authorized(addr, false)`
  transaction — the `StellarWhitelister` exposes no deauthorize path today. A previously
  authorized, now-sanctioned wallet retains on-chain authorization until an admin revokes it.
  This is **symmetric with EVM** (`phase_sync_whitelist`'s `process_disallows` is also
  deferred to a separate admin flow), so it is not a Stellar-specific regression.
- **Impact:** Automated relayer does not revoke on-chain access on a KYT failure; requires a
  manual/admin revocation flow (same as EVM).
- **Suggested fix:** Add a `set_authorized(addr, false)` submission path to `StellarWhitelister`
  (and the EVM equivalent) and wire the disallow pass to it, or formalise the separate admin
  revocation flow for both chains.

### TD-32: Trustee app duplicates env-accessor + Docker entrypoint plumbing with the LP app

- **Date:** 2026-07-07
- **Location:** `packages/trustee/src/lib/env.ts`, `docker/trustee/entrypoint.sh`
- **Gap:** Issue #777 scaffolds `packages/trustee` as a thin app that imports `@pipeline/ui`
  only. Its runtime-env accessor (`readString`/`readNumber` pattern) and Docker entrypoint
  (`jq`-built `window.__ENV__` writer) are copy-pasted from `packages/frontend`, not shared.
  The wallet/API client/formatter extraction into a shared package is the explicit scope of
  the epic #775 follow-up sub-issue #778.
- **Impact:** Two copies of the same env-accessor shape to keep in sync until #778 lands;
  low risk since the trustee surface is currently a single key (`VITE_API_BASE_URL`).
- **Suggested fix:** When #778 extracts shared frontend code, fold the env-accessor pattern
  (or a shared factory for it) and the entrypoint script generation into the shared package
  so both apps consume one implementation.

### TD-33: Trustee eslint config omits the wallet/api import-restriction blocks [RESOLVED 2026-07-08 / #791]

- **Date:** 2026-07-07
- **Location:** `packages/trustee/eslint.config.js`
- **Gap:** `packages/frontend/eslint.config.js` has `no-restricted-imports` blocks confining
  wagmi/viem/AppKit/react-query/Stellar SDK imports to `src/wallet/**` and `src/api/**`, plus
  a `no-restricted-globals` guard on bare `fetch`. The trustee scaffold has none of these
  because those modules do not exist there yet (Issue #777 imports `@pipeline/ui` only, no
  wallet/api deps).
- **Impact:** None today — there is nothing in `packages/trustee` for the guards to protect.
  Adding wallet/API deps directly (bypassing #778's shared extraction) would go unguarded.
- **Resolved by #791:** the sign-in flow landed the wallet-connect slice as the new
  `@pipeline/wallet-connect` shared package (not trustee-local files), so the trustee itself
  never imports wagmi/viem/AppKit/Stellar SDKs directly — `packages/trustee/eslint.config.js`
  now has an unconditional `no-restricted-imports` block for those packages (no carve-out
  needed, since no legitimate trustee file imports them) plus a `no-restricted-globals` guard
  confining bare `fetch` to `src/api/**` (`apiFetch` in `src/api/client.ts`, which injects the
  bearer token). `@pipeline/wallet-connect` has its own equivalent boundary scoped to its
  `src/evm/**`/`src/stellar/**` modules.

### TD-34: Trustee sign-in "Connect Wallet" button is a documented no-op [RESOLVED 2026-07-08 / #791]

- **Date:** 2026-07-08
- **Location:** `packages/trustee/src/components/SignInCard.tsx`
- **Gap:** Issue #787 ships the sign-in gate UI only (Figma node `4174-31660`). The
  "Connect Wallet" button's `onClick` performs no network call, no wallet-connect flow, and
  no redirect — it is a `// TODO(#778)` stub. There is no auth/session/wallet layer in
  `packages/trustee` yet (that extraction is #778), and spec #453 explicitly puts
  Authentication / 2FA / operator onboarding out of scope.
- **Impact:** The sign-in screen is visual-only; navigating to `/sign-in` does not gate any
  other route today (no route guard exists), and clicking Connect Wallet does nothing
  observable. Acceptable for a UI-only issue; would be a real gap if shipped as the only
  auth surface.
- **Resolved by #791:** `SignInCard` now calls `useTrusteeSession().signIn()`, which drives
  wallet-connect → `GET /v1/auth/challenge` → sign → `POST /v1/auth/verify` → stores the JWT in
  `sessionStorage` → redirects to `/`. A `401` renders as an inline "not authorized" error on
  the card. `TrusteeShell` now gates every route (`RouteGate`): unauthenticated → `/sign-in`,
  authenticated on `/sign-in` → `/`.

### TD-35: `@pipeline/wallet-connect` duplicates rather than moves the LP wallet-connect slice

- **Date:** 2026-07-08
- **Location:** `packages/wallet-connect/src/{evm,stellar}/*`, `packages/frontend/src/wallet/*`
- **Gap:** #791 extracted a minimal wallet-connect slice (connect/disconnect, address, the
  picker modal, provider mounting, plus net-new `signMessage`) into a new shared package
  per the exec plan's approach (a), but **copied** rather than **moved** the LP's
  `evm/{chain,config,mock}.ts`, `stellar/{chain,config,connectionStore,mock}.ts`,
  `ConnectModalProvider.tsx`/`ConnectModalContext.ts`, and `ConnectWalletModal.tsx` (plus the
  `connect-hero-ship.webp` asset) rather than re-pointing the LP app's imports at the new
  package. The exec plan's fallback path ("If moving risks LP regressions within this issue's
  blast radius, copy the minimal slice and log the duplication as tech-debt for #778") was
  taken to keep #791's blast radius scoped to the Trustee app and avoid touching LP import
  sites/tests under this issue.
- **Impact:** Two copies of connect/disconnect/config/mock logic for EVM and Stellar chain +
  wallet plumbing exist today (LP-owned in `packages/frontend/src/wallet`, shared in
  `packages/wallet-connect`). They are behaviourally identical at the point of the copy but
  will drift if one is changed without the other (e.g. a `useEvmWallet` bugfix). The LP app
  does **not** yet consume `@pipeline/wallet-connect` — it still owns its terms-gate-coupled
  `WalletGateProvider`/`useTermsAcknowledgement` wiring, which `@pipeline/wallet-connect`
  deliberately decouples from (see the package's `WalletGateContext.ts`).
- **Suggested fix:** #778 (shared wallet/api extraction, currently `backlog`) should re-point
  `packages/frontend`'s imports at `@pipeline/wallet-connect` for the overlapping surface
  (connect/disconnect, address, connectors, the connect modal, `signMessage`) and delete the
  LP-local duplicates, keeping only genuinely LP-specific code (`WalletGateProvider`, the
  deposit/withdraw/stake contract hooks, the terms-acknowledgement flag) in
  `packages/frontend/src/wallet`.

### TD-36: Trustee sidebar nav badges have no backend count source

- **Date:** 2026-07-08
- **Location:** `packages/trustee/src/lib/nav.ts` (`TrusteeNavItem.badgeCount`), `packages/trustee/src/components/TrusteeSidebar.tsx` (`NavBadge`)
- **Gap:** The Figma design (node `4116:8855`) shows count badges on Origination (1), Loans
  (4), and Cash Management (3) — presumably counts of pending/actionable items per section.
  There is no backend endpoint serving these counts today, so per the project rule [no
  frontend-computed metrics] issue #786 omits the numbers entirely rather than deriving them
  client-side. The badge slot (`NavBadge`) is built and renders nothing when
  `TrusteeNavItem.badgeCount` is `undefined`, ready to light up once a real count exists.
- **Impact:** The sidebar under-represents the Figma mock (no badges) until a backend source
  lands; no functional impact, just a deferred visual/product feature.
- **Suggested fix:** When a backend endpoint for per-section pending-item counts exists,
  populate `badgeCount` on the relevant `TRUSTEE_NAV_ITEMS` entries (likely via a query hook
  passed into `TrusteeSidebar`/`NavItem`, not a hardcoded value).

### TD-37: Trustee sidebar has no mobile/responsive behavior

- **Date:** 2026-07-08
- **Location:** `packages/trustee/src/components/TrusteeSidebar.tsx`
- **Gap:** Issue #786 implements the Figma sidebar (node `4116:8855`) as desktop-only: a fixed
  320px `<aside>` with no collapse, drawer, or off-canvas behavior below any breakpoint. The
  Figma frame itself is desktop-only, so there is no design reference for mobile yet.
- **Impact:** On narrow viewports the fixed 320px sidebar competes with the main content area
  for space; there is no hamburger/collapse affordance to reclaim it.
- **Suggested fix:** Once a mobile nav design exists (own Figma frame), add a breakpoint-gated
  collapse/off-canvas variant, likely mirroring the LP app's `MobileNavMenu` pattern
  (`packages/frontend/src/components/MobileNavMenu.tsx`).

### TD-38: Trustee `formatCompactUsd`/`formatFullUsd` duplicate the LP frontend's money formatters

- **Date:** 2026-07-08
- **Location:** `packages/trustee/src/utils/formatUsd.ts` vs.
  `packages/frontend/src/utils/formatCompactUsd.ts` / `packages/frontend/src/lib/usdc.ts`
- **Gap:** Issue #797 needed trustee-local money formatters for the Overview page's Capital
  Allocation card, but the trustee app deliberately does not depend on `@pipeline/frontend`
  (epic #775 keeps the two apps separate) and has no shared formatting package to pull from.
  The result is two near-identical `formatCompactUsd` implementations (trustee's trims
  trailing decimal zeros to match the Figma legend precision; the LP one always shows one
  decimal) plus a second `formatFullUsd` port of the LP whole-dollar formatter.
- **Impact:** Low today (small, well-tested pure functions) but any future rounding/precision
  fix has to be applied in both places.
- **Suggested fix:** If a third consumer needs the same formatting, extract a shared
  `@pipeline/format` (or similar) package both `frontend` and `trustee` can depend on, rather
  than depending on either app package directly.

### TD-39: Capital Allocation bar has no real proportions (bucket percentages not served)

- **Date:** 2026-07-08
- **Location:** `packages/trustee/src/components/CapitalAllocationCard.tsx`
- **Gap:** The Figma design for the Overview page's Capital Allocation card (node `4116:8934`)
  shows a proportionally-filled segmented bar with per-bucket percentages (7% / 4% / 1% / 83% /
  4%). `GET /v1/capital-allocation` serves only bucket values + `total`, no percentage/proportion
  fields, and computing `bucket/total` client-side is forbidden by the project rule [no
  frontend-computed metrics]. Issue #797 (human-confirmed decision, 2026-07-08) ships an inert,
  equal-width placeholder bar instead — styled per Figma's segment colours but not driven by
  real data.
- **Impact:** The bar does not visually communicate the actual allocation split; only the
  legend's dollar values are real. Cosmetic only — no correctness risk since no percentage is
  claimed anywhere in the UI.
- **Suggested fix:** Once the backend serves either the raw proportions or `total` is populated
  reliably enough that a server-computed percentage field can be added to the response, wire the
  bar's segment widths to that field (still not computed client-side).

### TD-40: Trustee Overview drift text + provenance chips are static mock strings

- **Date:** 2026-07-09
- **Location:** `packages/trustee/src/components/CapitalAllocationCard.tsx`
- **Gap:** Issue #807 adds the reconciliation drift header
  ("RECONCILES TO PLUSD BACKING · DRIFT < 0.01%") and the 4 provenance chips ("on-chain balance ·
  current block", "Relayer API · refreshed 2m ago", "Trustee feed · reconciled today", "stale
  values are labeled inline") as hard-coded mock text — neither is backed by any API field.
  `GET /v1/capital-allocation` has no drift/provenance data at all.
- **Impact:** The values are always identical regardless of actual reconciliation state; if the
  real drift ever exceeded 0.01% or a data source actually went stale, the UI would not reflect
  it. Cosmetic/interim only — explicitly authorised by the requester as static mock chrome (#807),
  not a silent correctness bug.
- **Suggested fix:** Wire to real provenance/drift data once the backend serves it — e.g. a
  drift percentage field plus per-source last-updated timestamps/status — and replace the static
  strings and `PROVENANCE_CHIPS` config with data-driven rendering.

### TD-41: Trustee Capital-Wallet balance is a client-side interim source + client-side total sum + client-side legend percentages + client-side proportional bar

- **Date:** 2026-07-09 (extended same-day, PR #811 review follow-up)
- **Location:** `packages/trustee/src/api/useCapitalWalletBalance.ts`,
  `packages/trustee/src/components/useCapitalAllocationCard.ts`,
  `packages/trustee/src/components/CapitalAllocationCard.tsx`,
  `packages/wallet-connect/src/stellar/sacBalance.ts`
- **Gap:** Issue #805 reads the Capital Wallet bucket's USDC balance directly from the Stellar
  contract (`usdc.balance(ENV.STELLAR_USDC_CUSTODY_ID)` via the new shared
  `@pipeline/wallet-connect` `getSacBalance` helper) as an interim substitute for the backend
  `capital_wallet` bucket, which `GET /v1/capital-allocation` still serves as `null`
  (`packages/api/src/routes/capital_allocation.rs` has not indexed it). Four client-side
  behaviors stem from this, all deliberate and guarded:
  1. The Capital Wallet legend value prefers the backend bucket but falls back to this on-chain
     read.
  2. The displayed total is a client-side sum (`backend total + on-chain balance`), added ONLY
     while the backend bucket is `null` (double-count guard).
  3. **Scope addition (human, Figma node `4116:8961`):** each legend row also shows
     `bucket_value ÷ displayed_total` rounded to the nearest whole percent (or `"< 1%"` for a
     strictly-positive sub-1% share, per a same-day PR #811 review follow-up) — a client-computed
     percentage, explicitly requested to reverse TD-39's "no client-computed percentages"
     deferral now that the on-chain-augmented total is considered authoritative enough to divide
     by. Percentages are independently rounded per bucket and NOT normalized to sum to 100.
  4. **Review follow-up (human, PR #811):** the previously-inert, equal-width allocation bar
     (TD-39) now sizes each segment's width to that bucket's EXACT (unrounded) share of the same
     displayed total (`row.barFraction`) — a second, related client-computed proportion, using
     the raw fraction (not the rounded percent text) so segments sum to ~100%. A bucket with an
     unknown value/total renders no segment.
- **Impact:** None of this is fabricated data — all four behaviors sum/divide two or more
  real, authoritative sources (backend response + live on-chain read) — but it is arithmetic the
  backend should eventually own outright once `capital_allocation.rs` indexes `capital_wallet`
  and (if ever added) serves a proportion/percentage field. Until then, the total, every bucket's
  percentage, and every bar segment's width silently change if either source's shape changes
  (e.g. decimal scale), since the trustee performs the conversion (`sacRawToDisplay`-style
  7-decimal → human-unit string, duplicated locally per TD-38's precedent since the trustee
  cannot depend on `@pipeline/frontend`).
- **Suggested fix:** Remove `useCapitalWalletBalance` and the total-sum/percentage/bar-fraction
  computation logic in `useCapitalAllocationCard.ts` (and the proportional-width rendering in
  `CapitalAllocationCard.tsx`) once the backend serves a non-null `capital_wallet` bucket (and,
  if a percentage/proportion field is ever added server-side, prefer that instead of computing
  `barFraction`/`percentDisplay` client-side) — the existing "prefer backend value" guards already
  make this a no-op removal for callers.

### TD-42: Trustee Origination page duplicates the LP `loan_data` extractor, and two Figma cells have no backend source

- **Date:** 2026-07-09 (updated 2026-07-10, issue #814; updated 2026-07-13, issue #843)
- **Location:** `packages/trustee/src/api/useLoanSubmissions.ts`,
  `packages/trustee/src/routes/-useOriginationTable.ts`,
  `packages/trustee/src/routes/origination.tsx` (issue #813);
  `packages/trustee/src/api/useLoanBook.ts`,
  `packages/trustee/src/routes/-useLoansTable.ts`,
  `packages/trustee/src/utils/formatUsd.ts` (`scaleRegistryAmount` /
  `formatRegistryCompactUsd` / `formatRegistryFullUsd`, issue #843); mirrored on the LP side by
  `packages/frontend/src/api/useLoanSubmissions.ts` (pre-existing),
  `packages/frontend/src/components/dashboard/originationRow.ts` (`mapSubmissionToRow`, issue
  #814), and the `formatFullUsd` (in `packages/frontend/src/utils/formatCompactUsd.ts`) /
  `formatMaturityDate` / `formatSubmittedDate` (`packages/frontend/src/utils/formatDate.ts`)
  formatters — hand-mirrored, byte-for-byte, from the trustee's `formatUsd.ts` / `formatDate.ts`.
- **Gap:** The Trustee Origination page and the LP Protocol Dashboard's In-Origination tab (#814)
  both read `GET /v1/loan-book/submissions` and now render the **same eight-column field set**
  (Originator/Commodity/Facility/Corridor/Rate/Maturity/Submitted/Status), but the two apps
  cannot share code (epic #775 keeps them separate), so `useLoanSubmissions.ts`'s typed
  interfaces (`EconomicsInput`, `LocationInput`, `SubmitLoanRequest`, `SubmissionView`) and the
  field-mapping logic (`mapSubmissionToRow`: base-6/bps/date parsing, `—` fallbacks, corridor
  arrow substitution) are hand-mirrored on both sides — same precedent as TD-38's `formatUsd.ts`
  duplication, now widened by #814 to also cover the extractor and the two new date/full-USD
  formatters. Additionally, two Figma cells on the trustee page have no backend field to source
  them, resolved as deliberate omissions/placeholders for #813 (human, issue #813 comment) and
  mirrored identically on the LP side (human, issue #814 comment):
  1. The Figma "Commodity · valuation" sub-line ("NSR · Net Smelter Return" / "Standard · price
     × quantity") is omitted entirely on **both** apps — `ValuationMode` lives in
     `loan_collateral_valuations` keyed by an on-chain `loan_id`, which pre-mint submissions
     don't have yet.
  2. The Figma "Review" button on `InReview` rows is rendered inert/disabled on the **trustee**
     page only — no submission-review/detail route exists in the trustee app yet. The **LP**
     dashboard doesn't attempt this treatment at all (resolved, issue #814): it keeps its
     existing simple color-coded status label, since the LP app is read-only for submissions
     with no review route.

  **Addendum (issue #843, Trustee Loans page — a fourth hand-mirroring):** the Trustee Loans page
  (`useLoanBook.ts` + its self-contained `LoanBookSummary`/`LoanBookEntry`/`TopConcentration`/
  `LoanBookResponse` types, `-useLoansTable.ts`'s row/summary mapping, and the new
  `scaleRegistryAmount`/`formatRegistryCompactUsd`/`formatRegistryFullUsd` helpers in the trustee
  `formatUsd.ts`) hand-mirrors the LP frontend's `useLoanBook.ts` and
  `packages/frontend/src/utils/formatCompactUsd.ts::scaleRegistryAmount` (issue #842) rather than
  sharing them — the same epic-#775 app-separation constraint. Two extra wrinkles specific to this
  page: (a) the trustee `useLoanBook` types carry the **post-#833 Trustee-only summary fields**
  (`deployed_senior`, `weighted_rate`, `weighted_tenor_days`, `at_risk_wl_and_default_*`,
  `top_concentration`, per-loan `senior_outstanding`/`ccr_bps`/`ccr_reported_at`/`spot_*`) that the
  pre-#833 LP hook does **not**, so the two loan-book hooks have already drifted; and (b) the
  `scaleRegistryAmount` ×1000 helpers and `-useLoansTable.ts`'s `correctCcrBps` (÷1000) are the
  trustee copies of the **#840 registry-scale workaround** — cross-linked to TD-42-adjacent debt so
  they are removed **together with the LP copies when backend issue #840 is fixed** (otherwise the
  Loans-page amounts render 1000× too big and CCR 1000× too small). See #843's exec plan
  (`docs/exec-plans/active/issue-843-trustee-loans-page.md`) RISK 1 for the CCR/at-risk% scale-mix
  detail.

  **Addendum (issues #845 / #847, Trustee Loan detail page — a fifth hand-mirroring):** the Loan
  detail page's Price & collateral section hand-mirrors the backend
  `CollateralValuationResponse` DTO (`packages/api/src/routes/collateral_valuation.rs`) as
  `packages/trustee/src/api/useLoanValuation.ts`'s self-contained
  `LoanValuationResponse`/`ValuationInputs`/`Waterfall`/`ValuationCcr`/`MetalInput`/`PenaltyInput`
  types — same epic-#775 app-separation constraint, no LP counterpart exists. **Scale note:** unlike
  `/v1/loan-book`, this endpoint recomputes money in **plain USD** (not the base-6/registry scale),
  so its amount fields are already correct — the #840 `scaleRegistryAmount` ×1000 workaround is
  **NOT** applied here (a documented divergence from the loan-book hand-mirror above). Also on this
  branch the loan-book `LoanBookEntry` hand-mirror gained the `loan_id`/`chain_id` fields (added
  backend-side in "add loan and chain ids to loan-book endpoint"), used as the `/loans/$id` route
  param + the valuation path segment — port them if the LP hook ever adopts them.

  **Addendum (issue #852, Trustee Loan detail — a sixth hand-mirroring):** the loan detail's
  "Registry state & derived" section hand-mirrors the backend `LoanFinancialsResponse` DTO
  (`packages/api/src/routes/loan_financials.rs`) as `packages/trustee/src/api/useLoanFinancials.ts`'s
  self-contained `LoanFinancialsResponse`/`LocationView` types — same epic-#775 constraint, no LP
  counterpart. **Scale (open, #852):** unlike `/valuations`, this endpoint's money fields are
  registry/loan-snapshot-sourced, so they are treated as **#840 1000×-low** and scaled with
  `formatRegistryCompactUsd` in `-useLoanDetail.ts::buildFinancials` — **to be verified against real
  data**; if it turns out correct-scale, swap to `formatCompactUsd` (part of the #840 workaround
  family, removed together when #840 is fixed). The `Custodian co-sig on mint` row has
  no field on this endpoint yet and renders `—` pending clarification (the `Epochs` row is now
  sourced from the endpoint's `epoch` object, #857).

  **Addendum (issue #1039, Trustee Loan detail — `documents` mirror drift closed, `reported_ccr_bps`
  still open):** `useLoanBook.ts`'s `LoanBookEntry` hand-mirror had drifted from the backend DTO —
  `documents` (added backend-side by commit `f73d54d`) was missing from the trustee TS type and
  silently discarded on the wire. #1039 added it (`LoanDocumentDto`, a further trustee-local
  duplicate of `useLoanSubmissions.ts`'s identical type — a fourth hand-mirroring alongside those
  already tracked above). `reported_ccr_bps` is likewise served by the backend but still missing
  from this mirror; nothing reads it yet, so it is left out rather than added speculatively.
- **Impact:** Any change to the `loan_data` shape, base-6/bps/date conventions, or
  `SubmissionView` fields must now be manually ported across **three** hand-mirrored call sites
  (trustee's `-useOriginationTable.ts`, LP's `originationRow.ts`, and each app's own
  `formatUsd`/`formatDate` formatters) or the surfaces will silently drift out of sync. The
  omitted valuation cell means both Origination surfaces are visually incomplete relative to the
  Figma reference until a backend field exists.
- **Suggested fix:** Extract a shared, framework-agnostic `loan_data` parsing package (types +
  base-6/bps/date formatters) now that a **second** consumer (the LP side, #814) exists on top of
  the trustee's; until then keep both hand-mirrored per the epic #775 app-separation rule. Add a
  `valuation_mode`/similar field to `SubmissionView` (backend change) to un-omit the valuation
  sub-line, and wire a submission-review route (separate Type-1 sub-issue of epic #775) to make
  the trustee's Review button live.

### TD-43: `draw_loan` mint↔review reconciliation has no backend fallback; `SubmitLoanRequest` gains a third hand-mirrored copy

- **Date:** 2026-07-10
- **Location:** `packages/trustee/src/routes/-useOriginationReview.ts` (issue #831);
  `packages/wallet-connect/src/stellar/contracts/loanRegistry.ts` (its own `SubmitLoanRequest`/
  `EconomicsInput`/`LocationInput` port, deliberately self-contained per the package's boundary
  rule — see TD-42 for the existing trustee/LP hand-mirroring this now triples).
- **Gap:** Approve's chain-first flow (mint the loan on-chain, then call the existing
  `POST /v1/loan-book/submissions/{id}/review`) has a frontend-only idempotency guard: if the
  mint succeeds but the review call then fails, re-clicking Approve in the SAME session skips
  the on-chain step (`useDrawLoan`'s `isSuccess` acts as an in-memory "minted" marker) and retries
  only the review call. A **hard page reload** between mint-success and review-failure loses that
  marker — a subsequent Approve would attempt another on-chain `draw_loan` call (whether the
  contract itself dedupes/rejects a re-mint of an already-registered loan is unconfirmed). There
  is no backend reconciliation: the worker already indexes the `loan_drawn` event but nothing
  auto-flips the DB submission to `Approved` from it, so a lost review call has no server-side
  recovery path today. Separately, `@pipeline/wallet-connect`'s `loanRegistry.ts` necessarily
  defines its own narrow `SubmitLoanRequest` (only the 5 `draw_loan`-relevant fields) rather than
  importing the trustee's — the package cannot depend on either app — adding a third hand-mirrored
  shape alongside TD-42's trustee/LP pair.
- **Impact:** A rare operational edge case (mint succeeds, review fails, operator reloads before
  retrying) can leave a loan minted on-chain with its DB submission stuck `InReview` with no
  automated way to reconcile — requires manual intervention (direct DB update or a future backend
  tool) until the follow-up below ships. The type triplication risks silent drift if `draw_loan`'s
  accepted shape changes without updating all three copies.
- **Suggested fix:** File a follow-up backend issue (Epic #775 / Stellar epic #444) to have the
  worker auto-flip a submission to `Approved` when it observes the matching indexed `loan_drawn`
  event, closing the reload gap without any frontend change. Consider the same shared
  `loan_data`-parsing package suggested by TD-42's fix, extended to also host the ScVal-encoding
  transform matrix, if a third on-chain consumer ever needs it.

### TD-44: Stellar vault `assets`/`shares` (`StakingDeposit`/`StakingWithdrawal`) have no read-time USDC normalization yet

- **Date:** 2026-07-21 (revised same day — see #901's read-time-not-write-time architecture correction)
- **Location:** `contract_logs` rows for `StakingDeposit`/`StakingWithdrawal` (raw, correctly
  unmodified — Stellar's native 7-decimal scale, per the worker's `parse_vault_deposit`/
  `parse_vault_withdraw`). No `ContractLogsRepo` method currently reads these events at all.
- **Gap:** #901 added `shared::chains::normalize_usdc_amount`/`LoanSnapshot::normalize_usdc_for_display`
  and wired them into every `ContractLogsRepo` method an API route actually consumes
  (loan-registry economics, withdrawal-queue, flow-events, yield-mints). No repo method reads
  `StakingDeposit`/`StakingWithdrawal` today — the only place these events are touched at all is
  `kyc_repo.rs`'s `GroupedRequest`/`RequestEventRow` (BUG-9), which is unused dead code. So
  neither `assets` (USDC — would need the same `normalize_usdc_amount` treatment once a real
  consumer exists) nor `shares` (the vault's own share-token amount — ERC-4626 `decimals_offset`
  convention, `staked-pipeline-usd/src/lib.rs`: `decimals() = ASSET_DECIMALS + decimals_offset`,
  not necessarily 7-decimal parity with USDC, needs separate confirmation) have any normalization
  path yet. No live impact today since nothing reads them.
- **Impact:** If either field is ever surfaced as a displayed/computed figure (e.g. a "your vault
  shares" balance or a fixed deposit/withdraw amount), `assets` will read 10× too large (same bug
  class as #901) and `shares` will be wrong by whatever the actual `decimals_offset` turns out to
  be — not necessarily the same factor.
- **Suggested fix:** When a real consumer of `StakingDeposit`/`StakingWithdrawal` amounts is
  added, add the corresponding `ContractLogsRepo` method and call
  `shared::chains::normalize_usdc_amount` on `assets` at **read time** (mirroring #901's other six
  methods — never at indexer decode/write time). For `shares`, first confirm the deployed
  `StakedPipelineUSD` contract's actual `decimals_offset` (check `pipeline-stellar-contracts`
  deployment config or query `staked_pl_usd.decimals()` directly) before normalizing it.

### TD-45: `loan_assays`/`loan_offtake_terms` still allow UPDATE/DELETE at the DB level

- **Date:** 2026-07-22 (#914)
- **Location:** `packages/shared/migrations/20260708000003_loan_assays.sql`,
  `20260708000004_loan_offtake_terms.sql`.
- **Gap:** Both tables are append-only **by application convention only** — #914's new
  `CollateralValuationRepo::insert_assay`/`insert_offtake` only ever `INSERT`, never
  `UPDATE`, and no route exposes an update/delete path. But the migrations' own
  comments call out that "DB-level REVOKE of UPDATE/DELETE is deferred to a
  follow-up migration" — that follow-up was never logged here and never landed.
  Nothing at the database layer actually prevents a row from being altered or
  removed outside the API (a manual `UPDATE`/`DELETE`, a future careless endpoint,
  direct DB access).
- **Impact:** The append-only audit guarantee the spec calls for — *"no silent edit
  or hard delete, because document fraud is a primary loss driver in commodity
  finance"* (`docs/product-specs/collateral-valuation.md:106`) — is enforced only by
  convention, not by the database. A bug or a compromised DB credential could alter
  or erase assay/offtake history undetected.
- **Suggested fix:** A migration that `REVOKE UPDATE, DELETE ON loan_assays,
  loan_offtake_terms FROM <api role>` (or similar), so the guarantee holds even if
  application code regresses.

### TD-46: Trustee `formatFractionPct` (decimal-fraction → 1dp percent) is duplicated across two route presenters

- **Date:** 2026-07-20
- **Location:** `packages/trustee/src/routes/-useLoansTable.ts` (private `formatFractionPct`,
  issue #843) and `packages/trustee/src/routes/-risk-council-escalate.ts` (private
  `formatFractionPct`, issue #782) — byte-identical logic, hand-mirrored rather than shared
  because the original wasn't exported.
- **Gap:** Both format the same `at_risk_wl_and_default_pct` / `top_concentration.share`-shaped
  decimal-fraction strings (e.g. `"0.0430"` → `"4.3%"`), but neither file exports the helper, so
  the second usage (the Risk Council Escalate-to-Default page) re-implements it locally instead
  of importing it — the same class of duplication TD-38/TD-42 already track for money formatters.
- **Impact:** Low — the function is 5 lines and stable (protocol ratio formatting), but a third
  consumer would make the drift risk (e.g. rounding-mode changes only applied in one copy) worth
  fixing before it repeats again.
- **Suggested fix:** Export `formatFractionPct` from `-useLoansTable.ts` (or lift it into
  `src/utils/` alongside `formatUsd.ts`'s money formatters, per `docs/FRONTEND.md` rule 3) and
  have both presenters import the shared copy.

### TD-47: `packages/frontend` has pre-existing Prettier formatting drift blocking the pre-commit hook

- **Date:** 2026-07-28 (#947)
- **Location:** At minimum `src/api/README.md`, `src/api/useStatsYield.ts`,
  `src/components/ConnectWalletModal.test.tsx`, `src/components/TopBar.test.tsx`,
  `src/components/TopBar.tsx`, `src/wallet/ConnectModalProvider.test.tsx`,
  `src/wallet/README.md`, `src/wallet/stellar/connectionStore.ts`,
  `src/wallet/stellar/contracts/stakedPlusd.test.ts` (per `yarn --cwd packages/frontend lint`
  at the time of #947; the list may grow before this is fixed).
- **Gap:** `.husky/pre-commit`'s "frontend lint" step runs `yarn --cwd packages/frontend lint`
  unscoped (whole workspace, not just staged files) via Prettier's `--check`. These 9 files
  fail that check even though none of them were touched by #947 — the drift predates this
  change and was not introduced by it. This blocked a backend-only commit (Rust + docs, no
  frontend files) until bypassed with `--no-verify` after explicit user approval.
- **Impact:** Any commit — even one that never touches `packages/frontend` — currently fails
  the pre-commit hook's frontend-lint step, forcing either an unrelated formatting fix bundled
  into an unrelated PR, or a `--no-verify` bypass (which also skips every other pre-commit
  check, not just this one).
- **Suggested fix:** Run `yarn --cwd packages/frontend format` (Prettier `--write`) across the
  9 files above in a dedicated formatting-only commit/PR, then confirm `yarn --cwd
  packages/frontend lint` passes clean so the hook stops blocking unrelated work.

### TD-48: Penalty `escalating` flag is stored but never applied

- **Date:** 2026-07-30 (#966)
- **Location:** `packages/shared/src/collateral_valuation_repo.rs` (`PenaltyTierJson.escalating`),
  `packages/shared/src/collateral_valuation/mod.rs` (`assemble_penalties` / `ConcentrateInputs::valuate`)
- **Gap:** The offtake penalty schedule carries an `escalating` boolean (also accepted by the
  `POST /offtake` endpoint), but the waterfall math treats every tier as flat — `escalating`
  is never read. Escalating penalties (a per-step rate that ramps with the excess) are not
  implemented.
- **Impact:** A deal authored with an escalating penalty basis is under-penalised — the
  collateral value and CCR read higher than the offtake terms intend. Silent, like the ppm
  units bug (#966) it sits next to.
- **Suggested fix:** Decide the escalation formula with the credit team, thread `escalating`
  into `PenaltyTier`, and branch the per-tier charge in `valuate`; add a spec worked example
  and round-trip test. Until then, treat `escalating: true` schedules as unsupported.

---

### TD-49: DepositManager contract error `#3` → "Amount exceeds the deposit limit." is an unverified mapping

- **Date:** 2026-08-06 (#1034)
- **Location:** `packages/frontend/src/utils/userError.ts` (Soroban contract-error table)
- **Gap:** The Soroban contract source is not vendored in this repo and the generated interface
  doc carries no `#[contracterror]` enum, so error `#3`'s meaning could not be confirmed. The
  mapping ships on circumstantial evidence (user-docs "a single deposit cannot exceed $5M";
  `maxPerLPPerWindow` default `5_000_000e6`; the reported ~5M repro threshold) — resolved with
  the user on #1034 as a deliberately flippable table entry.
- **Impact:** If `#3` means something other than the amount cap, users see a wrong (but
  harmless) specific message; the details dialog always carries the raw error either way.
- **Suggested fix:** Confirm the enum against the deployed WithdrawalQueue/DepositManager
  contract source (contracts repo / `stellar contract info`), then correct or confirm the
  table entry — a one-line change.

### TD-50: Trustee Loan detail's Documents card is a stand-in for the v3 §S5 tab strip

- **Date:** 2026-08-07 (#1039)
- **Location:** `packages/trustee/src/routes/loans.$id.tsx` (`DocumentsCard`);
  `docs/design-docs/trustee-dashboard-v3-design-assignment.md` §S5.
- **Gap:** The v3 design assignment specifies Documents as one of six tabs (Ledger / Terms /
  Movements / Documents / Location / Activity) on the loan detail page. The implemented page has
  no tab strip at all (the #847/#859/#862/#866 card layout); #1039 rendered Documents as an
  always-on card instead, placed directly before Other actions in every §S5 variant — an
  author-approved interim, not the spec'd structure.
- **Impact:** None today (the card satisfies the same user need), but a future full tab-strip
  migration will need to relocate this card's content rather than build it fresh.
- **Suggested fix:** Scope the §S5 tab-strip migration as its own issue once prioritized; move the
  Documents card's list markup into the new Documents tab body unchanged.

### TD-51: `packages/trustee` has the same pre-existing Prettier formatting drift as TD-47/TD-12 (`packages/frontend`)

- **Date:** 2026-08-07 (found during #1039)
- **Location:** Confirmed on the `feat/1039-loan-detail-documents` branch's base commit (i.e.
  pre-existing, not introduced by #1039): `packages/trustee/src/routes/loans.$id_.record-coupon.tsx`,
  `packages/trustee/src/routes/loans.$id_.record-repayment.tsx`,
  `packages/trustee/src/routes/risk-council.writedown.$id.tsx`, plus four test files that #1039
  touched with a single-line fixture addition each (`-record-repayment-page.test.tsx`,
  `-risk-council-reterm-page.test.tsx`, `-risk-council-writedown-page.test.tsx`,
  `-useLoansTable.test.ts`) — their pre-existing bodies fail `prettier --check` for unrelated
  reasons elsewhere in the file, so `yarn --cwd packages/trustee lint` fails on a clean checkout
  independent of #1039's changes (verified via `git stash`).
- **Impact:** Same as TD-12/TD-47 but for the trustee package: `yarn lint` fails on `main`,
  CI/pre-commit gates relying on it are already broken, and any future change to these files
  will look larger than it is if lint is fixed opportunistically inside an unrelated PR.
- **Suggested fix:** One-shot `prettier --write` pass over `packages/trustee` in a dedicated
  formatting-only chore PR (mirrors TD-47's suggested fix for `packages/frontend`), then confirm
  `yarn --cwd packages/trustee lint` passes clean.

---

## Post-MVP

- Automated bank integration (repayment identification currently manual)
- On-chain LTV oracle writes and automated enforcement triggers
- Withdrawal queue 4-tier mechanism (MVP is simple FIFO)
- Multiple Loan Originators
- Public bug bounty programme
- GenTwo MTN issuance
