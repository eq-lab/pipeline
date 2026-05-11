---
title: Glossary
order: 18
section: Reference
---

# Glossary

One alphabetical list. Trade-finance terms sit alongside protocol terms because a lender reading Pipeline documentation eventually needs both. Every entry is two sentences or fewer. Italicised terms are defined elsewhere on this page.

---

## A

**AccessManager** — The OpenZeppelin contract that holds every privileged role in the protocol and enforces scheduled actions with per-selector delays. It is the single hub the three governance Safes operate against; upgrades, role grants, and parameter loosenings all flow through it.

**ADMIN Safe** — A 3-of-5 Gnosis Safe that holds every role-granting and upgrading power in the protocol, with a 48-hour AccessManager delay on every action (14 days on changes to the delay itself). Re-enabling a paused contract, re-granting a revoked role, upgrading an implementation, and loosening any cap all require ADMIN, and every such action is cancellable by *GUARDIAN Safe* during the delay window.

**AIS (Automatic Identification System)** — The maritime transponder standard that broadcasts a vessel's identity, position, course, and speed in real time. Pipeline uses AIS feeds (and platforms like MarineTraffic) to track cargo while it is at sea; a vessel's IMO number and AIS trail are part of the tracking evidence borrowers are expected to post.

---

## B

**BURNER (role)** — The role on *PLUSD* that authorises `PLUSD.burn`, called during the withdrawal-claim path to burn escrowed PLUSD as USDC is paid out. Held in MVP by the *WithdrawalQueue* proxy address (contract-held, not an EOA).

---

## C

**Capital Wallet** — An on-chain Ethereum address holding Pipeline's USDC reserves, USDC out on active loans, and *USYC* holdings. Self-custodied via an MPC TSS quorum. Control is split across three cosigners — *Trustee*, *Team*, and *Relayer* — under a fixed signing policy. All movements in and out are on-chain ERC-20 transfers visible on Etherscan.

**CCR (Collateral Coverage Ratio)** — Collateral value divided by outstanding senior principal on a given loan, reported in basis points on LoanRegistry (e.g. 14000 = 140%). Pipeline's visible risk dial runs on three thresholds: above 130% is performing headroom, below 120% moves the loan to Watchlist, and below 110% triggers *RISK_COUNCIL Safe* escalation.

**claimAtShutdown** — The WithdrawalQueue function a lender calls post-shutdown if they had an in-flight queue entry at the time of execution. It applies the fixed recovery rate symmetrically to both Pending and Funded entries, so early queuers do not get a better rate than holders who redeem directly — it closes the queue-jump exploit class.

**CMA (Collateral Management Agreement)** — A contract under which an independent inspection and custody agent takes control of the physical collateral (warehoused commodity, tank-farm stock) and releases it only against documented instructions. A CMA gives a trade-finance lender verifiable, third-party confirmation that the cargo backing a loan exists and is controlled.

**Commodity** — The physical good financed by a given Pipeline loan — for example jet fuel JET A-1, refined metals, or agricultural products. Recorded as immutable origination data on the LoanRegistry NFT alongside the *Corridor* and *Offtaker*.

**Corridor** — The route the cargo travels, typically stated as "origin country → destination country" (e.g. "South Korea → Mongolia"). Corridor is immutable origination data on every LoanRegistry NFT; sanctioned corridors are not financed, and concentration across corridors is a diversification constraint.

**trusteeYieldAttestor** — The *Trustee*'s *EIP-1271 signer* contract whose address is stored on *YieldMinter*. The Trustee co-signs every yield mint after independently verifying the underlying USDC inflow (a senior-coupon on-ramp from the Trustee bank, or a realised USYC sale's USDC proceeds); the signature is recovered on-chain inside `YieldMinter.yieldMint` before any PLUSD is minted.

---

## D

**DEPOSITOR (role)** — The role on *PLUSD* that authorises `PLUSD.mintForDeposit`, the 1:1 deposit-leg mint called inside `DepositManager.claim`. Held in MVP by the *DepositManager* proxy address (contract-held, not an EOA), no human key holds it.

**DepositManager** — The contract lenders call to deposit USDC. The flow is two-step. `DepositManager.deposit(amount)` parks USDC in the *Intake Wallet* and creates a deposit ticket. After the *Relayer* runs *KYT* and marks the ticket claimable, the lender calls `DepositManager.claim(depositId)` to pull USDC from the Intake Wallet to the Capital Wallet and mint *PLUSD* 1:1.

