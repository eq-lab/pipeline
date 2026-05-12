---
title: Glossary
order: 36
section: Reference
---

# Glossary

One alphabetical list. Trade-finance terms sit alongside protocol terms because a lender reading Pipeline documentation eventually needs both. Italicised terms are defined elsewhere on this page.

---

## A

**AccessManager** — OpenZeppelin v5 role hub. Every privileged call across the protocol routes through it. Per-role timelocks are enforced here: ADMIN 3-day standard, 7-day for upgrades, 14-day meta-timelock on the delay parameter itself; RISK_COUNCIL 3-day; GUARDIAN instant.

**ADMIN** — A 3-of-5 MPC that holds every role-granting and upgrading power in the protocol, with a 3-day AccessManager delay on standard actions, 7-day delay on upgrades, and 14-day meta-timelock on changes to the delay itself. Re-enabling a paused contract, re-granting a revoked role, upgrading an implementation, and loosening any cap all require ADMIN. Every such action is cancellable by GUARDIAN during the delay window.

**AIS (Automatic Identification System)** — The maritime transponder standard that broadcasts a vessel's identity, position, course, and speed in real time. Pipeline uses AIS feeds (and platforms like MarineTraffic) to track cargo while it is at sea; a vessel's IMO number and AIS trail are part of the tracking evidence borrowers are expected to post.

---

## B

**BURNER (role)** — The role on PLUSD that authorises `PLUSD.burn`, called during the withdrawal-claim path to burn escrowed PLUSD as USDC is paid out. Held in MVP by the WithdrawalQueue proxy address (contract-held, not an EOA).

---

## C

**Capital Wallet** — Institutional-custody MPC address holding lender USDC and the USYC reserve. 5-share, 3-of-5 cosigner topology (Pipeline Team x2, Trustee x1, External Counterparties x2). All movements are on-chain ERC-20 transfers visible on Etherscan.

**CCR (Collateral Coverage Ratio)** — Collateral value divided by outstanding senior principal on a given loan, reported in basis points on LoanRegistry (e.g. 14000 = 140%). Pipeline's visible risk dial runs on three thresholds: above 130% is performing headroom, below 120% is maintenance margin call, and below 110% is margin call.

**Chainalysis** — Wallet-side AML and sanctions screening provider. Pipeline runs every lender wallet through Chainalysis on onboarding and on a 90-day refresh cycle.

**Charitable Trust** — Orphan trust at the top of the Pipeline entity hierarchy. Holds shares of The Trust Company. No beneficial owner.

**Circle Mint** — Operates the Payment Agent function — USDC ↔ USD conversion for loan funding, repayment on-ramping, and T-bill deployment.

**ClaimAttestation** — An EIP-712 payload signed off-chain by the Relayer under the `kytAttestor` key after a clean KYT result. The lender submits it to `DepositManager.claim` (or `WithdrawalQueue.claim`); the contract verifies the signature against the configured attestor address.

**CMA (Collateral Management Agreement)** — A contract under which an independent inspection and custody agent (SGS, Cotecna, Intertek) takes control of physical collateral (warehoused commodity, tank-farm stock) and releases it only against documented instructions. Gives a trade-finance lender verifiable, third-party confirmation that the cargo backing a loan exists and is controlled.

**Collateral Trust** — BVI statutory trust holding pledged bills of lading, warehouse receipts, and CMA receipts. Enforces on default.

**Commodity** — The physical good financed by a given Pipeline loan — for example jet fuel JET A-1, refined metals, or agricultural products. Recorded as immutable origination data on the LoanRegistry NFT alongside the Corridor and Offtaker.

**Corridor** — The route the cargo travels, typically stated as "origin country → destination country" (e.g. "South Korea → Mongolia"). Corridor is immutable origination data on every LoanRegistry NFT; sanctioned corridors are not financed.

**CTRM** — Commodity Trade and Risk Management system. Vessel tracking and cargo monitoring feed (Kpler primary; secondary feeds per deal). CTRM data drives the daily LTV refresh.

