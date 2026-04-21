# Harness Init — Exec Plan
## Pipeline MVP Technical Specification v0.3.8

---

## Phase Checklist

- [x] Phase 1: Harness Foundation (CLAUDE.md, AGENTS.md, ARCHITECTURE.md)
- [x] Phase 2: Documentation Tree
- [x] Phase 3: Product Specs (12 specs, 30 user stories)
- [x] Phase 4: Skills
- [x] Phase 5: Quality Infrastructure
- [x] Phase 6: Design Docs
- [x] Phase 7: Verify & Finalise — 0 lint errors, 4 warnings (large specs, acceptable)

## Confirmed Inputs

- **GitHub repo:** eq-lab/pipeline
- **Backend language:** Rust (packages/api + packages/worker)
- **Frontend:** TypeScript/React (packages/frontend, main.ts scaffold)
- **Monorepo:** pnpm workspaces (frontend) + Cargo workspace (api, worker)
- **Lint command:** TBD — see TD-1 in tech-debt-tracker.md
- **Doc lint:** `npx tsx scripts/lint-docs.ts`

---

## Extracted PRD Data

### Product Identity

- **Name:** Pipeline
- **Elevator pitch:** A decentralised commodity trade finance protocol that lets accredited LPs deposit USDC, receive the PLUSD stablecoin, stake into the sPLUSD yield-bearing vault, earn yield from loan repayments and USYC T-bill holdings, and withdraw back to USDC — secured by a two-rail (cash + token) architecture with MPC wallets and on-chain event-driven authorisation.
- **Target users:** Accredited LPs (investors), Pipeline Trust Company (Trustee), Loan Originators (Open Mineral AG for pilot), Pipeline team operators, Risk Council members.

---

### Business Domains

| # | Domain | Description |
|---|--------|-------------|
| 1 | **lp-onboarding** | Sumsub KYC/KYB, Chainalysis sanctions screening, WhitelistRegistry writes, re-screening cadence |
| 2 | **deposits** | USDC deposit flow, PLUSD minting, rate limiting, deposit queue, below-minimum accumulation |
| 3 | **staking** | sPLUSD ERC-4626 vault — stake, unstake, share price mechanics |
| 4 | **loans** | LoanRegistry (ERC-721), origination request flow, lifecycle updates, price feed monitoring |
| 5 | **yield** | Repayment waterfall, USYC NAV accrual, weekly yield distribution, PLUSD minting to vault + treasury |
| 6 | **withdrawals** | FIFO queue with partial fills, automated LP payout, Treasury Wallet redemption (Stage A + B) |
| 7 | **smart-contracts** | PLUSD, sPLUSD, WhitelistRegistry, WithdrawalQueue, LoanRegistry, FoundationMultisig — interfaces and data structures |
| 8 | **bridge-service** | On-chain event listening, MPC auto-signing, PLUSD minting authority, USDC↔USYC rebalancing, reconciliation invariant |
| 9 | **operations-console** | Trustee tooling, Team interface, Originator UI — operator account lifecycle, co-signing, compliance queue |
| 10 | **price-feed** | Platts/Argus price ingestion, CCR computation, threshold notifications, loan event log |
| 11 | **dashboards** | LP dashboard, Protocol dashboard (balance sheet, deployment monitor, withdrawal queue, yield history) |
| 12 | **audit-logging** | Append-only audit log, third-party log sink, compliance traceability |

---

### Feature Inventory

**lp-onboarding**
- Wallet-based LP account creation (WalletConnect v2 / RainbowKit)
- Sumsub KYC/KYB flow (individuals + corporate KYB)
- Accreditation self-certification (Reg D / Reg S)
- Chainalysis Address Screening — happy path auto-approval
- Manual compliance review queue for ambiguous screening results
- On-chain WhitelistRegistry write on approval
- 90-day re-screening freshness window with pre-deposit gate
- Passive re-screening revocation

