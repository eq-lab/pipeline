# LoanRegistry + YieldMinter v2.3 — build delta

**Status:** spec landed, implementation in progress on `rework/loan-registry`
**Spec branch:** `docs/update-specs-v2.3` (commits `09cb08a`, `28ff51f`)
**Implementation branch:** `eq-lab/pipeline-contracts@rework/loan-registry` (supersedes `main` for tracking)
**Source compared:** `LoanRegistryUpgradeable.sol`, `PipelineLoanRegistry.sol`, `ILoanRegistry.sol`, `PipelineYieldMinter.sol` on `rework/loan-registry`

This is the engineering hand-off for the v2.3 LoanRegistry and YieldMinter spec
update. It records what the specs require, how that differs from the in-progress
`rework/loan-registry` implementation, and the divergences that still need a product or
security decision before the contracts are final.

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

## Spec (target) vs. `rework/loan-registry`

### Where the branch already matches the spec direction

- LoanRegistry is UUPS + AccessManaged + ERC-7201, soulbound, pausable.
- `ImmutableLoanData` is on-chain (7 fields) in a per-loan map, written once at draw.
- Per-loan `MutableLoanData`, per-loan `cumulativeRepaymentData`, and per-repayment
  `repaymentData[loanId][repaymentId]` maps replace the old global scalar counters.
- `recordPayment` carries the 6-component split (`seniorPrincipalRepaid`, `seniorInterest`,
  `mgmtFee`, `perfFee`, `oetAlloc`, `equityDistributed`) with the `sum <= offtakerAmount`
  invariant.
- YieldMinter delivers both legs: net senior coupon to the sPLUSD vault and
  `mgmtFee + perfFee + oetAlloc` to the Treasury.

### LoanRegistry differences

| Dimension | `rework/loan-registry` | Spec v2.3 (target) |
|---|---|---|
| Entry point | `drawLoan(to, metadataURI, immutableLoanData, initialCcrBps, location)` | `mintLoan(originator, economics, metadataURI, initialLocation)` |
| Immutable fields | `seniorTranche, equityTranche, offtakerPrice, rateBps, originationTimestamp, originalMaturityTimestamp, facility (string)` | adds numeric `originalFacilitySize`; `facility` is descriptive only |
| Mint invariants | only `initialCcrBps >= ONE` (1e6) | `senior + equity == facilitySize`, `offtakerPrice >= facilitySize`, `maturity > origination` |
| Rate / maturity over life | `ImmutableLoanData` truly immutable; `currentMaturityDate` has no setter | append-only `EconomicsEpoch[]`, `rollover` and `amendEconomics` update terms |
| Rollover / re-term | **absent** | `rollover` (Trustee, post-maturity) and `amendEconomics` (RISK_COUNCIL) |
| Statuses | `Performing, WatchList, Default, Closed` | adds `Matured` |
| Repayment model | per-repayment records (`nextRepaymentId`, per-id `RepaymentData`) plus a cumulative map | cumulative per-loan counters only |
| Mint replay / bound | `minted[loanId][repaymentId]` one-time flag; mints exactly the recorded amounts | `usedLoanRefs` plus the maturity-capped `ceiling(loanId)` independent bound |
| CCR scale | `ONE = 1_000_000` (1e6), floor at draw | spec used bps (1e4) |
| `metadataURI` | set at draw, no setter | mutable, appendable docs |

### YieldMinter differences

| Dimension | `rework` `PipelineYieldMinter` | Spec v2.3 (target) |
|---|---|---|
| Entry point | `mintYield(loanId, repaymentId)` single | `mintLoanYield(att, relayerSig, custodianSig)` + `mintTbillYield(...)` |
| Authorisation | **AccessManager `restricted` only, no signatures** | Relayer ECDSA + custodian EIP-1271, both verified on-chain |
| Mint bound | exactly the recorded `seniorInterest` + fees for that repayment | per-loan cap `min(seniorInterestRecorded, ceiling(loanId))` |
| Mint call | `plUsd.mint(vault, ...)` and `plUsd.mint(treasury, ...)` direct | `PLUSD.mintForYield`, asserts ledger invariant |
| T-Bill path | **absent** | `mintTbillYield`, NAV-delta cap |
| Replay | per-`(loanId, repaymentId)` via registry `minted` map | `usedLoanRefs` / `usedTbillRefs` |
| Upgradeable / pausable | **No** (plain `AccessManaged`, immutables, constructor) | UUPS + Pausable + ERC-7201 |
| Treasury address | set at construction, no setter | rotatable per spec governance |