---

## D

**DEPOSITOR (role)** — The role on PLUSD that authorises `PLUSD.mintForDeposit`, the 1:1 deposit-leg mint called inside `DepositManager.claim`. Held in MVP by the DepositManager proxy address (contract-held, no human key).

**DepositManager** — Smart contract handling the two-step screened deposit. `deposit(amount)` parks USDC in the Intake Wallet and creates a deposit ticket. After the Relayer runs KYT and signs an EIP-712 ClaimAttestation, the lender calls `claim(depositId, attestation, signature)` to pull USDC from the Intake Wallet to the Capital Wallet, write a whitelist entry, and mint PLUSD 1:1.

**Deposit ticket** — A per-deposit entry in `DepositManager.tickets[lender][depositId]` recording amount, status, and timestamps. Statuses: `Pending` (awaiting KYT), `Claimable` (KYT clean), `UnderReview` (KYT soft fail in compliance queue), `Frozen` (KYT hard fail), `Claimed` (PLUSD minted), `Refunded` (USDC returned to lender).

---

## E

**EIP-712 attestation** — A structured-data signature format where the signer commits to a domain-separated, typed payload. Pipeline uses EIP-712 for ClaimAttestation, EnrolAttestation, and YieldAttestation. Both signatures on a yield mint (Relayer ECDSA + Trustee EIP-1271) are verified on-chain inside `YieldMinter.yieldMint` before PLUSD is minted.

**EIP-1271 signer** — A smart-contract signer that validates signatures by calling `isValidSignature(hash, signature)` on the signing contract, rather than recovering an ECDSA public key. Pipeline's Trustee operates an EIP-1271 signer for yield attestations; the contract independently verifies the underlying USDC inflow before co-signing any yieldMint.

**EnrolAttestation** — An EIP-712 payload signed by the Relayer under `kytAttestor` after an address-only KYT screen. The address holder submits it to `WhitelistRegistry.enrol`. Path 2 (standalone enrolment) for the whitelist.

**Equity tranche** — Junior slice of a commodity loan, funded by the Originator and held off-chain as first-loss capital. Realised losses hit the equity tranche before any sPLUSD writedown.

---

## F

**Facility** — A single trade-finance loan, typically tied to one Offtake contract for one cargo. Every facility is represented on-chain by one LoanRegistry NFT carrying its origination parameters and lifecycle state.

**Facility size** — The total committed loan amount at origination, in USDC (stored as `originalFacilitySize` on the LoanRegistry NFT). Split at mint into `originalSeniorTranche` (lender capital) and `originalEquityTranche` (originator first-loss).

**First-loss** — The tranche that absorbs realised losses before any other capital is hit. On Pipeline, the Originator equity tranche is first-loss on every loan.

**Framework: TBD** — Placeholder reference for the legal framework that governs Pipeline's KYT-only AML approach. Published before launch.

---

## G

**GUARDIAN** — A 2-of-5 MPC with instant, defence-only powers: pause any pausable contract, cancel any pending scheduled ADMIN or RISK_COUNCIL action, and revoke individual operational-role holders (`WHITELIST_REVOKER`, `TRUSTEE`) one at a time. Cannot grant roles, unpause, upgrade, or initiate any risk-increasing action. Restoration is strictly ADMIN's job under the 3-day timelock (7-day for upgrades).

---

## H

**Hashnote** — Asset manager that issues USYC, Hashnote's tokenised U.S. Treasury-bill product. Pipeline uses USYC as its idle-reserve yield engine. Pipeline redeems USYC for USDC against the Hashnote redemption rail to realise T-bill yield.

---

## I

**Intake Wallet** — A separate MPC custody address that holds USDC during the screening window between `DepositManager.deposit` and `DepositManager.claim`. Same cosigner substrate as the Capital Wallet under a deposit-specific sub-policy. Smart contracts hold standing allowances against the Intake Wallet for `claim` (Intake → Capital) and `refund` (Intake → lender) settlements. A compromise of the Intake Wallet drains parked deposits but cannot drain the Capital Wallet.