**deposits**
- Minimum deposit: 1,000 USDC (configurable)
- Below-minimum accumulation with pending-top-up counter
- Bridge detection of USDC Transfer events into Capital Wallet
- Four eligibility checks: whitelist, freshness, minimum, rate limit
- PLUSD mint 1:1 to USDC deposit
- Rolling 24h rate limit ($10M) and per-tx cap ($5M), configurable
- Deposit mint queue (FIFO) when rate limit breached — backend only
- Queued deposit visible to LP as "PLUSD mint pending rate limit"
- Split of large deposits (>$5M) into successive windows

**staking**
- PLUSD approve + sPLUSD.deposit() on-chain (no bridge involvement)
- Share calculation: assets × totalSupply / totalAssets
- Dead-shares seed at deployment (first-deposit attack mitigation)
- sPLUSD open to any PLUSD holder — no whitelist check
- sPLUSD.redeem() — reverts at PLUSD level if receiver not whitelisted
- Unstaking always available

**loans**
- Originator EIP-712 signed request submission (off-chain, no wallet popup)
- Trustee review queue — approve / request changes / reject
- LoanRegistry.mintLoan() broadcast by bridge on trustee approval
- Immutable data at mint: originator, borrowerID, commodity, corridor, facility size, tranche split, tenor, governing law, metadata URI, initial location
- Mutable lifecycle data: status (Performing/Watchlist/Default/Closed), currentMaturityDate, lastReportedCCR, currentLocation, closureReason
- LocationUpdate: type (Vessel/Warehouse/TankFarm/Other), identifier, trackingURL
- LoanMinted event → bridge prepares disbursement transaction → trustee + team co-sign
- Loan status transitions: Performing ↔ Watchlist (loan_manager), Default (risk_council 3-of-5), Closed (loan_manager or risk_council)
- Maturity date extensions

**yield**
- Manual repayment identification by trustee (no bank integration)
- Client-side waterfall computation against LoanRegistry parameters
- Waterfall components: senior principal return, management fee (0.5–1.5% p.a.), performance fee (10–20% net interest), OET allocation (0.05–0.10% p.a.), originator residual
- Trustee signs RepaymentSettled event
- Bridge mints: PLUSD to sPLUSD vault (senior coupon net) + PLUSD to Treasury (fees)
- Auto-sweep of senior principal returned into USYC
- Weekly USYC NAV yield distribution (Thursday, 70% vault / 30% treasury)
- Real-time accrued yield display (informational, pre-distribution)
- PLUSD backing invariant: totalSupply == USDC + USYC NAV + deployed loans + in-transit
- Reconciliation indicator: green <0.01% drift, amber 0.01–1%, red >1%

**withdrawals**
- sPLUSD.redeem() → PLUSD
- WithdrawalQueue.requestWithdrawal() — whitelist + freshness check, PLUSD escrowed
- FIFO queue with partial fill support
- Bridge auto-signs LP payout (destination == original deposit address, amount ≤ $5M per-tx / $10M 24h)
- Partial fill: outstanding remainder stays at head of queue
- WithdrawalPartiallyFilled and WithdrawalSettled events
- LP can cancelWithdrawal() before settlement (unfilled portion only)
- Above-envelope payouts routed to trustee + team signing queue
- Treasury Wallet redemption: Stage A (PLUSD → USDC, team op A + op B + trustee MPC), Stage B (USDC → pre-approved bank, same 3-party chain)
- Pre-approved bank account list maintained by foundation multisig

**smart-contracts**
- PLUSD: OZ ERC-20Pausable + _update whitelist hook (~5 lines custom)
- sPLUSD: OZ ERC-4626 unmodified
- WhitelistRegistry: custom ~80 lines (setAccess, revokeAccess, isAllowed, addDeFiVenue, freshnessWindow)
- WithdrawalQueue: custom ~180 lines (requestWithdrawal, cancelWithdrawal, fillRequest, getQueueDepth, pause)
- LoanRegistry: OZ ERC-721 + custom extension ~200 lines (mintLoan, updateMutable, setDefault, closeLoan)
- FoundationMultisig: Safe 3-of-5 (2-of-5 fast pause on PLUSD, sPLUSD, WithdrawalQueue)
- Total custom audit surface: ~470 lines

