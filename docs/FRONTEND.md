# FRONTEND

## Visual direction

Clean, professional financial interface. Priority: data density and clarity over decoration. Operators and LPs need to trust the numbers they see.

## Typography

Two self-hosted typefaces (declared as `@font-face` in `packages/ui/src/styles/theme.css`):

- **Besley** (display serif, SIL OFL 1.1) — weights 400 and 700, available via `font-display` Tailwind utility.
- **Graphik LC** (body sans, Type Today commercial license) — weights 400, 400-italic, and 500, available via `font-body` Tailwind utility.

The `.woff2` files live in `packages/ui/src/assets/fonts/` and are referenced by relative URL from the `@font-face` rules in `theme.css`. To add a new weight: drop the `.woff2` into `packages/ui/src/assets/fonts/`, add a matching `@font-face` block in `packages/ui/src/styles/theme.css` (with the right `font-family`, `font-weight`, `font-style`, and `font-display: swap`), and — if the new weight needs a semantic alias — extend the `--font-weight-*` tokens in the same file.

## Design tokens

All design tokens are declared as CSS custom properties inside a Tailwind v4 `@theme { … }` block in `packages/ui/src/styles/theme.css`. Token groups:

- **Color** (`--color-pipeline-*`) — background, surface, promo, brand, CTA, ink, and border values sourced from Figma frame `1497-94556`.
- **Typography** (`--text-pipeline-*`, `--font-weight-*`, `--tracking-pipeline-*`) — font-size/line-height pairs, semantic weight aliases (regular/medium/emphasized/bold), and label tracking.
- **Radii** (`--radius-pipeline-*`) — card, button, and pill radii.
- **Spacing** — Tailwind v4 default 4px numeric scale; no semantic aliases.

Rule: components must not inline raw hex codes. All color, radius, and typography values are consumed through Tailwind utilities (`bg-pipeline-paper`, `text-pipeline-ink`, `rounded-pipeline-card`, `font-display`, etc.).

The integration point is `packages/frontend/src/index.css`, which imports `@pipeline/ui/styles/theme.css` and adds an `@source` directive so Tailwind v4 scans `packages/ui/src` for utility class names. `packages/frontend/src/routes/index.tsx` carries a token-styled smoke probe that exercises color, typography, and radius tokens until the real WelcomeScreen lands (component issues #42–#49).

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