---

## K

**KYT (Know Your Transaction)** — Compliance screening that evaluates an address against sanctions and risk lists, and evaluates an inbound transaction for source-of-funds risk. Pipeline runs KYT on every deposit, on standalone address enrolments, and on scheduled passive re-screening of whitelisted addresses. KYT replaces customer identity verification (KYC, KYB) and accreditation declarations for lender onboarding under the `[Framework: TBD]` legal frame.

**kytAttestor** — The Relayer's ECDSA signing key whose address is stored as a parameter on DepositManager, WithdrawalQueue, and WhitelistRegistry. The Relayer signs `ClaimAttestation` (for deposit and withdrawal claims) and `EnrolAttestation` (for standalone whitelist enrolment) with this key. Rotated via per-contract `setKytAttestor` setters under 48-hour ADMIN timelock. Signing-key relationship, not a role grant.

---

## L

**Letter of credit** — A bank instrument under which an issuing bank undertakes to pay the seller once stated shipping and document conditions are met. A classical trade-finance payment mechanism. Pipeline finances the seller's working capital against the underlying trade, not the letter of credit itself.

**LoanRegistry** — An ERC-721 (soulbound) contract that records every loan facility as an NFT, with immutable origination data and mutable lifecycle state. Public audit trail of every loan. Informational only — a compromised or erroneous write to LoanRegistry moves no USDC and cannot change sPLUSD share price, which responds only to real yieldMint events.

**Loan Originator** — Independent commodity trading house, merchant, or specialist trade-finance shop that sources deals, underwrites them, and contributes the equity tranche on every loan they bring to Pipeline.

**LTV (Loan-to-Value)** — Outstanding loan principal divided by current cargo value. Marked daily against independent price assessments (Platts, Argus).

---

## M

**maxPerLPPerWindow** — A DepositManager parameter capping the USDC a single lender can deposit inside the rolling 24h deposit window. Together with `maxPerWindow` it bounds single-actor concentration on the deposit leg. YieldMinter has no per-account caps.

**maxPerWindow** — A DepositManager parameter capping the aggregate USDC accepted across all lenders inside the rolling 24h deposit window (launch value: $10M / 24h).

**maxTotalSupply** — Hard ceiling on `PLUSD.totalSupply() + outstandingClaimable` checked at deposit time and re-checked at claim time. `outstandingClaimable` reserves cap headroom for tickets already screened-clean but not yet claimed. Applies to both DepositManager and YieldMinter. Tightening is instant under GUARDIAN; loosening is 3-day-timelocked under ADMIN.

**mintForDeposit** — The PLUSD function the DepositManager calls inside `claim` to mint deposit-leg PLUSD 1:1 against a screened USDC deposit. Gated by the DEPOSITOR role and enforces the reserve invariant and `maxTotalSupply` ceiling.

**mintForYield** — The PLUSD function the YieldMinter calls to mint yield-leg PLUSD into the sPLUSD vault or the Treasury Wallet. Gated by the YIELD_MINTER role and enforces the reserve invariant and `maxTotalSupply` ceiling. Signature verification lives one layer up in YieldMinter.

**MOPS** — Mean of Platts Singapore. Benchmark price assessment used for refined-products pricing and LTV margining.

**MPC** — Multi-Party Computation. Cryptographic technique enabling threshold signing without any party ever holding a complete signing key. Used by BitGo for Pipeline's custody wallets, and by Pipeline's governance Safes (ADMIN, RISK_COUNCIL, GUARDIAN) at the on-chain layer.

---

## O

**Offtake contract** — A commercial agreement under which the Offtaker commits to buy a specified cargo at a stated price and schedule. Pipeline typically originates one Facility per offtake contract and books the end-buyer obligation as `originalOfftakerPrice` on the LoanRegistry NFT.

