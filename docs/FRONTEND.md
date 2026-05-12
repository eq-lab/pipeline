# FRONTEND

## Visual direction

Clean, professional financial interface. Priority: data density and clarity over decoration. Operators and LPs need to trust the numbers they see.

## Component workshop

Storybook lives in `packages/ui/.storybook/` and is launched with:

```bash
yarn workspace @pipeline/ui storybook        # dev server on http://localhost:6006
yarn workspace @pipeline/ui build-storybook  # static export → packages/ui/storybook-static/
```

Each Phase-3 component issue ships a `.stories.tsx` file alongside the component. The Storybook setup uses `@storybook/react-vite` (reusing the existing Vite 6 + Tailwind v4 config) and includes `@storybook/addon-docs` and `@storybook/addon-a11y` from day one.

## Component library / design system

TBD — evaluate Shadcn/ui (headless, Tailwind-based) or Radix UI primitives. Decision to be made before frontend sprint begins. Add a tech-debt entry if not resolved before Phase 1 implementation.

## Application structure

File-based routing is provided by [TanStack Router](https://tanstack.com/router) (`@tanstack/react-router`). Route files live in `packages/frontend/src/routes/`. The plugin (`@tanstack/router-plugin`) auto-generates `src/routeTree.gen.ts` on every `vite build` / `vite dev` run; that file is committed (so `tsc` works on a fresh clone without first running the dev server / build) but must not be edited manually.

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
- Live rate-limit status (current window utilisation, per-LP cap remaining)
- Chainalysis freshness indicator with days remaining

### Operations Console views (role-gated)

| Role | Views visible |
|------|--------------|
| Trustee | Origination queue, repayment reconciliation, yield attestation approval, loan lifecycle, USYC NAV tracking |
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
- **Transactions:** LP signs USDC.approve() + DepositManager.deposit(), sPLUSD.deposit(), sPLUSD.redeem(), WithdrawalQueue.requestWithdrawal(), WithdrawalQueue.claim() directly from connected wallet
- **No proxy:** contract interactions for LPs go direct from browser wallet to chain — no backend relayer

## Data fetching

All non-wallet data fetched from `packages/api` REST endpoints. Use SWR or React Query for caching and revalidation. No direct indexer queries from frontend.
