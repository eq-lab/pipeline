---
title: Potential risks
order: 33
section: Potential risks
---

# Potential risks

Yield on Pipeline comes from real commodity trade loan repayments and realised T-bill yield on USYC. Every yield line carries matching risk. Read this page before depositing.

Pipeline's risks fall into seven categories. For each, this page states the exposure, the mitigation, and the residual you are accepting by participating.

## Credit risk

#### What it is

A borrower defaults. Cargo cannot be recovered or recovery is delayed. Loss flows through the loss waterfall.

#### What mitigates it

- The asset class has historic default rates below 0.3% across decades — among the safest secured lending products in commerce
- Collateral Coverage Ratio thresholds: 130 is the healthy floor, 120 triggers amber-stage monitoring, and 110 triggers red-stage action including accelerated remediation
- Every loan underwritten by an Originator with their own equity at risk (up to 30% first-loss)
- Risk committee approves every facility against the published Credit Policy
- Daily LTV monitoring against independent price oracles
- Pre-onboarded liquidators and an established Partner Liquidation Network for fast collateral resale
- Concentration limits cap exposure to any single deal, borrower, offtaker, or Originator

#### What remains

In the rare case where loss exceeds the equity tranche on a facility, residual flows to the next protection layer. Concentration limits keep this exposure small. Beyond the equity tranche, PLIOU (planned beyond MVP) provides a second contingent layer before any haircut reaches lender principal.

## Liquidity risk

#### What it is

A burst of withdrawal requests exceeds the Withdrawal Queue Wallet balance. Lenders wait for top-ups.

#### What mitigates it

- 15% USDC buffer in the Capital Wallet (band 10–20%) sized so routine withdrawals never force a USYC sale
- Withdrawal Queue Wallet topped up routinely against the queue's outstanding obligations
- Short-duration loan book (30–180 days) means principal recycles fast
- USYC reserve is highly liquid — Hashnote redemption rail accommodates partial sales

#### What remains

A withdrawal large enough to require USYC sale will wait approximately one day for redemption settlement. Larger requests can take longer. The protocol always pays out — the question is latency, not principal.

## Custody risk

#### What it is

A cosigner key compromise, a custody-policy failure, or an institutional-vendor incident.

#### What mitigates it

- BitGo institutional MPC — no single share is a complete signing key
- 3-of-5 cosigner threshold with hard policy rule requiring both Team and Trustee participation
- Two External Counterparties make Team-only or Trustee-only quorums impossible
- Hardware circuit breaker that disconnects the Capital Layer on alarm; BitGo cannot pull this lever
- Three separate wallets isolating lender deposits, fees, and queued withdrawals

#### What remains

Three of five cosigners would need to collude. Given the topology — Team, Trustee, two independent external counterparties — collusion at this scale would require coordination across legally and operationally separate organisations.

## Smart-contract risk

#### What it is

A bug in protocol contracts. Unintended state transitions. Exploitable code paths.

#### What mitigates it

- Split-rail architecture — lender USDC sits in off-chain custody, never inside a contract
- Two-step screened deposits with attestation, two-party yield mints, queue aggregate enforcement
- Multiple independent audits (see [Audits & addresses](/technical/audits-and-addresses/))
- AccessManager-mediated upgrade path — every change runs through ADMIN's 3-day standard / 7-day upgrade timelock with GUARDIAN veto
- Hardware circuit breaker available to disconnect the Capital Layer on alarm

#### What remains

A contract bug cannot drain Capital Layer dollars. Worst-case outcome is denial of service — deposit pause, yield-mint pause, withdrawal pause — until ADMIN re-grants under timelock. Capital is preserved; only operations interrupted.

## Governance risk

#### What it is

A captured ADMIN, RISK_COUNCIL, or GUARDIAN MPC pushes through a hostile change.

#### What mitigates it

- Distinct signer sets across the three MPCs
- ADMIN 3-day standard / 7-day upgrade timelock with 14-day meta-timelock on the delay parameter
- RISK_COUNCIL 3-day timelock
- GUARDIAN can cancel any pending scheduled action in either window
- GUARDIAN cannot grant roles, unpause, upgrade, or move funds — defensive only

#### What remains

A captured GUARDIAN can grief — pause, cancel, revoke — but cannot escalate. A captured ADMIN waits 3 days standard (7 for upgrades), with GUARDIAN holding veto, and 14 days to even shorten that delay. A captured RISK_COUNCIL is similarly bounded by its 3-day window. Every governance action publicly visible during its delay window.

## Regulatory risk

#### What it is

Regulatory classification, jurisdictional authority, or sanctions regime evolves in a way that affects the protocol.

#### What mitigates it

- Engagement with leading legal counsel (Reed Smith, Carey Olsen) on Cayman / BVI structure
- Permissioned-only access — every lender deposit is KYT-ed; no anonymous capital
- Sanctions screening on every counterparty (borrower, offtaker, CMA, vessel) on origination and continuously
- Jurisdictional eligibility list maintained on the [Legal](/references/legal/) page

#### What remains

Regulatory regimes can change. Pipeline's structure is built to adapt — the trust hierarchy can be supplemented, the eligibility list revised, the operational stack migrated under governance. Permissioned access means the protocol does not have to retrofit compliance.

## Operational risk

#### What it is

Key compromise, vendor incident, integration error, or a bad on-call shift.

#### What mitigates it

- Hardware-backed key custody for operational keys (Relayer, Trustee attestor)
- Rate-limited attestation signing with anomaly detection
- Independent reconciliation oracle separate from the Relayer
- On-call rotation with SLA-bounded response to drift and incident events
- GUARDIAN can revoke any operational-role holder instantly

#### What remains

A compromise produces denial of service or, in the worst case, a bounded queue claim against Withdrawal Queue Wallet (capped by `totalClaimable`). Capital cannot be drained. GUARDIAN contains within minutes; ADMIN restores service under the 3-day timelock (7 days for upgrade-class fixes).

<div class="callout safety">
  <h4>The shape of the risk profile</h4>
  <p>Pipeline is not risk-free. Trade finance carries credit risk. The architecture is designed so the residual after every mitigation is bounded and well-understood. The asset class has stayed below 0.3% loss rates for decades.</p>
</div>
