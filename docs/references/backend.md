# Bridge Backend

**Scope:** Bridge service only — off-chain backend, indexer, yield co-signer, on-chain caller. Frontend and Trustee tooling are separate deliverables; Bridge exposes APIs they consume.
**Reference docs:** [`smart-contracts.md`](./smart-contracts.md) (contract spec v2.3), [`overview.html`](./overview.html) (architecture diagrams), [`security.md`](./security.md) (mint trust model + threat analysis)

---

## Identity

Bridge is the **off-chain backend** for the Pipeline protocol. It watches on-chain events, reconciles state, co-signs yield attestations, and submits operational transactions. It **never custodies USDC** — every dollar moves via the Capital Wallet (MPC) or directly from LP wallets.

**Deposits do not involve Bridge.** LPs deposit by calling the on-chain `DepositManager.deposit(amount)` directly. The contract atomically pulls their USDC to Capital Wallet and mints PLUSD 1:1. Bridge observes the events for reconciliation but is not in the critical path.

On-chain roles held by Bridge's hot key:

| Role | Target contract | What it gates |
|---|---|---|
| FUNDER | WithdrawalQueue | `fundRequest(queueId)`, `skipSanctionedHead()` |
| WHITELIST_ADMIN | WhitelistRegistry | `setAccess(lp, approvedAt)`, `refreshScreening(lp, ts)` |
| YIELD_MINTER | PLUSD | `yieldMint(att, bridgeSig, custodianSig)` — additionally requires two EIP-712 signatures verified on-chain |

Bridge also operates a **separate yield-signing key** whose address is registered on PLUSD as `bridgeYieldAttestor`. This key signs EIP-712 `YieldAttestation` structs that PLUSD verifies on-chain alongside the custodian's EIP-1271 signature. Neither Bridge alone nor the custodian alone can mint yield — both signatures are required.

Bridge has **no role on LoanRegistry**. All loan NFT writes (mint, amend, close) are done by the Trustee key directly.

Bridge has **no role in the deposit flow**. `MINT_ATTESTOR` is retired (spec v2.3) — deposits are atomic on-chain via DepositManager, which pulls USDC from LP wallets straight to Capital Wallet and mints PLUSD 1:1.

## Scope deviations vs. originator source spec

The v2.3 design deliberately diverges from Pipeline_MVP_Technical_Spec_v0_3_8.docx on a few points, all confirmed with the originator:

| Source-spec item | v2.3 decision | Rationale |
|---|---|---|
| Partial fills on WithdrawalQueue | **Dropped.** WQ uses full-amount `fundRequest` only. | Simplification per v2.0 S2. |
| `cancelWithdrawal(queue_id)` by LP | **Not in MVP.** Queue is one-way once submitted. | Product scope for MVP. |
| Backend FIFO queue for over-rate-limit deposits | **Dropped.** Over-cap deposit reverts at the contract; LP retries later. | No Bridge-side queue; rate limits enforced on-chain. |
| Weekly USYC yield cron with Trustee signature | **Replaced with lazy mint on stake/unstake.** | Same two-party attestation model as repayment yield. |
| Bridge cosigns loan disbursement | **Out of Bridge scope.** Disbursements are Trustee + Team cosigned directly on Capital Wallet (custodian MPC), no Bridge flow. | Separation of duty — Bridge is never in the disbursement signing path. |
| Bridge manages USDC↔USYC rebalancing | **Out of Bridge scope.** Custodian MPC policy engine + Trustee manage the band. | Custodian abstraction (see 2026-04-16 decisions). |

---

## Part 1 — Service Business Logic

Five core flows, one monitoring concern. Each flow: trigger → validation → action → on-chain effect.

### Flow 1: Deposit Observation (no Bridge action required)

```
LP calls                       DepositManager pulls USDC        PLUSD.mintForDeposit
DepositManager.deposit  ─────► LP → Capital Wallet     ──────►  mints 1:1 to LP
(one atomic tx)                                                  cumulativeLPDeposits++
                                                                       │
                                                                       ▼
                                                       Bridge indexes events
                                                       (reconciliation only)
```

Deposits are entirely on-chain and user-driven. Bridge is not a signer, not a gate, not in the critical path. The DepositManager contract enforces whitelist, reserve invariant, hard supply cap, and all rate limits. Any revert rolls the whole tx back atomically.

**Bridge's job on deposits:**

1. Index the events below and persist to the `deposit` table.
2. Reconcile: the sum of `DepositManager.Deposited.amount` events must equal `PLUSD.cumulativeLPDeposits()`. Any drift is a bug or indexer lag — alert ops.
3. Maintain per-LP deposit address history for the custodian's withdrawal-destination-matching policy (R2 in the spec).
4. Expose deposit history + status via the LP-facing API.

**Events to index (deposit-relevant):**

| Contract | Event | Why |
|---|---|---|
| DepositManager | `Deposited(lp, amount)` | Primary source of truth for deposits |
| USDC | `Transfer(lp, capitalWallet, amount)` | Cross-check — custodian reconciliation |
| PLUSD | `Transfer(0x0, lp, amount)` (mint path) | Cross-check — contract mint confirmation |

**Inflow classification (for Capital Wallet USDC receipts).** Bridge still classifies incoming USDC to Capital Wallet, because not every transfer is a deposit. Used for reconciliation and yield-flow triggers:

| Sender | Classification | Action |
|---|---|---|
| DepositManager | Deposit settlement | Already handled by `Deposited` event |
| On-ramp settlement address | Repayment inflow | Trigger yield flow (Flow 3) |
| USYC redemption sink | Rebalance inflow | Update balance tracking only |
| Unknown | Quarantine | Alert ops, do not auto-process |

