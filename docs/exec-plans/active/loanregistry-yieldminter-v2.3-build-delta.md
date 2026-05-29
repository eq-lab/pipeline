# LoanRegistry + YieldMinter v2.3 — build delta

**Status:** spec landed, implementation pending
**Branch:** `docs/update-specs-v2.3`
**Spec commits:** `09cb08a` (loan-doc core), `28ff51f` (wider reconciliation)
**Source compared:** `eq-lab/pipeline-contracts@main` (`LoanRegistryUpgradeable.sol`, `PipelineLoanRegistry.sol`, `ILoanRegistry.sol`, `PipelineYieldMinterV1.sol`)

This is the engineering hand-off for the v2.3 LoanRegistry and YieldMinter spec
update. It records what the specs now require, how that differs from the current
`main` implementation, and the upgrade-safety constraints the implementers must respect.

---

## Background

Two drivers. First, origination economics move on-chain so the minter can enforce a
mint cap the operator cannot fake. Second, product confirmed that loans get rolled over
(new rate, new maturity) and re-termed on default, so "immutable loan data" cannot be
literally immutable. We reconciled the two with an append-only epoch model that keeps a
tamper-proof mint ceiling while allowing terms to change.

## The four decisions (locked with product)

1. **Genesis snapshot plus append-only epochs.** `ImmutableLoanData` (7 numeric fields)
   is written once and never rewritten. Rate and maturity live in an append-only
   `EconomicsEpoch[]`. The original terms and every re-term stay on-chain.
2. **Maturity-capped mint ceiling.** Vault-leg mints are bounded by a piecewise sum
   across epochs where each epoch's interest accrual stops at its own maturity. A loan
   past maturity cannot over-accrue. A rollover re-opens accrual under the new rate.
3. **Fast-path rollover, gated re-terms.** `rollover` is Trustee, no timelock, only
   after maturity. `amendEconomics` and `setDefault` are RISK_COUNCIL, 24h. All three
   only append an epoch, so they can raise the ceiling but cannot mint. Actual minting
   still needs `recordPayment` plus the Relayer and custodian attestation.
4. **`Matured` status added.** Mint is allowed only in `Performing` and `Watchlist`.
   Status control stays Trustee and RISK_COUNCIL.

Plus: `recordPayment` grew to 8 args (fees carved from gross interest, net coupon to the
vault, may be zero on interest-deferred early payments). `metadataURI` is mutable so
documents can be appended. YieldMinter splits into `mintLoanYield` and `mintTbillYield`
with per-loan caps and distinct replay maps.

---

## Spec (target) vs. current `main`

### LoanRegistry

| Dimension | Current `main` | Spec v2.3 (target) |
|---|---|---|
| Origination economics | None on-chain. `mintLoan(to, metadataURI, initialMaturity, location)` | `ImmutableLoanData` (7 numeric fields) at mint, mirrored to `epochs[0]`. `mintLoan(originator, economics, metadataURI, initialLocation)` |
| Rate over loan life | No rate field at all | Per-epoch `seniorInterestRateBps` in append-only `EconomicsEpoch[]` |
| Maturity | Single `maturity` field, no function extends it | `currentMaturityDate` set by `rollover` / `amendEconomics`. Full history in epochs |
| Repayment counters | 4 GLOBAL scalars in `LoanRegistryStorage` | 7 PER-LOAN counters in `MutableLoanData` (adds mgmt/perf/oet fees, `seniorInterestRepaid` becomes `seniorInterestRecorded`) |
| `recordPayment` args | 5 (offtaker, principal, interest, equity) | 8 (adds mgmtFee, perfFee, oetAlloc. interest is the net coupon) |
| Statuses | `Performing, WatchList, Default, Closed` | adds `Matured`. Mint-eligible is Performing/Watchlist only |
| Rollover | Absent | `rollover(loanId, newRateBps, newMaturityDate)` Trustee, post-maturity, no timelock |
| Default re-terms | `setDefault(loanId, ccrBps)` | `setDefault(loanId)` plus `amendEconomics(...)` RISK_COUNCIL 24h, appends epoch |
| `metadataURI` | set at mint, no setter | mutable via `updateMutable`, appendable docs |
| Link to minting | none | YieldMinter reads `getMutable` and epochs for the per-loan cap |
| Events | `Repayment`, `StatusUpdated`, `LoanDefaulted`, ... | `PaymentRecorded`, `LoanRolledOver`, `EconomicsAmended`, `LoanMinted` (carries economics), ... |
| Soulbound / ERC-7201 / UUPS | Yes / Yes / Yes | Unchanged |

