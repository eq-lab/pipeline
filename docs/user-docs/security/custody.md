---
title: Custody
order: 14
section: Security & Transparency
---

# Custody

Your USDC reserves sit at a regulated third-party custodian. No Pipeline smart contract ever holds the underlying stablecoin. Every movement out of the Capital Wallet requires multiple independent cosigners under a fixed MPC policy.

<div class="callout safety">

A bug or exploit in on-chain code cannot drain investor capital. The USDC backing PLUSD does not live inside a protocol contract. It sits in a custodied wallet whose release policy is enforced outside the EVM, by a regulated counterparty with its own compliance controls.

</div>

## Who the custodian is

<em>Custodian name — to be published at launch.</em>

The custodian is selected against a fixed requirements list, not picked for convenience. They must be a regulated entity with independent compliance controls. They must support MPC signing with per-counterparty policy rules. They must operate an EIP-1271 signer contract that co-signs every yield mint. They must be a fully separate legal entity from Pipeline, with no shared beneficial ownership.

These requirements are non-negotiable. They are what makes the custody layer an independent check on protocol behaviour rather than a rubber stamp.

---

## Two wallets, different roles

Pipeline operates two wallets at the custodian. They hold different assets and use different cosigner sets.

- **Capital Wallet** — holds USDC lender reserves, USDC on active loans, and USYC (Hashnote's tokenised T-bill). Target USDC buffer 15% (band 10–20%). USYC NAV drifts up daily as T-bills accrue, but that gain is **unrealised** — it stays at the custodian until the Trustee instructs the custodian to sell USYC for USDC. Only on a sale do realised proceeds enter the Capital Wallet, and only then can they be co-signed and minted as PLUSD into the vault.
- **Treasury Wallet** — accumulates protocol fees and the 30% Treasury share of realised T-bill yield. Different MPC cosigner set. A compromise at one wallet doesn't propagate to the other.

---

## Cosigners — three keys, none alone

The Capital Wallet has three MPC cosigners. Each holds one share.

- **Trustee** — Pipeline Trust Company, an independent legal entity with its own board.
- **Team** — the Pipeline core team.
- **Relayer** — the operational backend that processes withdrawals and yield events.

Different transaction classes require different signer combinations. The combinations are fixed in custodian policy and cannot be changed by any single party. Routine LP withdrawals are auto-signed by Relayer within narrow, pre-configured bounds: per-LP cap, per-window cap, destination-set match. Anything outside those bounds stops. Loan disbursements require Trustee + Team. **USYC sales** (yield realisation, or large-withdrawal funding when the USDC buffer drops) are instructed by the Trustee against the custodian's USYC redemption rail; settlement is set by Hashnote and is not instant.

**No single operator can move USDC out of the Capital Wallet.** Relayer alone is bounded to policy-shaped payouts to pre-verified LP addresses. Trustee alone cannot release funds. Team alone cannot release funds. A two-party compromise is out of scope for smart-contract mitigations and is handled at the custodian boundary.

---

## Reserve composition

{% include chart.html src="c1-reserve-composition.svg" caption="Illustrative reserve composition at the 15% USDC-buffer target. Not live protocol data." %}

The live composition — USDC held, USYC held, active-loan USDC, buffer utilisation — is published on the Protocol Dashboard. <em>Dashboard URL — to be published at launch.</em>

---

## The reserve invariant (and its limits)

PLUSD tracks three on-chain counters: `cumulativeLPDeposits`, `cumulativeYieldMinted`, and `cumulativeLPBurns`. Every mint path asserts that `totalSupply ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns`. Over-minting beyond this envelope reverts at the contract level.

This invariant is internal-consistency only. It proves the contract has not minted more PLUSD than it accounted for. It does **not** independently verify that the custodian actually holds the corresponding USDC. That assurance comes from the custodian's regulated status, its independent ledger, and off-chain reconciliation performed by the Watchdog service.

Phase 2 targets on-chain Proof of Reserve via Chainlink PoR, moving the custodian-balance check inside the same invariant.

---

## What this means for a lender

Your USDC is not inside a smart contract you need to trust. It is in a custodied wallet moved by a cosigner policy you can inspect. The contracts guarantee internal consistency and enforce rate limits; the custodian guarantees the stablecoin is actually there; the three-cosigner MPC policy guarantees no single party can move it. Those are three independent checks, not one.

---

## Related

- [Supply safeguards](/security/supply-safeguards/)
- [Emergency response](/security/emergency-response/)
- [Split rail](/how-it-works/)
- [Risks](/risks/)
