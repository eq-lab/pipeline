**PIPELINE**

Decentralised Commodity Trade Finance Protocol

**MVP Technical Specification**

Version 0.3.8 \| Internal draft \| April 2026

**CONFIDENTIAL**

This document specifies the minimum viable implementation of the Pipeline protocol. Version 0.3.8 incorporates 37 amendments against v0.2, including the removal of the Loan Originator from the cash rail, the addition of on-chain event-driven authorisation for loan disbursements and LP payouts, the introduction of a price feed and event notification system for loan monitoring, weekly USYC yield distribution, a rewritten contract architecture using OpenZeppelin audited library code with minimal custom extensions, and a complete overhaul of the trustee tooling and bridge service scope.

**1. Scope and Design Principles**

**1.1 What this MVP is**

The MVP lets a verified LP deposit USDC, receive PLUSD, stake into sPLUSD, earn yield from loan repayments and idle USYC holdings, and withdraw back to USDC. It is not the production protocol --- components deferred to later phases are listed in §1.4.

**1.2 The split-rail principle**

The MVP separates two rails:

- Cash rail. Real USDC and tokenised T-bill reserves (USYC) move through two permissioned MPC wallets: the Pipeline Capital Wallet (LP-backing reserves) and the Pipeline Treasury Wallet (protocol revenue). Both wallets are co-governed by multiple parties via MPC --- see §1.5 for the trust model and §2.1 for per-wallet signing arrangements.

- Token rail. PLUSD and sPLUSD live on-chain as ERC-20 / ERC-4626 tokens. The token rail mirrors the cash rail but never holds USDC or USYC itself. Mints, burns, stakes, unstakes, withdrawal queue accounting, and the LoanRegistry are recorded on-chain; actual USDC and USYC delivery is performed by the MPC wallets in response to on-chain events under permission policies that wire cash-rail authority to token-rail state.

Smart contracts hold no USDC or USYC. Cash-rail outflows require either the bridge service (for narrowly-scoped automated flows) or human co-signature (for loan disbursements and treasury redemptions). A bug or exploit in on-chain code cannot drain investor capital unilaterally.

**1.3 In scope**

1.  LP onboarding via Sumsub KYC/KYB plus Chainalysis wallet sanctions screening, with a defined re-screening cadence and on-chain whitelist enforcement at mint time and on PLUSD transfer.

2.  LP deposit of USDC into the Capital Wallet from whitelisted addresses, subject to a configurable minimum deposit amount.

3.  PLUSD minting to the depositor address, 1:1 with received USDC, subject to on-chain rate limits and a deposit queue when the rate limit is reached.

4.  PLUSD staking into the sPLUSD ERC-4626 vault. Staking is open to any holder of PLUSD; only minting is restricted to whitelisted LPs.

5.  Loan facility creation via the LoanRegistry (ERC-721), with origination requests submitted off-chain by the Loan Originator and broadcast on-chain by the trustee tooling.

6.  Loan disbursement: triggered automatically by LoanMinted events, with the bridge service preparing the Capital Wallet outflow transaction and the trustee + team co-signing via MPC.

7.  Senior-tranche yield distribution from loan repayments: manual trustee reconciliation, waterfall calculation performed client-side against LoanRegistry parameters, minting of fresh PLUSD to the sPLUSD vault and to the Treasury Wallet. Senior principal is automatically swept into USYC after repayment.

8.  T-bill yield distribution from USYC NAV accrual: real-time backend tracking with weekly trustee signature on a pre-built distribution transaction, 70% to the sPLUSD vault and 30% to the Treasury Wallet.

9.  Withdrawal: sPLUSD unstake → PLUSD escrow into withdrawal queue → automated USDC payout from the Capital Wallet when the destination matches the original deposit address and the amount is within configured bounds. Partial fills are supported --- the first request in the queue receives any incoming liquidity as it arrives.

10. LoanRegistry with immutable origination parameters plus a mutable lifecycle bucket that includes status, CCR, current maturity date, current goods location (vessel / warehouse / tank farm) with tracking identifier and optional external URL.

11. Price feed and event notification system: real-time collateral valuation using external commodity reference prices, automated computation of LTV and CCR, and automated notifications to the team, the originator, the borrower, and the trustee on significant events (watchlist trigger, maintenance margin call, margin call, payment delay, AIS blackout).

12. LP dashboard: per-LP position, yield earned, withdrawal request status.

13. Protocol dashboard: balance sheet across both wallets, deployment monitor sourced from the LoanRegistry and the trustee feed, withdrawal queue, yield history.

14. Off-chain trustee tooling and client-side application covering loan origination verification, manual repayment reconciliation with client-side waterfall computation, weekly yield event signing, automated USDC ↔ USYC liquidity management with manual override, Treasury Wallet operations, and LoanRegistry mutations.

**1.4 Out of scope (deferred)**

- Automated bank integration. Repayment identification remains manual via the trustee tooling with client-side waterfall computation against LoanRegistry state. Automated virtual-account integration with the Trust Company\'s correspondent bank is a Phase 1.5 deliverable.

- On-chain LTV oracle writes and automated enforcement triggers. Price feeds and event notifications run off-chain in the MVP; the LoanRegistry carries a lastReportedCCR field that the trustee or automated system updates on threshold crossings.

- Loan vault contracts holding tokenised collateral. The LoanRegistry is informational; collateral remains under physical CMA control off-chain.

- Withdrawal queue tier system from white paper §9.2. MVP implements simple FIFO with partial fills. The four-tier mechanism is deferred.

- GenTwo MTN issuance and the off-chain note programme.

- Multiple Loan Originators (Open Mineral only in pilot).

- Equity tranche on-chain representation. The Originator\'s first-loss commitment is settled directly through the Pipeline Trust Company\'s USD bank account, never enters either MPC wallet, and is displayed on the dashboard as a trustee-attested figure per loan.

- Public bug bounty programme (e.g., Immunefi). MVP relies on the Tier 1 audit and restricted interaction model (§8.3).

**1.5 Trust assumptions**

The MVP relies on the following trusted parties. None of them can unilaterally drain investor capital on the cash rail.

- Pipeline Trust Company (Trustee). Holds one MPC key share on the Capital Wallet and one on the Treasury Wallet. Operates the USD bank account that receives loan repayments and equity tranche flows. Verifies Originator-submitted loan origination requests before broadcasting LoanRegistry mints. Runs the client-side repayment reconciliation and signs RepaymentSettled events. Signs the weekly TreasuryYieldDistributed event (pre-built by the system). Holds the loan_manager role on the LoanRegistry.

- Loan Originator (Open Mineral AG). Does not hold any MPC key share and does not hold any Ethereum signing key. Submits origination requests through the Originator UI (§9.5) authenticated via email + password + 2FA per the operator onboarding flow in §9.3; the trustee tooling validates and broadcasts. Posts the equity tranche directly to the Trust Company\'s USD bank account. Receives notifications from the price feed system on watchlist and margin call events for its loans.

- Pipeline team. Holds one MPC key share on the Capital Wallet and one on the Treasury Wallet. Co-signs loan disbursement transactions that the bridge service has prepared in response to LoanMinted events. Initiates Treasury Wallet redemptions (per §6.5). Operates the bridge service infrastructure.

- Pipeline bridge service. Holds one MPC key share on the Capital Wallet with a narrowly-scoped policy that auto-signs only four predefined transaction categories (see §9.1 for the full list and §9.2 for the security model). All counterparty addresses are pinned; all envelopes are bounded; anything outside these patterns requires human co-signature.

- Risk Council. 3-of-5 multisig holding the risk_council role on the LoanRegistry (used to authorise transitions to Default status and Closed-with-default-reason) and the 2-of-5 fast-pause capability on the foundation multisig over PLUSD, sPLUSD, and the WithdrawalQueue.

**2. System Architecture**

**2.1 Component map**

**Cash rail**

- Pipeline Capital Wallet. MPC wallet on Ethereum holding USDC and USYC. Three signing participants: Trustee, Pipeline team, and the bridge service (the latter as a narrowly-scoped automated participant). MPC vendor pending RFI between Fireblocks and BitGo.

- Pipeline Treasury Wallet. Second MPC wallet on the same vendor. Holds PLUSD as the unit of account for accumulated protocol revenue. Two signing participants: Trustee and Pipeline team. Outflows from the Treasury Wallet are permitted for the purpose of redeeming PLUSD back into USDC through the standard protocol redemption path (equivalent to a regular LP withdrawal, executed via a privileged flow to avoid queue contention). The team initiates Treasury redemptions; the trustee verifies and co-signs.

- Trustee USD bank account. Held by the Pipeline Trust Company. Receives loan repayments in USD from borrowers, receives equity tranche contributions from Loan Originators, settles equity tranche returns at maturity. Source of funds for the on-ramp leg of the repayment flow.

- On/Off-Ramp Provider. Institutional USDC ↔ USD rail (open between Circle Mint, Zodia Markets, and other institutional candidates). Used for the senior portion of loan disbursement and repayment flows. The fiat side of the equity tranche is handled directly between the Loan Originator and the Trust Company\'s USD account.

- USYC issuer (Hashnote / Circle). Provides the USDC ↔ USYC mint and redeem mechanism. Whitelists the Capital Wallet address as an authorised USYC holder. Onboarding is a critical-path dependency for MVP launch.

**Token rail**

- PLUSD contract. OpenZeppelin ERC-20Pausable standard with a minimal custom \_update override that consults the WhitelistRegistry. Two minting paths: deposit mints (against USDC inflow from whitelisted LPs) and yield mints (against trustee-signed yield events). Subject to the rolling 24h rate limit and per-transaction cap from §3.3.

- sPLUSD vault. OpenZeppelin ERC-4626 standard. Underlying asset: PLUSD. Yield accretion happens by minting additional PLUSD into the vault on each yield event. No whitelist check on sPLUSD transfers --- the vault is open to any holder of PLUSD, enabling DeFi composability downstream.

- WithdrawalQueue contract. Custom audited contract. Holds escrowed PLUSD from withdrawing LPs. Supports partial fills: the first request in the queue receives any incoming USDC liquidity as it arrives, with the remainder staying at the head of the queue until fully filled.

- WhitelistRegistry contract. Custom audited contract. On-chain allowlist of KYCed LP addresses plus approved DeFi venues (specific Curve pools, Uniswap pools, Aave markets if added). Consulted by the PLUSD transfer hook on every movement.

