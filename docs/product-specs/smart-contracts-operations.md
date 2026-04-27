# Smart Contracts — Roles, Upgradeability, Emergency Response & Data Models

> Role assignments, upgradeability, emergency response playbooks, and deferred features. See [smart-contracts.md](./smart-contracts.md) for the main spec (overview, governance, contracts table, security, actor glossary).

---

## Role Assignments

**Operational roles** (GUARDIAN can revoke a named holder directly; ADMIN grants and re-grants under 48h timelock):

- Relayer EOA holds: `FUNDER` (WithdrawalQueue), `WHITELIST_ADMIN` (WhitelistRegistry).
- Relayer yield-attestor key: referenced by `YieldMinter` as `relayerYieldAttestor` (rotatable under 48h ADMIN timelock via `proposeYieldAttestors`). This is a signing key, not a role — revocation is a rotation, not a `revokeRole` call.
- Trustee key holds: `TRUSTEE` on LoanRegistry (all loan NFT writes — Relayer has no LoanRegistry role).

**Contract-held roles** (bound to a proxy address, not an EOA; not subject to GUARDIAN revocation in the ordinary flow):

- DepositManager proxy holds: `DEPOSITOR` on PLUSD.
- YieldMinter proxy holds: `YIELD_MINTER` on PLUSD.
- WithdrawalQueue proxy holds: `BURNER` on PLUSD.

**Governance roles** (held by Safes; not revocable by GUARDIAN):

- GUARDIAN Safe holds: `PAUSER` on every pausable contract; `GUARDIAN_ROLE` on AccessManager (cancel pending actions, revoke operational-role holders).
- ADMIN Safe holds: `UPGRADER` on every upgradeable contract, `DEFAULT_ADMIN` on AccessManager (role grants, unpause, parameter changes — all 48h-timelocked).
- RISK_COUNCIL Safe holds: `setDefault` on LoanRegistry, `proposeShutdown` on ShutdownController.

### GUARDIAN revocation scope

GUARDIAN's `revokeRole(role, account)` on AccessManager is restricted to operational roles
held by EOAs: `FUNDER`, `WHITELIST_ADMIN`, `TRUSTEE`. Revocation is instant and requires
no timelock. Re-granting a revoked role requires an ADMIN proposal with the 48h
AccessManager delay (which GUARDIAN may cancel). GUARDIAN cannot revoke `UPGRADER`,
`DEFAULT_ADMIN`, `DEPOSITOR`, `YIELD_MINTER`, `BURNER`, or any governance role — attempts
revert. A Relayer-side yield-attestor compromise is handled by rotation via
`YieldMinter.proposeYieldAttestors`, not by `revokeRole`.

---

## Upgradeability

All nine protocol contracts use OpenZeppelin v5.x UUPS proxies. AccessManager itself is
deployed fresh from OZ and is not upgradeable (it has no custom code to evolve).

### Authorisation

- `upgradeTo(newImpl)` on every proxy is gated by the `UPGRADER` role on AccessManager.
- `UPGRADER` is held exclusively by the ADMIN 3/5 Safe.
- The call is scheduled through AccessManager with a 48h delay on the `upgradeTo`
  selector; GUARDIAN 2/5 may call `AccessManager.cancel(actionId)` at any point during
  the window to halt the upgrade.

### Meta-timelock on delay changes

`setTargetAdminDelay` — the function that sets the 48h delay itself — is gated by a
14-day meta-timelock. This defeats the sequence "ADMIN schedules delay-to-zero, waits
48h, delay is now zero, ADMIN immediately schedules a malicious upgrade with no wait."
A compromised ADMIN Safe still gives an attacker a minimum of 14 + 48h before any
upgrade lands — a window in which GUARDIAN can cancel, signers can rotate, or off-chain
governance can intervene.

### Pre-deployment audit checklist (enforced per upgrade)

Upgrade hygiene items are verified during the upgrade audit, not by runtime checks in
the contract. A runtime check adds audit surface and custom code to the upgrade path for
no additional protection — the audit catches the same failure modes before deployment.

1. Constructor calls `_disableInitializers()`.
2. EIP-712 `name` and `version` constants are unchanged on the upgrade path, or a
   migration is explicitly part of the upgrade plan. A silent domain-separator change
   would orphan pre-signed `YieldAttestation` entries and ERC-20 `Permit` signatures;
   domain stability is therefore an audit gate.
3. ERC-7201 storage layout: slots may only be appended; existing slots may not be
   reordered, renamed, or resized.
4. No new `external` / `public` selector bypasses AccessManager gating.

### Storage discipline

Each contract uses ERC-7201 namespaced storage. Slots may only be appended; existing
slots may not be reordered, renamed, or resized. Enforced at the diff level for every
upgrade PR.

---

## Emergency Response

Emergency response is Ethena-style: GUARDIAN takes instant, granular defensive actions;
restoring service requires the 48h AccessManager timelock. No single-call "revoke
everything" switch exists — every action names what it is doing to what, leaving a
reviewable record and a bounded blast radius.

### GUARDIAN's toolkit

| Action | Target | Timelock |
|---|---|---|
| `pause()` | Any pausable contract | Instant |
| `AccessManager.cancel(actionId)` | Any pending scheduled action (upgrade, role grant, parameter loosening, shutdown entry) | Instant |
| `AccessManager.revokeRole(role, account)` | Individual operational-role holders only — `FUNDER`, `WHITELIST_ADMIN`, `TRUSTEE` | Instant |

