---
title: Risks
order: 11
section: Risk & losses
---

<div class="callout risk">
Yield on Pipeline comes from real commodity trade loans and T-bill accrual. Every yield line carries matching risk. Read this page before depositing.
</div>

Pipeline's risks fall into seven categories. For each, this page states the exposure, the mitigation, and the residual you are accepting by participating.

## Credit risk

**What the risk is.** Commodity trade loans default. An originator can breach a covenant, the Collateral Coverage Ratio (CCR) can collapse, an offtaker can default on payment, or a commodity-price shock can wipe out collateral value mid-loan. Default losses land on the Pipeline balance sheet.

**What mitigates it.** Origination is diversified across corridors, commodities, and counterparties — no single loan is structurally allowed to dominate the book. CCR thresholds at 130, 120, and 110 drive staged notifications: 130 is the healthy floor, 120 triggers amber-stage monitoring, and 110 triggers red-stage action including accelerated remediation. Every loan is funded behind an Originator equity tranche that absorbs first-loss before any sPLUSD writedown. Payment-delay flags operate on the same ladder: 7 days amber, 21 days red.

**Residual.** If realised losses exceed the Equity tranche on a given loan, the remainder writes down sPLUSD share price — this is designed, not accidental. Severe systemic losses route to shutdown, at which point sPLUSD holders redeem at the ratcheted recovery rate rather than at par. Credit losses cannot be hedged away.

{% include chart.html src="c3-ccr-ladder.svg" caption="CCR thresholds. Not live protocol data." %}

See [Defaults and losses](/pipeline/defaults-and-losses/) for the full loss waterfall.

## Liquidity risk

**What the risk is.** Withdrawal timing is not instant. The Capital Wallet USDC buffer targets 15% of PLUSD supply (operating band 10–20%), but large or concentrated withdrawals can deplete it faster than it refills. Topping up the buffer from USYC takes roughly one day at the custodian. Withdrawal-queue funding is capped at $5M per transaction and $10M per rolling 24 hours.

**What mitigates it.** The withdrawal queue is strict FIFO — no priority lanes, no reordering. The Bridge auto-funds within the $5M/tx and $10M/24h envelope whenever the buffer falls below the target band. Above-envelope requests route to the team and trustee signing queue and clear on the next multi-sig window.

**Residual.** If your position is large relative to the buffer, your exit will stage across multiple windows. Concentration-sized deposits should plan exit timing in advance and not assume same-day liquidity on the full notional. There is no instant-redemption AMM — redemption is queue-based by design.

## Custody risk

**What the risk is.** The USDC underlying PLUSD sits at a regulated third-party custodian. The custodian is a counterparty — legally separate from Pipeline but still a single point of operational failure. Custody is not trustless.

**What mitigates it.** The Capital Wallet is a 2-of-3 MPC wallet with three independent cosigners: Trustee, Team, and Bridge. No single-key compromise can move USDC. Custodian-side policy caps per-LP cumulative outflow and enforces destination matching for lender payouts, so even a cosigner coalition cannot re-route funds to an arbitrary address. The custodian is regulated and subject to external audit.

**Residual.** A custodian operational failure — regulatory action, insolvency, withdrawal suspension — can still delay USDC movement even with cosigners functioning. This is distinct from a single-key compromise and is not mitigated by MPC. See [Custody](/pipeline/security/custody/).

## Smart contract risk

**What the risk is.** PLUSD, DepositManager, sPLUSD, LoanRegistry, and the surrounding contracts are custom Solidity code. Any bug — reentrancy, access control, arithmetic, oracle staleness, signature replay — could be exploited.

**What mitigates it.** The custom surface is narrow: roughly 500 LOC of custom logic sitting on top of OpenZeppelin v5.x audited bases (ERC-20, ERC-4626, AccessControl, Pausable). The reserve invariant (PLUSD supply ≤ USDC under custody) is checked on every mint path. Four economic caps bound blast radius on any exploited mint path: $5M/tx, $10M/24h, per-LP cumulative, and daily aggregate. Deposits are atomic — no asynchronous attestor sits in the critical path. Yield mints are two-party EIP-712 signed, so no single signer can mint.