---

## Divergences that need a decision

These are points where the in-progress code and the approved spec genuinely disagree.
They are product or security decisions, not naming cleanups, so they are listed for the
team rather than silently resolved in either direction.

1. **On-chain two-party attestation dropped.** The spec's core threat-model property is
   "no single compromise mints": Relayer ECDSA plus custodian EIP-1271 verified in the
   minter. The branch gates `mintYield` with the AccessManager role alone. If the role is
   held by an MPC or Safe that itself enforces multi-party signing, the property may hold
   off-chain, but it is no longer enforced or auditable in the contract.
2. **No independent mint ceiling.** The spec bounds a vault mint by the maturity-capped
   `principal x rate x elapsed` sum the contract computes itself, so even a colluding
   Trustee plus minter cannot mint more interest than the loan's terms could earn. The
   branch mints exactly the Trustee-recorded `seniorInterest`, bounded only by the
   `sum <= offtakerAmount` invariant on numbers the Trustee supplies. Decision #2 of the
   spec (math the contract can do on its own) is not implemented.
3. **Rollover / re-terms unaddressed on-chain.** Product required that loans roll over
   under new rate and maturity after maturity, and re-term on default. The branch has no
   epochs, no `rollover`, no `amendEconomics`, and no setter for `currentMaturityDate`.
   Either rollover is being deferred, handled off-chain, or modelled as a new loan NFT.
4. **Per-repayment records vs. cumulative counters.** Here the branch is arguably ahead of
   the spec: indexed per-repayment `RepaymentData` plus a one-time `minted` flag is a
   cleaner fit for lumpy and multi-tranche repayments than the spec's cumulative-only
   counters. Worth folding back into the spec regardless of how 1 to 3 resolve.

Open question for the team: align the code up to the spec (restore attestation, ceiling,
rollover), or amend the spec down to the simpler branch design (and accept the weaker
mint bound and off-chain-only multi-party control). Items 1 and 2 are security-relevant
and should not be settled by default.

---

## Upgrade-safety constraints (verified against OpenZeppelin Upgrades docs)

1. **The branch authors the ERC-7201 layout cleanly** (per-loan maps appended after
   `nextLoanId` and `metadataURI`), so the old `main` global-scalar problem is gone. Any
   future change must stay append-only: new fields only at the end of a struct or the
   namespaced storage struct, never reordered or removed.
2. **`reinitializer` for any migration** that introduces new state on an already-deployed
   proxy. Not needed yet if `rework` ships as the first real deployment.
3. **YieldMinter is not a proxy.** If the spec's UUPS + Pausable shape is kept, this is a
   structural change to the branch, not an in-place upgrade.
4. **Role granularity is AccessManager config, not in-contract.** Every mutator is
   `restricted`. The Trustee-versus-RISK_COUNCIL split and the 24h `setDefault` timelock
   are wired in AccessManager, so the spec's role and timelock table is a deployment
   checklist.
5. **Naming alignment.** Branch uses `drawLoan`, `WatchList`, `mintYield`, CCR in 1e6.
   Specs use `mintLoan`, `Watchlist`, `mintLoanYield`, CCR in bps. Pick one before codegen.

---

## Spec map

- Data model authority: [loans-data.md](../../product-specs/loans-data.md)
- Lifecycle and state machine: [loans.md](../../product-specs/loans.md)
- Minting, caps, console: [trustee-console.md](../../product-specs/trustee-console.md)
- Registry function table and roles: [smart-contracts-registry.md](../../product-specs/smart-contracts-registry.md)
- YieldMinter interface: [smart-contracts-interfaces.md](../../product-specs/smart-contracts-interfaces.md)
- Yield delivery flow: [yield.md](../../product-specs/yield.md)
