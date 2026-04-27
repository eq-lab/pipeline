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

**Capital Wallet** — An on-chain Ethereum address held at a regulated custodian that stores Pipeline's USDC reserves, USDC out on active loans, and *USYC* holdings. Control is split across three MPC cosigners — *Trustee*, *Team*, and *Relayer* — under a fixed custodian policy; all movements in and out are on-chain ERC-20 transfers visible on Etherscan.

**CCR (Collateral Coverage Ratio)** — Collateral value divided by outstanding senior principal on a given loan, reported in basis points on LoanRegistry (e.g. 14000 = 140%). Pipeline's visible risk dial runs on three thresholds: above 130% is performing headroom, below 120% moves the loan to Watchlist, and below 110% triggers *RISK_COUNCIL Safe* escalation.

**claimAtShutdown** — The WithdrawalQueue function a lender calls post-shutdown if they had an in-flight queue entry at the time of execution. It applies the fixed recovery rate symmetrically to both Pending and Funded entries, so early queuers do not get a better rate than holders who redeem directly — it closes the queue-jump exploit class.

**CMA (Collateral Management Agreement)** — A contract under which an independent inspection and custody agent takes control of the physical collateral (warehoused commodity, tank-farm stock) and releases it only against documented instructions. A CMA gives a trade-finance lender verifiable, third-party confirmation that the cargo backing a loan exists and is controlled.

**Commodity** — The physical good financed by a given Pipeline loan — for example jet fuel JET A-1, refined metals, or agricultural products. Recorded as immutable origination data on the LoanRegistry NFT alongside the *Corridor* and *Offtaker*.

**Corridor** — The route the cargo travels, typically stated as "origin country → destination country" (e.g. "South Korea → Mongolia"). Corridor is immutable origination data on every LoanRegistry NFT; sanctioned corridors are not financed, and concentration across corridors is a diversification constraint.

**custodianYieldAttestor** — The custodian's *EIP-1271 signer* contract whose address is stored on *YieldMinter*. The custodian co-signs every yield mint after independently verifying the underlying USDC inflow (or USYC NAV delta) against its own records; the signature is recovered on-chain inside `YieldMinter.yieldMint` before any PLUSD is minted.

---

## D

**DEPOSITOR (role)** — The role on *PLUSD* that authorises `PLUSD.mintForDeposit`, the 1:1 deposit-leg mint. Held in MVP by the *DepositManager* proxy address (contract-held, not an EOA); no human key holds it.

**DepositManager** — The contract lenders call to deposit USDC. `DepositManager.deposit(amount)` pulls USDC from the lender to the *Capital Wallet* and mints *PLUSD* 1:1 in the same transaction, with no off-chain signer in the critical path; if any check fails, the whole transaction reverts.

---

## E

**EIP-712 attestation** — A structured-data signature format where the signer commits to a domain-separated, typed payload instead of an opaque hash. Pipeline's yield mints carry two independent EIP-712 signatures — one from *Relayer*'s ECDSA key (`relayerYieldAttestor`), one from the custodian's *EIP-1271 signer* (`custodianYieldAttestor`) — both verified on-chain inside *YieldMinter* before PLUSD is minted.

**EIP-1271 signer** — A smart-contract signer that validates signatures by calling `isValidSignature(hash, signature)` on the signing contract, rather than recovering an ECDSA public key. Pipeline's custodian is an EIP-1271 signer; it independently verifies the underlying USDC inflow before co-signing any *yieldMint*.

**Equity tranche** — The junior slice of a commodity loan, funded by the *Originator* and held off-chain as *first-loss* capital. Realised losses hit the Equity tranche before any *sPLUSD* writedown, so lenders are shielded as long as losses stay within this cushion.

---

## F

**Facility** — A single trade-finance loan, typically tied to one *Offtake contract* for one cargo. Every facility is represented on-chain by one LoanRegistry NFT carrying its origination parameters and lifecycle state.

**Facility size** — The total committed loan amount at origination, in USDC (stored as `originalFacilitySize` on the LoanRegistry NFT). It is split at mint into `originalSeniorTranche` (lender capital) and `originalEquityTranche` (originator first-loss).

**First-loss** — The tranche that absorbs realised losses before any other capital is hit. On Pipeline, the *Originator* equity tranche is first-loss on every loan; only once it is exhausted does loss reach the *sPLUSD* share price.