**bridge-service**
- On-chain event listeners: USDC Transfer, WithdrawalRequested, LoanMinted, RepaymentSettled, TreasuryYieldDistributed
- MPC auto-signing for 4 categories: USDC↔USYC swaps (in band), LP payouts (pinned destination + within caps), loan disbursement preparation, Treasury redemption preparation
- PLUSD MINTER role: deposit mints + yield mints
- WithdrawalQueue FILLER role
- LoanRegistry loan_manager role
- WhitelistRegistry WHITELIST_ADMIN role
- USDC↔USYC automated rebalancing (target 15%, bands 10–20%, cap $5M per-tx / $20M daily)
- Deposit mint queue management (FIFO, USDC Transfer log + mint log delta rebuild on restart)
- Weekly yield event pre-building and presentation to trustee
- Reconciliation invariant computation and publishing
- Hot keys in HSM-backed KMS (AWS KMS / GCP KMS)

**operations-console**
- Operator account lifecycle: invite (72h link) → signup (email + password + TOTP/WebAuthn 2FA) → pending activation → 2-person team consensus → active
- Suspension (single team member), permanent removal (2-person consensus)
- Trustee view: origination queue, repayment reconciliation, weekly yield signature, USYC manual override, loan lifecycle updates
- Team view: signing queue (loan disbursements, treasury redemptions, above-envelope payouts/swaps), compliance review queue, bridge alerts, operational monitoring
- Originator view: new origination request form (EIP-712), My Requests status, My Loans portfolio, statistics, notifications

**price-feed**
- Platts + Argus price polling (~15min market hours, configurable)
- Per-loan CCR computation: collateral_value / outstanding_senior_principal
- Threshold notifications: Watchlist (CCR <130%), Maintenance margin call (<120%), Margin call (<110%), Payment delay amber (>7d), red (>21d), AIS blackout (>12h tracking loss), CMA discrepancy (>3%)
- Recipients per event type (team, originator, borrower via originator, trustee)
- Delivery: in-app + email + optional Telegram/Slack webhook
- Batched LoanRegistry CCR updates on threshold crossings (not every tick)
- Thresholds configurable by foundation multisig (protocol-wide) and loan_manager (per-loan)

**dashboards**
- LP dashboard: position, yield earned (nominal + time-weighted annualised), withdrawal queue status, transaction history, pending deposits
- Protocol Panel A: balance sheet (PLUSD supply, sPLUSD, Capital Wallet USDC/USYC, loans deployed, in-transit, USDC ratio, reconciliation indicator)
- Protocol Panel B: deployment monitor (per-loan live data from LoanRegistry + trustee feed + price feed event log)
- Protocol Panel C: withdrawal queue (depth, pending count, coverage ratio, recent fills)
- Protocol Panel D: yield history (cumulative loan yield + T-bill yield, real-time accrual, exchange rate time series, 30-day annualised yield)

**audit-logging**
- Append-only log: timestamp, action type, triggering event, on-chain tx hash, before/after invariant, parameters
- Action categories: deposit mint, yield mint, LP payout, USDC/USYC swap, loan disbursement preparation, LoanRegistry mutation, notification dispatch
- Mirrored in near-real-time to third-party log sink (append-only, trustee-managed or SIEM)
- Retention: lifetime of protocol

---

### Tech Stack

