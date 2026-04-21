# RELIABILITY

## Performance targets

See [`QUALITY_SCORE.md`](./QUALITY_SCORE.md) for latency and availability targets.

## Scaling path

**MVP (pilot):**
- Single originator (Open Mineral AG), estimated ≤ 10 active loans
- LP pool size: accredited investors, regulated by on-chain rate limits
- Bridge service: single-instance, stateless restart (rebuilds deposit queue from Transfer log delta)

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
| Weekly yield distribution missed | worker | If not signed by Thursday 20:00 ET → red alert |
| Price feed polling gap > 2h | worker | On-call Slack |
| AIS blackout > 12h | worker | Originator + Trustee + Team |
| Bridge auto-sign failure | worker | Immediate on-call page |

## Audit log reliability

The append-only audit log is mirrored in near-real-time to a third-party log sink (trustee-managed cloud account or SIEM). Write access to the sink is append-only — the bridge service cannot delete or modify historical entries. Retention: lifetime of the protocol.

## Disaster recovery

| Scenario | Recovery path |
|----------|--------------|
| Bridge service crash | Restart; rebuilds deposit mint queue from on-chain Transfer log delta |
| Bridge signing key compromise | Rotate HSM-backed KMS key (2-person operational access); MPC vendor re-keys the Capital Wallet participant |
| Smart contract pause | Foundation multisig 2-of-5 fast-pause via Risk Council; resume requires same threshold |
| MPC vendor outage | Trustee + team can co-sign manually via vendor's offline key ceremony path |

## Known scaling limits

- Deposit mint queue is backend-only (no on-chain state) — single bridge instance is the bottleneck at high deposit volume. Phase 2: distributed queue.
- LoanRegistry on-chain queries are unbounded in the MVP — a pagination layer is needed at >100 active loans.
- Price feed polling is single-threaded per commodity — parallel polling required at >20 active loan commodities.