**FUNDER (role)** — The role on *WithdrawalQueue* that authorises `fundRequest` — pulling USDC from the *Capital Wallet* (via pre-approved allowance) to fund a queue head. Held in MVP by *Relayer*; revocable instantly by *GUARDIAN Safe*.

---

## G

**GUARDIAN Safe** — A 2-of-5 Gnosis Safe with instant, defence-only powers: pause any pausable contract, cancel any pending ADMIN-scheduled action, and revoke individual operational-role holders (YIELD_MINTER, FUNDER, WHITELIST_ADMIN, TRUSTEE) one at a time. GUARDIAN cannot grant roles, unpause, upgrade, or initiate any risk-increasing action — restoration is strictly *ADMIN Safe*'s job under the 48h timelock.

---

## H

**Hashnote** — The asset manager that issues *USYC*, the tokenized U.S. Treasury-bill product Pipeline uses as its idle-reserve yield engine. Pipeline's *Relayer* reads NAV directly from the Hashnote API to compute the lazy *yieldMint* on sPLUSD stake/unstake events.

---

## L

**Letter of credit** — A bank instrument under which an issuing bank undertakes to pay the seller once stated shipping and document conditions are met. Letters of credit are a classical trade-finance payment mechanism; Pipeline finances the seller's working capital against the underlying trade, not the letter of credit itself.

**LoanRegistry** — An ERC-721 (soulbound) contract that records every loan facility as an NFT, with immutable origination data and mutable lifecycle state. It is informational only — a compromised or erroneous write to LoanRegistry moves no USDC and cannot change *sPLUSD* share price, which responds only to real *yieldMint* events.

---

## M

**maxPerLPPerWindow** — A *DepositManager* parameter capping the PLUSD a single lender wallet can mint inside the rolling deposit window. Together with `maxPerWindow` it bounds single-actor concentration on the deposit leg; YieldMinter has no per-account caps.

**maxPerWindow** — A *DepositManager* parameter capping the aggregate PLUSD mintable across all lenders inside the rolling deposit window (launch value: $10M / 24h). Yield mints do not consume this budget — YieldMinter is a separate contract with separate gating.

**maxTotalSupply** — A hard ceiling on `PLUSD.totalSupply()` checked on every PLUSD mint regardless of path (deposit or yield). This is the only economic cap that applies to both *DepositManager* and *YieldMinter*; tightening is instant under ADMIN, loosening is 48h-timelocked.

**mintForDeposit** — The PLUSD function the *DepositManager* contract calls to mint deposit-leg PLUSD 1:1 against a USDC inflow. It is gated by the *DEPOSITOR* role (held exclusively by the DepositManager proxy) and enforces the *reserve invariant* and the `maxTotalSupply` ceiling before minting.

**mintForYield** — The PLUSD function the *YieldMinter* contract calls to mint yield-leg PLUSD into the sPLUSD vault or the *Treasury Wallet*. It is gated by the *YIELD_MINTER* role (held exclusively by the YieldMinter proxy) and enforces the *reserve invariant* and `maxTotalSupply` ceiling before minting; signature verification lives one layer up in YieldMinter.

---

## O

**Offtake contract** — A commercial agreement under which the *Offtaker* commits to buy a specified cargo at a stated price and schedule. Pipeline typically originates one *Facility* per offtake contract and books the end-buyer obligation as `originalOfftakerPrice` on the LoanRegistry NFT.

**Offtaker** — The end buyer of the physical commodity in a trade-finance deal. When the offtaker pays for the cargo, USD lands in the *Trustee*'s correspondent bank account; the Trustee then on-ramps USD → USDC into the *Capital Wallet* and records the tranche split on LoanRegistry. The offtaker never touches USDC and never touches the chain.

**Original offtaker price** — The total USDC the end buyer is contracted to pay for the cargo, recorded as `originalOfftakerPrice` on the LoanRegistry NFT at mint time. Outstanding offtaker balance on a live loan is derived as `originalOfftakerPrice − offtakerReceivedTotal`.

**Originator** — The commodity-trading firm that sources the deal and posts the *Equity tranche* off-chain as first-loss. The originator brings the borrower, term sheet, and diligence to the *Trustee* off-chain; the first on-chain event in the life of a facility is the Trustee minting the loan NFT on *LoanRegistry*. Open Mineral is Pipeline's launch originator; additional originators are onboarded over time.