| Category | Technology |
|----------|------------|
| Blockchain | Ethereum mainnet (primary), Soroban (documented alternative) |
| Smart contracts | Solidity + OpenZeppelin (ERC-20, ERC-4626, ERC-721) |
| Web3 frontend | WalletConnect v2, RainbowKit, ethers.js |
| Indexer | Custom internal indexer (EQ LAB) |
| MPC wallets | Fireblocks or BitGo (pending RFI) |
| Multisig | Safe (Gnosis Safe) |
| KYC/KYB | Sumsub |
| Wallet screening | Chainalysis Address Screening |
| T-bill token | USYC (Hashnote / Circle) |
| On/off-ramp | Circle Mint, Zodia Markets (pending selection) |
| Price feeds | Platts (S&P Global), Argus (LSEG) — licensed data |
| Key management | AWS KMS / GCP KMS (HSM-backed) |
| Off-chain signatures | EIP-712 |
| Frontend framework | Not explicitly specified — React implied (RainbowKit) |
| Backend language | Not specified — Node.js/TypeScript likely given EQ LAB prior work |
| 2FA | TOTP (Google Authenticator, Authy) + WebAuthn/FIDO2 |

---

### User Roles

| Role | Auth model | On-chain keys | Capabilities |
|------|-----------|---------------|--------------|
| LP | Wallet signature (WalletConnect) | Yes (own EOA) | Deposit, stake, unstake, withdraw |
| Trustee | Email + password + 2FA | MPC key share (Capital + Treasury) | Loan verification, repayment signing, weekly yield signing, MPC co-sign |
| Loan Originator | Email + password + 2FA | None | Origination requests (EIP-712 signed), portfolio view |
| Pipeline Team | Email + password + 2FA | MPC key share (Capital + Treasury) | Operator management, co-signing, compliance, monitoring |
| Risk Council | Safe multisig members | Ethereum signing key (Safe) | Protocol pause, loan default/close |
| Bridge Service | Programmatic | MPC key share (Capital only, scoped) | Auto-sign 4 tx categories, PLUSD minter/filler/loan_manager |

---

### API Surface

**Smart contract interfaces (Ethereum):**
- `PLUSD`: mint, burn, transfer, transferFrom, pause, unpause
- `sPLUSD`: deposit, redeem, totalAssets, pause, unpause
- `WhitelistRegistry`: setAccess, revokeAccess, isAllowed, addDeFiVenue, freshnessWindow
- `WithdrawalQueue`: requestWithdrawal, cancelWithdrawal, fillRequest, getQueueDepth, pause, unpause
- `LoanRegistry`: mintLoan, updateMutable, setDefault, closeLoan, getImmutable, getMutable

**Bridge service backend:**
- POST origination request (EIP-712 signed payload)
- Sumsub webhook consumer
- Chainalysis API calls (on onboarding + pre-deposit re-screening)
- USYC NAV feed polling
- Platts / Argus price feed polling
- MPC vendor API (transaction preparation and policy-gated signing)

---

### Non-Functional Requirements

- **Backing invariant:** PLUSD totalSupply == USDC + USYC NAV + deployed loans + in-transit (drift thresholds: green <0.01%, amber 0.01–1%, red >1%)
- **Rate limits:** $10M/24h rolling, $5M per-tx (mint and LP payout)
- **USYC rebalancing caps:** $5M per-tx, $20M daily aggregate
- **USDC ratio targets:** 15% target, 10% lower band, 20% upper band
- **Deposit minimum:** 1,000 USDC
- **Chainalysis freshness:** 90-day window
- **Audit:** Tier 1 (Trail of Bits, ChainSecurity, OpenZeppelin, or equivalent) — ~470 lines custom code
- **Audit log retention:** lifetime of protocol
- **Real-time price polling:** ~15min market hours
- **MPC key storage:** HSM-backed KMS, 2-person operational access for rotation

---

### Deferred / Out of Scope

- Automated bank integration (repayment identification is manual)
- On-chain LTV oracle writes / automated enforcement triggers
- Loan vault contracts (collateral is off-chain)
- Withdrawal queue tier system (4-tier mechanism from white paper §9.2)
- GenTwo MTN issuance
- Multiple Loan Originators (pilot = Open Mineral only)
- Equity tranche on-chain representation
- Public bug bounty programme

---

### Open Items / Risks