- LoanRegistry contract. OpenZeppelin ERC-721 standard with custom extension storing immutable origination data and mutable lifecycle state. Minted by the trustee tooling via the loan_manager role after off-chain verification of the Originator\'s request. Emits LoanMinted event that triggers the bridge service\'s disbursement preparation.

- Foundation multisig. Safe (3-of-5 standard / 2-of-5 fast pause). Holds admin roles on all contracts. Fast-pause authority over PLUSD, sPLUSD, and WithdrawalQueue.

**Bridge**

- Pipeline Bridge Service. Backend service operated by the Pipeline team. Three distinct capabilities: (1) on-chain event listener that monitors the LoanRegistry, WithdrawalQueue, and PLUSD contracts; (2) MPC participant on the Capital Wallet with narrowly-scoped auto-signing authority for predefined transaction types; (3) mint authority for PLUSD via the MINTER role. The bridge also runs the price feed and notification system that monitors active loans.

**2.2 Architecture diagram**

![](media/3cb2ed84e578c3be3224fd70e63178cd8b28891a.png){width="6.666666666666667in" height="4.583333333333333in"}

**2.3 Chains and dependencies**

- Target chain: Ethereum mainnet for PLUSD, sPLUSD, WhitelistRegistry, WithdrawalQueue, and LoanRegistry. Soroban remains a documented alternative.

- Token standard: OpenZeppelin ERC-20Pausable for PLUSD; OpenZeppelin ERC-4626 for sPLUSD; OpenZeppelin ERC-721 for LoanRegistry. Custom logic is limited to small, clearly-scoped extensions (see §8.3).

- Indexer: custom internal indexer built by EQ LAB, reusing the infrastructure pattern from prior EQ LAB projects. No dependency on external indexing services (The Graph, Goldsky) for the MVP.

- KYC vendor: Sumsub. Wallet sanctions screening: Chainalysis Address Screening. Both feed into the on-chain WhitelistRegistry via the bridge service.

- MPC vendor: Fireblocks or BitGo (selection pending parallel RFI). Same vendor used for both Capital Wallet and Treasury Wallet.

- On/off-ramp provider: open between Circle Mint, Zodia Markets, and other institutional candidates.

- Tokenised T-bill issuer: USYC (Hashnote / Circle). Capital Wallet whitelisted as authorised holder.

- Price feed sources: Platts and Argus reference prices (S&P Global / LSEG) via licensed data subscription, consumed by the backend price feed and notification system.

**3. LP Onboarding and Deposit**

**3.1 Onboarding flow**

LPs onboard through the Pipeline web application. The flow runs entirely off-chain except for the final whitelist write.

15. LP visits the Pipeline app and connects an Ethereum wallet via WalletConnect v2 / RainbowKit. Connecting the wallet creates the Pipeline account --- there is no separate email or password registration step. The connected wallet address is the account identifier and is bound to all subsequent KYC/AML records. The wallet itself provides authentication for every subsequent session: the LP signs a one-off message to bind the wallet to a Pipeline session, and the wallet\'s own security model (hardware key, mobile biometric, etc.) is the authentication factor. No 2FA is required from Pipeline.

16. LP completes Sumsub KYC/KYB: identity verification for individuals, corporate documents and UBO disclosure for entities.

17. LP completes accreditation: self-certification plus documentary evidence (Reg D 506(c) for US persons; Reg S attestation for non-US persons). PLUSD minting is permitted for both US and non-US LPs with the appropriate exemption.

18. Chainalysis Address Screening checks the LP\'s connected wallet address against sanctions lists, mixers, and prohibited categories. A clean result is required for whitelist approval.

19. The bridge service evaluates the screening results automatically. If Sumsub returns APPROVED and Chainalysis returns a clean result, the bridge service immediately writes the LP address to the on-chain WhitelistRegistry with the approvedAt timestamp set to the current block time. No human review is required for the happy path. If either vendor returns REJECTED, the LP is notified with the rejection reason and cannot proceed. If either vendor returns FLAGGED, MANUAL_REVIEW, or any other non-binary status, the LP enters the compliance review queue (§9.3) for a compliance officer to resolve manually.

20. LP receives an in-app notification of approval and (optionally) an email if the LP supplied one for notification preferences. The approvedAt timestamp on the WhitelistRegistry is the authoritative reference for the re-screening cadence defined in §3.1.1.

21. LP receives a confirmation in the app and is now eligible to deposit.

**3.1.1 Chainalysis re-screening cadence**

An LP\'s wallet must pass a fresh Chainalysis screen within the defined freshness window before any PLUSD mint is authorised. The working parameters for the MVP are:

- **Initial screen at onboarding.** The approvedAt timestamp on the WhitelistRegistry records the screening date.

- **Freshness window: 90 days.** A wallet\'s screening is considered current for 90 days from the last clean screen. Parameter configurable by the foundation multisig.

- **Pre-deposit re-screening.** When an LP initiates a deposit in the app, the frontend checks the on-chain approvedAt timestamp. If the freshness window has expired, the app blocks the deposit UI and prompts the LP to re-verify. The re-verification triggers a fresh Chainalysis screen via the bridge service; on a clean result, approvedAt is refreshed and the deposit UI is unblocked. On a failed or suspicious screen, the LP\'s whitelist entry is flagged for manual compliance review.

**3.2 Deposit and PLUSD mint flow**

Depositor\'s user experience is similar to a regular DeFi application: the LP connects a wallet to the app, the app verifies eligibility, and the LP signs a direct USDC transfer to the Capital Wallet from their connected wallet. The bridge service detects the transfer and triggers the corresponding PLUSD mint.

22. LP initiates a deposit in the Pipeline app. The app reads the LP\'s on-chain WhitelistRegistry status and Chainalysis approvedAt timestamp. If the wallet is not whitelisted or screening has expired, the deposit UI is disabled and the LP is prompted to complete the missing step. This frontend gate prevents most non-whitelisted deposits from ever reaching the contract, minimising Risk Committee workload.

23. LP enters the deposit amount, which must be at or above the minimum of 1,000 USDC. The minimum exists to prevent uneconomic bridge gas costs --- at very small deposit sizes the gas of the resulting on-chain mint transaction can exceed the economic value of the deposit itself. The minimum is a configurable parameter set by the foundation multisig.

24. LP confirms. The app uses the connected wallet (via ethers.js or equivalent) to prepare and submit a USDC transfer transaction directly from the LP\'s address to the Capital Wallet address. The LP signs the transaction in their wallet as they would for any standard DeFi deposit.

25. The bridge service observes the USDC Transfer event into the Capital Wallet and runs four checks: (a) lpAddress is whitelisted, (b) lpAddress passes the Chainalysis freshness check, (c) the deposit amount is at or above 1,000 USDC, (d) the deposit-mint rate limit and per-transaction cap are not breached.

26. If all checks pass, the bridge service calls PLUSD.mint(lpAddress, amount). If the rate limit or per-transaction cap is breached, the deposit enters the mint queue (§3.3). If the whitelist or screening check fails, the deposit is quarantined and reviewed manually by a compliance officer.

27. Below-minimum deposits (below 1,000 USDC) are accumulated rather than rejected. The bridge service tracks the unminted balance per LP address as a \'pending top-up\' counter. When subsequent deposits from the same address bring the cumulative pending amount to or above the 1,000 USDC threshold, the bridge mints PLUSD for the combined total in a single transaction and resets the counter. The frontend UI displays the LP\'s pending top-up balance as \'pending deposits --- not yet earning yield\' alongside their active position, so the LP can see exactly how much sits below the threshold and what additional amount would unlock the mint. This avoids returning small deposits and the operational overhead of refunds.

**3.3 Mint authority, rate limiting, and deposit queue**

PLUSD has a single MINTER role, held by the bridge service. The bridge service distinguishes two minting categories, both using the same on-chain function but tracked separately in the audit log and alerting:

- **Deposit mints.** Triggered by USDC Transfer events into the Capital Wallet from whitelisted LP addresses, above the minimum deposit amount.

- **Yield mints.** Triggered by trustee-signed RepaymentSettled events (loan repayment yield) and trustee-signed TreasuryYieldDistributed events (weekly USYC NAV accrual).

On-chain rate limit applied to all mints combined: \$10M per rolling 24h window and \$5M per single transaction (both configurable by foundation multisig, see §1.5 trust assumptions for the security rationale). Mints exceeding either limit revert at the contract level.

**3.3.1 Deposit queue for rate-limited mints**

A single large deposit or a burst of deposits that would breach the 24h rolling limit must not be rejected back to the LP --- the USDC has already arrived in the Capital Wallet and the LP is entitled to PLUSD. Instead, the bridge service maintains a deposit mint queue:

28. The bridge service observes the USDC Transfer and runs the eligibility checks.

29. If the mint would breach the rate limit, the bridge service records the pending mint in a queue (lpAddress, amount, deposit_tx_hash, queued_at) and does not call mint() immediately.

30. As the rolling 24h window rolls forward and headroom becomes available, the bridge service processes queued mints in FIFO order, calling PLUSD.mint() for each as capacity permits.

31. Queued deposits are visible to the LP in the app: the LP dashboard shows a \'PLUSD mint pending rate limit\' status with the expected processing window.

32. The deposit queue is a backend-only construct --- it has no on-chain state. If the bridge service restarts, it rebuilds the queue from the USDC Transfer log and the PLUSD mint log by computing the delta.

A single deposit that exceeds the per-transaction cap (\$5M) is split into multiple mint transactions by the bridge service over successive rolling windows, with the LP seeing incremental PLUSD arrive as each window opens.

**4. Staking PLUSD into sPLUSD**

**4.1 Staking flow**

Staking is a pure on-chain interaction. The LP calls the sPLUSD vault directly; the bridge service is not involved.

33. The LP approves the sPLUSD vault to spend PLUSD.

34. The LP calls sPLUSD.deposit(assets, receiver=lpAddress).

35. The vault transfers PLUSD in, computes shares = assets \* totalSupply / totalAssets (or 1:1 on first deposit), and mints sPLUSD shares to the LP.

**4.2 Vault parameters and open access**

The sPLUSD vault is open to any holder of PLUSD --- there is no whitelist check on deposit, redeem, or transfer of sPLUSD. This is deliberate and is the point at which Pipeline\'s DeFi composability kicks in.