---

## P

**PLUSD** — Pipeline's ERC-20 deposit receipt. One PLUSD represents one USDC held at the *Capital Wallet*; PLUSD is non-transferable between ordinary lender wallets (every transfer must touch a system address or an approved DeFi venue), and fresh supply enters only through *mintForDeposit* or *mintForYield*.

---

## R

**RecoveryPool** — The contract that holds USDC for lender recovery payments after shutdown. `redeemInShutdown` and `claimAtShutdown` both draw from RecoveryPool at the fixed recovery rate; as the *Trustee* repatriates capital over time, *RISK_COUNCIL Safe* may ratchet the rate upward.

**recordRepayment** — The LoanRegistry function the *Trustee* calls to book a split of an offtaker payment across Senior principal, Senior interest, and *Equity tranche*. It is pure accounting — it moves no USDC and mints no PLUSD; actual yield delivery runs through the independent *yieldMint* path on *YieldMinter*.

**redeemInShutdown** — The PLUSD function a holder calls during shutdown to exchange PLUSD for USDC at the frozen recovery rate. Every PLUSD redeemed during shutdown pays the same per-unit amount regardless of order, so there is no race to redeem and no queue jump.

**Relayer** — Pipeline's backend service, running as an on-chain account that holds two operational roles: *FUNDER* on WithdrawalQueue and *WHITELIST_ADMIN* on WhitelistRegistry. The Relayer also signs yield attestations with its `relayerYieldAttestor` key, but the *YIELD_MINTER* role itself is held by the *YieldMinter* contract — Relayer never holds it directly. Relayer is one of three MPC cosigners on the *Capital Wallet*, never custodies USDC, never touches LoanRegistry, and is not in the critical path for deposits.

**relayerYieldAttestor** — The Relayer's ECDSA signing key whose address is stored on *YieldMinter*. The Relayer signs the first half of every yield attestation with this key; it is rotated via `YieldMinter.proposeYieldAttestors` under a 48h ADMIN timelock and is held in an air-gapped hardware signer with no internet egress.

**Reserve invariant** — An on-chain, per-transaction check that `totalSupply + amount ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns` on every PLUSD mint path. It is an internal-consistency check against PLUSD's own ledger — not a Proof of Reserve — and catches over-mint or counter desync before supply changes.

**RISK_COUNCIL Safe** — A 3-of-5 Gnosis Safe with a 24-hour AccessManager delay on its actions. Its scope is narrow: `setDefault` on a LoanRegistry loan, `proposeShutdown` on the *ShutdownController*, and `adjustRecoveryRateUp` during shutdown — it cannot grant roles, upgrade, or unpause.

---

## S

**Senior tranche** — The senior slice of a commodity loan, funded by Pipeline lenders through the *sPLUSD* vault. Senior principal and the net senior coupon (gross interest minus management and performance fees) are what flows back to lenders when the *Offtaker* pays.

**ShutdownController** — A standalone contract that holds the single `isActive` flag and `recoveryRateBps` the rest of the protocol reads. Entering shutdown is a one-way transition proposed by *RISK_COUNCIL Safe* (24h delay) and executed by *ADMIN Safe*; the rate ratchets up only, never down.

**Split-rail** — Pipeline's architecture: a cash rail where USDC sits at the custodian under MPC control, and a token rail where the on-chain contracts track receipts and enforce rules. Rules link the two rails; no contract can spend custodian funds, and no custodian signer can mint tokens alone.

**sPLUSD** — An ERC-4626 vault wrapping *PLUSD*. Stakers deposit PLUSD and receive sPLUSD shares whose redemption value rises as fresh PLUSD is minted into the vault through *yieldMint*; share price moves only on actual mints, not on LoanRegistry writes or time-based accrual.

---

## T

**Team** — Pipeline's operating team, which holds one MPC cosigner share on both the *Capital Wallet* and the *Treasury Wallet*. Team holds no on-chain role (no FUNDER, WHITELIST_ADMIN, TRUSTEE) and has no ability to mint PLUSD.

**Tranche** — A slice of a loan with a defined priority in the repayment waterfall. Pipeline's facilities are structured with a *Senior tranche* (lender capital, paid first) and an *Equity tranche* (originator first-loss, paid last).