**Rate-limit surfaces for the frontend.** The deposit UI needs live rate-limit state to show deposit caps before the LP submits. Bridge exposes the on-chain PLUSD state (`maxPerWindow`, `maxPerLPPerWindow`, current window usage, per-LP current usage) via read-only API — it does not gate deposits itself.

**No mint queue, no attestation signing, no reissuance.** Everything that was Bridge's responsibility on deposits in v2.2 is gone in v2.3.

### Flow 2: Withdrawal Queue Funding

```
WithdrawalRequested event          Bridge checks queue head      Bridge calls on-chain
(from WQ contract)    ──────────►  whitelist, balance    ──────► WQ.fundRequest(queueId)
                                                                      │
                                   LP de-whitelisted?                 ▼
                                   ──► skipSanctionedHead()    USDC: Capital Wallet → WQ
                                                               via pre-approved allowance
```

**Trigger.** `WithdrawalRequested(queueId, requester, amount)` event from WithdrawalQueue contract.

**Decision logic at queue head (`nextToFund`):**

```
read nextToFund from WQ
  │
  ├─ isAllowed(requester)?         ← on-chain check, no freshness
  │    ├─ YES
  │    │    ├─ screening fresh?    ← Bridge-side check via Chainalysis
  │    │    │    ├─ YES → check Capital Wallet USDC balance
  │    │    │    │          ├─ sufficient → fundRequest(queueId)
  │    │    │    │          └─ insufficient → request USYC redeem, retry after
  │    │    │    │
  │    │    │    └─ STALE → refreshScreening(lp, newTs) first, then fund
  │    │    │               if Chainalysis returns flagged → revokeAccess, then skip
  │    │    │
  │    │    └─ (screening stale AND Chainalysis unreachable)
  │    │         → alert ops, do NOT fund, do NOT skip
  │    │           this is a stuck-head state requiring manual intervention
  │    │
  │    └─ NO → skipSanctionedHead()
  │
  └─ loop: after funding/skip, re-check nextToFund
```

**Stale-screening-at-head problem.** On-chain `isAllowed` does not check freshness — only `isAllowedForMint` does. `skipSanctionedHead` requires `!isAllowed`, so it reverts on a stale-but-not-revoked LP. Bridge's resolution path: call `refreshScreening(lp, newApprovedAt)` to update the timestamp, then proceed with `fundRequest`. If re-screening returns a sanction flag, Bridge calls `revokeAccess` first, then `skipSanctionedHead`. If Chainalysis is unreachable, the head is stuck — alert ops for manual `adminRelease(Pending)` via the ADMIN Safe.

**USYC liquidity management.** Per spec §15, USYC auto-allocation of idle capital is managed by the **custodian's MPC policy engine**, not by Bridge. Bridge's responsibility is limited to: when funding a withdrawal and Capital Wallet USDC balance is insufficient, Bridge **requests** a USYC → USDC redemption through the MPC custody API. The custodian executes. Bridge does not autonomously manage the USDC/USYC ratio — it only reacts to insufficient balance at funding time.

**Funding mechanics.** Bridge calls `WQ.fundRequest(queueId)`. The WQ contract pulls USDC from Capital Wallet via `usdc.transferFrom(capitalWallet, WQ, amount)` — a pre-existing allowance. Bridge doesn't move USDC itself; it triggers the pull.

### Flow 3: Repayment Yield Distribution

```
Repayment USDC inflow       Bridge proposes         Custodian co-signs      Bridge submits
detected on Capital Wallet  YieldAttestation  ────► (EIP-1271)       ────►  yieldMint(att, bSig, cSig)
(classified from Flow 1)    (EIP-712 sig)                                   PLUSD verifies both
```

**On-chain reality (v2.3).** `PLUSD.yieldMint(att, bridgeSig, custodianSig)` is `restricted(YIELD_MINTER)` **and** verifies two EIP-712 signatures on-chain: Bridge's ECDSA signature over the `YieldAttestation` struct, and the custodian's EIP-1271 `isValidSignature` return. All three must pass — the role gate on the caller, the Bridge signature, and the custodian signature. The destination is also constrained to `sPLUSD vault` or `Treasury`. Three independent controls mean compromising any single party mints zero PLUSD.

**Attestation struct:**

```
YieldAttestation {
  bytes32 repaymentRef;   // keccak256(abi.encode(chainId, repaymentTxHash, destinationTag))
                          // destinationTag = "vault" or "treasury" (bytes32)
                          // — deterministic, one PER DESTINATION per repayment
  address destination;    // vault OR treasury
  uint256 amount;         // minted amount in PLUSD's 6 decimals
  uint64  deadline;       // Unix timestamp, attestation expiry
  uint256 salt;           // random entropy — allows reissuance if sig lost in transit
}
```

The encoding must match smart-contracts.md byte-for-byte (`abi.encode` is load-bearing — Bridge signing code must use the same encoding the contract verifies). The EIP-1271 magic value the contract checks from the custodian signer is `0x1626ba7e` — custodian stubs must return exactly this on valid sigs.

**Replay protection.** PLUSD maintains `usedRepaymentRefs` mapping. Each attestation is valid exactly once (first `yieldMint` call consumes the ref). Vault and treasury legs are built with **distinct refs** per destination: `keccak256(chainId, repaymentTxHash, "vault")` and `keccak256(chainId, repaymentTxHash, "treasury")`. Both legs can be submitted independently and retry cleanly.