**Offtaker** — The end buyer of the physical commodity in a trade-finance deal. When the offtaker pays for the cargo, USD lands in the Trustee's correspondent bank account; the Trustee then on-ramps USD → USDC into the Capital Wallet. The offtaker never touches USDC and never touches the chain.

**Open Mineral AG** — Pipeline's inaugural Loan Originator. Swiss-headquartered metals merchant founded by ex-Glencore principals, backed by Mubadala.

**Operational Expense Trust (OET)** — Ring-fenced runway reserve. Pre-funded by a fraction of commission fees. Covers fixed operating costs through an orderly wind-down.

**Originator** — Short for Loan Originator.

---

## P

**Payment Agent** — Operates the fiat bridge via Circle Mint. Handles USD↔USDC for loan funding, repayment, and T-bill deployment. Operational counterparty, not part of the legal structure.

**PLIOU** — Contingent loss-absorption token, issued by The Trust Company only when a default has been declared, the equity tranche is exhausted, and a residual principal gap remains. Sold for PLUSD at discount to par; redeemed at par from future protocol revenue. Capped at 10% of PLUSD supply, 60-month horizon. Available beyond MVP.

**Platts / Argus** — Independent commodity price-assessment providers (S&P Global, LSEG). Pipeline uses them as the oracle source for daily LTV mark-to-market.

**PLUSD** — Pipeline's ERC-20 dollar receipt. Minted 1:1 against deposited USDC. One PLUSD represents one USDC held at the Capital Wallet. Transfers require both endpoints to be whitelisted or one to be a system address (DepositManager, YieldMinter, WithdrawalQueue, sPLUSD vault). Fresh supply enters only through mintForDeposit or mintForYield.

**PRT (Pipeline Recovery Tokens)** — Post-MVP ERC-20 IOU token. Issued pro-rata to PLUSD and sPLUSD holders when loss exceeds the equity tranche and the sPLUSD writedown cushion. 1 PRT = $1 face claim against the Recovery Pool, redeemable at `pool.balance / totalSupply(PRT)` (capped at 1.0, ratchets up only). Freely transferable.

---

## R

**Realised gain (USYC)** — `USDC proceeds − cost basis of units sold`, computed at the moment a Trustee-instructed USYC redemption settles. Remaining position's cost basis is reduced by the cost basis of units sold. Realised gains are the only USYC-engine input to PLUSD mints.

**RecoveryPool** — Dormant contract in MVP. Reserved primitive for post-MVP recovery flows alongside PRT. Holds USDC against which PRT holders redeem at the published rate.

**recordRepayment** — A LoanRegistry function the Trustee calls to book a split of an offtaker payment across senior principal, senior interest, and equity tranche. Pure accounting — moves no USDC and mints no PLUSD; actual yield delivery runs through the independent yieldMint path on YieldMinter.

**Relayer** — Pipeline's off-chain backend. Indexes the chain, co-signs YieldAttestations alongside the Trustee, signs KYT attestations off-chain (`kytAttestor`), and operates the WHITELIST_REVOKER role for fast sanctions response. Holds no custody share. Cannot mint PLUSD alone. Never writes to DepositManager or WithdrawalQueue directly. Signs off-chain attestations that the lender or address holder submits at claim or enrol time. A compromised Relayer cannot mint PLUSD on its own.

**relayerYieldAttestor** — The Relayer's ECDSA signing key whose address is stored on YieldMinter. The Relayer signs the first half of every yield attestation with this key. Rotated via `YieldMinter.proposeYieldAttestors` under a 48-hour ADMIN timelock. Held in an air-gapped hardware signer.

**Reserve invariant** — An on-chain, per-transaction check that `totalSupply + amount ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns` on every PLUSD mint path. Internal-consistency check against PLUSD's own ledger — not a Proof of Reserve — and catches over-mint or counter desync before supply changes.

**RISK_COUNCIL** — A 3-of-5 MPC with a 3-day AccessManager delay on its actions. Scope: `setDefault` on a LoanRegistry loan, write-down closures (`closeLoan` with reason `Default` or `OtherWriteDown`), and exchange-coefficient changes on the WithdrawalQueue. Cannot grant roles, upgrade, or unpause.

