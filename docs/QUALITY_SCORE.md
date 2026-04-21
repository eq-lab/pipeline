# QUALITY SCORE

MVP quality bars. All targets must be met before mainnet launch.

## Backing invariant

| Status | Drift threshold |
|--------|----------------|
| Green | < 0.01% |
| Amber | 0.01% – 1.0% |
| Red | > 1.0% |

Amber and red states trigger an immediate alert to the on-call channel and to the trustee. The invariant is evaluated after every deposit, yield mint, loan disbursement, repayment, and withdrawal.

## Latency targets

| Operation | Target |
|-----------|--------|
| API p50 | ≤ 100ms |
| API p95 | ≤ 500ms |
| On-chain event → bridge action | ≤ 30s |
| Reconciliation invariant publish after state change | ≤ 60s |
| LP withdrawal (within automated bounds, USDC available) | ≤ 10 min |

## Frontend performance

| Metric | Target |
|--------|--------|
| LCP | ≤ 2.5s |
| FID / INP | ≤ 100ms |
| Initial JS bundle | ≤ 250 kB gzipped |

## Availability

| Service | Target |
|---------|--------|
| API + Worker | 99.9% monthly uptime |
| Weekly yield distribution (Thursday) | Zero missed distributions |
| Price feed polling | ≥ 95% of scheduled ticks delivered |

## Test coverage

| Package | Threshold |
|---------|-----------|
| `packages/worker` (bridge logic, waterfall, CCR) | 100% line coverage for core domain logic |
| `packages/api` (endpoint handlers) | 100% for auth and fund-transfer endpoints |
| Smart contracts | 100% branch coverage via Foundry/Hardhat test suite |
| `packages/frontend` | Unit tests for all calculation utilities |

## Smart contract audit

- Tier 1 auditor (Trail of Bits, ChainSecurity, OpenZeppelin, or equivalent)
- Scope: all 5 custom contracts (~470 lines custom code)
- Zero critical or high findings unresolved at launch

## Rate limits (enforced on-chain)

| Limit | Value | Configurable by |
|-------|-------|----------------|
| Rolling 24h mint | $10M | Foundation multisig |
| Per-tx mint cap | $5M | Foundation multisig |
| Rolling 24h LP payout | $10M | Foundation multisig |
| Per-tx LP payout cap | $5M | Foundation multisig |
| Per-tx USYC swap | $5M | Foundation multisig |
| Daily aggregate USYC swap | $20M | Foundation multisig |
