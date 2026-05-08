---
title: Security & Transparency
order: 13
section: Security & Transparency
---

# Security & Transparency

Pipeline is built around four security decisions that compound. Capital lives outside the contracts. Deposits are atomic. Yield mints need two independent signatures. Defensive action is separated from constructive action. None of these is novel by itself. Together they remove most of the failure modes that have hit on-chain credit protocols, and bound the rest with explicit, reviewable scope.

## Four decisions

**1. Capital is custodied off-chain.** Lender USDC and the USYC reserve sit in an institutional MPC custody operated under BitGo's TSS policy with a 3-of-5 cosigner quorum (Trustee, 2 Team, 2 reputable counterparties). No protocol contract can spend from the custody. Withdrawal settlement uses an isolated **Withdrawal Queue Wallet** topped up periodically from the Capital Wallet, so a queue-contract exploit can only drain settlement headroom, not the full reserve.

**2. The deposit path has no off-chain attestor.** `DepositManager.deposit(amount)` pulls USDC and mints PLUSD 1:1 in the same transaction. There is no signing step, no asynchronous queue, no off-chain "approval" of a deposit. The on-chain USDC movement IS the attestation. This closes the attack class where a compromised signing key mints against a fake or spoofed deposit, the failure mode that took down Resolv in March 2026.

**3. Yield mints are gated by two independent signatures.** `YieldMinter.yieldMint(attestation, relayerSig, trusteeSig)` verifies a Relayer ECDSA signature AND a Trustee EIP-1271 signature on-chain before any PLUSD mints. Compromising the Relayer alone mints zero. Compromising the Trustee's yield-attestor alone mints zero. The destination is hard-constrained to the sPLUSD vault or the Treasury Wallet, and a per-attestation `ref` guard rejects replays.

**4. Defensive action is fast. Constructive action is slow.** GUARDIAN (2/5 MPC) can pause any contract, cancel pending ADMIN actions, and revoke named operational-role holders instantly, with no timelock. ADMIN (3/5 MPC) can grant roles, unpause, and upgrade only after a 3-day delay (7 days for upgrades) that GUARDIAN can cancel. RISK_COUNCIL (3/5 MPC) handles credit and recovery under a 3-day delay. A compromised GUARDIAN can grief but cannot escalate. A compromised ADMIN cannot move quickly enough to outrun GUARDIAN's veto.

---

## Explore the cluster

<div class="card-grid">
  <a class="card" href="/security/custody/">
    <h4>Custody</h4>
    <p>Institutional MPC custody, 3-of-5 cosigner quorum, separate Withdrawal Queue Wallet, emergency disconnect, why BitGo cannot freeze funds.</p>
  </a>
  <a class="card" href="/security/governance/">
    <h4>Governance</h4>
    <p>Three MPCs, distinct signer sets, what each can and cannot do, the 14-day meta-timelock on the delay parameter.</p>
  </a>
  <a class="card" href="/security/supply-safeguards/">
    <h4>Supply safeguards</h4>
    <p>DepositManager vs YieldMinter, who checks what, plus the structural safeguards that prevent unbacked PLUSD minting.</p>
  </a>
  <a class="card" href="/security/emergency-response/">
    <h4>Emergency response</h4>
    <p>Ethena-style split: GUARDIAN pauses and revokes, ADMIN restores under timelock.</p>
  </a>
  <a class="card" href="/security/audits-and-addresses/">
    <h4>Audits &amp; addresses</h4>
    <p>Deployed contracts, third-party audits, formal verification, live data.</p>
  </a>
</div>

---

## Trust footprint

Pipeline reduces trust assumptions but does not eliminate them. The accepted assumptions (Trustee independence, MPC cosigner integrity, governance signer-set distinctness, Watchdog correctness) are enumerated and justified on the child pages.

- Self-custody policy and cosigner integrity. See [Custody](/security/custody/).
- Three-MPC governance, signer-set distinctness, and the meta-timelock. See [Governance](/security/governance/).
- Supply-side assumptions (two-step screened deposits with the Intake Wallet, two-party yield co-signing, Watchdog correctness). See [Supply safeguards](/security/supply-safeguards/).
- Pause-and-revoke playbooks for Relayer, Trustee, and yield-attestor compromise. See [Emergency response](/security/emergency-response/).

For the full risk categorisation (credit, liquidity, custody, smart-contract, governance, regulatory, operational), see [Potential risks](/risks/).

---

## Full threat model

The full threat model, layered defence stack, pause cascade, and cross-rail sequence analysis lives in the product specs. See [security.md on GitHub](https://github.com/eq-lab/pipeline/blob/docs/update-specs-v2.3/docs/product-specs/security.md).

---

## Related

- [How Pipeline works](/how-it-works/). The split-layer architecture.
- [Potential risks](/risks/).
- [Default management](/defaults-and-losses/).