**Risk committee** — Off-chain governance body of five members that approves loans, reviews concentration weekly, declares defaults, and sets recovery coefficients during workout. Decisions expressed on-chain via the RISK_COUNCIL MPC.

---

## S

**Senior tranche** — The senior slice of a commodity loan, funded by Pipeline lenders via the sPLUSD vault. Earns the senior coupon. Sits behind the equity tranche (and PRT, post-MVP) in the loss waterfall.

**ShutdownController** — Dormant contract in MVP. Reserved primitive for post-MVP terminal-mode scenarios. MVP loss handling uses the WithdrawalQueue exchange coefficient as the entire mechanism.

**Split-rail** — Pipeline's architecture: a cash rail where USDC sits in self-custodied MPC wallets (Intake, Capital, Withdrawal Queue, Treasury) operated under the Trustee + Team + External Counterparties cosigner policy; and a token rail where on-chain contracts track receipts and enforce rules. Rules link the two rails; no contract can spend wallet funds, and no single cosigner can mint tokens or move USDC alone.

**sPLUSD** — ERC-4626 vault wrapping PLUSD. Stakers deposit PLUSD and receive sPLUSD shares whose redemption value rises as fresh PLUSD is minted into the vault through yieldMint. Share price moves only on actual mints, not on LoanRegistry writes or time-based accrual.

**Strategy Trusts** — Cayman / BVI Purpose Trusts that ring-fence each investment strategy. Capital allocated to one strategy cannot be commingled with another.

**Sumsub** — Identity-verification provider used for KYC (individuals) and KYB (entities) on Pipeline's Originator and counterparty onboarding flows. Not used for lender onboarding; lenders are screened by KYT only.

---

## T

**Team** — Pipeline's operating team. Holds two MPC cosigner shares on each Capital Layer wallet (Intake, Capital, Withdrawal Queue, Treasury). Holds no on-chain role; has no ability to mint PLUSD or move USDC alone.

**The Trust Company** — Cayman holding entity that owns the Strategy Trusts and the Operational Expense Trust. Exercises protocol-level governance, holds the USD bank account, and signs the custody quorum.

**totalClaimable** — WithdrawalQueue aggregate: `totalRequested - totalClaimed`. The currently outstanding obligations. Every claim asserts `claimAmount ≤ totalClaimable`; the queue physically refuses to pull more than it owes.

**totalClaimed** — WithdrawalQueue aggregate: cumulative PLUSD burned via successful claims.

**totalRequested** — WithdrawalQueue aggregate: cumulative PLUSD escrowed across all withdrawal requests ever submitted.

**Trade Company (Cayman SPC)** — Segregated-portfolio company; lender of record on every loan. Each strategy sits in a separate Segregated Portfolio with statutory ring-fencing under Cayman Companies Act Part XIV.

**Tranche** — A slice of a loan with a defined priority in the repayment waterfall. Pipeline's facilities are structured with a senior tranche (lender capital, paid first) and an equity tranche (originator first-loss, paid last).

**Treasury Wallet** — Institutional-custody MPC address that accumulates protocol fees (management, performance, OET allocation) and the 30% Treasury share of realised T-bill yield. 5-share, 3-of-5 cosigner topology.

**Trustee** — Pipeline Trust Company, an independent legal entity. Operationally the Trustee is (a) the sole caller of LoanRegistry lifecycle writes for non-default reasons (`recordRepayment`, Trustee-branch `closeLoan`); and (b) one MPC cosigner on every Capital Layer wallet. The Trustee does not custody USDC alone and cannot mint PLUSD.

**TRUSTEE (role)** — The on-chain role on LoanRegistry that authorises Trustee-branch loan NFT writes. Held in MVP by the Trustee key alone. Revocable instantly by GUARDIAN, re-grantable only by ADMIN under the 3-day timelock.