**Residual.** Pre-audit, assume the custom code has not been externally reviewed. Phase-2 Chainlink Proof of Reserve is not yet deployed — the reserve invariant is checked against custodian-attested balances, not an independent oracle. A novel exploit is possible even after audit. See [Supply safeguards](/pipeline/security/supply-safeguards/).

## Governance risk

**What the risk is.** Three Safes hold privileged roles: ADMIN (3-of-5, 48h timelock), RISK_COUNCIL (3-of-5, 24h timelock), and GUARDIAN (2-of-5, instant). A compromised Safe can grief the protocol or accelerate risk-increasing actions. Governance is not trustless.

**What mitigates it.** Signer sets across the three Safes are distinct — this is an operational requirement at signer-set construction. A 14-day meta-timelock guards the delay parameter itself, so timelocks cannot be shortened on short notice. GUARDIAN can cancel any pending ADMIN action inside its 48h window, giving the protocol a fast veto against a captured ADMIN Safe. GUARDIAN scope is deliberately narrow: pause, cancel, and revoke named operational-role holders — no grants, no upgrades, no unpause.

**Residual.** Overlapping signer sets would collapse the three-Safe separation. This constraint is enforced operationally, not on-chain, so a signer-set change that violates it is not caught by the contracts. See [Emergency response](/pipeline/security/emergency-response/).

## Regulatory risk

**What the risk is.** KYC freshness windows, OFAC exposure, and jurisdictional offering restrictions all apply. Post-mint sanctions events can freeze a lender's position from further transfers or redemptions. The regulatory envelope around tokenised trade finance is still evolving.

**What mitigates it.** Chainalysis screening runs on every deposit with a 90-day freshness window — a lender cleared more than 90 days ago must re-screen before the next deposit. Post-mint sanctions events trigger immediate `revokeAccess` on the affected position. The withdrawal queue implements a queue-head skip so a sanctioned LP at the front of the queue cannot DoS the redemption flow for compliant lenders behind them.

**Residual.** Regulatory conditions change. Jurisdictions may be removed from the supported list on short notice, and a lender legally permitted to deposit today may find themselves unable to add to their position tomorrow. Existing positions remain redeemable but further deposits may be blocked. See [Legal](/pipeline/legal/).

## Operational risk

**What the risk is.** Three operational keys exist outside the multi-sig boundary: the Bridge operational key, the Trustee key, and the custodian's yield-attestor key. Each can be compromised independently of the others and independently of the governance Safes.

**What mitigates it.** Deposits are atomic on-chain via DepositManager, which removes the Bridge from the deposit critical path entirely — a compromised Bridge key cannot mint PLUSD against a depositor. Yield accrual uses two-party EIP-712 attestation (Bridge + custodian), so no single signer can mint yield. LoanRegistry is informational only — sPLUSD share price moves on actual repayment events, not on Trustee writes, so a compromised Trustee cannot inflate share price. GUARDIAN revokes individual operational-role holders instantly without touching unrelated roles.

**Residual.** A compromised operational key can still grief: forced-failed withdrawals, stale whitelist writes, delayed yield posting. Grief windows last until GUARDIAN responds, which is instant in principle but bounded by signer availability in practice. Grief risk is non-zero. See [Emergency response](/pipeline/security/emergency-response/).

## What we cannot promise

<div class="callout risk">
<ul>
<li>No guaranteed yield. Illustrative attribution charts are representative, not promises.</li>
<li>No guaranteed withdrawal time. Caps and queue depth apply, and large exits stage across windows.</li>
<li>No guarantee against smart-contract exploits — even post-audit, a novel vulnerability is possible.</li>
<li>No guarantee the custodian will remain operational or regulated in the same jurisdiction forever.</li>
<li>No guarantee that a loan shown in the LoanRegistry reflects real-world performance — Trustee attestations are trusted inputs, not on-chain-verified.</li>
</ul>
</div>

---

**See also:** [Defaults and losses](/pipeline/defaults-and-losses/) · [Security overview](/pipeline/security/) · [Legal](/pipeline/legal/)