The architectural principle: KYC and sanctions screening are enforced at the point where USDC enters the protocol and PLUSD is minted. Once PLUSD exists, it is a standard ERC-20 that can flow through the WhitelistRegistry-controlled set of permitted holders (KYCed LPs plus approved DeFi venues). Staking PLUSD into sPLUSD requires only that the user already holds PLUSD --- which in turn required either having passed KYC to mint it or having received it from another whitelisted address. No additional KYC is required to stake.

This means third parties who acquire PLUSD via approved DeFi venues can stake into sPLUSD and earn yield without going through Pipeline\'s direct onboarding. It does not weaken the protection of LP capital because the only way PLUSD enters circulation is via KYCed deposits, and the only addresses that can hold PLUSD are whitelisted. sPLUSD inherits the indirect KYC chain without imposing its own additional check.

- Underlying asset: PLUSD.

- Initial exchange rate: 1 PLUSD = 1 sPLUSD at first deposit, with first-deposit attack mitigation via dead-shares seed at vault deployment.

- Transfer restriction: none. sPLUSD is fully open.

- Rounding: standard ERC-4626 rounding direction.

**4.3 Unstaking**

36. LP calls sPLUSD.redeem(shares, receiver=lpAddress, owner=lpAddress).

37. The vault burns the sPLUSD shares and transfers the corresponding PLUSD amount (computed at the current exchange rate) to the LP.

Unstaking is always available. The receiver of the PLUSD must be whitelisted or the PLUSD transfer will revert at the PLUSD contract level, not at the vault level --- this is the point where the KYC chain re-enters on the way out.

**5. Yield Waterfall and Distribution**

**5.1 Repayment recognition and client-side waterfall**

Bank integration is excluded. Repayment identification is manual; waterfall computation is performed client-side in the trustee tooling against LoanRegistry parameters.

38. A borrower repays a loan by wiring USD into the Pipeline Trust Company\'s correspondent bank account.

39. The trustee identifies the loan_id corresponding to the wire using wire details, borrower communication, and the open loan ledger. The loan_id is the LoanRegistry tokenId.

40. In the trustee tooling, the trustee selects the loan from the LoanRegistry (the tooling displays all active loans read from on-chain state), enters the repayment amount received, and optionally enters the repayment date if different from today.

41. The client-side application computes the full waterfall breakdown automatically. The computation uses: (a) the immutable loan parameters from the LoanRegistry NFT (originalFacilitySize, originalSeniorTranche, originalEquityTranche, originationDate, originalMaturityDate, governingLaw), (b) the mutable lifecycle state (status, currentMaturityDate), (c) the protocol-wide fee schedule (management fee rate, performance fee rate, OET allocation rate), (d) the actual tenor from origination to repayment, and (e) the amount the trustee has just entered. The output is a structured breakdown showing every waterfall component:

  ------------------------------------------------------------------------------------------------------------
  **Component**               **Formula**
  --------------------------- --------------------------------------------------------------------------------
  senior_principal_returned   min(amount, outstanding_senior_principal)

  senior_gross_interest       tenor × senior_rate × senior_deployed

  management_fee              senior_deployed × mgmt_rate × (tenor / 365)

  securitisation_agent_fee    0 (inactive in MVP)

  performance_fee             (senior_gross_interest − management_fee) × perf_rate

  senior_coupon_net           senior_gross_interest − management_fee − performance_fee

  oet_allocation              senior_deployed × oet_rate × (tenor / 365)

  originator_residual         amount − senior_principal_returned − senior_coupon_net − fees − oet_allocation
  ------------------------------------------------------------------------------------------------------------

42. The trustee reviews the breakdown and adjusts any parameter if the actual transaction differs from the computed values (e.g., a negotiated fee waiver, a partial repayment, or an early repayment fee). The tooling highlights deviations from the computed baseline for transparency.

43. Once confirmed, the trustee signs the resulting RepaymentSettled transaction. The signed event is the trigger for the on-chain yield delivery in §5.3.

**5.2 The waterfall itself**

The priority order is:

44. Principal repayment to the senior tranche.

45. Management fee: 0.5--1.5% p.a. on senior deployed, pro-rated to loan tenor. Accrues to protocol revenue.

46. Securitisation Agent fee: reserved for forward compatibility, inactive in MVP.

47. Senior coupon to the senior tranche: gross senior interest minus management fee and performance fee. Delivered to sPLUSD vault as PLUSD mint.

48. Performance fee: 10--20% of senior net interest after management fee. Accrues to protocol revenue.

49. Operational Expense Trust allocation: 0.05--0.10% of senior deployed, pro-rated to loan tenor. Accrues to protocol revenue. The OET rate is a protocol-wide parameter configurable by the foundation multisig.

50. Residual junior yield: returned to the Loan Originator on its equity tranche, settled directly through the Trust Company\'s USD bank account. The equity tranche never enters the cash rail and does not appear in the on-chain event.

**5.3 On-chain yield delivery from loan repayments**

51. The trustee instructs the on-ramp provider to convert the senior portion (senior_principal_returned + senior_coupon_net + protocol fees) from USD to USDC, settling into the Capital Wallet.

