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