- MPC vendor selection (Fireblocks vs BitGo) — pending RFI
- USYC issuer onboarding (critical-path dependency for MVP launch)
- On/off-ramp provider selection
- Chain selection (Ethereum vs Soroban)
- Commodity price data licensing (S&P Global + LSEG)
- Trust Company correspondent bank confirmation
- Risk Council membership finalisation
- Weekly yield reference time (working: 17:00 America/New_York Thursday)
- OET allocation rate (0.05–0.10%)
- CCR threshold levels (working values in §9.6)

---

## Proposed Directory Layout

```
pipeline/
├── CLAUDE.md
├── AGENTS.md
├── ARCHITECTURE.md
├── docs/
│   ├── design-docs/
│   │   ├── index.md
│   │   ├── core-beliefs.md
│   │   ├── split-rail-architecture.md
│   │   ├── bridge-security-model.md
│   │   └── whitelist-enforcement-model.md
│   ├── exec-plans/
│   │   ├── active/
│   │   │   └── harness-init.md   ← this file
│   │   ├── completed/
│   │   ├── known-bugs.md
│   │   └── tech-debt-tracker.md
│   ├── generated/
│   │   └── .gitkeep
│   ├── product-specs/
│   │   ├── index.md
│   │   ├── user-stories.md
│   │   ├── lp-onboarding.md
│   │   ├── deposits.md
│   │   ├── staking.md
│   │   ├── loans.md
│   │   ├── yield.md
│   │   ├── withdrawals.md
│   │   ├── smart-contracts.md
│   │   ├── bridge-service.md
│   │   ├── operations-console.md
│   │   ├── price-feed.md
│   │   ├── dashboards.md
│   │   └── audit-logging.md
│   ├── references/
│   ├── PLANS.md
│   ├── PRODUCT_SENSE.md
│   ├── QUALITY_SCORE.md
│   ├── RELIABILITY.md
│   ├── SECURITY.md
│   └── FRONTEND.md
├── .claude/
│   ├── settings.json
│   └── skills/
│       ├── issue/SKILL.md
│       ├── pr/SKILL.md
│       ├── pipeline-continue/SKILL.md
│       ├── pipeline-audit/SKILL.md
│       ├── test-fast/SKILL.md
│       └── test/SKILL.md
├── scripts/
│   └── lint-docs.ts
└── .github/
    └── workflows/
        ├── lint.yml
        └── tests.yml
```

---

## Product Spec Decomposition

| Spec file | Domain | Approx. features |
|-----------|--------|-----------------|
| lp-onboarding.md | LP Onboarding & Compliance | 8 features |
| deposits.md | Deposits & PLUSD Minting | 9 features |
| staking.md | Staking (sPLUSD) | 5 features |
| loans.md | Loan Management | 12 features |
| yield.md | Yield Distribution & Waterfall | 11 features |
| withdrawals.md | Withdrawals | 10 features |
| smart-contracts.md | Smart Contract Surface | 6 contracts, interfaces |
| bridge-service.md | Bridge Service | 10 responsibilities |
| operations-console.md | Operations Console | 15 features across 3 roles |
| price-feed.md | Price Feed & Notifications | 8 features |
| dashboards.md | Dashboards | 4 panels |
| audit-logging.md | Audit Logging | 4 features |

**Total: 12 product specs, ~105 discrete features, estimated 80–100 user stories**

---

## Ambiguities / Questions for User

1. **GitHub repo:** What is the GitHub org/repo slug (e.g., `pipeline-protocol/pipeline`)? Needed for AGENTS.md and skill templates.
2. **Backend language:** The PRD implies a Node.js/TypeScript backend (EQ LAB prior work, ethers.js). Is this confirmed? Affects the doc linter language and test commands.
3. **Frontend framework:** RainbowKit implies React. Is the frontend TypeScript/React? Is there a monorepo structure planned (e.g., Turborepo, pnpm workspaces)?
4. **Indexer:** The EQ LAB custom indexer — is it a separate service/repo or part of this repo?
5. **Lint command:** What lint command does this project use (or will use)? Default placeholder: `yarn lint`.
