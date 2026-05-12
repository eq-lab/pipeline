---
title: Quick start manual
order: 5
section: Start here
---

# Quick start manual

## For lenders

1. Confirm Pipeline can serve your jurisdiction (see [Legal](/references/legal/)).
2. Set up a self-custodied wallet. Pipeline never holds your keys.
3. Fund the wallet with at least $1,000 USDC plus a small ETH balance for gas (two transactions on your side: `deposit` and `claim`).
4. Connect the wallet at pipeline.one. No identity documents required — Pipeline runs KYT (Know Your Transaction) screening on every deposit, not KYC.
5. Approve USDC to DepositManager and call `deposit(amount)`. Your USDC moves to the Intake Wallet pending screening; a deposit ticket is created.
6. Wait for KYT screening. Typically seconds, sometimes minutes. The Relayer signs a claim attestation off-chain on a clean result.
7. Call `claim(depositId, attestation, signature)` yourself. The contract enrols you on WhitelistRegistry, moves USDC from the Intake Wallet to the Capital Wallet, and mints PLUSD 1:1 — all in this transaction.
8. Stake PLUSD into sPLUSD. Yield accrues to share price automatically.

<div class="callout info">
  <h4>What happens next</h4>
  <p>sPLUSD share price moves only when a senior coupon or realised T-bill gain is minted into the vault. Both events are recorded on-chain. To exit, unstake sPLUSD, queue the resulting PLUSD on the WithdrawalQueue, and claim USDC yourself when the queue is funded.</p>
</div>

## For originators

1. Fill out the application [here](https://forms.gle/kP1H3VJ5dKVoou6Q8).
2. We will contact you within five business days.
3. If approved, complete your onboarding.
4. Start loan origination and earning higher yield on equity tranche.

## For borrowers

1. Reach out to us.
