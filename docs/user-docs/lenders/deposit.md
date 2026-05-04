---
title: Deposit
order: 7
section: For Lenders
redirect_from:
  - /lenders/deposit-and-stake/
---

# Deposit

Deposit USDC to receive PLUSD at 1:1. Deposit is a single atomic transaction — your USDC never moves without the matching PLUSD mint landing in the same block. PLUSD is the compliance-bounded representation of your deposit; you can hold it, send it to other whitelisted addresses, or stake it into sPLUSD to earn yield.

| Asset  | What it is                          | Earns yield | Whitelist at transfer |
|--------|-------------------------------------|-------------|-----------------------|
| USDC   | External stablecoin                 | No          | No                    |
| PLUSD  | 1:1 claim on the Capital Wallet     | No          | Yes                   |
| sPLUSD | ERC-4626 share of the vault         | Yes         | No at the share level |

## Before you deposit

- Your wallet must be whitelisted and your Chainalysis screen fresh (90-day window). See [onboarding](/lenders/onboarding/) if either is missing.
- The minimum deposit is $1,000 USDC. There is no maximum beyond the rate limits below.
- You need enough ETH in your wallet to cover two transactions: the USDC approval and the deposit call. Gas is paid by you, not the protocol.
- Pipeline never takes custody of your keys. Every step is initiated from your own wallet.

---

## Deposit flow

{% include diagram.html src="d2-deposit-mint.svg" caption="Deposit to mint — one atomic transaction, no Relayer signer in the critical path." %}

### Walkthrough

<ol class="steps">
  <li>Approve <code>DepositManager</code> as a USDC spender, then call <code>DepositManager.deposit(amount)</code> from your whitelisted wallet.</li>
  <li>DepositManager calls <code>WhitelistRegistry.isAllowedForMint(lp)</code> and reverts if your wallet is not whitelisted or your Chainalysis screen is older than 90 days.</li>
  <li>DepositManager checks the four caps in order: per-LP 24h limit, aggregate 24h limit, hard total supply ceiling, and the freshness window.</li>
  <li>DepositManager calls <code>USDC.transferFrom(lp, capitalWallet, amount)</code>, a single on-chain ERC-20 transfer from your wallet to the Capital Wallet.</li>
  <li>DepositManager calls <code>PLUSD.mintForDeposit(lp, amount)</code>, which runs the reserve invariant check; only DepositManager holds the DEPOSITOR role.</li>
  <li>Your PLUSD balance rises 1:1 with the USDC deposited, and the whole transaction reverts as a unit if any prior step fails.</li>
</ol>

### Rate limits

A single deposit cannot exceed $5M. 24h deposits across all your wallets cannot exceed $10M. If either cap would be breached, the transaction reverts on-chain — there is no auto-queue in MVP. Split the deposit manually and retry when limits reset. The deposit UI reads the `GET /v1/protocol/limits` endpoint and shows live utilisation before you submit, so you can size each transaction against available headroom.

A third cap — the hard total supply ceiling on PLUSD — is a protocol-wide circuit breaker and is only tightened or loosened by ADMIN governance. Tightening is instant; loosening requires a 48h AccessManager delay. You will almost never see this cap bind; it exists to bound the blast radius of any integration error.

### What lands in your wallet

- PLUSD, minted 1:1 to USDC, with no fee deducted at mint time.
- The deposit event is indexed immediately; your PLUSD balance is spendable in the same block.
- PLUSD can only be sent to other whitelisted addresses.

### Where the USDC goes

Your USDC moves in a single ERC-20 transfer to the Capital Wallet — the institutional-custody MPC address whose cosigner shares are held by the Trustee, the Pipeline Team, and two reputable external counterparties under a 3-of-5 threshold. Smart contracts never hold lender USDC, so a contract exploit can't drain deposits. The Capital Wallet maintains the 15% USDC buffer (band 10–20%) and rotates excess into USYC for yield. Every movement out of the wallet is subject to the cosigner quorum; no single Pipeline party can move it.

---

## Common deposit failure modes

- **Deposit reverts with whitelist error.** Your Chainalysis screen is older than 90 days. Re-screen via the app.
- **Deposit reverts with rate-limit error.** You or the protocol have hit the 24h cap. Check live utilisation and split the deposit or wait.
- **Deposit reverts on `transferFrom`.** You did not approve `DepositManager` to spend USDC, or the approval is for less than the `amount` you passed.
- **Deposit reverts with paused error.** The GUARDIAN Safe has paused `DepositManager`. Check the status page before retrying.

---

## Contract addresses

`DepositManager`, `PLUSD`, and `WhitelistRegistry` addresses are published on the [Audits & addresses page](/security/audits-and-addresses/) and are verified on Etherscan. Treat the Audits & addresses page as the source of truth. Do not trust addresses copied from third-party sites.

---

## Next

- [Stake PLUSD](/lenders/stake/) — convert PLUSD into yield-bearing sPLUSD.
- [Withdraw](/lenders/withdraw/) — convert sPLUSD or PLUSD back to USDC.
- [Yield engines](/how-it-works/yield-engines/) — how senior coupons and T-bill NAV flow into the vault.
- [Supply safeguards](/security/supply-safeguards/) — the reserve invariant, rate limits, and the hard supply cap.
