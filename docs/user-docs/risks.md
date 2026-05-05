---
title: Potential risks
order: 11
section: Potential risks
---

<div class="callout risk">
Yield on Pipeline comes from real commodity trade loan repayments and realised T-bill yield on USYC. Every yield line carries matching risk. Read this page before depositing.
</div>

Pipeline's risks fall into seven categories. For each, this page states the exposure, the mitigation, and the residual you are accepting by participating.

## Credit risk

**What the risk is.** Commodity trade loans default. An originator can breach a covenant, the Collateral Coverage Ratio (CCR) can collapse, an offtaker can default on payment, or a commodity-price shock can wipe out collateral value mid-loan. Default losses land on the Pipeline balance sheet.

**What mitigates it.** Origination is diversified across corridors, commodities, and counterparties. No single loan is structurally allowed to dominate the book. CCR thresholds at 130, 120, and 110 drive staged notifications. 130 is the healthy floor, 120 triggers amber-stage monitoring, and 110 triggers red-stage action including accelerated remediation. Every loan is funded behind an Originator equity tranche that absorbs first-loss before any sPLUSD writedown. Payment-delay flags operate on the same ladder. 7 days amber, 21 days red.

**Residual.** If realised losses exceed the Equity tranche on a given loan, the remainder writes down sPLUSD share price. This is designed, not accidental. Severe systemic losses (exceeding both Equity tranche and sPLUSD cushion) trigger a haircut coefficient on the WithdrawalQueue. Every PLUSD or sPLUSD redemption pays out at `face * coefficient` until recoveries land and the coefficient ratchets back to 1.0. Credit losses cannot be hedged away.

{% include chart.html src="c3-ccr-ladder.svg" caption="CCR thresholds. Not live protocol data." %}

See [Default management](/defaults-and-losses/) for the full loss waterfall and the post-MVP IOU mechanism.

## Liquidity risk

**What the risk is.** Withdrawal timing is not instant. Withdrawals are user-pulled from a separate **Withdrawal Queue Wallet** that the Trustee and Team top up periodically from the Capital Wallet. If a wave of claims drains the Queue Wallet faster than the next top-up cycle, claims revert until the wallet is replenished. Capital Wallet itself targets a 15% USDC buffer (band 10–20%). Refilling it requires the Trustee to sell USYC for USDC against the Hashnote redemption rail, typically about a day, longer for large redemptions.

**What mitigates it.** The WithdrawalQueue is FIFO-escrow with a self-limit (`claimAmount ≤ totalClaimable`). The Trustee monitors the Withdrawal Queue Wallet's balance against the queue's outstanding obligations and triggers top-ups before the wallet bites. Top-ups run under the Capital Wallet's 3-of-5 cosigner quorum (mandatory Team + Trustee).

**Residual.** If your position is large relative to the wallet's available headroom, your claim may revert until the next top-up cycle clears. Concentration-sized deposits should plan exit timing in advance and not assume same-day liquidity on the full notional. There is no instant-redemption AMM. Redemption is queue-based by design.

## Custody risk

**What the risk is.** Pipeline's USDC and USYC sit in institutional MPC custody operated under BitGo's TSS policy. There is no third-party custodian, but custody is still not trustless. It depends on the cosigner quorum operating correctly, the cosigner key material staying secure, and Pipeline Trust Company (a Pipeline-side legal entity) remaining operational and independent.

**What mitigates it.** The Capital Wallet uses a 3-of-5 cosigner quorum across five institutionally-distinct parties (Trustee, Pipeline Team with 2 shares, and two reputable external counterparties), with a hard policy requiring **Team + Trustee + one more** on every transfer. No single-key compromise can move USDC. No two-party coalition without both Team and Trustee can move USDC. Withdrawal settlement uses an isolated **Withdrawal Queue Wallet** so a queue-contract exploit can only drain settlement headroom, not the full reserve. The wallets' on-chain balances are publicly verifiable on Etherscan. The USYC position is verifiable against Hashnote attestations. A custody-side hardware circuit breaker can revoke the queue's allowance and freeze transfer authorisations on alarm without waiting for on-chain governance.

**Residual.** A Team+Trustee coalition compromise is out of scope for smart-contract mitigations and rests on operational separation. Trust Company solvency or governance failure can still delay USDC movement even with cosigners functioning. The MPC SDK itself is a software dependency. A vendor-side bug could in principle affect the wallets. These residuals are tracked off-chain and disclosed on the Protocol Dashboard's reconciliation indicator. See [Custody](/security/custody/).

## Smart contract risk

**What the risk is.** PLUSD, DepositManager, sPLUSD, LoanRegistry, WithdrawalQueue, and the surrounding contracts are custom Solidity code. Any bug (reentrancy, access control, arithmetic, oracle staleness, signature replay) could be exploited.