**Deposit ticket** — A per-deposit entry in `DepositManager.tickets[lender][depositId]` recording amount, status, and timestamps. Statuses: `Pending` (awaiting KYT), `Claimable` (KYT clean), `UnderReview` (KYT soft fail in compliance queue), `Frozen` (KYT hard fail), `Claimed` (PLUSD minted), `Refunded` (USDC returned to lender).

---

## E

**EIP-712 attestation** — A structured-data signature format where the signer commits to a domain-separated, typed payload instead of an opaque hash. Pipeline's yield mints carry two independent EIP-712 signatures — one from the *Relayer*'s ECDSA key (`relayerYieldAttestor`), one from the *Trustee*'s *EIP-1271 signer* (`trusteeYieldAttestor`) — both verified on-chain inside *YieldMinter* before PLUSD is minted.

**EIP-1271 signer** — A smart-contract signer that validates signatures by calling `isValidSignature(hash, signature)` on the signing contract, rather than recovering an ECDSA public key. Pipeline's *Trustee* operates an EIP-1271 signer for yield attestations; the contract independently verifies the underlying USDC inflow before co-signing any *yieldMint*.

**Equity tranche** — The junior slice of a commodity loan, funded by the *Originator* and held off-chain as *first-loss* capital. Realised losses hit the Equity tranche before any *sPLUSD* writedown, so lenders are shielded as long as losses stay within this cushion.

---

## F

**Facility** — A single trade-finance loan, typically tied to one *Offtake contract* for one cargo. Every facility is represented on-chain by one LoanRegistry NFT carrying its origination parameters and lifecycle state.

**Facility size** — The total committed loan amount at origination, in USDC (stored as `originalFacilitySize` on the LoanRegistry NFT). It is split at mint into `originalSeniorTranche` (lender capital) and `originalEquityTranche` (originator first-loss).

**First-loss** — The tranche that absorbs realised losses before any other capital is hit. On Pipeline, the *Originator* equity tranche is first-loss on every loan; only once it is exhausted does loss reach the *sPLUSD* share price.

---

## G

**GUARDIAN Safe** — A 2-of-5 Gnosis Safe with instant, defence-only powers: pause any pausable contract, cancel any pending ADMIN-scheduled action, and revoke individual operational-role holders (YIELD_MINTER, WHITELIST_REVOKER, TRUSTEE) one at a time. GUARDIAN cannot grant roles, unpause, upgrade, or initiate any risk-increasing action. Restoration is strictly *ADMIN Safe*'s job under the 48h timelock.

---

## H

**Hashnote** — The asset manager that issues *USYC*, the tokenized U.S. Treasury-bill product Pipeline uses as its idle-reserve yield engine. Pipeline's *Relayer* reads NAV directly from the Hashnote API to compute the lazy *yieldMint* on sPLUSD stake/unstake events.

---

## I

**Intake Wallet** — A separate MPC custody address that holds USDC during the screening window between `DepositManager.deposit` and `DepositManager.claim`. Same cosigner substrate as the *Capital Wallet* under a deposit-specific sub-policy. Smart contracts hold standing allowances against the Intake Wallet for `claim` (Intake to Capital) and `refund` (Intake to lender) settlements. A compromise of the Intake Wallet drains parked deposits but cannot drain the Capital Wallet.

---

## K

**KYT (Know Your Transaction)** — Compliance screening that evaluates an address against sanctions and risk lists, and evaluates an inbound transaction for source-of-funds risk. Pipeline runs KYT on every deposit, on standalone address enrolments, and on scheduled passive re-screening of whitelisted addresses. KYT replaces customer identity verification (KYC, KYB) for lender onboarding under the *Framework: TBD* legal frame.

**kytAttestor** — The Relayer's ECDSA signing key whose address is stored as a parameter on *DepositManager*, *WithdrawalQueue*, and *WhitelistRegistry*. The Relayer signs `ClaimAttestation` (for deposit and withdrawal claims) and `EnrolAttestation` (for standalone whitelist enrolment) with this key. Each contract verifies the signature on-chain at the moment the lender or address holder submits the attestation. Rotated via per-contract `setKytAttestor` setters under 48h ADMIN timelock. This is a signing-key relationship, not a role grant.

---

## L

**Letter of credit** — A bank instrument under which an issuing bank undertakes to pay the seller once stated shipping and document conditions are met. Letters of credit are a classical trade-finance payment mechanism; Pipeline finances the seller's working capital against the underlying trade, not the letter of credit itself.

