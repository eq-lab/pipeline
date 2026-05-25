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

---

## Post-MVP

- Automated bank integration (repayment identification currently manual)
- On-chain LTV oracle writes and automated enforcement triggers
- Withdrawal queue 4-tier mechanism (MVP is simple FIFO)
- Multiple Loan Originators
- Public bug bounty programme
- GenTwo MTN issuance
