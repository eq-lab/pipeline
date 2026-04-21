# FRONTEND

## Visual direction

Clean, professional financial interface. Priority: data density and clarity over decoration. Operators and LPs need to trust the numbers they see.

## Component library / design system

TBD — evaluate Shadcn/ui (headless, Tailwind-based) or Radix UI primitives. Decision to be made before frontend sprint begins. Add a tech-debt entry if not resolved before Phase 1 implementation.

## Application structure

Single SPA serving two logical views gated by authenticated role:

| View | Auth | Entry |
|------|------|-------|
| LP Dashboard | Wallet connection (WalletConnect v2 / RainbowKit) | `/` |
| Operations Console | Email + password + 2FA | `/ops` |

### LP Dashboard panels

- Position summary (PLUSD, sPLUSD, net position, yield earned)
- Deposit flow (USDC → PLUSD)
- Staking flow (PLUSD → sPLUSD)
- Withdrawal flow (sPLUSD → PLUSD → queue)
- Transaction history
- Pending deposits (below-minimum accumulation, mint queue status)
- Chainalysis freshness indicator with days remaining

### Operations Console views (role-gated)

| Role | Views visible |
|------|--------------|
| Trustee | Origination queue, repayment reconciliation, weekly yield signing, loan lifecycle, USYC manual override |
| Team | Signing queue, compliance review queue, bridge alerts, operator management, operational monitoring |
| Originator | New origination request, My Requests, My Loans, statistics, notifications |

## Responsive behavior

Desktop-first — LPs and operators are expected to use desktop browsers. Mobile layout should be readable but is not a primary concern for MVP.

## Real-time updates

- Protocol dashboard panels: poll API every 30 seconds
- Bridge alerts: SSE (Server-Sent Events) or WebSocket push from API
- Price feed / CCR: display as of last API poll; timestamp shown
- sPLUSD exchange rate: read directly from contract via ethers.js on page load

## Web3 integration

- **Wallet connection:** WalletConnect v2 + RainbowKit
- **Contract reads:** ethers.js direct calls for balances, exchange rate, whitelist status
- **Transactions:** LP signs USDC transfer, sPLUSD.deposit(), sPLUSD.redeem(), WithdrawalQueue.requestWithdrawal() directly from connected wallet
- **No proxy:** contract interactions for LPs go direct from browser wallet to chain — no backend relayer

## Data fetching

All non-wallet data fetched from `packages/api` REST endpoints. Use SWR or React Query for caching and revalidation. No direct indexer queries from frontend.