**LoanRegistry** — An ERC-721 (soulbound) contract that records every loan facility as an NFT, with immutable origination data and mutable lifecycle state. It is informational only — a compromised or erroneous write to LoanRegistry moves no USDC and cannot change *sPLUSD* share price, which responds only to real *yieldMint* events.

---

## M

**maxPerLPPerWindow** — A *DepositManager* parameter capping the USDC a single lender can deposit inside the rolling 24h deposit window. Together with `maxPerWindow` it bounds single-actor concentration on the deposit leg. YieldMinter has no per-account caps.

**maxPerWindow** — A *DepositManager* parameter capping the aggregate USDC accepted across all lenders inside the rolling 24h deposit window (launch value: $10M / 24h). Yield mints do not consume this budget. YieldMinter is a separate contract with separate gating.

**maxTotalSupply** — A hard ceiling on `PLUSD.totalSupply() + outstandingClaimable` checked at deposit time and re-checked at claim time. The `outstandingClaimable` term reserves cap headroom for tickets already screened-clean but not yet claimed. Applies to both *DepositManager* and *YieldMinter* on `mintForYield`. Tightening is instant under ADMIN, loosening is 48h-timelocked.

**mintForDeposit** — The PLUSD function the *DepositManager* contract calls inside `claim` to mint deposit-leg PLUSD 1:1 against a screened USDC deposit. It is gated by the *DEPOSITOR* role (held exclusively by the DepositManager proxy) and enforces the *reserve invariant* and `maxTotalSupply` ceiling before minting.

**mintForYield** — The PLUSD function the *YieldMinter* contract calls to mint yield-leg PLUSD into the sPLUSD vault or the *Treasury Wallet*. It is gated by the *YIELD_MINTER* role (held exclusively by the YieldMinter proxy) and enforces the *reserve invariant* and `maxTotalSupply` ceiling before minting. Signature verification lives one layer up in YieldMinter.

---

## O

**Offtake contract** — A commercial agreement under which the *Offtaker* commits to buy a specified cargo at a stated price and schedule. Pipeline typically originates one *Facility* per offtake contract and books the end-buyer obligation as `originalOfftakerPrice` on the LoanRegistry NFT.

**Offtaker** — The end buyer of the physical commodity in a trade-finance deal. When the offtaker pays for the cargo, USD lands in the *Trustee*'s correspondent bank account; the Trustee then on-ramps USD → USDC into the *Capital Wallet* and records the tranche split on LoanRegistry. The offtaker never touches USDC and never touches the chain.

**Original offtaker price** — The total USDC the end buyer is contracted to pay for the cargo, recorded as `originalOfftakerPrice` on the LoanRegistry NFT at mint time. Outstanding offtaker balance on a live loan is derived as `originalOfftakerPrice − offtakerReceivedTotal`.

**Originator** — The commodity-trading firm that sources the deal and posts the *Equity tranche* off-chain as first-loss. The originator brings the borrower, term sheet, and diligence to the *Trustee* off-chain; the first on-chain event in the life of a facility is the Trustee minting the loan NFT on *LoanRegistry*. Open Mineral is Pipeline's launch originator; additional originators are onboarded over time.

---

## P

**PLUSD** — Pipeline's ERC-20 deposit receipt. One PLUSD represents one USDC held at the *Capital Wallet*. Transfers require both endpoints to be whitelisted addresses or system addresses (the `_update` hook on PLUSD enforces the rule). Fresh supply enters only through *mintForDeposit* or *mintForYield*.

---

## R

**RecoveryPool** — The contract that holds USDC for lender recovery payments after shutdown. `redeemInShutdown` and `claimAtShutdown` both draw from RecoveryPool at the fixed recovery rate; as the *Trustee* repatriates capital over time, *RISK_COUNCIL Safe* may ratchet the rate upward.

**recordRepayment** — The LoanRegistry function the *Trustee* calls to book a split of an offtaker payment across Senior principal, Senior interest, and *Equity tranche*. It is pure accounting — it moves no USDC and mints no PLUSD; actual yield delivery runs through the independent *yieldMint* path on *YieldMinter*.

**redeemInShutdown** — The PLUSD function a holder calls during shutdown to exchange PLUSD for USDC at the frozen recovery rate. Every PLUSD redeemed during shutdown pays the same per-unit amount regardless of order, so there is no race to redeem and no queue jump.

