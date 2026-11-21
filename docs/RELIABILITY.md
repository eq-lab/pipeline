# RELIABILITY

## Performance targets

See [`QUALITY_SCORE.md`](./QUALITY_SCORE.md) for latency and availability targets.

## Scaling path

**MVP (pilot):**
- Single originator (Open Mineral AG), estimated ≤ 10 active loans
- LP pool size: accredited investors, regulated by on-chain rate limits
- Bridge service: single-instance, stateless restart (rebuilds state from finalized on-chain event logs)

**Phase 2 (production):**
- Multiple originators
- Horizontal scaling of API tier
- Worker sharding by event category if throughput requires

## Monitoring strategy

| Signal | Owner | Alert threshold |
|--------|-------|----------------|
| Reconciliation invariant | worker | Amber (0.01% drift) → on-call Slack |
| USDC ratio out of band | worker | Below 10% or above 20% → on-call Slack |
| Mint rate limit hit | worker | Any hit → info log; sustained → amber alert |
| LP payout above $1M | worker | Every occurrence → on-call Slack |
| Yield attestation custodian co-sign timeout | worker | If custodian does not respond within 30 min → red alert |
| Price feed polling gap > 2h | worker | On-call Slack |
| AIS blackout > 12h | worker | Originator + Trustee + Team |
| Bridge auto-sign failure | worker | Immediate on-call page |

## Audit log reliability

The append-only audit log is mirrored in near-real-time to a third-party log sink (trustee-managed cloud account or SIEM). Write access to the sink is append-only — the bridge service cannot delete or modify historical entries. Retention: lifetime of the protocol.

## Disaster recovery

| Scenario | Recovery path |
|----------|--------------|
| Bridge service crash | Restart; rebuilds state from finalized on-chain event logs (idempotent handlers) |
| Bridge signing key compromise | Rotate HSM-backed KMS key (2-person operational access); MPC vendor re-keys the Capital Wallet participant |
| Smart contract pause | GUARDIAN 2/5 Safe instant pause on all pausable contracts; resume requires same threshold |
| MPC vendor outage | Trustee + team can co-sign manually via vendor's offline key ceremony path |

## Known scaling limits

- Over-rate-limit deposits revert at contract; LPs retry when window headroom opens. No bridge-side queue — single bridge instance is not a deposit bottleneck.
- LoanRegistry on-chain queries are unbounded in the MVP — a pagination layer is needed at >100 active loans.
- Price feed polling is single-threaded per commodity — parallel polling required at >20 active loan commodities.

## Selective verification

`scripts/check-changes.sh` runs only the checks that the changed paths need: the diff since the merge-base with `origin/main` (or `CODING_FLOW_BASE_SHA`), plus staged files when `CODING_FLOW_CHECK_STAGE=commit` (the default). It is the gate for automated runners and can be run by hand. It prints the plan, runs every selected step even after a failure, and exits non-zero if any step failed.

| Changed paths | Checks |
|---------------|--------|
| `docs/**`, `*.md` only (outside `packages/mcp` and `specs/`) | doc lint |
| `packages/api`, `worker`, `shared`, `Cargo.*`, Rust config | `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`, `cargo nextest run --workspace` (falls back to `cargo test --all` with a warning), migration-version check for new migrations |
| `packages/ui` | comment lint, plus everything for `wallet-connect`, `frontend`, `trustee` |
| `packages/wallet-connect` | tests, plus everything for `frontend`, `trustee` |
| `packages/frontend` | comment lint, build (`tsc -b && vite build`), vitest |
| `packages/trustee` | comment lint, build, vitest |
| `packages/mcp`, `specs/` (Markdown included) | mcp typecheck, lint (ESLint and Prettier), 300-line check, hash guard of the spec tooling, spec run with the ratchet (`specs/README.md`) |
| root config (`package.json`, `yarn.lock`, `.yarnrc.yml`, `tsconfig*`), `scripts/`, `.github/`, `.husky/`, `Dockerfile`, `docker/`, any other path | everything above |

Doc lint and `yarn install --immutable` always run. With `CODING_FLOW_CHECK_STAGE=setup` the script only installs JS dependencies. `CARGO_TARGET_DIR` is respected, so worktrees can share one build directory. `integration` selects like `commit` but ignores staged files.