**Treasury Wallet** — An on-chain Ethereum address at the custodian, using a distinct MPC cosigner set from the *Capital Wallet*. It accumulates protocol fees and the 30% T-bill share of the yield split; a compromise at one wallet does not propagate to the other.

**Trustee** — Pipeline Trust Company, an independent legal entity holding the Trustee key. Operationally the Trustee is (a) the sole caller of every LoanRegistry write — `mintLoan`, `updateMutable`, `recordRepayment`, Trustee-branch `closeLoan` — and (b) one MPC cosigner on the *Capital Wallet*; the Trustee does not custody USDC alone and cannot mint PLUSD.

**TRUSTEE (role)** — The role on *LoanRegistry* that authorises all loan NFT writes. Held in MVP by the *Trustee* key alone; revocable instantly by *GUARDIAN Safe*, re-grantable only by *ADMIN Safe* under the 48h timelock.

---

## U

**UPGRADER (role)** — The role on AccessManager that authorises `upgradeTo(newImpl)` on every UUPS proxy. Held in MVP by the *ADMIN Safe*; upgrades are 48h-delayed and *GUARDIAN Safe*-cancellable, and the delay itself is protected by a 14-day meta-timelock.

**USYC** — Hashnote's tokenised U.S. Treasury-bill holding, where idle USDC from the *Capital Wallet* is parked. USYC NAV drifts up daily as the underlying bills accrue, but the gain is **unrealised** — it stays at the custodian. Yield is delivered to PLUSD only when the *Trustee* instructs the custodian to sell USYC for USDC; the realised gain (proceeds minus cost basis) is then minted via *YieldMinter*, 70% to the sPLUSD vault and 30% to the *Treasury Wallet*.

**Unrealised gain (USYC)** — `USYC NAV × units − cost basis`. Informational only — does not enter `PLUSD.totalSupply` and does not move sPLUSD share price. Becomes realised only when the Trustee instructs the custodian to sell USYC for USDC.

**Realised gain (USYC)** — `USDC proceeds − cost basis of units sold`, computed at the moment a Trustee-instructed USYC redemption settles. The remaining position's cost basis is reduced by the cost basis of units sold. Realised gains are the only USYC-engine input to PLUSD mints.

---

## W

**WhitelistRegistry** — The on-chain allowlist of KYC'd lender wallets and approved DeFi venues, with a Chainalysis `approvedAt` timestamp per entry. Deposits check freshness (default 90-day window); transfers of *PLUSD* require at least one of (sender, receiver) to be a system address or whitelisted entry.

**WHITELIST_ADMIN (role)** — The role on *WhitelistRegistry* that authorises `setAccess`, `refreshScreening`, and `revokeAccess`. Held in MVP by *Relayer*; revocable instantly by *GUARDIAN Safe*.

**WithdrawalQueue** — The FIFO queue a lender enters to convert *PLUSD* back to USDC. The queue has four states — Pending, Funded, Claimed, AdminReleased — and is funded in full-amount chunks by *Relayer* under the *FUNDER* role; there are no partial fills or LP-initiated cancellations in MVP.

---

## Y

**yieldMint** — The *YieldMinter* function `yieldMint(attestation, relayerSig, custodianSig)` that mints yield-leg PLUSD into either the sPLUSD vault or the *Treasury Wallet*. It is publicly callable but reverts unless both signatures verify on-chain — Relayer ECDSA against `relayerYieldAttestor`, custodian EIP-1271 against `custodianYieldAttestor` — and the attestation `ref` is unused; on success it calls `PLUSD.mintForYield`.

**YieldMinter** — A standalone contract that gates yield-leg PLUSD mints. It verifies the two-party EIP-712 attestation (Relayer ECDSA + custodian EIP-1271), checks the `ref` is unused (replay protection), constrains the destination to the sPLUSD vault or *Treasury Wallet*, and calls `PLUSD.mintForYield`. YieldMinter holds the *YIELD_MINTER* role on PLUSD; pause is GUARDIAN-instant, attestor rotation is 48h ADMIN-timelocked.

**YIELD_MINTER (role)** — The role on *PLUSD* that authorises `mintForYield`. Held in MVP by the *YieldMinter* proxy address (contract-held, not an EOA); revocable instantly by *GUARDIAN Safe*.

---

## Related

- [How Pipeline works](/how-it-works/)
- [Security](/security/)
- [Risks](/risks/)