52. The Capital Wallet receives a USDC inflow tagged with the loan_id (via the wallet vendor\'s metadata field or via amount-and-time matching against the signed RepaymentSettled event).

53. The bridge service consumes the signed RepaymentSettled event and the on-chain USDC inflow. It verifies that the inflow amount equals the sum of the senior components in the signed event.

54. On verification, the bridge service mints PLUSD in two places via the yield-mint path:

    - PLUSD.mint(sPLUSDvault, senior_coupon_net) --- fresh PLUSD minted directly into the sPLUSD vault, increasing vault.totalAssets and accreting NAV for all stakers.

    - PLUSD.mint(TreasuryWallet, management_fee + performance_fee + oet_allocation) --- fresh PLUSD minted to the Treasury Wallet as protocol revenue.

55. The bridge service then initiates an automatic USDC → USYC conversion of the senior_principal_returned portion. This swap is executed under the bridge\'s MPC auto-signing permission for USDC ↔ USYC flow (§2.1). The principal is swept into USYC and begins earning T-bill yield immediately rather than sitting idle. The operational USDC buffer in the Capital Wallet is maintained at the target ratio (working value: 15% of total reserves) by the automated liquidity management rules in §5.5.

**5.4 On-chain yield delivery from USYC NAV accrual**

USYC in the Capital Wallet accrues NAV continuously. The protocol recognises accrued yield weekly on Thursday at a defined end-of-day time, aligned with USYC NAV publication (exact time TBD, working assumption: 17:00 America/New_York or the issuer\'s published NAV reference time, whichever is later).

56. Between weekly distribution events, the bridge service reads the current USYC NAV from the issuer\'s published feed in real time and continuously updates a running accrued_yield figure. This figure is exposed to the protocol dashboard so LPs can see T-bill yield accumulating in real time, even though it is only distributed weekly. The real-time figure is informational only --- it does not affect sPLUSD NAV until the weekly distribution event fires.

57. At the weekly reference time, the bridge service computes total_accrued_yield = USYC NAV appreciation since the previous distribution multiplied by the USYC holding amount.

58. The bridge service pre-builds a TreasuryYieldDistributed transaction carrying the computed values (total_accrued_yield, vault_share = 70%, treasury_share = 30%, reference USYC NAV, holding amount, week_ending date) and presents it to the trustee tooling for signature.

59. The trustee reviews the pre-built transaction. The trustee tooling displays the week\'s accrual against the previous reference NAV, the resulting split, and the expected on-chain mint amounts. The trustee signs the transaction (a standard EIP-712 signature --- a signed attestation, not an on-chain transaction by the trustee).

60. On receipt of the trustee signature, the bridge service mints PLUSD in two places via the yield-mint path:

    - PLUSD.mint(sPLUSDvault, vault_share) --- 70% of accrued yield to stakers via NAV accretion.

    - PLUSD.mint(TreasuryWallet, treasury_share) --- 30% of accrued yield to the Treasury Wallet as protocol revenue.

The USYC itself is not redeemed during the weekly yield event. USYC stays in the Capital Wallet, continues to accrue, and the next week\'s reference NAV becomes the baseline for the following calculation. Physical USYC → USDC redemption happens on two triggers only: (a) liquidity management rebalancing in response to the USDC buffer drifting outside the target band (§5.5), or (b) Trust Company cash extraction from the Treasury Wallet (§6.5).

**5.5 Automated USDC ↔ USYC liquidity management**

The bridge service manages the Capital Wallet\'s USDC/USYC composition automatically: idle capital earns T-bill yield in USYC; an operational USDC buffer is kept for loan disbursements and LP withdrawals.

- **Target USDC ratio:** 15% of total Capital Wallet reserves (USDC + USYC NAV). Parameter configurable.

- **Upper band:** 20% USDC ratio. When the actual ratio exceeds the upper band (e.g., after a large loan repayment or a large deposit), the bridge service initiates a USDC → USYC swap to bring the ratio back to target.

- **Lower band:** 10% USDC ratio. When the ratio falls below the lower band (e.g., after several LP withdrawals), the bridge service initiates a USYC → USDC redemption to restore the ratio.

- **Bounds on individual swaps:** each automated swap is capped at a per-transaction maximum (working value: \$5M) and at a daily aggregate maximum (working value: \$20M), both configurable by the foundation multisig. Above these bounds, the trustee or team must manually authorise the swap via the trustee tooling backup path.

- **Manual override:** the trustee retains a manual swap UI in the trustee tooling that can execute swaps outside the automated band-keeping rules. The manual path requires Trustee + team co-signature regardless of amount.

**5.6 PLUSD backing model and reconciliation invariant**

PLUSD is backed 1:1 by USD-equivalent reserves consisting of USDC and tokenised T-bill positions held in the Capital Wallet, plus USDC currently deployed on loans, plus USDC in transit through the on-ramp. The reconciliation invariant:

PLUSD totalSupply == USDC in Capital Wallet + USYC NAV in Capital Wallet + USDC out on loans (deployed senior principal not yet repaid) + USDC in transit (on-ramp leg in either direction)

Treasury Wallet PLUSD is part of totalSupply and is backed by the same Capital Wallet contents as every other PLUSD holder.

The bridge service evaluates the invariant after each yield distribution event, each deposit, each loan disbursement, each repayment, and each LP withdrawal. The result is published to the protocol dashboard with a status indicator: green when drift is below 0.01%, amber when between 0.01% and 1%, red when above 1%. Amber and red states trigger an alert to the on-call channel and to the trustee.

**6. Withdrawal**

**6.1 Flow overview**

Withdrawal is an inverse of deposit, automated through the bridge service\'s MPC auto-signing permission for LP payouts. The routine happy path requires no human signature.

61. If the LP holds sPLUSD, they first call sPLUSD.redeem(\...) to convert into PLUSD at the current exchange rate.

62. The LP calls WithdrawalQueue.requestWithdrawal(amount). The contract checks that msg.sender is currently on the WhitelistRegistry with a fresh Chainalysis screen --- if the check fails, the call reverts. This is a defensive measure to ensure that even if PLUSD ends up in a non-whitelisted address (e.g., via a future DeFi venue interaction), it cannot be used to drain protocol liquidity. The check is gated by a contract parameter that the foundation multisig can lift at later stages once the protocol\'s DeFi composability surface is more mature.

63. On a successful whitelist check, the contract pulls the PLUSD into queue escrow, assigns a sequential queue_id, and emits WithdrawalRequested(lpAddress, amount, queue_id).

64. The bridge service observes the event and evaluates fillability against the current USDC balance in the Capital Wallet (USYC is not counted --- if USDC is insufficient, the automated liquidity management from §5.5 will redeem USYC as the USDC ratio drops, and the queue will process as liquidity arrives).

65. If USDC is sufficient to fulfil the full request, the bridge service auto-signs the payout transaction on the Capital Wallet (see §6.4 for the policy check) and calls WithdrawalQueue.fillRequest(queue_id) on settlement. The full amount is paid out in one transaction.

66. If USDC is insufficient for the full request, the bridge service fills as much as possible via a partial fill (§6.3) and leaves the remainder at the head of the queue. The partial fill triggers the automated liquidity management to restore the USDC ratio, which will in turn bring USYC → USDC redemption online to service the remaining amount.

**6.2 Why escrow rather than burn-on-request**

Escrow enables queue cancellation --- an LP can call cancelWithdrawal(queue_id) before settlement and retrieve their PLUSD without losing economic position. It also keeps the §5.6 reconciliation invariant valid throughout the withdrawal lifecycle: PLUSD totalSupply does not decrease until USDC has actually left the Capital Wallet.

**6.3 FIFO queue with partial fills**

The WithdrawalQueue processes requests in strict FIFO order by queue_id. Partial fills work as follows:

- When USDC arrives in the Capital Wallet from any source (deposit, repayment, USYC redemption), the bridge service attempts to fill the first request in the queue.

- If the available USDC is enough for the full first request, the bridge fills it completely and moves to the second request with any remaining USDC.

- If the available USDC is less than the first request, the bridge fills the request partially. The queue entry\'s outstanding amount is reduced; the entry stays at the head of the queue.

- Partial fills emit a WithdrawalPartiallyFilled event carrying (queue_id, amount_filled, amount_remaining). The LP dashboard displays progressive fill status.

- The request is removed from the queue only when amount_remaining reaches zero, at which point WithdrawalSettled is emitted.

- A cancelled partially-filled request returns only the unfilled remainder to the LP; the portion already paid out is final.

**6.4 Automated LP payout authorisation**

The bridge service auto-signs LP payout transactions on the Capital Wallet under a narrowly-scoped MPC permission policy. The policy enforces the following checks at the MPC engine level, before the transaction is executed:

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Check**                   **Rule**
  --------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Destination address         Must equal the LP address that originally deposited the USDC corresponding to this PLUSD. The mapping (LP → original deposit address) is stored in the bridge service\'s persistent state and verified by the policy engine via webhook.

  Whitelist status            Destination must be currently whitelisted on the WhitelistRegistry with a fresh Chainalysis screen (§3.1.1).

  Amount                      Must equal the amount_remaining in the corresponding WithdrawalQueue entry, or a partial fill amount up to the Capital Wallet\'s current USDC availability.

  Per-transaction cap         \$5M USDC maximum per single payout transaction.

  Rolling 24h aggregate       \$10M USDC maximum across all LP payouts in a rolling 24h window.

  Out-of-envelope condition   Any request that fails the destination match, exceeds the caps, or involves a non-whitelisted address is rejected at the MPC engine level. The transaction must then be manually co-signed by Trustee + team via the trustee tooling escape path.
  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

The destination-match check is the central security property: a compromised bridge cannot redirect withdrawals to an attacker-controlled address, because the only valid destination is the pinned original deposit address, enforced by the MPC policy engine.

LPs that want to withdraw to a different address than they deposited from must go through a manual review process with the trustee. This is operationally rare at pilot scale and is not supported through the automated path.

Foundation multisig pause capability on the WithdrawalQueue via 2-of-5 Risk Council signature freezes all fills immediately. Alerting on every automated payout above \$1M is pushed to the 24/7 on-call channel.

**6.5 Treasury Wallet redemption and cash extraction**

Extracting protocol revenue from the Treasury Wallet to the Trust Company\'s operating bank account is a two-stage process. Stage A converts Treasury Wallet PLUSD into USDC inside the protocol-controlled boundary. Stage B transfers the USDC out via the on-ramp provider to a pre-approved Trust Company bank account. Both stages require multi-party consensus.

**6.5.1 Stage A --- PLUSD to USDC redemption**

The Treasury Wallet redeems PLUSD for USDC via the same mechanics as a regular LP withdrawal (PLUSD escrow, FIFO queue, partial fill support, reconciliation invariants), with three differences: the initiator is the Pipeline team rather than an LP, the authorisation chain has two team operators plus the trustee rather than the bridge\'s automated LP-payout policy, and the resulting request is filled ahead of the standard LP queue via a privileged flow to avoid queue contention with LP redemptions.

Authorisation chain for Stage A:

67. Team operator A initiates a Treasury redemption request via the team interface, specifying the PLUSD amount.

68. Team operator B independently verifies the request (parameters, business reason, current Treasury Wallet balance) and confirms. Operator B must be a different person from Operator A --- the trustee tooling enforces this by binding each verification to a distinct authenticated session.

69. Trustee receives the verified request in the trustee view, reviews the parameters, and provides the final co-signature via MPC.

70. On all three signatures, the bridge service executes the PLUSD escrow and the USDC payout from the Capital Wallet, settling USDC at a protocol-controlled withdrawal endpoint inside the cash rail.

**6.5.2 Stage B --- USDC to bank account**

Once USDC is settled at the withdrawal endpoint inside the cash rail, the team initiates the off-ramp leg: a transfer of USDC out via the on/off-ramp provider, converting to USD and then SWIFT-wiring to a Trust Company bank account.

The destination bank account is selected from a **pre-approved list** of Trust Company accounts. The list is maintained by the foundation multisig --- adding or removing a destination requires a foundation multisig transaction. Operators cannot enter free-text bank account details; the destination is always picked from the approved list. This prevents an operator (or a compromised operator account) from redirecting funds to an attacker-controlled bank account.

Authorisation chain for Stage B mirrors Stage A: team operator A initiates the transfer (selecting amount and destination from the approved list), team operator B verifies, trustee co-signs via MPC. The bridge service then submits the off-ramp instruction to the on/off-ramp provider on confirmation of all three signatures.

Both stages are recorded in the §9.7 audit log with full traceability: which operators signed, which destination was used, the final SWIFT reference.

**7. Dashboards**

**7.1 LP dashboard**

- Connected wallet address, KYC status, and Chainalysis freshness (with days remaining until re-screening required).

- Current PLUSD balance and current sPLUSD balance, with the live sPLUSD→PLUSD exchange rate and the equivalent PLUSD value.

- Total deposited, total withdrawn, current net position.

- Yield earned: computed as (current sPLUSD value in PLUSD) minus (cost basis of staked PLUSD), tracked per stake lot. Both nominal and time-weighted annualised view.

- Active withdrawal requests: queue_id, original amount, amount_filled, amount_remaining, status. No estimated fill time.

- Transaction history: deposits, mints (including any queued via §3.3.1), stakes, unstakes, withdrawal requests, partial fills, final settlements.

**7.2 Protocol dashboard**

**Panel A --- Balance sheet**

- Total PLUSD outstanding.

- Total sPLUSD outstanding and current sPLUSD→PLUSD exchange rate.

- Capital Wallet contents: USDC balance and USYC holding (units and current USD value at issuer\'s NAV), shown as separate lines.

- USDC out on active loans (from the trustee feed).

- USDC in transit (on-ramp leg).

- Current target USDC ratio vs actual ratio, with upper and lower band indicators from §5.5.

- Reconciliation indicator: the §5.6 invariant with green/amber/red status.

**Panel B --- Deployment monitor**

Reads loan identity and lifecycle state from the LoanRegistry on-chain. Reads outstanding principal, accrued interest, days remaining, and equity tranche from the trustee feed. Each field is labelled by source.

- For each active loan: loanId, originator, borrower, commodity, corridor, original facility size, original tranche split (all from chain); current outstanding principal, accrued interest, days remaining (trustee feed); current status, currentMaturityDate, lastReportedCCR with timestamp (chain); current goods location with location type (vessel / warehouse / tank farm / other), location identifier, and --- for vessels --- a link to an external maritime tracking platform showing the vessel\'s current AIS position (chain); equity tranche commitment with source originator (trustee feed, marked as off-chain).

- For each historical (Closed) loan: same fields plus actual maturity date, closureReason, realised senior coupon, realised originator residual, realised loss if any.

- Aggregate metrics: total deployed, weighted average tenor, weighted average gross rate, commodity mix, corridor mix, originator concentration.

- Real-time event log for each loan: watchlist triggers, margin call notifications, payment delays, AIS blackouts, status transitions (from the price feed and notification system, §9.6).

**Panel C --- Withdrawal queue**

- Total queue depth (sum of outstanding escrowed PLUSD across all requests).

- Number of pending requests, with breakdown of fully pending vs partially filled.

- Oldest pending request age.

- Available USDC liquidity in the Capital Wallet vs queue depth, expressed as a coverage ratio.

- Recent fills: queue_id, amount filled, full or partial, time-in-queue.

**Panel D --- Yield history**

- Time series of cumulative PLUSD minted into the sPLUSD vault, with two distinct series: loan repayment yield (discrete events) and T-bill yield (weekly discrete events from §5.4).

- Real-time accrued T-bill yield since the last weekly distribution (from §5.4.1), shown as a rolling figure that resets after each weekly mint.

- Time series of the sPLUSD→PLUSD exchange rate.

- Trailing 30-day annualised yield to senior, with breakdown into loan-yield contribution and T-bill-yield contribution.

**8. Smart Contract Surface**

**8.1 Contracts to deploy**

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Contract**         **Base standard**                               **Purpose**                                                                                      **Privileged roles**
  -------------------- ----------------------------------------------- ------------------------------------------------------------------------------------------------ ---------------------------------------------------------------
  PLUSD                OZ ERC-20Pausable + minimal \_update override   Receipt token; minted 1:1 to USDC deposits and against trustee-signed yield events               MINTER (bridge), PAUSER (foundation multisig)

  sPLUSD               OZ ERC-4626 (standard)                          Yield-bearing vault on PLUSD with NAV accretion. Open to any PLUSD holder.                       PAUSER (foundation multisig)

  WhitelistRegistry    Custom (audited)                                On-chain allowlist: KYCed LPs + approved DeFi venues. Tracks Chainalysis approvedAt timestamp.   WHITELIST_ADMIN (bridge), DEFAULT_ADMIN (foundation multisig)

  WithdrawalQueue      Custom (audited)                                FIFO queue with partial fill support                                                             FILLER (bridge), PAUSER (foundation multisig)

  LoanRegistry         OZ ERC-721 + custom extension                   On-chain registry of loan facilities                                                             loan_manager (bridge), risk_council (Risk Council 3-of-5)

  FoundationMultisig   Safe                                            Holds admin roles on all contracts                                                               Risk Council members (3-of-5 standard, 2-of-5 fast pause)
  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**8.2 Critical interfaces**

Interfaces summarised by contract. All functions are external unless noted. Events are omitted from the tables below for brevity and are defined inline in the implementation.

**PLUSD**

  --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Function**                                             **Access**   **Description**
  -------------------------------------------------------- ------------ ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
  mint(address to, uint256 amount)                         MINTER       Mints PLUSD. Enforces rolling 24h rate limit (\$10M) and per-tx cap (\$5M), both configurable by foundation multisig. Reverts if recipient not on WhitelistRegistry.

  burn(address from, uint256 amount)                       MINTER       Burns PLUSD from a specified address. Used by WithdrawalQueue.fillRequest.

  transfer(address to, uint256 amount)                     public       Standard ERC-20 transfer. Inherited from OZ. Custom \_update hook reverts if recipient not on WhitelistRegistry.

  transferFrom(address from, address to, uint256 amount)   public       Standard ERC-20. Same whitelist check via \_update.

  pause() / unpause()                                      PAUSER       Freezes all mint, burn, transfer operations. 2-of-5 Risk Council via foundation multisig.
  --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**sPLUSD (ERC-4626)**

  ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Function**                                              **Access**    **Description**
  --------------------------------------------------------- ------------- ----------------------------------------------------------------------------------------------------------
  deposit(uint256 assets, address receiver)                 public        Standard ERC-4626 deposit. Open to any PLUSD holder.

  redeem(uint256 shares, address receiver, address owner)   public        Standard ERC-4626 redeem. Reverts at the PLUSD level if receiver is not whitelisted.

  totalAssets()                                             public view   Returns PLUSD.balanceOf(address(this)). Yield accretion happens via fresh PLUSD mints into this address.

  pause() / unpause()                                       PAUSER        Freezes deposits and redemptions. 2-of-5 Risk Council via foundation multisig.
  ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**WithdrawalQueue**

  ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Function**                                   **Access**    **Description**
  ---------------------------------------------- ------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  requestWithdrawal(uint256 amount)              public        Pulls PLUSD from caller into escrow, creates a queue entry, returns queue_id. Emits WithdrawalRequested.

  cancelWithdrawal(uint256 queueId)              public        Only callable by original requester. Returns remaining escrowed PLUSD. Cannot reverse already-filled portions.

  fillRequest(uint256 queueId, uint256 amount)   FILLER        Bridge calls this to fill the first request in the queue, either fully or partially. Burns the filled PLUSD amount. Emits WithdrawalPartiallyFilled or WithdrawalSettled.

  getQueueDepth()                                public view   Returns (totalEscrowed, count, outstandingAtHead).

  pause() / unpause()                            PAUSER        Freezes all fills. 2-of-5 Risk Council via foundation multisig.
  ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**WhitelistRegistry**

  -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Function**                                **Access**                         **Description**
  ------------------------------------------- ---------------------------------- ----------------------------------------------------------------------------------------------------
  setAccess(address lp, uint256 approvedAt)   WHITELIST_ADMIN                    Bridge sets a wallet as approved with the current Chainalysis screening timestamp.

  revokeAccess(address lp)                    WHITELIST_ADMIN or DEFAULT_ADMIN   Immediate removal from whitelist, e.g., on failed passive re-screen.

  isAllowed(address lp)                       public view                        Returns true if lp is currently whitelisted AND (block.timestamp - approvedAt) \< freshnessWindow.

  freshnessWindow                             public storage                     Configurable parameter (default 90 days) set by DEFAULT_ADMIN.

  addDeFiVenue(address venue)                 DEFAULT_ADMIN                      Foundation multisig adds approved DeFi pool/vault addresses that can hold PLUSD.
  -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**LoanRegistry**

  --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Function**                                                                                                             **Access**                     **Description**
  ------------------------------------------------------------------------------------------------------------------------ ------------------------------ ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  mintLoan(address originator, ImmutableLoanData data)                                                                     loan_manager                   Mints a new loan NFT. Bridge calls this after the trustee has verified the originator\'s off-chain signed request. Emits LoanMinted event that triggers the bridge\'s disbursement preparation (§9).

  updateMutable(uint256 tokenId, LoanStatus status, uint256 newMaturityDate, uint256 newCCR, LocationUpdate newLocation)   loan_manager                   Updates lifecycle fields. Reverts if newStatus == Default.

  setDefault(uint256 tokenId)                                                                                              risk_council                   Risk Council 3-of-5 multisig transitions a loan to Default status.

  closeLoan(uint256 tokenId, ClosureReason reason)                                                                         loan_manager or risk_council   loan_manager for {ScheduledMaturity, EarlyRepayment}; risk_council for {Default, OtherWriteDown}.

  getImmutable(uint256 tokenId)                                                                                            public view                    Returns immutable origination data.

  getMutable(uint256 tokenId)                                                                                              public view                    Returns current mutable lifecycle data.
  --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**LoanRegistry data structures**

Each loan NFT carries two on-chain data structs (immutable origination data plus mutable lifecycle state) and references two enum types. The LocationUpdate struct is embedded in the mutable struct to track current goods location.

ImmutableLoanData (set at mint, never changes):

  -----------------------------------------------------------------------------------
  **Field**               **Type**     **Notes**
  ----------------------- ------------ ----------------------------------------------
  originator              address      Originator\'s on-chain identifier

  borrowerId              bytes32      Hashed borrower identifier

  commodity               string       e.g. Jet fuel JET A-1

  corridor                string       e.g. South Korea → Mongolia

  originalFacilitySize    uint256      6-decimal USDC units

  originalSeniorTranche   uint256      Senior portion at origination

  originalEquityTranche   uint256      Equity portion at origination

  originationDate         uint256      Block timestamp at mint

  originalMaturityDate    uint256      Originally agreed maturity

  governingLaw            string       e.g. English law, LCIA London

  metadataURI             string       Optional IPFS pointer to descriptive context
  -----------------------------------------------------------------------------------

MutableLoanData (updated by loan_manager / risk_council):

  ------------------------------------------------------------------------------------------
  **Field**                  **Type**         **Notes**
  -------------------------- ---------------- ----------------------------------------------
  status                     LoanStatus       Performing \| Watchlist \| Default \| Closed

  currentMaturityDate        uint256          May be extended from original

  lastReportedCCR            uint256          Basis points (e.g. 14000 = 140%)

  lastReportedCCRTimestamp   uint256          When CCR was last updated

  currentLocation            LocationUpdate   Embedded struct, see below

  closureReason              ClosureReason    Set when status = Closed
  ------------------------------------------------------------------------------------------

LocationUpdate (embedded in mutable data, updated as cargo moves):

  ------------------------------------------------------------------------------------------
  **Field**            **Type**       **Notes**
  -------------------- -------------- ------------------------------------------------------
  locationType         LocationType   Vessel \| Warehouse \| TankFarm \| Other

  locationIdentifier   string         Vessel IMO, warehouse name, tank farm ID

  trackingURL          string         Optional external tracking link (MarineTraffic etc.)

  updatedAt            uint256        Timestamp of last location update
  ------------------------------------------------------------------------------------------

Enums: LoanStatus { Performing, Watchlist, Default, Closed } · ClosureReason { None, ScheduledMaturity, EarlyRepayment, Default, OtherWriteDown } · LocationType { Vessel, Warehouse, TankFarm, Other }.

**8.3 Architecture, audit posture, and restricted interactions**

Contracts use OpenZeppelin audited library code as the base. Custom logic is isolated to small, narrowly-scoped extensions.

**Audit isolation principles**

- **PLUSD** uses OpenZeppelin\'s ERC-20Pausable directly, with a single custom override of the \_update hook that calls WhitelistRegistry.isAllowed(to). The override is approximately 5 lines of Solidity. All other token logic is inherited unmodified from the audited OpenZeppelin library.

- **sPLUSD** uses OpenZeppelin\'s ERC-4626 implementation unmodified. Yield accretion is a natural property of ERC-4626 and requires no custom code --- it happens because the bridge service mints fresh PLUSD into the vault address, which increases totalAssets while totalSupply stays constant.

- **LoanRegistry** uses OpenZeppelin\'s ERC-721 as the base. The custom extension stores the immutable and mutable loan data structures, implements role-based access control for mintLoan, updateMutable, setDefault, and closeLoan, and emits events. The custom surface is approximately 200 lines.

- **WhitelistRegistry** and **WithdrawalQueue** are fully custom contracts, but both are small and narrowly scoped. WhitelistRegistry is approximately 80 lines; WithdrawalQueue with partial fill support is approximately 180 lines.

- Total custom code surface for audit is approximately 470 lines across all contracts. This is a small target for a Tier 1 auditor and should complete a full review in standard engagement time.

**Restricted interaction model**

PLUSD transfers are gated by the WhitelistRegistry on every movement, not just at mint time. The WhitelistRegistry contains two categories of approved address:

- KYCed LP wallets approved via the §3.1 onboarding process, with Chainalysis freshness enforced via the approvedAt timestamp and the freshnessWindow parameter.

- Approved DeFi venues --- specific Curve pools, Uniswap v4 pools, Aave market contracts --- explicitly added by the foundation multisig after legal and technical review. These venues are where PLUSD composability is deliberately enabled.

Any PLUSD transfer to an address not in either category reverts at the PLUSD level. This means a compromised PLUSD (e.g., if an LP\'s wallet is drained by an unrelated attack) cannot be moved to an attacker-controlled address that has not been pre-approved. The attacker would need to compromise both an LP wallet AND either pass KYC with the stolen wallet or find an approved DeFi venue that accepts the stolen PLUSD.

Note: the whitelist enforcement on PLUSD transfers is intentionally tight for the MVP. As the protocol matures and the set of approved DeFi venues grows, the foundation multisig can lift the per-transfer check (e.g., by setting WhitelistRegistry into a permissive mode where only sanctioned addresses are blocked, rather than only approved addresses being permitted). This is a configuration change at the WhitelistRegistry level and does not require a contract upgrade. The MVP ships in the strict mode; lifting is a Phase 2 governance decision.

sPLUSD is NOT subject to the whitelist check --- the vault is open, and DeFi composability for the yield-bearing token is the primary use case for third-party participation. The KYC chain is enforced at the PLUSD level: any sPLUSD redemption ultimately delivers PLUSD, and that PLUSD can only be transferred to whitelisted addresses. The whitelist check re-enters on the way out of the vault.

**Audit engagement**

MVP targets a single Tier 1 audit (Trail of Bits, ChainSecurity, OpenZeppelin, or equivalent) scoped to the six contracts above. Public bug bounty is explicitly excluded from the MVP. The combination of a Tier 1 audit and the restricted interaction model is the MVP\'s security posture; a public bug bounty is a Phase 2 addition once the protocol has an open DeFi surface and the attack incentives justify the overhead of running the programme.

**9. Bridge Service and Off-Chain Components**

**9.1 Bridge service responsibilities**

- **On-chain event listening.** Monitor USDC Transfer events into the Capital Wallet, WithdrawalRequested events on the WithdrawalQueue, LoanMinted and loan status events on the LoanRegistry, and any trustee-signed events submitted via the trustee tooling.

- **MPC auto-signing (narrowly scoped).** The bridge service is an MPC participant on the Capital Wallet with auto-signing authority for four transaction categories, each tied to specific on-chain or counterparty conditions: USDC ↔ USYC swaps within the band-keeping bounds; LP withdrawal payouts where the destination matches the original deposit address and the amount is within \$5M/\$10M bounds; preparation (not signing) of loan disbursement transactions in response to LoanMinted events; and preparation of Treasury Wallet redemption transactions in response to team-initiated requests.

- **PLUSD minting.** Deposit mints in response to USDC Transfer events from whitelisted LPs (with the deposit queue in §3.3.1 for rate-limit overflow). Yield mints in response to trustee-signed RepaymentSettled and TreasuryYieldDistributed events.

- **USDC → USYC sweep on loan repayment.** Automatically convert senior principal returns to USYC immediately after the repayment settles (§5.3 step 5).

- **Weekly yield event pre-building.** Continuously track USYC NAV in real time. At the weekly reference time (Thursday end of day), pre-build the TreasuryYieldDistributed transaction and present it to the trustee tooling for signature.

- **WhitelistRegistry maintenance.** Update the on-chain whitelist in response to Sumsub KYC approvals and Chainalysis screening results.

- **Price feed and notification system (§9.6).** Monitor active loans in real time against external commodity reference prices; compute CCR and trigger notifications on threshold crossings.

- **Reconciliation invariant publishing.** Compute and publish the §5.6 invariant after every state-changing event.

**9.2 Bridge service security model**

The bridge service is deliberately designed so that its compromise does not enable a drain of investor capital. The security posture rests on three structural properties:

- **Narrow MPC permissions.** The bridge is an MPC signer only for the four transaction categories enumerated in §9.1, each gated by predefined counterparty addresses and bounds. The MPC policy engine enforces these constraints at the wallet level, not in the bridge\'s software. A compromised bridge cannot sign anything outside the pre-authorised patterns; exceptional transactions require human signatures from trustee and/or team.

- **Pinned counterparty addresses.** For each auto-signed transaction type, the valid destination is fixed (Hashnote/Circle for USYC swaps, on-ramp provider for loan disbursements) or derived from on-chain state (LP payout destination must equal the original deposit address from the bridge\'s pinned mapping). A compromised bridge cannot redirect funds to an attacker-controlled destination.

- **Bounded automated envelopes.** Every auto-signed transaction type is bounded by per-transaction and rolling-aggregate caps enforced by the MPC policy. The \$10M/\$5M caps on LP payouts and the \$20M/\$5M caps on USDC ↔ USYC swaps mean that even a worst-case compromise is bounded to a recoverable fraction of the pilot pool within any single detection window.

On the token-rail side: the bridge holds the MINTER role on PLUSD, which is bounded by the on-chain rate limit (\$10M rolling / \$5M per tx) enforced at the PLUSD contract level. The bridge holds the FILLER role on the WithdrawalQueue, which can only burn PLUSD that is already in queue escrow --- the bridge cannot fabricate a fill against an escrow entry that does not exist. The bridge holds the loan_manager role on the LoanRegistry, but mintLoan and updateMutable both require the bridge to have first validated an off-chain signed request from the trustee (for mints, additionally an originator signature verified by the trustee).

Bridge hot keys for on-chain transactions are stored in an HSM-backed KMS (AWS KMS / GCP KMS) with two-person operational access required for key rotation. The MPC key share is managed through the MPC vendor\'s own key ceremony and is not stored on the bridge\'s hot infrastructure. Foundation multisig 2-of-5 fast-pause can freeze PLUSD, sPLUSD, and WithdrawalQueue immediately on incident detection, regardless of bridge state.

**9.3 Team interface**

The Team interface is the Pipeline team\'s view inside the Operations Console --- the same web application that hosts the Trustee tooling (§9.4) and the Originator UI (§9.5), with role-based access to screens relevant to the team\'s responsibilities. Team members authenticate via the same email + password + 2FA model as trustees and originators; the first team members bootstrap themselves at protocol launch, and all subsequent team invitations use the same two-person consensus activation rule described in §9.3.1.

Four functional areas: operator account management (inviting and approving trustees and originators), fund-transfer co-signing, exception handling (compliance review queue and bridge alerts), and operational monitoring.

**9.3.1 Operator account management**

Team members are the only parties who can invite new trustees and originators. Invitations are issued with an assigned role; the invited user signs up with email + password + 2FA binding (per the flow described in §9.4 Operator account onboarding); activation requires approval by two distinct team members before the account can take any privileged action.

- **Invite new operator.** Fields: invitee email, role (Trustee or Originator), optional sub-role, optional note. On submission, the system generates a one-time signup link and emails it to the invitee. The link expires after 72 hours.

- **Pending activations queue.** Lists all operator accounts in Pending Activation state. Each row shows invitee email, role, invitation date, signup date (if the invitee has completed signup), and the team members who have approved so far. A team member clicks Approve; after two distinct team members have approved, the account is activated automatically. A team member who invited an account cannot count as one of the two approvers --- at least one of the approvers must be a different team member from the inviter.

- **Active operators view.** Lists all activated trustee and originator accounts with their role, last login, and status. Single-click Suspend action for immediate suspension (e.g., suspected compromise or staff offboarding). Suspend takes effect immediately on a single team member\'s action.

- **Removal requests.** Permanent removal of an activated operator requires the same two-person consensus as activation. A team member initiates a removal request from the Active operators view; a second team member must approve before the account is removed.

Inviting, approving, suspending, and removing team members themselves follow the same rules: any existing team member can invite; two-person consensus activates; one team member suspends; two-person consensus permanently removes. The first team members at protocol launch are bootstrapped via the foundation multisig (out of scope for this document).

**9.3.2 Fund-transfer co-signing**

The team co-signs four categories of cash-rail transaction via MPC. Each category has its own permission policy on the relevant wallet (§1.5). The team interface surfaces pending transactions in a unified signing queue with category filters.

- **Loan disbursements.** The bridge service prepares the Capital Wallet outflow transaction in response to a LoanMinted event. The pending transaction appears in the team signing queue. A team member reviews (loan ID, amount, destination = on-ramp provider address) and provides their MPC signature. Trustee\'s MPC signature is required in parallel (§5.1 Flow E).

- **Treasury redemption Stage A (PLUSD → USDC).** Per §6.5.1: team operator A initiates; team operator B independently verifies; trustee co-signs. The team interface enforces that Operator A and Operator B are different team members by binding each step to a distinct authenticated session.

- **Treasury redemption Stage B (USDC → bank).** Per §6.5.2: same two-team-operators + trustee chain. Destination must be selected from the foundation-multisig-maintained pre-approved bank account list --- no free-text entry.

- **Above-envelope LP payouts.** Automated LP payouts within the \$5M per-tx / \$10M rolling-24h bounds are auto-signed by the bridge service. Payouts above either bound route to the signing queue for trustee + team co-signature. The team member reviews destination (must be the LP\'s original deposit address), amount, and the originating queue_id before signing.

- **Above-envelope USDC ↔ USYC swaps.** Automated swaps within the \$5M per-tx / \$20M daily aggregate bounds (§5.5) are bridge-signed. Swaps above either bound route to the signing queue for trustee + team co-signature.

**9.3.3 Compliance review queue**

Reached only when LP onboarding (§3.1) returned an ambiguous screening result that the automated path could not resolve. For each queue entry, the team member sees: LP\'s Sumsub output, Chainalysis report, accreditation declaration, connected wallet address, and the specific flag that triggered manual review.

- **Single-reviewer decision.** A single compliance officer (a team member with the compliance sub-role) can approve or reject an exception-review LP. Approvals result in the bridge service writing the LP address to the WhitelistRegistry as in the happy path; rejections notify the LP with the reason.

- **Escalation.** For genuinely complex cases (politically exposed persons, large entity with complex UBO chain, etc.), the reviewer can escalate to a two-person review. The second compliance officer must be a different team member.

- **Audit trail.** Every compliance decision is recorded in the §9.7 audit log with the deciding officer, the evidence reviewed, and the outcome.

**9.3.4 Bridge alerts and on-call response**

Real-time feed of bridge service events: rate-limit hits, alerting threshold breaches (any mint ≥ \$1M, any payout ≥ \$1M), reconciliation invariant drift (amber/red status from §5.6), failed screening checks during deposits, unusual activity patterns.

- **Live alert stream.** Chronological feed with severity (info / amber / red), timestamp, category, and the originating event or transaction. Filterable by severity and category.

- **Acknowledge and resolve.** Team members on call acknowledge alerts (stopping repeat notifications) and add resolution notes. Acknowledgement does not change any on-chain state; it is a UI convenience for tracking incident response.

- **Emergency pause coordination.** If an incident warrants a foundation multisig pause (on PLUSD, sPLUSD, or WithdrawalQueue, per §8.1), the team interface provides a button to notify all Risk Council members with the context. Risk Council members sign the pause transaction on Safe independently --- the team interface does not execute the pause itself.

**9.3.5 Operational monitoring**

A small set of read-only dashboards for day-to-day operational awareness. All data sourced from the internal indexer and the bridge service.

- **Protocol health.** Reconciliation invariant status, Capital Wallet USDC ratio against the target band (§5.5), queue depth, oldest pending withdrawal, active loan count. Same data as the public protocol dashboard (§7.2) but with finer operational detail.

- **Signing queue depth.** Count of pending MPC transactions awaiting team signature, grouped by category (loan disbursement, Treasury redemption, above-envelope LP payout, above-envelope swap). SLA indicators if any pending transaction has been open longer than the operational threshold.

- **Operator activity.** Recent login history, recent privileged actions by trustees and originators, recent operator status changes (activations, suspensions). For operational awareness only --- compliance-grade audit is via §9.7.

**9.3.6 Authorisation and security model**

- **Email + password + 2FA authentication.** Same model as trustees and originators (§9.4.1). Team members do not hold Ethereum signing keys outside the MPC participation.

- **MPC participation.** Each team member is a distinct participant in the Capital Wallet and Treasury Wallet MPC policies. The wallet vendor\'s policy engine enforces the per-transaction-category rules (§1.5) and the two-operator-disjoint rule for Treasury redemption stages.

- **Two-person consensus on account lifecycle.** Invitations of new operators (team, trustee, originator) by a team member do not grant the invited user any privileges. Activation requires a second team member\'s approval. Suspensions are single-member; permanent removals are two-member.

- **Audit log.** Every team action (login, signing-queue action, invitation, activation approval, suspension, compliance decision, alert acknowledgement) is recorded in the §9.7 audit log.

**9.4 Trustee tooling**

The trustee tooling is a back-office application operated by the Pipeline Trust Company. It is a first-class component of the MVP.

**Operator account onboarding**

Originators and trustees do not auto-onboard like LPs. Each operator account is created by an invited user and then activated by Pipeline team consensus before the account can take any privileged action. This is the operator-side analogue of the LP onboarding flow in §3, with two important differences: operators authenticate via traditional email + password + 2FA rather than wallet connection, and account activation requires two-person consensus from the Pipeline team rather than passing automated checks.

- **Invitation.** A team member issues an invitation by entering the operator\'s work email and selecting a role (Originator or Trustee). The system generates a one-time signup link and emails it to the operator. The link expires after 72 hours.

- **Signup.** The operator opens the link, enters their work email (must match the invited address), sets a password (complexity rules TBD at implementation), and binds a 2FA authenticator. Acceptable 2FA methods: TOTP via authenticator app (Google Authenticator, Authy) or hardware key (WebAuthn / FIDO2). 2FA binding is mandatory; the account cannot be activated without it. After signup, the account enters Pending Activation state.

- **Two-person team consensus activation.** The new account appears in the Pipeline team\'s operator approvals queue. At least two distinct team members must independently approve the account before it transitions from Pending Activation to Active. This is a team-internal consensus check, not a foundation multisig action --- it does not touch the on-chain Risk Council multisig. The two-person requirement is enforced by the trustee tooling backend; a single team member cannot self-approve or bypass.

- **Activation and login.** On the second approval, the account is activated and the operator receives an email confirmation. The operator can then log into the Operations Console (the technical-spec name for the role-based trustee tooling described in §9.4 throughout). Their assigned role determines which screens they see --- an Originator account sees only the Originator view, a Trustee account sees only the Trustee view.

- **Suspension and removal.** Any single team member can suspend an operator account immediately (e.g., on suspected compromise or staff offboarding). Permanent removal requires the same two-person consensus as activation. Suspended accounts cannot log in but their audit history is preserved indefinitely per §9.7.

- **Audit logging.** Every operator account lifecycle event (invitation, signup, approval, activation, suspension, removal) is recorded in the §9.7 append-only audit log. Each event captures the actor, the target operator, and the timestamp.

**Loan origination verification and minting**

- Receive an origination request from the Originator (submitted through a separate Originator interface, carrying an off-chain signed payload with the immutable loan parameters).

- Verify the Originator\'s signature and review the parameters against the originator\'s credit framework and Pipeline\'s protocol-level rules.

- Approve or reject the request. On approval, the trustee instructs the bridge service to call LoanRegistry.mintLoan() with the verified parameters. The mint is a loan_manager transaction broadcast by the bridge on behalf of the trustee.

- The LoanMinted event triggers the bridge service to prepare the loan disbursement transaction on the Capital Wallet. The trustee and team then co-sign the prepared transaction via MPC to execute the actual USDC outflow. The Originator is not involved in the disbursement signing --- the Originator\'s role ends at request submission.

**LoanRegistry lifecycle updates**

- Update mutable lifecycle fields via the loan_manager role: status transitions (Performing ↔ Watchlist), currentMaturityDate extensions, lastReportedCCR updates in response to price feed events, and current goods location updates as cargo moves through the trade corridor.

- Submit Risk Council escalation requests for transitions to Default status and Closed-with-default-reason.

- Close loans at scheduled maturity or early repayment.

**Repayment reconciliation with client-side waterfall**

- Log incoming USD wires from borrowers. Identify the corresponding loan_id manually.

- Select the loan from the LoanRegistry-backed loan picker in the tooling. Enter the repayment amount received.

- Review the client-side-computed waterfall breakdown (§5.1). Adjust individual components if the actual transaction deviates from the baseline computation.

- Sign the RepaymentSettled event.

- Instruct the on-ramp provider to convert the senior portion to USDC, settling into the Capital Wallet. The bridge service then automatically executes the on-chain yield delivery and the senior principal sweep to USYC.

**USYC liquidity management**

USDC ↔ USYC liquidity management is automated by the bridge service under the band-keeping rules in §5.5. The trustee tooling exposes a manual override UI as a backup path for exceptional cases, but the expected MVP operational mode is fully automated. The trustee monitors the automated swap activity via the protocol dashboard and can override or pause the automation through the foundation multisig if needed.

**Weekly yield event signature**

- At the weekly reference time (Thursday end of day NY, exact time TBD), the bridge service pre-builds the TreasuryYieldDistributed transaction and presents it to the trustee tooling.

- The trustee reviews the pre-built transaction (total accrued yield, vault share, treasury share, reference NAV, holding amount).

- The trustee signs the transaction (a signed attestation, not an on-chain transaction) and the bridge service executes the yield-mints.

- The trustee is not expected to compute any values manually --- the entire transaction is pre-built and the trustee\'s role is verification and signature.

**Treasury Wallet operations**

- The team initiates Treasury Wallet redemption requests through a team-facing interface that shares the trustee tooling\'s backend. The trustee\'s role on Treasury redemptions is verification and co-signing via MPC; the team is the initiator.

- The trustee tooling displays Treasury Wallet balance with breakdown by source (cumulative inflows from each fee category).

**Daily reconciliation publishing**

The daily reconciliation feed is published automatically by the bridge service, not manually by the trustee. The bridge computes the snapshot (Capital Wallet contents, Treasury Wallet contents, in-transit amounts, invariant status) and publishes it to the protocol dashboard on a continuous basis with no human step required. Equity tranche figures per active loan --- the one category of data the bridge cannot compute from on-chain state alone --- are input by the trustee tooling on a rolling basis as equity flows settle, and are included in the automated daily feed without requiring a daily manual signature.

**9.5 Originator UI**

The Originator UI is the off-chain client through which Loan Originators interact with the protocol. It runs as a role-restricted view inside the same Operations Console as the trustee tooling (§9.4) --- same backend, same authentication infrastructure (operator account onboarding per §9.4), different screens. Originators have no Ethereum signing key and no MPC key share; every action they take is mediated by the trustee tooling and ultimately by the bridge service.

The Originator UI exposes four functional areas: submitting new origination requests, viewing the status of own requests, browsing own loan portfolio, and viewing aggregate statistics on loans originated.

**9.5.1 New origination request**

Originators do not call LoanRegistry.mintLoan() directly. The trustee holds the loan_manager role on the LoanRegistry; the Originator UI submits an off-chain signed request, the trustee tooling validates and broadcasts the on-chain mint.

71. Originator opens the New origination form and enters the immutable loan parameters: borrower identifier, commodity, corridor, original facility size, senior/equity tranche split, tenor, governing law, optional metadata URI, and initial location data (LocationType, identifier, optional tracking URL).

72. On submit, the Originator UI builds the canonical EIP-712 payload covering all immutable parameters, requests an off-chain signature from the Originator\'s authenticated session (no on-chain transaction, no wallet popup --- the signature is bound to the Originator\'s logged-in account using the same auth credentials they used at signup, with 2FA confirmation for the signature step).

73. The signed request is POSTed to the bridge service, which validates the signature deterministically. If the signature is valid, the request is recorded with status SubmittedAwaitingTrustee and surfaced in the trustee\'s origination queue (§9.4 Loan origination verification). If invalid, the request is rejected immediately and not surfaced to the trustee.

74. The trustee reviews the parameters (the system has already validated the signature, per §3.5 of the technical spec for Flow E in the UI/UX spec). The trustee approves, requests changes, or rejects.

75. On trustee approval, the trustee tooling broadcasts LoanRegistry.mintLoan() with the verified parameters. The LoanMinted event fires, the bridge service prepares the disbursement transaction (per §9.1), and the standard Originator + Trustee + Team loan disbursement flow proceeds.

76. On rejection or change request, the Originator sees the trustee\'s comment in the My Requests view and may resubmit a revised request as a new submission.

**9.5.2 My requests view**

Lists every origination request the Originator has submitted, with status:

- **SubmittedAwaitingTrustee** --- request signed and sent, awaiting trustee review.

- **ChangesRequested** --- trustee has flagged required changes; comment shown, Originator can revise and resubmit.

- **Rejected** --- trustee declined; comment shown, no further action possible on this request.

- **Approved** --- trustee has approved the request and broadcast the LoanRegistry mint. The corresponding loanId is shown and links to the loan detail view.

- **Disbursed** --- the loan disbursement co-signature has settled and USDC has been wired to the borrower.

Each entry shows submission timestamp, current status, last-updated timestamp, the immutable parameters submitted, and the loanId once minted.

**9.5.3 My loans view**

Lists every loan facility minted with originator equal to this Originator\'s address. Reads loan identity and lifecycle state from the LoanRegistry on-chain; reads outstanding principal, accrued interest, and days remaining from the trustee feed. Filterable by status (Performing / Watchlist / Default / Closed) and by commodity, corridor, or borrower.

For each loan, fields displayed match the protocol dashboard\'s Panel B per §7.2 --- same data sourcing, scoped to this Originator\'s loans only. Clicking a loan opens a detail view with the full immutable + mutable LoanRegistry state, the price feed event log for that loan (watchlist triggers, margin call notifications, payment delays, AIS blackouts, status transitions per §9.6), and the repayment history reconstructed from RepaymentSettled events filtered by loanId.

**9.5.4 Statistics**

A single-page summary of the Originator\'s portfolio performance, computed from the LoanRegistry, the trustee feed, and the RepaymentSettled event log. Scoped to loans where originator equals this Originator\'s address.

  ----------------------------------------------------------------------------------------------------------------------------------------------
  **Metric**                               **Source**                                            **Notes**
  ---------------------------------------- ----------------------------------------------------- -----------------------------------------------
  Active loans count                       LoanRegistry (status != Closed)                       Real-time

  Aggregate outstanding senior principal   Trustee feed                                          Sum across active loans

  Lifetime loans originated                LoanRegistry                                          Active + Closed

  Lifetime volume originated               LoanRegistry (originalFacilitySize sum)               Senior + equity total

  Weighted average tenor                   LoanRegistry (closed loans)                           Weighted by originalFacilitySize

  Weighted average gross rate              RepaymentSettled events                               Computed from realised senior interest

  Default count and realised loss          LoanRegistry (status == Default) + RepaymentSettled   Zero in pilot

  Concentration view                       LoanRegistry                                          Distribution by commodity, corridor, borrower

  Equity tranche outstanding               LoanRegistry + trustee feed                           Sum of equity across active loans

  Lifetime residual yield earned           RepaymentSettled events (originator_residual)         Cumulative junior yield from closed loans
  ----------------------------------------------------------------------------------------------------------------------------------------------

**9.5.5 Notifications**

Originators receive notifications for events on their own loans only, via the §9.6 notification subsystem. Delivery channels: in-app banner inside the Originator UI plus optional email and Slack webhook (per §9.6). The notification feed inside the UI is a chronological log filterable by event type (watchlist, maintenance margin call, margin call, payment delay amber/red, AIS blackout, CMA discrepancy, status transition) with acknowledge / mark-read controls. Acknowledgement does not change on-chain state --- it is a UI convenience for the Originator to track which alerts they have actioned.

**9.5.6 Authorisation and security model**

- **No on-chain keys.** Originator accounts authenticate via email + password + 2FA (per §9.4 operator onboarding). They do not hold Ethereum signing keys and they do not hold MPC key shares. Every on-chain effect of an Originator action is mediated by the trustee tooling.

- **Off-chain signature scope.** The EIP-712 signature on a new origination request covers the canonical immutable parameters only. It does not authorise any cash-rail action and it does not commit the Originator on-chain --- the LoanRegistry mint is a trustee transaction. The signature is the Originator\'s evidentiary commitment to the parameters they submitted.

- **Read scope.** The Originator UI reads loan data scoped to loans where originator equals this Originator\'s address. The bridge service enforces this filter at the API level --- an Originator cannot query loans belonging to another Originator. (In the MVP with one Originator the filter is moot, but it is in place for the multi-originator future.)

- **Audit log.** Every Originator action (login, request submission, request resubmission, notification acknowledgement) is recorded in the §9.7 audit log alongside trustee, team, and bridge service actions.

**9.6 Price feed and event notification system**

Automatic position tracking is a first-class MVP requirement. The bridge service runs a price feed and notification subsystem that monitors every active loan in real time.

**Price feed architecture**

- **Source.** Platts and Argus reference prices for each commodity the protocol finances. Consumed via licensed data subscription (S&P Global for Platts, LSEG for Argus). The MVP does not publish prices on-chain; it consumes them off-chain to compute CCR and trigger notifications.

- **Polling cadence.** Working assumption: price feed updates every 15 minutes during market hours, less frequently overnight. Configurable parameter.

- **Per-loan valuation.** For each active loan in the LoanRegistry, the bridge computes current collateral value using: (a) the commodity reference price from the feed, (b) the current quantity from the trustee feed (or the original quantity minus delivered portions tracked off-chain), (c) the commodity-specific haircut schedule defined in the credit framework, and (d) the loan\'s current outstanding senior principal.

- **CCR computation.** CCR = collateral_value / outstanding_senior_principal, expressed in basis points. Updated on every price feed tick. When the computed CCR crosses a defined threshold, the bridge triggers the appropriate notification path and initiates a loan_manager update to the LoanRegistry\'s lastReportedCCR field (via a batched update on threshold crossings, not on every tick, to avoid on-chain spam).

**Notification events and recipients**

Significant loan events trigger notifications to the team, the loan\'s Originator, the borrower (through the Originator as commercial intermediary), and the trustee. Notifications are delivered via a mix of dashboard alerts, email, and optionally Telegram/Slack webhooks configured per recipient.

  -----------------------------------------------------------------------------------------------------------------------------------------
  **Event**                 **Trigger**                                              **Recipients**
  ------------------------- -------------------------------------------------------- ------------------------------------------------------
  Watchlist                 CCR falls below 130% (amber)                             Team, Originator, Trustee

  Maintenance margin call   CCR falls below 120%                                     Team, Originator, Borrower (via Originator), Trustee

  Margin call               CCR falls below 110% (red)                               Team, Originator, Borrower, Trustee

  Payment delay (amber)     Scheduled repayment \> 7 days late                       Team, Originator, Trustee

  Payment delay (red)       Scheduled repayment \> 21 days late                      Team, Originator, Trustee

  AIS blackout              Vessel tracking loss \> 12 hours                         Team, Originator, Trustee

  CMA discrepancy           Reported collateral quantity differs from CMA by \> 3%   Team, Originator, Trustee

  Status transition         Any change to LoanRegistry mutable status field          Team, Originator, Trustee
  -----------------------------------------------------------------------------------------------------------------------------------------

Thresholds and notification rules are configurable at the protocol level by the foundation multisig and per-loan by the loan_manager role for loan-specific overrides. All notification events are also logged to an append-only event history on the protocol dashboard (Panel B), providing a full audit trail of loan lifecycle events.

**9.7 Audit logging**

Every privileged action taken by the bridge service is recorded in an append-only audit log stored in a dedicated log database. The log captures, for each action: the timestamp, the action type (categorised --- deposit mint, yield mint, LP payout, USDC/USYC swap, loan disbursement preparation, LoanRegistry mutation, notification dispatch), the triggering on-chain event or trustee signature, the on-chain transaction hash of any resulting transaction, the before/after state of the relevant invariant, and any input parameters.

The log serves three purposes: incident investigation (tracing from symptom back to causing action), compliance evidence (every PLUSD mint and Capital Wallet outflow traceable to a specific authorised trigger), and audit substrate (the Tier 1 auditor consumes it to verify operational posture matches the specified design).

The log is mirrored in near-real-time to an independent third-party log sink (a separate cloud account managed by the trustee, or a dedicated SIEM service) so that a compromise of the bridge service infrastructure cannot retroactively alter the record. Write access to the log sink is append-only; the bridge service cannot delete or modify historical entries. Retention is the lifetime of the protocol.

**10. Open Items**

**10.1 Vendor selections pending**

- **MPC wallet vendor.** Fireblocks or BitGo. Selection driven by parallel RFI. The vendor must support the bridge service as a programmatic MPC participant with policy-engine conditions tying auto-signing to on-chain events and predefined counterparty addresses.

- **On/off-ramp provider.** Open between Circle Mint, Zodia Markets, and other institutional candidates. Single-rail for MVP.

- **Deployment chain.** Ethereum mainnet (working assumption) or Soroban.

**10.2 Critical-path dependencies**

- USYC issuer onboarding (Hashnote / Circle). Capital Wallet whitelisted as an authorised USYC holder.

- Risk Council membership.

- Trust Company correspondent bank confirmation.

- MPC vendor confirmation that the policy engine can encode the bridge-as-participant rules described in §9.2.

- Commodity price data licensing with S&P Global (Platts) and LSEG (Argus) for the price feed subsystem.

**10.3 Parameters to finalise**

- Exact weekly yield reference time on Thursday (working assumption: 17:00 America/New_York or issuer NAV publication time).

- OET allocation rate (working range: 0.05--0.10% of senior deployed, pro-rated).

- Automated USDC ↔ USYC swap bounds (working values: \$5M per-tx, \$20M daily aggregate).

- Target USDC ratio band (working values: 15% target, 10% lower, 20% upper).

- CCR threshold levels for each notification event (working values in §9.6 notification table).

**10.4 Follow-ups outside this document**

- White paper §9.1 amendment regarding PLUSD\'s backing model (USDC + tokenised T-bills, not USDC alone). Flagged only; not in this document\'s scope.

- Originator-facing interface specification. The Originator\'s off-chain origination request submission flow needs its own small UX spec.

- Loan disbursement operational runbook covering the coordination between the automated LoanMinted trigger, the bridge\'s transaction preparation, the team + trustee co-signature, and the SWIFT disbursement by the on-ramp provider.

**Document Control**

Version 0.3.8 --- Internal draft. Incorporates the v0.3 amendments plus two rounds of review fixes: v0.3.1 (formatting cleanup, withdrawal whitelist check, LoanRegistry struct tables) and v0.3.2 (corrected §3.2 deposit flow with below-minimum top-up handling, dedup pass across §1.2, §1.5, §2.1, §6.4, §9.2). April 2026.

It is not yet a finalised engineering brief. The vendor selections and dependencies in §10 should be resolved before implementation work begins. All references to white paper sections refer to Pipeline White Paper v7 (April 2026).

**CONFIDENTIAL**
