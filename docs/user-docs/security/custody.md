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

Pipeline operates the Capital Wallet and Treasury Wallet using **BitGo's MPC TSS SDK**. BitGo is the software substrate, the same way a database engine is software in a banking system: Pipeline runs it, configures the cosigner quorum, sets the per-transaction-class signing policy, and generates the cosigner key shares on its own infrastructure. **BitGo is not a signer, not a counterparty, and not a custodian** in the legal sense — there is no third-party institution holding the keys whose own solvency, jurisdiction, or compliance posture is a separate failure mode.

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

The Relayer is **not a cosigner** on the Capital Wallet. The Relayer's role lives entirely on the Protocol Layer — it is the first signer on yield attestations through `YieldMinter` and the funder of withdrawal-queue entries via a pre-approved allowance, but it cannot move USDC out of the custody and cannot mint PLUSD alone.

### Per-transaction-class policy

Different transaction classes carry different sub-policies inside the custody, all of which still satisfy the 3-of-5 + Team + Trustee rule:

- **Routine LP withdrawal funding** runs against a **pre-approved allowance** that the Relayer can call against without triggering a fresh signing event. The allowance itself was cosigned at deployment and bounds destination (must match the original deposit address), per-LP cumulative cap, and rolling 24-hour aggregate.
- **Loan disbursements** require a fresh cosigner quorum on the specific outflow.
- **USYC sales** (yield realisation, or large-withdrawal funding when the USDC buffer drops) are Trustee-instructed against the Hashnote redemption rail, then settled into USDC inside the wallet.
- **Yield attestations** are an on-chain matter, not a custody matter — the Relayer signs first with `relayerYieldAttestor`; the Trustee co-signs second with `trusteeYieldAttestor` (an EIP-1271 signer contract gated by the Trustee's signing facility); `YieldMinter` verifies both signatures on-chain before any PLUSD mints. Custody is not in the loop.

---

## Emergency disconnect

The custody substrate carries a **hardware circuit breaker** that decouples the Capital Wallet from the protocol contracts on alarm. When triggered, the breaker:

- Revokes the standing pre-approved allowance the Relayer calls against to fund withdrawals.
- Freezes any other transfer authorisations issued to protocol addresses.
- Requires a fresh cosigner quorum to re-establish any allowance once the incident is resolved.

The breaker is a **custody-side action**. It does not require an AccessManager schedule, an ADMIN timelock, or a governance vote. It can be pulled by the Trustee or the Team independently of the on-chain GUARDIAN's pause cascade — the two are layered, not redundant. Critically, **BitGo cannot pull this lever and cannot freeze funds independently**: the breaker is operated by the cosigner parties, not by the substrate provider.

---

## Capital Wallet and Treasury Wallet

The Capital Wallet holds **USDC lender reserves, USDC on active loans, and USYC** (Hashnote's tokenised T-bill). Target USDC buffer 15% (band 10–20%); the rest is held as USYC. USYC NAV drifts up daily as T-bills accrue, but that gain is **unrealised** until the Trustee instructs the wallet to sell USYC for USDC. Only realised proceeds can feed a PLUSD yield mint.

The Treasury Wallet holds accumulated protocol fees and the 30% Treasury share of realised T-bill yield. It runs on the same custody substrate under a separate cosigner-policy configuration, so a compromise at one wallet does not propagate to the other.

---

## Reserve composition

{% include chart.html src="c1-reserve-composition.svg" caption="Illustrative reserve composition at the 15% USDC-buffer target. Not live data." %}

The live composition — USDC held, USYC held, active-loan USDC, buffer utilisation — is on the Protocol Dashboard. *Dashboard URL — to be published at launch.*

---

## Reserve invariant (and its limits)

PLUSD tracks three on-chain counters: `cumulativeLPDeposits`, `cumulativeYieldMinted`, `cumulativeLPBurns`. Every mint asserts `totalSupply ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns`. Over-minting beyond this envelope reverts at the contract level.

This is internal-consistency only. It proves the contract has not minted more PLUSD than it accounted for. It does **not** independently verify that the wallet holds the corresponding USDC. That assurance comes from the wallet's on-chain balances (Etherscan-readable for USDC; Hashnote-attested for USYC) and off-chain reconciliation by the Watchdog service.

Phase 2 brings on-chain Proof of Reserve via Chainlink PoR — moving the balance check inside the same invariant.

---

## What this means for a lender

Your USDC is held in an institutional MPC custody under a 3-of-5 cosigner quorum that requires the Trustee and the Pipeline Team on every transfer. The contracts guarantee internal consistency and enforce rate limits. The on-chain wallet balances are visible directly on Etherscan. A custody-side circuit breaker can disconnect the wallets from the protocol contracts on alarm without waiting for an on-chain governance action. Three independent checks, not one.

The trade-off: Pipeline Trust Company is a Pipeline-side legal entity, so its independence is a governance commitment rather than an external check. Read [Potential risks](/risks/) for that residual.

---

## Related

- [Governance](/security/governance/)
- [Supply safeguards](/security/supply-safeguards/)
- [Emergency response](/security/emergency-response/)
- [How Pipeline works](/how-it-works/)
- [Potential risks](/risks/)