**Relayer** — Pipeline's backend service. Holds one operational role on-chain: *WHITELIST_REVOKER* on WhitelistRegistry (narrow defensive role for fast sanctions response). Holds two off-chain signing keys whose addresses are referenced by contracts: `kytAttestor` (signs deposit and withdrawal claim attestations and standalone enrol attestations) and `relayerYieldAttestor` (first signer on yield mints). Relayer never custodies USDC, never touches LoanRegistry, and never writes to DepositManager or WithdrawalQueue directly. It signs off-chain attestations that the lender or address holder submits at claim or enrol time. A compromised Relayer cannot mint PLUSD on its own (PLUSD is only minted when the lender calls `claim` against their own deposited USDC).

**relayerYieldAttestor** — The Relayer's ECDSA signing key whose address is stored on *YieldMinter*. The Relayer signs the first half of every yield attestation with this key; it is rotated via `YieldMinter.proposeYieldAttestors` under a 48h ADMIN timelock and is held in an air-gapped hardware signer with no internet egress.

**Reserve invariant** — An on-chain, per-transaction check that `totalSupply + amount ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns` on every PLUSD mint path. It is an internal-consistency check against PLUSD's own ledger — not a Proof of Reserve — and catches over-mint or counter desync before supply changes.

**RISK_COUNCIL Safe** — A 3-of-5 Gnosis Safe with a 24-hour AccessManager delay on its actions. Its scope is narrow: `setDefault` on a LoanRegistry loan, `proposeShutdown` on the *ShutdownController*, and `adjustRecoveryRateUp` during shutdown — it cannot grant roles, upgrade, or unpause.

---

## S

**Senior tranche** — The senior slice of a commodity loan, funded by Pipeline lenders through the *sPLUSD* vault. Senior principal and the net senior coupon (gross interest minus management and performance fees) are what flows back to lenders when the *Offtaker* pays.

**ShutdownController** — A standalone contract that holds the single `isActive` flag and `recoveryRateBps` the rest of the protocol reads. Entering shutdown is a one-way transition proposed by *RISK_COUNCIL Safe* (24h delay) and executed by *ADMIN Safe*; the rate ratchets up only, never down.

**Split-rail** — Pipeline's architecture: a cash rail where USDC sits in self-custodied MPC wallets (Capital Wallet, Treasury Wallet) operated by the *Trustee*, *Team*, and *Relayer*; and a token rail where the on-chain contracts track receipts and enforce rules. Rules link the two rails; no contract can spend wallet funds, and no single MPC cosigner can mint tokens or move USDC alone.

**sPLUSD** — An ERC-4626 vault wrapping *PLUSD*. Stakers deposit PLUSD and receive sPLUSD shares whose redemption value rises as fresh PLUSD is minted into the vault through *yieldMint*; share price moves only on actual mints, not on LoanRegistry writes or time-based accrual.

---

## T

**Team** — Pipeline's operating team, which holds two MPC cosigner shares on the *Capital Wallet* and one on the *Treasury Wallet*. Team holds no on-chain role (no WHITELIST_REVOKER, TRUSTEE, etc.) and has no ability to mint PLUSD.

**Tranche** — A slice of a loan with a defined priority in the repayment waterfall. Pipeline's facilities are structured with a *Senior tranche* (lender capital, paid first) and an *Equity tranche* (originator first-loss, paid last).

**Treasury Wallet** — A self-custodied on-chain Ethereum address with a distinct MPC cosigner set from the *Capital Wallet*. It accumulates protocol fees and the 30% Treasury share of realised T-bill yield; a compromise at one wallet does not propagate to the other.

**Trustee** — Pipeline Trust Company, an independent legal entity holding the Trustee key. Operationally the Trustee is (a) the sole caller of every LoanRegistry write — `mintLoan`, `updateMutable`, `recordRepayment`, Trustee-branch `closeLoan` — and (b) one MPC cosigner on the *Capital Wallet*; the Trustee does not custody USDC alone and cannot mint PLUSD.

**TRUSTEE (role)** — The role on *LoanRegistry* that authorises all loan NFT writes. Held in MVP by the *Trustee* key alone; revocable instantly by *GUARDIAN Safe*, re-grantable only by *ADMIN Safe* under the 48h timelock.

---

## U

