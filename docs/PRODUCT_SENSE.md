# PRODUCT SENSE

## Elevator pitch

Pipeline is a decentralised commodity trade finance protocol: accredited LPs deposit USDC, receive the PLUSD stablecoin, stake into the sPLUSD yield-bearing vault, and earn yield from short-tenor commodity loans (senior tranche) and idle USYC T-bill holdings — while their capital stays protected behind MPC wallets that smart contracts cannot drain.

## Core loop

1. LP passes KYC/AML → whitelisted on-chain
2. LP deposits USDC → receives PLUSD (1:1)
3. LP stakes PLUSD → holds sPLUSD (yield-accruing)
4. Trustee validates and mints loans → Capital Wallet disburses to borrower via on-ramp
5. Borrower repays → trustee reconciles → yield minted to sPLUSD vault
6. USYC T-bill yield accrues weekly → 70% to sPLUSD vault, 30% to Treasury
7. LP unstakes sPLUSD → queues withdrawal → receives USDC

## Key differentiators

- **Split-rail security:** smart contracts hold no USDC or USYC; cash-rail outflows require MPC co-signatures. A smart contract exploit cannot unilaterally drain capital.
- **Composable yield token:** sPLUSD is an open ERC-4626 vault — any DeFi venue approved by the foundation multisig can hold and route it.
- **Dual yield source:** loan repayment coupons + USYC T-bill NAV accrual give LPs two uncorrelated yield streams.
- **Real-time collateral monitoring:** price feed + CCR computation on active loans with automated threshold notifications.

## Success metrics (MVP)

- PLUSD backing invariant drift ≤ 0.01% (green status) at all times
- LP withdrawal settled within ≤ 24h for requests within automated bounds
- Zero unintended cash-rail outflows (measured by audit log)
- Reconciliation invariant published within 60 seconds of each state-changing event

## Anti-goals (what this product is NOT)

- Not a retail lending platform — LPs are accredited investors only
- Not a public DeFi protocol at MVP — interaction model is restricted; bug bounty is Phase 2
- Not automated end-to-end — repayment identification is manual; bank integration is deferred
- Not multi-originator at pilot — Open Mineral AG is the sole originator
- Not a tokenised collateral vault — the LoanRegistry is informational; physical collateral stays off-chain under CMA control
