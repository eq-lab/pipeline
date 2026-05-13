---
title: Deposit
order: 14
section: For Lenders
redirect_from:
  - /lenders/deposit-and-stake/
---

# Deposit

Deposit USDC, wait for KYT screening, claim PLUSD. Two on-chain transactions on your side, with a screening window in between. Your USDC sits in the **Intake Wallet** during screening, then moves to the Capital Wallet when you claim. PLUSD is the compliance-bounded representation of your deposit. You can hold it, transfer to other whitelisted addresses, or stake into sPLUSD to earn yield.

| Asset  | What it is                          | Earns yield | Whitelist at transfer |
|--------|-------------------------------------|-------------|-----------------------|
| USDC   | External stablecoin                 | No          | No                    |
| PLUSD  | 1:1 claim on the Capital Wallet     | No          | Yes                   |
| sPLUSD | ERC-4626 share of the vault         | Yes         | No at the share level |

## Before you deposit

- The minimum deposit is $1,000 USDC. There is no maximum beyond the rate limits below.
- You need enough ETH in your wallet for three transactions: the USDC approval, the deposit call, and the claim call once KYT returns clean. Gas is paid by you, not the protocol.
- Pipeline never takes custody of your keys. Every step is initiated from your own wallet.
- You do not need to be whitelisted in advance. The deposit flow itself enrols you on a clean KYT result. See [Onboarding](/lenders/onboarding/) for the three enrolment paths.

---

## Deposit flow

{% include diagram.html src="d2-deposit-mint.svg" caption="Two-step deposit. The Intake Wallet holds USDC during KYT screening. The Capital Wallet receives USDC at claim. PLUSD mints to the lender at claim." %}

### Walkthrough

<ol class="steps">
  <li>Approve <code>DepositManager</code> as a USDC spender, then call <code>DepositManager.deposit(amount)</code> from your wallet.</li>
  <li>DepositManager checks the rate limits in order: minimum deposit, per-lender 24h cap, global 24h cap, hard total supply ceiling against <code>totalSupply + outstandingTickets</code>.</li>
  <li>DepositManager calls <code>USDC.transferFrom(you, intakeWallet, amount)</code>. USDC moves from your wallet to the Intake Wallet.</li>
  <li>DepositManager creates a deposit ticket: <code>{amount, status: Pending, createdAt}</code>. You receive a <code>depositId</code>.</li>
  <li>The Relayer detects the deposit and runs KYT on your address and the inbound transfer off-chain. Typically seconds, sometimes minutes.</li>
  <li>On a clean result, the Relayer signs a claim attestation (EIP-712) and serves it via API. The Relayer makes no on-chain write. Your frontend polls the API and fetches the attestation when ready.</li>
  <li>You call <code>DepositManager.claim(depositId, attestation, signature)</code>. The contract verifies the signature against the configured attestor address, checks the deadline and nonce, writes your address to the WhitelistRegistry, pulls USDC from the Intake Wallet to the Capital Wallet via standing allowance, and mints PLUSD 1:1 to your address. The reserve invariant check runs on the mint.</li>
  <li>Your PLUSD balance rises 1:1 with the USDC deposited, no fee deducted at mint time. The ticket flips to <code>Claimed</code>.</li>
</ol>

The Relayer never writes to DepositManager. Its role is to sign the off-chain attestation. This mirrors the yield mint flow on YieldMinter and the withdrawal claim flow on WithdrawalQueue.

### Rate limits

A single deposit cannot exceed $5M. 24h deposits across all your wallets cannot exceed $10M. If either cap would be breached, the deposit transaction reverts on-chain. There is no auto-queue. Split the deposit manually and retry when limits reset. The deposit UI reads the `GET /v1/protocol/limits` endpoint and shows live utilisation before you submit, so you can size each transaction against available headroom.

A third cap, the hard total supply ceiling on PLUSD, is a protocol-wide circuit breaker. Tightening is instant under GUARDIAN. Loosening is an ADMIN action under the standard 3-day AccessManager delay, GUARDIAN-cancelable during the window. The ceiling reserves headroom against tickets that have already passed KYT and are waiting for claim, so a claim cannot be blocked by other lenders' claims exhausting the cap.

