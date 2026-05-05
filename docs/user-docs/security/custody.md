---
title: Custody
order: 15
section: Security & Transparency
---

# Custody

Lender USDC and the USYC reserve sit in an **institutional MPC custody** — a 3-of-5 quorum operated under BitGo's TSS policy by independent parties, with the Trustee and the Pipeline Team both required on every transfer. No protocol contract holds the underlying stablecoin. BitGo provides the substrate; **it holds no signing share, cannot freeze funds, and cannot seize them**. A hardware circuit breaker on the custody side disconnects the wallets from the protocol contracts on alarm, independent of any on-chain action.

<div class="callout safety">
<p>A bug or exploit in on-chain code cannot drain investor capital. Lender USDC does not live inside any protocol contract — it sits at addresses governed by the institutional cosigner quorum below.</p>
</div>

## Institutional substrate

Pipeline operates the Capital Wallet, the Withdrawal Queue Wallet, and the Treasury Wallet using **BitGo's MPC TSS SDK**. BitGo is the software substrate, the same way a database engine is software in a banking system: Pipeline runs it, configures the cosigner quorum, sets the per-transaction-class signing policy, and generates the cosigner key shares on its own infrastructure. **BitGo is not a signer, not a counterparty, and not a custodian** in the legal sense — there is no third-party institution holding the keys whose own solvency, jurisdiction, or compliance posture is a separate failure mode.

The legal entity that holds custody on paper is **Pipeline Trust Company** — an independent trust entity with its own board. Operationally, custody is enforced by the cosigner quorum, not by any single party. The Trust Company is one of five cosigners; it cannot move funds alone.

What this means in practice:

- The cosigner shares are spread across **five institutionally-distinct parties** under a 3-of-5 threshold, with the Trustee and Team both required on every transfer.
- There is no third-party custodian whose own solvency or regulatory action is a separate failure mode.
- BitGo's role is the same as any other software dependency — code that we run, not a party that holds keys.
- A custody-side **hardware circuit breaker** can disconnect the wallets from the protocol contracts on alarm, instantly and independently of any on-chain governance action.

---

## Cosigner policy · 3-of-5 with mandatory Team + Trustee

The Capital Wallet is configured with **five cosigner shares** under a **3-of-5 threshold**, with a hard policy rule that **no transfer signs without both the Team and the Trustee participating**. The five shares:

| Cosigner | Shares | Role |
|---|---|---|
| **Fiduciary Trustee** | 1 | Pipeline Trust Company — independent legal entity with its own board |
| **Pipeline Team** | 2 | Pipeline core operating team — two independent key-holders inside the team |
| **External Counterparties** | 2 | Two reputable, institutionally-distinct third parties |

Every signing combination that satisfies the threshold also satisfies the Team-and-Trustee requirement: a 3-of-5 set must include at least one Team share AND the Trustee share, plus one more from any party. **No two parties acting alone can move funds.** A coalition of Counterparties cannot move funds. A Team-only quorum cannot move funds. A Trustee-and-Counterparties quorum cannot move funds. The minimum legitimate quorum is Team + Trustee + one more.

The Relayer is **not a cosigner** on any wallet. The Relayer's role lives entirely on the Protocol Layer — first signer on yield attestations through `YieldMinter`, maintainer of the whitelist — but it cannot move USDC out of any Pipeline custody address.

### Per-transaction-class policy

Different transaction classes carry different sub-policies inside the custody, all of which still satisfy the 3-of-5 + Team + Trustee rule:

