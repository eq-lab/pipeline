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

---

## Post-MVP

- Automated bank integration (repayment identification currently manual)
- On-chain LTV oracle writes and automated enforcement triggers
- Withdrawal queue 4-tier mechanism (MVP is simple FIFO)
- Multiple Loan Originators
- Public bug bounty programme
- GenTwo MTN issuance