**UPGRADER (role)** — The role on AccessManager that authorises `upgradeTo(newImpl)` on every UUPS proxy. Held in MVP by the *ADMIN Safe*; upgrades are 48h-delayed and *GUARDIAN Safe*-cancellable, and the delay itself is protected by a 14-day meta-timelock.

**USYC** — Hashnote's tokenised U.S. Treasury-bill holding, parked in the *Capital Wallet*. USYC NAV drifts up daily as the underlying bills accrue, but the gain is **unrealised** — it stays in the wallet. Yield is delivered to PLUSD only when the *Trustee* instructs the wallet to sell USYC for USDC against the Hashnote redemption rail; the realised gain (proceeds minus cost basis) is then minted via *YieldMinter*, 70% to the sPLUSD vault and 30% to the *Treasury Wallet*.

**Unrealised gain (USYC)** — `USYC NAV × units − cost basis`. Informational only — does not enter `PLUSD.totalSupply` and does not move sPLUSD share price. Becomes realised only when the Trustee instructs the wallet to sell USYC for USDC.

**Realised gain (USYC)** — `USDC proceeds − cost basis of units sold`, computed at the moment a Trustee-instructed USYC redemption settles. The remaining position's cost basis is reduced by the cost basis of units sold. Realised gains are the only USYC-engine input to PLUSD mints.

---

## W

**Standalone enrolment** — The non-deposit path to the transfer whitelist. A counterparty submits their address through the standalone enrolment endpoint, the *Relayer* runs address-only *KYT*, and on a clean result the address is added to *WhitelistRegistry* via `setAccess`. No funds move on this path. Used by CEX hot wallets, OTC desks, treasury operators, and anyone who needs to receive PLUSD without depositing first.

**WhitelistRegistry** — The on-chain allowlist gating PLUSD and sPLUSD transfers via `_update`. Each entry carries an `approvedAt` timestamp set by the *Relayer* on a clean *KYT* screen. Both endpoints of every transfer must be either whitelisted (with a fresh `approvedAt`) or a system address. Default freshness window is 90 days. The registry no longer gates deposits or withdrawals. Mint eligibility lives in the *DepositManager* ticket book, withdrawal eligibility is checked at `WithdrawalQueue.claim` against the same `isAllowed` view.

**WHITELIST_ADMIN (role)** — The role on *WhitelistRegistry* that authorises `setAccess`, `refreshScreening`, and `revokeAccess`. Held in MVP by *Relayer*, revocable instantly by *GUARDIAN Safe*.

**WithdrawalQueue** — The queue a lender enters to convert *PLUSD* back to USDC. Three states: `Pending`, `Claimed`, `AdminReleased`. Lenders call `requestWithdrawal` to escrow PLUSD, then `claim` themselves to atomically pull USDC from the *Withdrawal Queue Wallet*, burn escrowed PLUSD, and receive payout. There are no partial fills, no FUNDER role, and no lender-initiated cancellations in MVP.

**Withdrawal Queue Wallet** — A separate MPC custody address that holds USDC earmarked for queue settlement. Top-ups from the *Capital Wallet* are signed by Trustee + Team + one more under the standard 3-of-5 quorum. The on-chain `WithdrawalQueue` contract pulls from this Wallet via standing allowance during `claim`.

---

## Y

**yieldMint** — The *YieldMinter* function `yieldMint(attestation, relayerSig, trusteeSig)` that mints yield-leg PLUSD into either the sPLUSD vault or the *Treasury Wallet*. It is publicly callable but reverts unless both signatures verify on-chain — Relayer ECDSA against `relayerYieldAttestor`, Trustee EIP-1271 against `trusteeYieldAttestor` — and the attestation `ref` is unused; on success it calls `PLUSD.mintForYield`.

**YieldMinter** — A standalone contract that gates yield-leg PLUSD mints. It verifies the two-party EIP-712 attestation (Relayer ECDSA + Trustee EIP-1271), checks the `ref` is unused (replay protection), constrains the destination to the sPLUSD vault or *Treasury Wallet*, and calls `PLUSD.mintForYield`. YieldMinter holds the *YIELD_MINTER* role on PLUSD; pause is GUARDIAN-instant, attestor rotation is 48h ADMIN-timelocked.

**YIELD_MINTER (role)** — The role on *PLUSD* that authorises `mintForYield`. Held in MVP by the *YieldMinter* proxy address (contract-held, not an EOA); revocable instantly by *GUARDIAN Safe*.

---

## Related

- [How Pipeline works](/how-it-works/)
- [Security](/security/)
- [Risks](/risks/)