GUARDIAN **cannot** grant roles, unpause any contract, upgrade, revoke governance roles
(`UPGRADER`, `DEFAULT_ADMIN`) or contract-held roles (`DEPOSITOR`, `YIELD_MINTER`,
`BURNER`), or initiate any risk-increasing action. Attempts revert.

### Restoration path

Every restoration runs through ADMIN with the 48h AccessManager delay and is itself
GUARDIAN-cancelable: `unpause()` on any contract; re-grant of any revoked operational
role; rotation of `relayerYieldAttestor` / `custodianYieldAttestor` via
`YieldMinter.proposeYieldAttestors`; rotation of `capitalWallet` on DepositManager;
upgrade of any implementation via the `UPGRADER` role.

### Playbook: Relayer operational-key compromise

1. **Detection.** Watchdog alerts on anomalous `WhitelistAccess` grants,
   `WithdrawalFunded` without matching Capital Wallet allowance movement, divergence
   between `DepositManager.Deposited` and `PLUSD.cumulativeLPDeposits`, or a non-zero
   value from `PLUSD.assertLedgerInvariant()`.
2. **Immediate (GUARDIAN, < 1 min).** Pause PLUSD, DepositManager, YieldMinter, and
   WithdrawalQueue (defence in depth).
3. **Containment (GUARDIAN, < 10 min).** Submit separate `revokeRole` transactions for
   `FUNDER` and `WHITELIST_ADMIN` on the compromised Relayer address. Even a fully
   compromised Relayer cannot mint yield afterwards (custodian EIP-1271 still required,
   and YieldMinter is paused), cannot fund withdrawals (`FUNDER` revoked), and cannot
   modify the whitelist.
4. **Investigation & recovery.** Audit event logs; if the yield-signing key is
   compromised, ADMIN proposes `YieldMinter.proposeYieldAttestors(newRelayerAttestor,
   sameCustodian)` under 48h timelock. Provision a new Relayer address; ADMIN proposes
   re-granting `FUNDER`, `WHITELIST_ADMIN` under 48h timelock each. Unpause via ADMIN.

### Playbook: Trustee key compromise

1. **Immediate.** GUARDIAN revokes `TRUSTEE` from the Trustee key. Blocks `mintLoan`,
   `updateMutable`, `recordRepayment`, and Trustee-branch `closeLoan`. Capital flows
   are unaffected — LoanRegistry has no capital touchpoints.
2. **Containment.** Trustee can (out-of-band, via Capital Wallet MPC policy) revoke the
   Capital Wallet → WQ USDC allowance. Single-key Trustee compromise alone cannot move
   USDC (Relayer cosign required).
3. **Data-integrity review.** False LoanRegistry entries do not move funds or share
   price; reconcile against Capital Wallet inflows to identify them.
4. **Recovery.** Provision a new Trustee key; ADMIN re-grants `TRUSTEE` under 48h
   timelock.

### Playbook: Custodian yield-attestor compromise

1. **Immediate.** Custodian's own key-management revokes the compromised key; no
   on-chain action strictly required — the compromised key alone cannot mint (Relayer
   sig and `YIELD_MINTER` caller chain still needed).
2. **Rotation.** ADMIN calls `YieldMinter.proposeYieldAttestors(sameRelayer,
   newCustodian)` under 48h timelock. Yield mints continue during the window (old
   attestor still valid — acceptable because it cannot mint alone).
3. **Defence in depth.** If coordinated compromise is suspected, GUARDIAN also pauses
   YieldMinter.

---

## Deferred features

Acknowledged design targets not in MVP scope. Documented here so reviewers understand
the bounded nature of what is shipping.

### Loss waterfall

On a loan loss event, the intended seniority is:

1. Originator equity tranche (absorbed by the originator off-chain).
2. sPLUSD writedown (share-price reduction).
3. IOU token issued to PLUSD holders for the residual.

An insurance-tranche unwind is planned as a Gradual Dutch Auction (GDA) on the residual
equity. **None of this is implemented in MVP.** The MVP's only response to loss is
shutdown (fixed recovery rate on PLUSD), which is a blunt instrument. Per-loan loss
handling without protocol-wide shutdown is post-MVP.

### Chainlink Proof of Reserve

The MVP's ledger invariant verifies internal-consistency only. Chainlink PoR, which
would verify on-chain that `PLUSD.totalSupply()` is backed by actual USD-equivalent
custody balances, is phase 2.

### Partial loan repayments

Trade-finance loans in MVP are effectively single-shot: principal + interest paid at
maturity or early in one transfer. `recordRepayment` supports a single tranche-split
entry per call, which the Trustee may call multiple times if operational reality is
multi-tranche, but there is no on-chain primitive for "expected schedule of partial
repayments." If multi-tranche repayment becomes operationally needed, the extension
will be additive (a `LoanPartialRepaid` event and additional mutable fields).

### Global pause aggregator

The MVP uses per-contract pause with a documented multi-call cascade. A single
`GlobalPauser` that every contract reads on its mutating path is a post-MVP option if
ops friction proves material.

For the LoanRegistry data models (origination JSON schema and MutableLoanData), see
[smart-contracts-registry.md](./smart-contracts-registry.md).