### What lands in your wallet

- PLUSD, minted 1:1 to USDC, with no fee deducted at mint time.
- The deposit event is indexed when the claim transaction lands.
- PLUSD can only be sent to other whitelisted addresses.

### Where your USDC goes

**Step 1 (deposit).** USDC transfers from your wallet to the **Intake Wallet**, a separate MPC custody address. The Intake Wallet operates under the same cosigner substrate as the Capital Wallet (3-of-5 with Trustee and Team mandatory), with a sub-policy specific to deposit operations. Smart contracts never hold lender USDC.

**Step 2 (claim).** USDC moves from the Intake Wallet to the **Capital Wallet** via the standing allowance the Intake Wallet has granted to DepositManager. The transfer is pulled by your `claim` call, not pushed by an off-chain signer. The Capital Wallet maintains the 15% USDC buffer (band 10-20%) and rotates excess into USYC for yield.

If KYT returns a soft fail or hard fail, your USDC stays in the Intake Wallet pending compliance disposition. It does not move to the Capital Wallet. PLUSD is not minted.

---

## When KYT does not return clean

Three result classes. Your ticket stays `Pending` on-chain in all three. The off-chain handling differs.

- **Clean.** The Relayer signs a claim attestation. You call `claim` with it. PLUSD mints. Ticket flips to `Claimed`.
- **Soft fail.** The Relayer does not sign the attestation. A compliance officer reviews. The default outcome is auto-refund within 72h. Trustee and Team co-sign a USDC transfer from the Intake Wallet back to your wallet. After settlement, the Trustee calls `markRefunded` to flip the ticket on-chain. Compliance can override and approve, in which case the Relayer signs and serves the attestation as in the clean path.
- **Hard fail.** No attestation. Ticket stays `Pending` indefinitely. Funds held pending Trustee disposition under legal direction.

---

## Abandoned tickets

A `Pending` ticket that you do not claim within 30 days of `deposit` is refundable. Call `DepositManager.refund(depositId)` to pull your USDC back from the Intake Wallet to your wallet. No attestation required for abandonment refunds, the 30-day timeout is the gate.

---

## Common deposit failure modes

- **`deposit` reverts on `transferFrom`.** You did not approve `DepositManager` to spend USDC, or the approval is less than the amount you passed.
- **`deposit` reverts with rate-limit error.** You or the protocol have hit the 24h cap. Check live utilisation and split the deposit or wait.
- **`claim` reverts with `InvalidSignature` or `AttestationExpired`.** Your attestation is invalid or past its deadline. Frontend re-fetches a fresh attestation from the Relayer API.
- **`claim` reverts with `TicketNotPending`.** The ticket is already `Claimed`, `Refunded`, or your `Pending` ticket has aged past 30 days. If past the window, call `refund` to retrieve USDC.
- **`claim` reverts with `NonceUsed`.** The attestation was already submitted in a prior tx. Frontend fetches a fresh attestation.
- **No attestation available from the API.** KYT has not returned clean. Either screening is still in progress, or you are in compliance review (soft fail) or freeze (hard fail). Check ticket status in the dashboard.
- **`deposit` or `claim` reverts with paused error.** GUARDIAN has paused DepositManager. Check the status page before retrying.

---

## Contract addresses

`DepositManager`, `PLUSD`, `WhitelistRegistry`, and the Intake Wallet address are published on the [Audits & addresses page](/technical/audits-and-addresses/) and are verified on Etherscan. Treat that page as the source of truth. Do not trust addresses copied from third-party sites.

---

## Next

- [Stake PLUSD](/lenders/stake/). Convert PLUSD into yield-bearing sPLUSD.
- [Withdraw](/lenders/withdraw/). Convert sPLUSD or PLUSD back to USDC.
- [Supply safeguards](/security/capital-safeguards/). The reserve invariant, rate limits, the hard supply cap.
