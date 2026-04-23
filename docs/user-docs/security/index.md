---
title: Security & Transparency
order: 13
section: Security & Transparency
---

# Security & Transparency

Pipeline is built on a split-rail architecture where on-chain contracts track receipts and off-chain custodied USDC is moved by MPC cosigners. No single operator — Bridge, custodian, Trustee, or a single governance Safe — can drain investor capital or mint unbacked PLUSD.

{% include diagram.html src="d1-system-context.svg" caption="System context — off-chain cash rail on the left, on-chain token rail on the right, governance by three Safes." %}

The off-chain zone holds the Custodian, Capital Wallet, Treasury Wallet, Bridge, and Trustee. The on-chain zone holds AccessManager plus eight protocol contracts that track deposits, shares, loans, yield, and shutdown state. Three Safes — ADMIN, RISK_COUNCIL, and GUARDIAN — gate every privileged action through AccessManager, each with a distinct signer set and timelock.

---

## Explore the cluster

<div class="card-grid">
  <a class="card" href="/security/custody/">
    <h4>Custody</h4>
    <p>How USDC is held at the custodian and moved by MPC cosigners.</p>
  </a>
  <a class="card" href="/security/supply-safeguards/">
    <h4>Supply safeguards</h4>
    <p>Four structural safeguards that prevent unbacked PLUSD minting.</p>
  </a>
  <a class="card" href="/security/emergency-response/">
    <h4>Emergency response</h4>
    <p>Ethena-style split: GUARDIAN pauses and revokes; ADMIN restores under timelock.</p>
  </a>
  <a class="card" href="/security/audits-and-addresses/">
    <h4>Audits &amp; addresses</h4>
    <p>Deployed contracts, third-party audits, formal verification, live data.</p>
  </a>
</div>

---

## Governance

{% include diagram.html src="d8-governance.svg" caption="Three Safes with distinct signer sets: ADMIN 3/5 (48h timelock), RISK_COUNCIL 3/5 (24h timelock), GUARDIAN 2/5 (instant)." %}

Three Safes own the protocol. Their powers do not overlap. Their signer sets are distinct.

- **ADMIN (3/5)** owns role grants, re-grants, unpauses, upgrades, and parameter changes. Every action runs through a 48h AccessManager timelock; GUARDIAN can cancel during the window.
- **RISK_COUNCIL (3/5)** owns `setDefault` on LoanRegistry, `proposeShutdown`, and `adjustRecoveryRateUp` — all 24h-timelocked, GUARDIAN-cancelable.
- **GUARDIAN (2/5)** owns pause, cancel, and `revokeRole` for operational-role holders — instant, no timelock. GUARDIAN cannot grant any role, unpause, upgrade, or move funds.

The split is deliberate. Fast defensive action is separated from slow constructive action. GUARDIAN can stop things; only ADMIN can start them again.

---

## Trust footprint

Pipeline reduces trust assumptions but does not eliminate them. The accepted assumptions — custodian integrity, cosigner integrity, governance signer-set distinctness, Watchdog correctness — are enumerated and justified on the child pages:

- Custodian and cosigner integrity are covered in [Custody](/security/custody/).
- Supply-side assumptions (atomic deposits, EIP-712 yield co-signing, Watchdog correctness) are covered in [Supply safeguards](/security/supply-safeguards/).
- Governance signer-set distinctness and the pause-and-revoke model are covered in [Emergency response](/security/emergency-response/).

For the full risk categorisation — custody, market, operational, protocol, governance — see [Risks](/risks/).

---

## For the full threat model

The full threat model, layered defence stack, pause cascade, and cross-rail sequence analysis lives in the product specs: [security.md on GitHub](https://github.com/eq-lab/pipeline/blob/docs/update-specs-v2.3/docs/product-specs/security.md).

---

## Related

- [Split-rail architecture](/how-it-works/)
- [Risks](/risks/)
- [Defaults and losses](/defaults-and-losses/)