### YieldMinter

| Dimension | Current `PipelineYieldMinterV1` | Spec v2.3 (target v2) |
|---|---|---|
| Functions | `mintYield(amount, signature)` single | `mintLoanYield(att, relayerSig, custodianSig)` plus `mintTbillYield(...)` |
| Signers | Single ECDSA (`mintAuthority`), no custodian | Two-party: Relayer ECDSA plus custodian EIP-1271 |
| Destinations | Vault only | Vault and Treasury, bound by leg |
| Loan linkage / cap | None | reads LoanRegistry, per-loan plus maturity-capped ceiling |
| Replay | sequential `nextNonce` | `usedLoanRefs` / `usedTbillRefs` ref maps |
| Mint call | `plUsd.mint(vault, amount)` direct | `PLUSD.mintForYield`, asserts ledger invariant |
| T-Bill path | Absent | `mintTbillYield`, NAV-delta cap |
| Upgradeable | No (plain `AccessManaged`, immutables, constructor) | UUPS proxy plus Pausable plus ERC-7201 |

---

## Upgrade-safety constraints (verified against OpenZeppelin Upgrades docs)

1. **The global-to-per-loan counter move is not an append-safe upgrade if the registry
   already holds state.** In `LoanRegistryStorage` the four global scalars
   (`offtakerReceivedTotal` and the rest) sit before the `metadataURI` and
   `mutableLoanData` mappings. The ERC-7201 and OZ rule is append-only: removing or
   reordering earlier fields shifts the mapping declaration slots and orphans every
   existing entry. So either (a) if not yet deployed with real state, author the new
   layout directly, or (b) if deployed, keep the global scalars as deprecated frozen
   slots, append the per-loan counters to the end of `MutableLoanData` (safe, because it
   is a mapping value and new members land in previously-zero slots), and append the
   `ImmutableLoanData` and `EconomicsEpoch[]` maps to the end of `LoanRegistryStorage`.
2. **`reinitializer(2)` for migration.** Seed `epochs[0]` from genesis economics and
   backfill the per-loan counters from historical `Repayment` events in a reinitializer,
   as the spec's upgrade-migration note states.
3. **YieldMinter v1 is not a proxy.** Moving to the two-path v2 is a fresh UUPS
   deployment, not an in-place upgrade. Plan the cutover. It holds no migratable state
   today beyond `nextNonce`.
4. **Role granularity is AccessManager config, not in-contract.** Every mutator is
   `restricted`. The Trustee-versus-RISK_COUNCIL split and the 24h `setDefault` timelock
   are wired in AccessManager, so the spec's role and timelock table is a deployment
   checklist, not contract logic.
5. **Naming alignment.** The contract enum is `WatchList`. The specs use `Watchlist`.
   Pick one before codegen.

---

## Spec map

- Data model authority: [loans-data.md](../../product-specs/loans-data.md)
- Lifecycle and state machine: [loans.md](../../product-specs/loans.md)
- Minting, caps, console: [trustee-console.md](../../product-specs/trustee-console.md)
- Registry function table and roles: [smart-contracts-registry.md](../../product-specs/smart-contracts-registry.md)
- YieldMinter interface: [smart-contracts-interfaces.md](../../product-specs/smart-contracts-interfaces.md)
- Yield delivery flow: [yield.md](../../product-specs/yield.md)
