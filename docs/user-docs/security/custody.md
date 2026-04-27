---
title: Custody
order: 14
section: Security & Transparency
---

# Custody

Lender USDC sits in self-custodied MPC wallets operated by Pipeline. There is **no third-party custodian** holding the keys. The cosigner shares are split across three Pipeline-side parties — **Trustee**, **Team**, **Relayer** — and configured under a fixed MPC threshold-signature policy. No Pipeline smart contract ever holds the underlying stablecoin.

<div class="callout safety">
<p>A bug or exploit in on-chain code cannot drain investor capital. Lender USDC does not live inside any protocol contract — it sits at addresses governed by the MPC quorum below.</p>
</div>

## Self-custody — what that means here

Pipeline operates the Capital Wallet and Treasury Wallet as **self-custodied MPC wallets** using BitGo's MPC TSS SDK. The SDK is software; **BitGo is not a signer, not a cosigner, and not a counterparty**. Pipeline configures the MPC quorum, the per-transaction-class signing policy, and the cosigner-key generation entirely on its own infrastructure.

The legal entity that holds custody on paper is **Pipeline Trust Company** — an independent trust entity with its own board. Operationally, custody is enforced by the MPC quorum, not by any single party. The Trust Company is one of the three cosigners; it cannot move funds alone.

What this means for a lender:

- The keys sit with Pipeline, but no single Pipeline party holds enough share to sign alone.
- There's no third-party custodian whose own solvency or jurisdiction is a separate failure mode.
- BitGo's role is the same as any other software dependency — code that we run, not a party that holds keys.

---

## Two wallets, different roles

Pipeline operates two MPC wallets. They hold different assets and use different cosigner sets.

- **Capital Wallet** — USDC lender reserves, USDC on active loans, and USYC (Hashnote's tokenised T-bill). Target USDC buffer 15% (band 10–20%); the rest is held as USYC. USYC NAV drifts up daily as T-bills accrue, but that gain is **unrealised** until the Trustee instructs the wallet to sell USYC for USDC. Only realised proceeds can feed a PLUSD yield mint.
- **Treasury Wallet** — accumulated protocol fees and the 30% Treasury share of realised T-bill yield. Different MPC cosigner set. A compromise at one wallet doesn't propagate to the other.

---

## Cosigners — three shares, none alone

The Capital Wallet's MPC quorum has three cosigners. Each holds one share.

- **Trustee** — Pipeline Trust Company, an independent legal entity with its own board.
- **Team** — Pipeline core operating team.
- **Relayer** — the operational backend that processes withdrawals and yield events.

Different transaction classes need different cosigner combinations. Combinations are fixed in the MPC policy and can't be changed by any single party.

- **Routine LP withdrawals** — auto-signed by the Relayer within narrow bounds: per-LP cap, per-window cap, destination must match the original deposit address. Anything outside those bounds stops.
- **Loan disbursement** — Trustee + Team.
- **USYC sales** (yield realisation, or large-withdrawal funding when the USDC buffer drops) — Trustee-instructed against the wallet's USYC redemption rail. Settlement timing is set by Hashnote and is not instant.
- **Yield attestations** — Relayer signs first with `relayerYieldAttestor`. The Trustee co-signs second with `trusteeYieldAttestor` (the Trustee's signing facility, an EIP-1271 signer contract gated by the Trustee's MPC share). YieldMinter verifies both signatures on-chain before any PLUSD mints.

**No single operator can move USDC.** The Relayer alone is bounded to policy-shaped payouts to pre-verified addresses. Trustee alone can't release funds. Team alone can't release funds. A two-party compromise is out of scope for smart-contract mitigations and is handled at the MPC-policy boundary.

---

## Reserve composition

{% include chart.html src="c1-reserve-composition.svg" caption="Illustrative reserve composition at the 15% USDC-buffer target. Not live data." %}

The live composition — USDC held, USYC held, active-loan USDC, buffer utilisation — is on the Protocol Dashboard. *Dashboard URL — to be published at launch.*

---

## Reserve invariant (and its limits)

PLUSD tracks three on-chain counters: `cumulativeLPDeposits`, `cumulativeYieldMinted`, `cumulativeLPBurns`. Every mint asserts `totalSupply ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns`. Over-minting beyond this envelope reverts at the contract level.

This is internal-consistency only. It proves the contract hasn't minted more PLUSD than it accounted for. It does **not** independently verify that the wallet holds the corresponding USDC. That assurance comes from the wallet's on-chain balances (Etherscan-readable for USDC; Hashnote-attested for USYC) and off-chain reconciliation by the Watchdog service.

Phase 2 brings on-chain Proof of Reserve via Chainlink PoR — moving the balance check inside the same invariant.

---

## What this means for a lender

Your USDC isn't inside a smart contract you have to trust. It's at an MPC-controlled wallet whose policy you can inspect. The contracts guarantee internal consistency and enforce rate limits. The on-chain wallet balances are visible directly on Etherscan. The three-cosigner quorum guarantees no single Pipeline party can move funds alone. Three independent checks, not one.

There is no third-party custodian in the picture. That removes one class of failure (custodian solvency, custodian regulatory action, custodian withdrawal suspension) — and adds a different one: the Trust Company is a Pipeline-side legal entity, so its independence is a governance commitment rather than an external check. Read [Risks](/risks/) for that residual.

---

## Related

- [Supply safeguards](/security/supply-safeguards/)
- [Emergency response](/security/emergency-response/)
- [Split rail](/how-it-works/)
- [Risks](/risks/)
