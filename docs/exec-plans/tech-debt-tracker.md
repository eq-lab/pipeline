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

---

## Post-MVP

- Automated bank integration (repayment identification currently manual)
- On-chain LTV oracle writes and automated enforcement triggers
- Withdrawal queue 4-tier mechanism (MVP is simple FIFO)
- Multiple Loan Originators
- Public bug bounty programme
- GenTwo MTN issuance