- **Withdrawal Queue Wallet top-ups** (Capital Wallet → Withdrawal Queue Wallet) — bulk USDC transfers that fund queue settlement; signed by Trustee + Team + one more under the standard 3-of-5 quorum, on the Trustee's monitoring cadence.
- **Loan disbursements** (Capital Wallet → on-ramp provider) — fresh cosigner quorum on the specific outflow.
- **USYC sales** (yield realisation, or wallet rebalancing when the USDC buffer drops) — Trustee-instructed against the Hashnote redemption rail, then settled into USDC inside the wallet.
- **Yield attestations** are an on-chain matter, not a custody matter — the Relayer signs first with `relayerYieldAttestor`; the Trustee co-signs second with `trusteeYieldAttestor` (an EIP-1271 signer contract gated by the Trustee's signing facility); `YieldMinter` verifies both signatures on-chain before any PLUSD mints. Custody is not in the loop.

---

## Capital Wallet, Withdrawal Queue Wallet, Treasury Wallet

| Wallet | What it holds | Who pulls from it |
|---|---|---|
| **Capital Wallet** | USDC lender reserves, USDC on active loans, USYC (Hashnote tokenised T-bill) | Trustee + Team for loan disbursement, USYC sales, top-ups to the Withdrawal Queue Wallet |
| **Withdrawal Queue Wallet** | USDC earmarked for lender withdrawals — sized to cover near-term `totalClaimable` plus headroom | The on-chain `WithdrawalQueue` contract via `transferFrom` against a standing allowance the Wallet has granted to it; lenders trigger this themselves when they call `claim` |
| **Treasury Wallet** | Accumulated protocol fees (management, performance, OET) | Pipeline Team for fee operations |

The **Withdrawal Queue Wallet is the architecturally important one for safety** — by isolating queue settlement funds in their own MPC wallet, a WithdrawalQueue contract bug or exploit can drain only the topped-up amount, not the full Capital Wallet. The contract holds an allowance against this Wallet, never against the Capital Wallet directly.

All three wallets run on the same custody substrate under separate cosigner-policy configurations, so a compromise at one does not propagate to the others.

---

## Emergency disconnect

The custody substrate carries a **hardware circuit breaker** that decouples the wallets from the protocol contracts on alarm. When triggered, the breaker:

- Revokes the standing pre-approved allowance the WithdrawalQueue contract has against the Withdrawal Queue Wallet.
- Freezes any other transfer authorisations issued to protocol addresses.
- Requires a fresh cosigner quorum to re-establish any allowance once the incident is resolved.

The breaker is a **custody-side action**. It does not require an AccessManager schedule, an ADMIN timelock, or a governance vote. It can be pulled by the Trustee or the Team independently of the on-chain GUARDIAN's pause cascade — the two are layered, not redundant. Critically, **BitGo cannot pull this lever and cannot freeze funds independently**: the breaker is operated by the cosigner parties, not by the substrate provider.

---

## Reserve composition

{% include chart.html src="c1-reserve-composition.svg" caption="Illustrative reserve composition at the 15% USDC-buffer target. Not live data." %}

The live composition — USDC held, USYC held, active-loan USDC, Withdrawal Queue Wallet balance, buffer utilisation — is on the Protocol Dashboard. *Dashboard URL — to be published at launch.*

---

## Reserve invariant (and its limits)

PLUSD tracks three on-chain counters: `cumulativeLPDeposits`, `cumulativeYieldMinted`, `cumulativeLPBurns`. Every mint asserts `totalSupply ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns`. Over-minting beyond this envelope reverts at the contract level.

This is internal-consistency only. It proves the contract has not minted more PLUSD than it accounted for. It does **not** independently verify that the wallets hold the corresponding USDC. That assurance comes from the wallets' on-chain balances (Etherscan-readable for USDC; Hashnote-attested for USYC) and off-chain reconciliation by the Watchdog service.

Phase 2 brings on-chain Proof of Reserve via Chainlink PoR — moving the balance check inside the same invariant.

---

## What this means for a lender

Your USDC is held in an institutional MPC custody under a 3-of-5 cosigner quorum that requires the Trustee and the Pipeline Team on every transfer. The on-chain wallet balances are visible directly on Etherscan. A custody-side circuit breaker can disconnect the wallets from the protocol contracts on alarm without waiting for an on-chain governance action. Withdrawal settlement funds live in their own isolated wallet, so the worst case for a queue-contract exploit is bounded by current settlement headroom, not by total reserves.

The trade-off: Pipeline Trust Company is a Pipeline-side legal entity, so its independence is a governance commitment rather than an external check. Read [Potential risks](/risks/) for that residual.

---

## Related

- [Governance](/security/governance/)
- [Supply safeguards](/security/supply-safeguards/)
- [Emergency response](/security/emergency-response/)
- [How Pipeline works](/how-it-works/)
- [Potential risks](/risks/)
