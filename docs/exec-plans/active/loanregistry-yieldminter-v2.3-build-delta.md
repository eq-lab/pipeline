# LoanRegistry + YieldMinter v2.3 — build delta

**Status:** spec landed. Implementation **in progress** on `rework/loan-registry` (WIP).
**Spec branch:** `docs/update-specs-v2.3` (commits `09cb08a`, `28ff51f`)
**Implementation branch:** `eq-lab/pipeline-contracts@rework/loan-registry` (WIP, supersedes `main`)
**Source compared:** `LoanRegistryUpgradeable.sol`, `PipelineLoanRegistry.sol`, `ILoanRegistry.sol`, `PipelineYieldMinter.sol` on `rework/loan-registry`

This is the engineering hand-off for the v2.3 LoanRegistry and YieldMinter spec
update. The `rework/loan-registry` branch is mid-implementation. This doc tracks what
has landed on the branch against the spec and what is still to build, so the gaps below
are a remaining-work checklist, not a list of conflicts.

---

## Background

Two drivers. First, origination economics move on-chain so the minter can enforce a
mint bound the operator cannot fake. Second, product confirmed that loans get rolled over
(new rate, new maturity) and re-termed on default, so "immutable loan data" cannot be
literally immutable. The spec reconciles the two with an append-only epoch model that
keeps a tamper-proof mint ceiling while allowing terms to change.

## The four spec decisions (locked with product)

1. **Genesis snapshot plus append-only epochs.** `ImmutableLoanData` written once. Rate
   and maturity live in an append-only `EconomicsEpoch[]`.
2. **Maturity-capped mint ceiling.** Vault-leg mints bounded by a piecewise sum across
   epochs, each epoch's accrual stopping at its own maturity. An independent bound the
   contract computes itself.
3. **Fast-path rollover, gated re-terms.** `rollover` Trustee/no-timelock/post-maturity.
   `amendEconomics` and `setDefault` RISK_COUNCIL/24h. All append an epoch, none mint.
4. **`Matured` status.** Mint allowed only in `Performing` and `Watchlist`.

Plus 8-field `recordPayment` (fees carved from gross interest), mutable `metadataURI`,
and a split YieldMinter (`mintLoanYield` + `mintTbillYield`) with two-party attestation.

---

## Landed on the branch

- LoanRegistry is UUPS + AccessManaged + ERC-7201, soulbound, pausable.
- `ImmutableLoanData` is on-chain (7 fields) in a per-loan map, written once at draw.
- Per-loan `MutableLoanData`, per-loan `cumulativeRepaymentData`, and per-repayment
  `repaymentData[loanId][repaymentId]` maps replace the old global scalar counters.
- `recordPayment` carries the 6-component split (`seniorPrincipalRepaid`, `seniorInterest`,
  `mgmtFee`, `perfFee`, `oetAlloc`, `equityDistributed`) with the `sum <= offtakerAmount`
  invariant, and returns a `repaymentId`.
- YieldMinter delivers both legs: net senior coupon to the sPLUSD vault and
  `mgmtFee + perfFee + oetAlloc` to the Treasury.
- Yield is gated per repayment: `canYieldBeMinted` + a one-time `minted[loanId][repaymentId]`
  flag + `markMinted`.

## Branch (WIP) vs. spec target

### LoanRegistry

| Dimension | `rework/loan-registry` (now) | Spec v2.3 (target) | Status |
|---|---|---|---|
| Entry point | `drawLoan(to, metadataURI, immutableLoanData, initialCcrBps, location)` | `mintLoan(originator, economics, metadataURI, initialLocation)` | naming to align |
| Immutable fields | `seniorTranche, equityTranche, offtakerPrice, rateBps, originationTimestamp, originalMaturityTimestamp, facility (string)` | adds numeric `originalFacilitySize`; `facility` descriptive only | pending |
| Mint invariants | only `initialCcrBps >= ONE` (1e6) | `senior + equity == facilitySize`, `offtakerPrice >= facilitySize`, `maturity > origination` | pending |
| Rate / maturity over life | `ImmutableLoanData` immutable; `currentMaturityDate` no setter | append-only `EconomicsEpoch[]`; `rollover` and `amendEconomics` update terms | pending |
| Rollover / re-term / `Matured` | absent | `rollover`, `amendEconomics`, `Matured` status | pending |
| Repayment model | per-repayment records + cumulative map | cumulative per-loan counters | branch ahead, fold into spec |
| Mint replay / bound | `minted[loanId][repaymentId]` one-time flag; mints exactly the recorded amounts | `usedLoanRefs` plus the maturity-capped `ceiling(loanId)` independent bound | ceiling pending |
| CCR scale | `ONE = 1_000_000` (1e6) | bps (1e4) | scale to align |
| `metadataURI` | set at draw, no setter | mutable, appendable docs | setter pending |