**What mitigates it.** The custom surface is narrow: roughly 500 LOC of custom logic sitting on top of OpenZeppelin v5.x audited bases (ERC-20, ERC-4626, AccessManager, Pausable). The reserve invariant (PLUSD supply ≤ counter envelope) is checked on every mint path. Four economic caps bound blast radius on any exploited mint path: $5M/tx, $10M/24h, per-LP cumulative, and daily aggregate. Deposits are atomic. No asynchronous attestor sits in the critical path. Yield mints are two-party signed, so no single signer can mint. Withdrawals self-limit via the queue's three aggregates and pull only from the isolated Withdrawal Queue Wallet, bounding the settlement-side blast radius.

**Residual.** Pre-audit, assume the custom code has not been externally reviewed. Phase-2 Chainlink Proof of Reserve is not yet deployed. The reserve invariant is checked against the contract's own counters, not an independent oracle reading the wallet's actual balances. A novel exploit is possible even after audit. See [Supply safeguards](/security/supply-safeguards/).

## Governance risk

**What the risk is.** Three MPCs hold privileged roles. ADMIN (3-of-5, 3-day standard, 7-day upgrades), RISK_COUNCIL (3-of-5, 3-day), and GUARDIAN (2-of-5, instant). A compromised MPC can grief the protocol or accelerate risk-increasing actions. Governance is not trustless.

**What mitigates it.** Signer sets across the three MPCs are distinct as an operational requirement at signer-set construction. A 14-day meta-timelock guards the delay parameter itself, so timelocks cannot be shortened on short notice. GUARDIAN can cancel any pending ADMIN action inside its delay window, giving the protocol a fast veto against a captured ADMIN MPC. GUARDIAN scope is narrow: pause, cancel, and revoke named operational-role holders. No grants, no upgrades, no unpause.

**Residual.** Overlapping signer sets would collapse the three-MPC separation. This constraint is enforced operationally, not on-chain, so a signer-set change that violates it is not caught by the contracts. See [Emergency response](/security/emergency-response/).

## Regulatory risk

**What the risk is.** KYB freshness windows, OFAC exposure, and jurisdictional offering restrictions all apply. Post-mint sanctions events can freeze a lender's position from further transfers or redemptions. The regulatory envelope around tokenised trade finance is still evolving.

**What mitigates it.** Chainalysis screening runs on every deposit with a 90-day freshness window. A lender cleared more than 90 days ago must re-screen before the next deposit. Post-mint sanctions events trigger immediate `disallow` on the affected position. The withdrawal queue does not let a sanctioned LP block compliant lenders from claiming.

**Residual.** Regulatory conditions change. Jurisdictions may be removed from the supported list on short notice, and a lender legally permitted to deposit today may find themselves unable to add to their position tomorrow. Existing positions remain redeemable but further deposits may be blocked. See [Legal](/legal/).

## Operational risk

**What the risk is.** Three operational keys exist outside the multi-sig boundary. The Relayer operational key (`relayerYieldAttestor` plus WHITELIST_MANAGER_ROLE), the Trustee's yield-attestor signing facility (`trusteeYieldAttestor`), and the Trustee's MPC cosigner share. Each can be compromised independently of the others and independently of the governance MPCs.

**What mitigates it.** Deposits are atomic on-chain via DepositManager. The Relayer isn't in the deposit critical path. Yield mints use two-party EIP-712 attestation (Relayer + Trustee), so no single signer can mint. **Withdrawals are user-pulled, so the Relayer is not in the withdrawal critical path either.** A Relayer compromise cannot halt or hijack lender exits. LoanRegistry is informational only. sPLUSD share price moves on actual repayment events flowing through the YieldMinter, not on Trustee writes, so a compromised Trustee can't inflate share price by editing the registry. GUARDIAN revokes individual operational-role holders instantly without touching unrelated roles.

**Residual.** A compromised operational key can still grief: stale whitelist writes, delayed yield posting. A compromised Trustee cosigner share could delay Withdrawal Queue Wallet top-ups (since Team and Trustee are both required on every Capital Wallet transfer). Grief windows last until GUARDIAN responds, which is instant in principle but bounded by signer availability in practice. Grief risk is non-zero. See [Emergency response](/security/emergency-response/).

## Caveats

<div class="callout risk">
<ul>
<li>No guaranteed yield. Illustrative attribution charts are representative, not promises.</li>
<li>No guaranteed withdrawal time. Queue depth and Withdrawal Queue Wallet headroom apply, and large exits stage across top-up cycles.</li>
<li>No guarantee against smart-contract exploits. Even post-audit, a novel vulnerability is possible.</li>
<li>No guarantee that Pipeline Trust Company stays operational or independent indefinitely. No guarantee that Hashnote keeps redeeming USYC to USDC on the current rail.</li>
<li>No guarantee that a loan shown in the LoanRegistry reflects real-world performance. Trustee attestations are trusted inputs, not on-chain-verified.</li>
</ul>
</div>

---

**See also:** [Default management](/defaults-and-losses/) · [Security overview](/security/) · [Legal](/legal/)