**trusteeYieldAttestor** — The Trustee's EIP-1271 signer contract whose address is stored on YieldMinter. The Trustee co-signs every yield mint after independently verifying the underlying USDC inflow (senior-coupon on-ramp or realised USYC sale proceeds). Signature recovered on-chain inside `YieldMinter.yieldMint` before any PLUSD is minted.

---

## U

**Unrealised gain (USYC)** — `USYC NAV × units − cost basis`. Informational only — does not enter `PLUSD.totalSupply` and does not move sPLUSD share price. Becomes realised only when the Trustee instructs the wallet to sell USYC for USDC.

**UPGRADER (role)** — The role on AccessManager that authorises `upgradeTo(newImpl)` on every UUPS proxy. Held in MVP by ADMIN. Upgrades are 7-day-delayed and GUARDIAN-cancellable. The delay itself is protected by a 14-day meta-timelock.

**USYC** — Hashnote's tokenised U.S. Treasury-bill holding, parked in the Capital Wallet. NAV drifts up daily as the underlying bills accrue, but the gain is unrealised. Yield is delivered to PLUSD only when the Trustee instructs the wallet to sell USYC for USDC against the Hashnote redemption rail; realised gain is then minted via YieldMinter, 70% to the sPLUSD vault and 30% to the Treasury Wallet.

---

## W

**WhitelistRegistry** — On-chain allowlist of compliance-screened lender addresses. Both endpoints of every PLUSD transfer must be whitelisted (or one must be a system address). 90-day KYT freshness window enforced via `approvedAt` per entry. Three enrolment paths: deposit-triggered (auto-enrol via `DepositManager.claim`), standalone (holder calls `enrol` with an EnrolAttestation), and DeFi venue (governance-added).

**WHITELIST_ADMIN (role)** — The role on WhitelistRegistry that authorises `setAccess` (enrolment). Held in MVP by the DepositManager proxy address (so auto-enrolment can happen inside `DepositManager.claim`). Contract-held.

**WHITELIST_REVOKER (role)** — The role on WhitelistRegistry that authorises `revokeAccess`. Held by the Relayer EOA. Narrow defensive on-chain role for fast sanctions response. GUARDIAN can revoke this role instantly.

**Withdrawal Queue Wallet** — Institutional-custody MPC address holding USDC earmarked for queued withdrawals. Funded by periodic top-ups from the Capital Wallet under the 3-of-5 cosigner quorum (Trustee mandatory). Pre-approved as a USDC source for the WithdrawalQueue contract via standing allowance.

**WithdrawalQueue** — On-chain user-pulled FIFO exit queue. Lenders escrow PLUSD via `requestWithdrawal`, receive a queue ID, then call `claim` themselves. The queue contract pulls USDC from the Withdrawal Queue Wallet via the wallet's standing allowance, with a `claimAmount ≤ totalClaimable` aggregate-ledger ceiling. Can carry an exchange coefficient less than 1.0 during recovery.

---

## Y

**YieldAttestation** — An EIP-712 payload referencing a specific USDC inflow (senior coupon repayment or realised USYC sale proceeds). Co-signed by the Relayer (`relayerYieldAttestor`) and the Trustee (`trusteeYieldAttestor`). Submitted to `YieldMinter.yieldMint`, which verifies both signatures on-chain before minting.

**YieldMinter** — Two-party yield mint gate. Requires verified signatures from both the Trustee attestor (EIP-1271) and the Relayer attestor before any PLUSD is minted. Mint destinations hard-constrained to the sPLUSD vault or Treasury Wallet. `usedRepaymentRefs` replay guard rejects any attestation ID already consumed.

**YIELD_MINTER (role)** — The role on PLUSD that authorises `PLUSD.mintForYield`. Held in MVP by the YieldMinter proxy address (contract-held, not an EOA).

**yieldMint** — The YieldMinter function called to mint yield-leg PLUSD. Verifies both signatures, checks the replay guard, enforces the recipient constraint (sPLUSD vault or Treasury Wallet only), and calls `PLUSD.mintForYield`.