### YieldMinter

| Dimension | `rework` `PipelineYieldMinter` (now) | Spec v2.3 (target) | Status |
|---|---|---|---|
| Entry point | `mintYield(loanId, repaymentId)` single | `mintLoanYield(att, relayerSig, custodianSig)` + `mintTbillYield(...)` | loan path partial, T-Bill pending |
| Authorisation | AccessManager `restricted` only | Relayer ECDSA + custodian EIP-1271, verified on-chain | attestation pending |
| Mint bound | exactly the recorded `seniorInterest` + fees for that repayment | per-loan cap `min(seniorInterestRecorded, ceiling(loanId))` | ceiling pending |
| Mint call | `plUsd.mint(vault, ...)` and `plUsd.mint(treasury, ...)` direct | `PLUSD.mintForYield`, asserts ledger invariant | to align |
| T-Bill path | absent | `mintTbillYield`, NAV-delta cap | pending |
| Upgradeable / pausable | No (plain `AccessManaged`, immutables, constructor) | UUPS + Pausable + ERC-7201 | pending |
| Treasury address | set at construction, no setter | rotatable per spec governance | setter pending |

---

## Remaining work to reach the spec

Checklist of what is still to build on the branch to match the approved spec.

- [ ] **Two-party attestation in YieldMinter.** Relayer ECDSA + custodian EIP-1271
      verified on-chain on the mint path. This is the spec's "no single compromise mints"
      property and is currently AccessManager-role-only.
- [ ] **Independent maturity-capped ceiling.** Bound a vault mint by the
      `principal x rate x elapsed` sum the contract computes itself, so the mint does not
      rely solely on Trustee-supplied numbers (spec decision #2).
- [ ] **Epochs + rollover + amendEconomics + Matured.** Append-only `EconomicsEpoch[]`,
      `rollover` (Trustee, post-maturity), `amendEconomics` (RISK_COUNCIL), and the
      `Matured` status. Currently `ImmutableLoanData` is fixed with no re-term path.
- [ ] **T-Bill mint path.** `mintTbillYield` with the USYC NAV-delta cap and its own
      replay map.
- [ ] **YieldMinter as UUPS + Pausable**, minting via `PLUSD.mintForYield` with the
      ledger-invariant assertion rather than a direct `plUsd.mint`.
- [ ] **Numeric `originalFacilitySize`** plus the mint invariants
      (`senior + equity == facilitySize`, `offtakerPrice >= facilitySize`,
      `maturity > origination`).
- [ ] **Mutable `metadataURI`** setter and a `treasury` setter under governance.

## Design notes to settle while building

- **Fold the per-repayment model into the spec.** The branch's indexed per-repayment
  `RepaymentData` plus the one-time `minted` flag is a cleaner fit for lumpy and
  multi-tranche repayments than the spec's cumulative-only counters. Recommend updating
  the spec to match (keep cumulative as a derived rollup). This is a spec follow-up, not
  branch work.
- **Naming and scale alignment before codegen.** Branch uses `drawLoan`, `WatchList`,
  `mintYield`, CCR in 1e6. Specs use `mintLoan`, `Watchlist`, `mintLoanYield`, CCR in bps.
  Pick one set.

---

## Upgrade-safety constraints (verified against OpenZeppelin Upgrades docs)

1. **The branch authors the ERC-7201 layout cleanly** (per-loan maps appended after
   `nextLoanId` and `metadataURI`), so the old `main` global-scalar problem is gone. Any
   future change must stay append-only: new fields only at the end of a struct or the
   namespaced storage struct, never reordered or removed. Adding the epoch and per-loan
   counter state when those land must follow the same rule.
2. **`reinitializer` for any migration** that introduces new state on an already-deployed
   proxy. Not needed if `rework` ships as the first real deployment.
3. **YieldMinter is not a proxy yet.** Moving to the spec's UUPS + Pausable shape is a
   structural change, not an in-place upgrade.
4. **Role granularity is AccessManager config, not in-contract.** Every mutator is
   `restricted`. The Trustee-versus-RISK_COUNCIL split and the 24h `setDefault` timelock
   are wired in AccessManager, so the spec's role and timelock table is a deployment
   checklist.

---

## Spec map

- Data model authority: [loans-data.md](../../product-specs/loans-data.md)
- Lifecycle and state machine: [loans.md](../../product-specs/loans.md)
- Minting, caps, console: [trustee-console.md](../../product-specs/trustee-console.md)
- Registry function table and roles: [smart-contracts-registry.md](../../product-specs/smart-contracts-registry.md)
- YieldMinter interface: [smart-contracts-interfaces.md](../../product-specs/smart-contracts-interfaces.md)
- Yield delivery flow: [yield.md](../../product-specs/yield.md)