**Reissuance after a failed submission.** The attestation's `repaymentRef` stays the same (the contract hasn't consumed it yet — the tx reverted). Bridge requests a fresh Bridge sig + custodian co-sig on the same struct with a new `salt` and `deadline`, and resubmits. If the contract already consumed the ref (e.g. Bridge's view of the world was wrong), the whole distribution is over for that destination.

**Workflow:**

1. **Detect.** Bridge indexes USDC inflow to Capital Wallet; classifier (Flow 1 table) identifies it as a repayment.
2. **Reconcile.** Bridge matches the inflow to a loan via the on-ramp metadata (out-of-band mapping — not on-chain).
3. **Propose.** Trustee provides final split amounts for vault and treasury via `POST /v1/trustee/repayments/{id}/approve`. (Waterfall computation is not in MVP scope — Trustee computes off-chain; Bridge executes.)
4. **Bridge signs.** Signer service constructs the two `YieldAttestation` structs (one for vault, one for treasury) and signs each with `bridgeYieldAttestor` key.
5. **Custodian co-signs.** Bridge posts the structs + Bridge sigs to the custodian's Co-Signer / Policy Engine. Custodian independently verifies:
   - USDC inflow actually arrived at Capital Wallet (custodian's own ledger)
   - Amount matches the attestation
   - Destination is an approved system address (vault / treasury)
   The custodian's EIP-1271 contract returns a second signature.
6. **Submit.** Bridge calls `PLUSD.yieldMint(att, bridgeSig, custodianSig)` via the tx outbox. PLUSD verifies both sigs, checks reserve invariant, checks hard supply cap, mints to destination.
7. **Confirm.** On confirmed receipt, mark the `yield_attestation` record as `confirmed` and advance any dependent state.

**Partial-failure recovery.** Vault and treasury are two separate `yieldMint` calls. If the first succeeds and the second reverts, Bridge retries the failed leg with the same attestation (still valid — not yet replayed). If the attestation's `deadline` has passed, Bridge requests a fresh custodian co-sig with a new `salt` and resubmits.

**Custodian integration surface (implementation detail):**

- API endpoint for co-sign request (Fireblocks Co-Signer Callback Handler, BitGo webhook, or equivalent).
- Timeout handling: if custodian does not respond within N minutes, alert ops; Bridge cannot submit without both sigs.
- Retry semantics: idempotent on `repaymentRef`.

**Waterfall data source.** Not in MVP scope. Trustee provides final amounts. Post-MVP the spec will define a `loan_terms` store for on-chain-anchored fee rates.

### Flow 4: USYC Yield Distribution (lazy, stake/unstake-triggered)

```
Stake or unstake        Bridge reads USYC NAV    Bridge + custodian     Bridge submits
action detected   ────► from Hashnote API  ────► co-sign YieldAttest ──► yieldMint × 2
                        computes delta           (same as Flow 3)         advance baseline
```

USYC grows in price; sPLUSD share price only moves when `yieldMint` runs. To keep the share price current without a cron, yield is minted **lazily** on every stake/unstake action. Same two-party attestation model as Flow 3.

**Trigger.** `sPLUSD.Deposit` or `sPLUSD.Withdraw` event indexed. Before processing the user action downstream, Bridge checks whether a yield mint is due.

**Steps:**

1. Read current USYC NAV from Hashnote API (`https://usyc.hashnote.com/api/price`; historical: `/api/price-reports`).
2. Compute `yield_delta = current_NAV - last_minted_NAV` (USDC terms, applied to Capital Wallet USYC holdings).
3. If `delta <= 0`: skip. No mint needed.
4. If `delta > 0`: apply split ratio (governance-controlled parameter, read from chain or config store). Build two `YieldAttestation` structs (vault + treasury). Refs are `keccak256("usyc-yield", chainId, navTimestamp, "vault")` and `keccak256("usyc-yield", chainId, navTimestamp, "treasury")` — same per-destination scoping pattern as Flow 3.
5. Get Bridge sig + custodian co-sig (same integration path as Flow 3).
6. Submit both `yieldMint` calls via tx outbox.
7. **Only after both txs confirmed:** advance `last_minted_NAV` baseline in the `nav_snapshot` table.

**Partial-failure recovery.** Same as Flow 3. If one leg fails, retry with fresh custodian co-sig. Until both legs confirm, baseline does not advance. Next stake/unstake trigger tries again against the unchanged baseline — idempotent.

**Continuous tracking for UI.** Between mints, Bridge polls USYC NAV (e.g. every minute) and exposes accrued-but-undistributed yield via read API for the dashboard. This is display-only — not an on-chain signal.

### Flow 5: Whitelist Management

**Trigger.** Sumsub webhook (KYC approval) or admin action.

Bridge verifies Chainalysis address screening is clean and current, then calls `WhitelistRegistry.setAccess(lp, approvedAt)` on-chain. LP record stored locally with KYC metadata (approval date, screening expiry, provider ref).

**Ongoing.** Bridge periodically re-checks Chainalysis screening freshness for all whitelisted LPs (batch job, configurable interval). Expired screening (> 90 days) triggers `refreshScreening(lp, newTs)` on-chain if re-screening passes, or `revokeAccess(lp)` if flagged.

### Reserve Reconciliation (the full backing invariant)

PLUSD's on-chain `reserveHealth()` view checks internal consistency — `totalSupply ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns`. That is necessary but not sufficient for an LP: it proves the contract's own ledger is balanced, not that custodian reserves actually back the supply.

Bridge publishes a **fuller backing invariant** off-chain, per source spec §5.6:

```
PLUSD totalSupply  ==  USDC in Capital Wallet
                    +  USYC NAV in Capital Wallet
                    +  USDC out on loans (deployed senior principal, not yet repaid)
                    +  USDC in transit (on-ramp leg, either direction)
```

**Inputs Bridge assembles:**

| Term | Source |
|---|---|
| `USDC in Capital Wallet` | Custodian API (current balance) |
| `USYC NAV in Capital Wallet` | Hashnote NAV API × Capital Wallet USYC holdings (custodian API) |
| `USDC out on loans` | Sum of active `loan_mirror` entries where `status ∈ {Active, Watchlist, Default-pending}` at `principal` |
| `USDC in transit` | On-ramp / off-ramp queue state (off-chain) |
| `PLUSD totalSupply` | PLUSD `totalSupply()` on-chain |

**Evaluation cadence.** After every: deposit event, withdrawal claim, yield mint, loan disbursement, repayment inflow.

**Publishing.** Result exposed via `GET /v1/protocol/reserve-reconciliation` and on the protocol dashboard with a status indicator:

| Drift | Status | Action |
|---|---|---|
| `< 0.01%` | **Green** | Normal — no action |
| `0.01% – 1%` | **Amber** | Alert on-call channel + Trustee. Investigate before next sensitive operation. |
| `> 1%` | **Red** | Page on-call + Trustee. Consider pausing `DepositManager` pending investigation. Trip Guardian if sustained. |

The watchdog (security.md Layer 3) consumes this feed. Divergence that cannot be explained within minutes is a Guardian-trip recommendation.

**Intentional gap.** The contract-level invariant (`reserveHealth()`) and this full backing invariant are **different invariants**. Both must hold. The former is self-consistency; the latter is real backing. A contract bug or counter desync shows up in the former; a custodian discrepancy or missing loan tracking shows up in the latter.

### Monitoring (cross-cutting)

| What | Source | Action |
|---|---|---|
| All contract events | QuickNode indexer | Persist, reconcile, alert on anomalies |
| Reserve-invariant headroom | PLUSD `reserveHealth()` view | Alert when headroom < threshold — hard cap approach |
| Capital Wallet balance | On-chain USDC + USYC | Dashboard data, funding-time balance check |
| Rate-limit window state | PLUSD on-chain view (`maxPerWindow`, `windowMinted`, `maxPerLPPerWindow`, `lpWindowMinted`) | Read-only surface for deposit UI |
| Commodity prices | Platts/Argus API | Alert Trustee on CCR threshold crossing |
| Payout > $1M | Self (pre-fundRequest) | Alert to ops channel |
| On-chain invariants | WQ `invariantCheck()`, PLUSD `isFullyOperational()`, `reserveHealth()` | Alert on drift |
| Gas price | Network | Defer non-urgent txs above gas cap (see §Gas Strategy) |
| DepositManager events vs. PLUSD counters | Reconciliation job | Alert on drift between `Deposited` event sum and `cumulativeLPDeposits()` |

---

## Part 2 — Database & Data Storage Pipeline

### Event Indexer

**Stack.** QuickNode Ethereum node, custom indexer service.

**Finality model.** Use the `finalized` block tag (Ethereum PoS), not a block-depth heuristic. State-changing actions (yield mints, withdrawal funding, whitelist updates) operate on finalized events only. Unfinalized events populate dashboards with a "pending confirmation" label.

**Indexed events (minimum set):**

| Contract | Event | Why |
|---|---|---|
| DepositManager | `Deposited(lp, amount)` | Deposit detection (primary source) |
| USDC | `Transfer(*, capitalWallet, amount)` | Repayment detection, deposit cross-check, inflow classification |
| USDC | `Transfer(capitalWallet, *, amount)` | Outflow tracking, reconciliation |
| PLUSD | `Transfer(0x0, lp, amount)` | Mint confirmation (cross-check vs Deposited) |
| WithdrawalQueue | `WithdrawalRequested` | Flow 2 trigger |
| WithdrawalQueue | `WithdrawalFunded / WithdrawalClaimed / WithdrawalSanctionedSkip / WithdrawalAdminReleased` | Status tracking |
| PLUSD | `RateLimitsChanged / MaxTotalSupplyChanged` | Update local cache |
| PLUSD | `YieldAttestorsChanged` | Audit trail for key rotation |
| WhitelistRegistry | `LPApproved / ScreeningRefreshed / LPRevoked` | Whitelist sync |
| LoanRegistry | `LoanMinted / LoanUpdated / LoanClosed` | Local loan book mirror |
| sPLUSD | `Deposit / Withdraw` | Trigger lazy USYC yield (Flow 4) |
| ShutdownController | `ShutdownEntered` | Halt all normal flows |
| All pausable | `Paused() / Unpaused()` | Halt/resume flows |

**Reorg handling.** Indexer tracks `finalized` vs `latest` separately. Handlers only process finalized events for state-changing actions (signing, funding). `latest` events used for real-time dashboard data with a "pending confirmation" label.

### Data Model (logical entities)

```
┌─────────────────┐     ┌──────────────────┐
│ lp               │     │ deposit           │
├─────────────────┤     ├──────────────────┤
│ address (PK)     │────<│ id (PK)           │  — mirrors DepositManager.Deposited
│ kyc_status       │     │ lp_address (FK)   │    events. No attestation state —
│ kyc_provider_ref │     │ tx_hash           │    deposits are atomic on-chain.
│ screening_expiry │     │ amount            │
│ whitelisted_at   │     │ block_number      │
│ created_at       │     │ finalized         │
│ updated_at       │     │ indexed_at        │
└─────────────────┘     └──────────────────┘

┌──────────────────────┐     ┌─────────────────────────┐
│ withdrawal            │     │ yield_attestation        │
├──────────────────────┤     ├─────────────────────────┤
│ queue_id (PK)         │     │ id (PK)                  │
│ lp_address            │     │ repayment_ref (unique)   │
│ amount                │     │ destination              │
│ status                │     │  (vault | treasury)      │
│  (requested |         │     │ amount                   │
│   funding |           │     │ deadline                 │
│   funded |            │     │ salt                     │
│   claimed |           │     │ bridge_sig               │
│   sanctioned_skipped |│     │ custodian_sig            │
│   admin_released)     │     │ status                   │
│ requested_at          │     │  (pending_custodian |    │
│ funded_at             │     │   co_signed |            │
│ claimed_at            │     │   submitting |           │
│ created_at            │     │   confirmed |            │
└──────────────────────┘     │   failed | expired)      │
                              │ distribution_id (FK)     │
                              │ tx_hash (nullable)       │
                              │ created_at               │
                              └─────────────────────────┘

┌──────────────────────┐     ┌──────────────────────┐
│ yield_distribution    │     │ nav_snapshot          │
├──────────────────────┤     ├──────────────────────┤
│ id (PK)               │     │ id (PK)               │
│ type                  │     │ usyc_nav              │
│  (repayment | usyc)   │     │ usyc_holdings         │
│ loan_id (nullable)    │     │ yield_delta           │
│ vault_amount          │     │ captured_at           │
│ treasury_amount       │     │ distribution_id (FK)  │
│ status                │     │ is_baseline (bool)    │
│  (pending_trustee |   │     └──────────────────────┘
│   co_signing |        │
│   submitting |        │     ┌──────────────────────┐
│   partial |           │     │ loan_mirror           │
│   confirmed |         │     ├──────────────────────┤
│   failed)             │     │ loan_id (PK)          │
│ created_at            │     │ originator            │
└──────────────────────┘     │ borrower              │
                              │ principal             │
┌──────────────────────┐     │ commodity             │
│ loan_terms (post-MVP) │     │ status                │
├──────────────────────┤     │ ccr_bps               │
│ loan_id (PK, FK)      │     │ maturity              │
│ mgmt_fee_rate_bps     │     │ originated_at         │
│ coupon_rate_bps       │     │ closed_at             │
│ perf_fee_rate_bps     │     │ closure_reason        │
│ oet_rate_bps          │     │ last_synced_block     │
│ doc_hash              │     └──────────────────────┘
│ entered_by            │
│ entered_at            │
└──────────────────────┘

┌──────────────────────┐     ┌──────────────────────┐
│ indexed_event         │     │ tx_outbox             │
├──────────────────────┤     ├──────────────────────┤
│ id (PK)               │     │ intent_id (PK)        │
│ contract_address       │     │ method                │
│ event_name             │     │ target_contract       │
│ tx_hash                │     │ calldata              │
│ log_index              │     │ nonce (nullable)      │
│ block_number           │     │ tx_hash (nullable)    │
│ block_hash             │     │ status                │
│ finalized              │     │  (pending | submitted │
│ args (JSONB)           │     │   | confirmed |       │
│ processed              │     │   | reverted |        │
│ indexed_at             │     │   | replaced)         │
└──────────────────────┘     │ gas_price             │
                              │ retries               │
                              │ created_at            │
                              │ confirmed_at          │
                              └──────────────────────┘
```

**Removed from v2:** `mint_attestation`, `mint_queue`. Deposits are atomic on-chain; there is nothing to queue or sign on the deposit side.

### Transaction Outbox

The write-side reliability problem: Bridge must not lose transactions between decision and on-chain confirmation. The `tx_outbox` table implements the **outbox pattern**:

1. Business logic writes intent to `tx_outbox` with `status=pending` and a content-derived `intent_id` (idempotent).
2. Tx Submitter picks up pending intents, assigns nonce, submits to network, updates `status=submitted` + `tx_hash`.
3. Confirmation watcher matches on-chain receipts to outbox rows, updates `status=confirmed` or `status=reverted`.
4. On restart: submitter reconciles — checks `eth_getTransactionByHash` for all `submitted` rows, replays `pending` rows.

All outbound transactions (`fundRequest`, `yieldMint`, `setAccess`, `refreshScreening`, `skipSanctionedHead`) go through the outbox. Nonce management is centralized — the submitter is the sole writer to the EOA's nonce space.

Yield mint intents in the outbox carry the full `(YieldAttestation, bridgeSig, custodianSig)` payload in `calldata`. If a yield mint reverts (e.g. reserve-invariant tightening, hard cap breach), the failure is terminal — a new attestation with a fresh `salt` + fresh custodian co-sig is required.

### Data Pipeline

```
QuickNode node
      │
      ├─ latest blocks  ──► real-time dashboard data (unfinalized)
      │
      ├─ finalized blocks ──► indexed_event table
      │                              │
      │                        Reorg-safe (finalized = no reorgs)
      │
      ▼
 Event Router ────┬──────┬──────┬──────┬──────┬──────►  per event type
                  │      │      │      │      │
                  ▼      ▼      ▼      ▼      ▼
            Deposit   WQ     Yield   sPLUSD  Whitelist
            Handler  Handler Handler Handler  Handler
            (observe) (act)  (act)   (trigger)(act)
               │       │       │        │      │
               ▼       ▼       ▼        ▼      ▼
            deposit  withdrawal yield_   ─    lp table
            table    table      *        │
                                         ▼
                                  triggers Flow 4
                                  (yield mint)
                                        │
                                        ▼
                                   tx_outbox ──► Tx Submitter ──► Ethereum
```

**Handler responsibilities (v2.3):**
- **Deposit Handler:** pure observer, no tx output. Reconciles `DepositManager.Deposited` vs `PLUSD.cumulativeLPDeposits()`.
- **WQ Handler:** funds the queue head, handles stale-screening path, writes `fundRequest` / `skipSanctionedHead` / `refreshScreening` / `revokeAccess` intents to tx_outbox.
- **Yield Handler:** builds `YieldAttestation`, orchestrates Bridge sig → custodian co-sig → tx_outbox submission. Used by both Flow 3 (repayment) and Flow 4 (USYC).
- **sPLUSD Handler:** observes stake/unstake events, triggers Yield Handler's USYC flow if NAV delta > 0.
- **Whitelist Handler:** processes Sumsub webhooks, writes `setAccess` / `refreshScreening` / `revokeAccess` intents.

**Delivery guarantees.** At-least-once processing. Every handler is idempotent (keyed on `tx_hash + log_index`). The indexer persists the last finalized block number and resumes from there on restart.

---

## Part 3 — API Endpoints

### 3A. LP-Facing (consumed by Pipeline App frontend)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/lp/{address}/status` | LP profile: whitelist status, screening expiry, KYC status |
| `GET` | `/v1/lp/{address}/deposits` | Deposit history mirrored from `DepositManager.Deposited` events |
| `GET` | `/v1/lp/{address}/withdrawals` | Withdrawal history with queue position and status |
| `GET` | `/v1/queue/depth` | WQ stats: pending count, funded count, total escrowed, estimated wait |
| `GET` | `/v1/vault/stats` | sPLUSD share price, total assets, APY, accrued-undistributed yield |
| `GET` | `/v1/protocol/status` | Operational: paused contracts, shutdown state, rate-limit window |
| `GET` | `/v1/protocol/limits` | Current `maxPerWindow`, `maxPerLPPerWindow`, `maxTotalSupply`, window utilization, per-LP utilization — for deposit UI to display caps before the LP submits |
| `GET` | `/v1/protocol/reserve-health` | `reserveHealth()` view: backing, supply, headroom — for dashboard |

### 3B. Trustee-Facing (consumed by Trustee tooling)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/trustee/repayments/pending` | Detected repayments awaiting Trustee split decision |
| `POST` | `/v1/trustee/repayments/{id}/approve` | Submit Trustee's split amounts (vault / treasury) → triggers Bridge to build attestations and request custodian co-sig |
| `GET` | `/v1/trustee/yield/usyc/status` | Current NAV baseline, current NAV, accrued delta, current split ratio |
| `GET` | `/v1/trustee/loans` | Loan book mirror (post-MVP: + loan terms) |
| `GET` | `/v1/trustee/alerts` | Active alerts: CCR crossings, payment delays, screening expirations |

### 3C. Admin / Ops

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/admin/yield-attestations` | Pending yield attestations: status, co-sig state, stuck items |
| `POST` | `/v1/admin/yield-attestation/{id}/reissue` | Re-request custodian co-sig with fresh `salt` (deadline expired or sig lost) |
| `GET` | `/v1/admin/reconciliation` | Cross-check: `DepositManager.Deposited` sum vs `PLUSD.cumulativeLPDeposits()`; WQ state vs DB; etc. |
| `GET` | `/v1/admin/capital-wallet/balance` | USDC + USYC breakdown |
| `GET` | `/v1/admin/tx-outbox` | Outbox status: pending, submitted, stuck transactions |
| `POST` | `/v1/admin/tx-outbox/{id}/retry` | Manually retry a failed/stuck transaction |
| `GET` | `/v1/admin/health` | Service health: indexer lag, last finalized block, queue depths, custodian co-signer reachability |

### 3D. Dashboard Views

Read-only aggregations, exposed as SQL views or dedicated read endpoints.

| View | Content |
|---|---|
| `v_daily_deposits` | Per-day: count, total amount, avg amount, rate-limit utilization % |
| `v_daily_withdrawals` | Per-day: requested/funded/claimed, avg time-to-fund, avg time-to-claim |
| `v_yield_history` | Per-distribution: type, vault amount, treasury amount, NAV ref, date |
| `v_lp_positions` | Per-LP: deposited, withdrawn, net position |
| `v_loan_book` | Active loans, status breakdown, total principal outstanding |
| `v_yield_attestation_stats` | Time-to-cosign distribution, custodian error rate, expired-sig count |
| `v_capital_wallet_history` | Daily USDC/USYC balances, inflows, outflows |
| `v_tx_outbox_stats` | Tx success rate, avg confirmation time, gas spend |
| `v_reserve_health` | Time series of backing, supply, headroom |

---

## Part 4 — Service Architecture

### Decomposition

Bridge is described as a "single backend" for simplicity, but should be deployed as **separate internal services** sharing a Postgres database, communicating via internal RPC (gRPC or message queue). No service is internet-facing except the API Gateway.

```
                    ┌──────────────────────────────────────────────┐
                    │              Bridge Cluster                   │
                    │                                              │
 QuickNode ────────►│  ┌─────────────┐    ┌──────────────────┐    │
                    │  │ Indexer      │───►│ Postgres          │    │
                    │  │ (no keys)   │    │ (shared state)    │    │
                    │  └─────────────┘    └──────┬───────────┘    │
                    │                            │                 │
                    │  ┌─────────────┐    ┌──────┴───────────┐    │
                    │  │ Orchestrator│───►│ Tx Outbox         │    │
                    │  │ (no keys)   │    └──────┬───────────┘    │
                    │  └─────────────┘           │                 │
                    │                     ┌──────┴───────────┐    │
                    │                     │ Tx Submitter      │────►  Ethereum
                    │                     │ (holds Bridge EOA)│    │
                    │                     └──────────────────┘    │
                    │                                              │
                    │  ┌─────────────┐                            │
                    │  │ Signer      │  (holds bridgeYieldAttestor│
                    │  │ (HSM-backed)│   key — yield attestations │
                    │  └─────────────┘   only; no internet egress)│
                    │                                              │
                    │  ┌─────────────┐                            │
 Frontend ────────►│  │ API Gateway │  (reads DB, proxies to     │
 Trustee UI ──────►│  │ (no keys)   │   Orchestrator)            │
 Admin ───────────►│  └─────────────┘                            │
                    │                                              │
                    │  ┌────────────────────┐                     │
                    │  │ Custodian Co-Signer│────────────────────►  Custodian API
                    │  │ Client             │   (EIP-1271 co-sig) │  (yield only)
                    │  └────────────────────┘                     │
                    └──────────────────────────────────────────────┘
```

**Blast radius per compromise:**

| Service compromised | Can do | Cannot do |
|---|---|---|
| Indexer | Poison event data in DB | Sign attestations, submit txs, mint PLUSD |
| Orchestrator | Queue malicious yield-mint intents | Obtain custodian co-sig (so no yield mint possible) |
| Tx Submitter | Front-run tx queue, submit arbitrary txs | Forge Bridge yield sig; forge custodian sig; submit anything without EOA roles |
| Signer | Produce Bridge yield sigs without custodian co-sig | Mint PLUSD alone — still needs custodian EIP-1271 sig + YIELD_MINTER caller role |
| API Gateway | Leak read data, inject bad Trustee approvals | Sign, submit, or index |
| Custodian alone (external) | Produce a custodian sig | Mint PLUSD alone — still needs Bridge ECDSA sig + YIELD_MINTER caller role |

### Gas Strategy

| Priority | Transactions | Gas policy |
|---|---|---|
| Critical | `fundRequest`, `skipSanctionedHead` | Submit up to 2× market gas. Alert if base fee > configurable cap. |
| Normal | `yieldMint`, `setAccess`, `refreshScreening` | Submit at market gas. Defer if base fee > cap. Retry next block. |
| Deferrable | Batch whitelist updates | Wait for gas < threshold. No SLO. |

Gas cap, max retry count, and escalation thresholds are runtime config. Tx Submitter implements EIP-1559 fee estimation with configurable priority fee bounds. Stuck transactions (not mined after N blocks) are replaced with higher gas via the outbox.

### Contract Upgrade Handling

UUPS proxies mean the implementation behind a contract can change. If `PLUSD_Impl_v2` adds a new event or changes ABI, the indexer's parsing breaks. Strategy:

1. Bridge pins ABI per contract address in its config.
2. On upgrade (detected via `Upgraded(implementation)` event from the proxy), Bridge alerts ops.
3. Ops deploys updated Bridge with new ABI config. This is a coordinated deploy alongside the 48h upgrade timelock window — there is time to prepare.
4. The indexer tolerates unknown events (logs them raw, skips handler routing) rather than crashing.

### Key Rotation (yield-attestor keys)

Two yield-attestor addresses are registered on PLUSD: `bridgeYieldAttestor` (Bridge's signing EOA) and `custodianYieldAttestor` (custodian's EIP-1271 contract). Both are rotatable via `PLUSD.proposeYieldAttestors(newBridge, newCustodian)` + 48h timelock.

No scheduled rotation. Rotation is an emergency response to key compromise. During the 48h window both old and new addresses are registered at different times — Bridge's orchestration just continues to use whatever is currently active, and the custodian side operates analogously. Outstanding yield attestations signed by the old Bridge key remain valid until the execute-step lands on-chain; Bridge re-issues any unconfirmed attestation with the new key after rotation.

---

## Part 5 — Operational Concerns

### Observability

Structured JSON logging with correlation IDs spanning: on-chain event → indexer → handler → outbox → tx confirmation. Every flow produces metrics:

| Metric | Type | Granularity |
|---|---|---|
| `withdrawal_time_to_fund` | Histogram | Per withdrawal |
| `yield_attestation_cosign_latency` | Histogram | Per attestation (Bridge-signed → custodian-cosigned) |
| `yield_distribution_latency` | Histogram | Per distribution (event → confirmed on-chain) |
| `indexer_lag_blocks` | Gauge | Continuous |
| `reserve_health_headroom` | Gauge | Continuous (from PLUSD `reserveHealth()` view) |
| `deposit_counter_drift` | Gauge | Continuous (Deposited sum − cumulativeLPDeposits) |
| `tx_outbox_pending` | Gauge | Continuous |
| `tx_submission_errors` | Counter | Per tx type |
| `gas_spend_wei` | Counter | Per tx type |
| `custodian_cosign_errors` | Counter | Per error class |

Alerting tiers:

| Tier | Condition | Channel |
|---|---|---|
| Page | Indexer lag > 5 min, outbox stuck > 30 min, signer unreachable, custodian co-signer unreachable, shutdown detected, `deposit_counter_drift` ≠ 0, `reserve_health_headroom` below tight threshold | PagerDuty |
| Ticket | Failed tx after 3 retries, gas above cap for > 1h, Chainalysis API down, custodian co-sign errors > threshold | Slack + ticket |
| Info | Payout > $1M, attestation expired unsubmitted, screening refresh batch complete | Slack |

### SLOs

| Metric | Target | Measurement |
|---|---|---|
| Deposit confirmation → API-visible | p50 < 2 min, p99 < 5 min | From finalized block to `/v1/lp/{addr}/deposits` reflecting it |
| Withdrawal → funded | p50 < 5 min, p99 < 30 min (excluding USYC redeem) | From event to on-chain confirmation |
| Yield attestation co-sign round trip | p50 < 30s, p99 < 5 min | Bridge-signed → custodian-cosigned |
| Indexer lag | < 2 finalized blocks | Continuous |
| API availability | 99.9% | 30-day rolling |
| Yield distribution | Confirmed within 24h of Trustee approval | Per distribution |

### Secrets Management

| Secret | Storage | Rotation |
|---|---|---|
| `bridgeYieldAttestor` private key | HSM (AWS CloudHSM or custodian's key vault) | Via on-chain `proposeYieldAttestors` + 48h timelock |
| Bridge EOA private key (FUNDER / WHITELIST_ADMIN / YIELD_MINTER submitter) | HSM | Via role re-grant on AccessManager |
| Custodian co-signer API credentials | Vault (HashiCorp / AWS Secrets Manager) | Per custodian policy |
| Sumsub webhook HMAC key | Vault | On provider rotation |
| Chainalysis API key | Vault | Quarterly |
| Postgres credentials | Vault, rotated automatically | 90-day |
| Internal service mTLS certs | Cert manager (auto-provisioned) | 30-day auto-renew |

### Authentication

| Surface | Auth model |
|---|---|
| LP-facing (`/v1/lp/*`, `/v1/queue/*`, `/v1/vault/*`, `/v1/protocol/*`) | EIP-4361 (Sign-In-With-Ethereum) session token, proving LP controls the address. Rate-limited. |
| Trustee-facing (`/v1/trustee/*`) | mTLS + API key. Trustee tooling is a known internal client. |
| Admin (`/v1/admin/*`) | SSO + WebAuthn (hardware key). IP allowlist. |
| Internal services (Indexer ↔ Orchestrator ↔ Signer ↔ Submitter) | mTLS with auto-provisioned certs. No internet egress. |

### Disaster Recovery

**RPO/RTO targets.** RPO = 0 (Postgres streaming replication). RTO = 15 min (failover to hot standby).

**Full reconstruction from chain.** The database is fully reconstructible from on-chain events. Procedure: replay all indexed events from contract deployment block through the handlers. This is the "break glass" for catastrophic DB corruption. Estimated time: hours (depends on block range). Deposits, yield mints, withdrawals are all derivable from events. Per-LP deposit address history for custodian-side destination matching is also derivable.

**Indexer checkpoint.** Last finalized block number persisted in DB. On restart, resume from checkpoint. No risk of gap or double-processing (finalized events are stable, handlers are idempotent).

### Test Strategy

| Layer | Scope | Tool |
|---|---|---|
| Unit | Business logic (inflow classification, attestation construction, NAV baseline tracking, reconciliation math) | Standard test framework, mocked chain reads |
| Integration | Full flow: event → handler → outbox → mock tx submission | Anvil fork with deployed contracts |
| End-to-end | Deposit, withdraw, yield cycle against testnet deployment | Sepolia/Holesky with real contracts |
| Chaos | Kill indexer mid-flow, kill signer mid-sign, RPC flap, DB failover | Custom harness |
| Load | 10× expected peak: concurrent deposits, withdrawals, yield distributions | k6 or similar |

### Schema Migrations

Postgres migrations managed by a versioned migration tool (e.g. golang-migrate, Flyway, or framework-native). Breaking schema changes require a blue-green deploy plan. The tx_outbox and indexed_event tables are append-heavy — partition by month if volume warrants it.

---

## Decisions Required Before Implementation

These are not open items — they are **blocking decisions** that affect the implementation architecture.

| # | Decision | Options | Status | Owner |
|---|---|---|---|---|
| 1 | Deposit flow | Atomic DepositManager, no off-chain signer | Resolved (v2.3 spec) | — |
| 2 | Yield approval | Two-party EIP-712 verified on-chain (Bridge + custodian EIP-1271) | Resolved (v2.3 spec) | — |
| 3 | Waterfall computation / loan_terms store | Post-MVP. Trustee provides split amounts for MVP. | Deferred | Product + Trustee |
| 4 | USDC/USYC movements | Managed by Trustee at custodian; Bridge only requests at funding time | Resolved | — |
| 5 | Yield split parameter | On-chain governance parameter | Resolved (v2.3 spec M6) | — |
| 6 | Custodian provider | Business decision | No architectural impact | Product |
| 7 | USYC NAV source | Hashnote HTTP API | Resolved — `usyc.hashnote.com/api/price` | Dev |
| 8 | Service decomposition | Split from day 1 | Resolved | Dev + Security |
| 9 | Stale-screening resolution | Bridge auto-refreshes via Chainalysis; fallback alert ops | Resolved | Dev |
| 10 | Yield-attestor key rotation | `proposeYieldAttestors` emergency-only, custodian manages lifecycle | Resolved | — |
| 11 | `repaymentRef` for vault vs treasury | Resolved — distinct refs per destination: `keccak256(chainId, txHash, "vault")` and `keccak256(chainId, txHash, "treasury")` | Resolved | — |
| 12 | Custodian co-sign timeout behaviour | Bridge enforces client-side timeout (default 30min) → mark attestation expired, alert ops, require fresh request with new `salt`. Fireblocks also supports server-side TTL via policy engine (belt-and-suspenders); BitGo needs client-side enforcement. Same Bridge policy regardless of custodian. | Resolved | — |
| 13 | Initial cap parameters | `maxPerWindow`, `maxPerLPPerWindow`, `maxTotalSupply` launch values | **Open** — business decision informed by expected launch TVL and LP profile | Product + Risk |
