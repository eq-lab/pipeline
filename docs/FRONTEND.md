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

## Code structure rules

These rules apply to everything under `packages/frontend/` and `packages/ui/`. They exist so a reader can find the logic, the view, or the shared utility without spelunking — and so reused code earns the testing it deserves.

1. **One component per file.** A file exports exactly one React component. Co-located children (small layout subcomponents that are not used elsewhere) are still each in their own file. The file name matches the component name (`StakeCard.tsx` exports `StakeCard`, etc.).

2. **Separate view from logic via a co-located hook.** A component's `.tsx` file is JSX-and-styling only. Any non-trivial state, derivation, side effect, or external integration lives in a `useXxx` hook next to the component (`StakeCard.tsx` + `useStakeCard.ts`). The view calls the hook and renders. This keeps components diff-friendly under UX review, makes the logic unit-testable without a DOM, and gives reviewers one place to look for behaviour.

3. **Extract common utils — and always test them.** When the same helper (formatter, parser, predicate, comparator, mock-resolver, etc.) is needed in two or more places, lift it into a dedicated `utils/` module and import it from there. Every extracted util ships with a unit test in the same commit. Inline duplication is a code smell; an untested util is a regression waiting to happen.

4. **Catalogue every extracted util.** Each shared util is listed in [`docs/frontend/utils.md`](./frontend/utils.md) with its import path and a one-line description. The PR that introduces or moves a util updates this catalogue in the same commit.

5. **Catalogue every reused hook.** Each hook used by two or more components (or intended for reuse) is listed in [`docs/frontend/hooks.md`](./frontend/hooks.md) with its import path and a one-line description. Component-local hooks following rule 2 (e.g. `useStakeCard`) stay out of this list; the catalogue is for genuinely shared hooks.

See [`docs/frontend/index.md`](./frontend/index.md) for the catalogue index.

## Toast notifications

Transient global feedback is rendered by `<ToastProvider>` in the bottom-right corner of the viewport. The imperative `useToast()` hook (imported from `@/lib/toast`) is the canonical surface for emitting notifications from page components.

**Rule:** toast emissions always live at the call site (e.g. the page component that owns the write hook), never inside the hook itself. The hook stays generic; the page decides what copy to show.

```ts
const toast = useToast();

// Pending — sticky until updated/dismissed.
toast.show({ id: "deposit-tx", tone: "pending", title: "Sending…" });

// Terminal — auto-dismisses after 5 s.
toast.update("deposit-tx", {
  tone: "success",
  title: "Deposit submitted",
  action: { label: "View", onClick: () => navigate({ to: "/transactions" }) },
});
```

See [`docs/frontend/hooks.md`](./frontend/hooks.md) for the full `useToast` API reference.

## Application structure

File-based routing is provided by [TanStack Router](https://tanstack.com/router) (`@tanstack/react-router`). Route files live in `packages/frontend/src/routes/`. The plugin (`@tanstack/router-plugin`) auto-generates `src/routeTree.gen.ts` on every `vite build` / `vite dev` run; that file is committed (so `tsc` works on a fresh clone without first running the dev server / build) but must not be edited manually.

Single SPA serving two logical views gated by authenticated role:

| View               | Auth                                              | Entry  |
| ------------------ | ------------------------------------------------- | ------ |
| LP Dashboard       | Wallet connection (WalletConnect v2 / RainbowKit) | `/`    |
| Operations Console | Email + password + 2FA                            | `/ops` |

### LP Dashboard panels

- Position summary (PLUSD, sPLUSD, net position, yield earned)
- Deposit flow (USDC → PLUSD)
- Staking flow (PLUSD → sPLUSD)
- Withdrawal flow (sPLUSD → PLUSD → queue)
- Transaction history
- Live rate-limit status (current window utilisation, per-LP cap remaining)
- Chainalysis freshness indicator with days remaining

### Operations Console views (role-gated)

| Role       | Views visible                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| Trustee    | Origination queue, repayment reconciliation, yield attestation approval, loan lifecycle, USYC NAV tracking |
| Team       | Signing queue, compliance review queue, bridge alerts, operator management, operational monitoring         |
| Originator | New origination request, My Requests, My Loans, statistics, notifications                                  |

## Responsive behavior

Desktop-first — LPs and operators are expected to use desktop browsers. Mobile layout should be readable but is not a primary concern for MVP.

## Real-time updates

- Protocol dashboard panels: poll API every 30 seconds
- Bridge alerts: SSE (Server-Sent Events) or WebSocket push from API
- Price feed / CCR: display as of last API poll; timestamp shown
- sPLUSD exchange rate: read directly from contract via ethers.js on page load

## Web3 integration

- **Wallet connection:** wagmi + viem + Reown AppKit (WalletConnect v2). All blockchain access
  is wrapped in `packages/frontend/src/wallet/`; see
  `packages/frontend/src/wallet/README.md` for the public API and the
  `pipeline.mock.wallet.*` localStorage mock key schema.
- **Contract reads:** `useContractRead` wrapper in the wallet module (delegates to wagmi's
  `useReadContract`); token metadata + balance + approval via `useToken`.
- **Transactions:** LP signs USDC.approve() + DepositManager.deposit(), sPLUSD.deposit(),
  sPLUSD.redeem(), WithdrawalQueue.requestWithdrawal(), WithdrawalQueue.claim() directly from
  connected wallet via wagmi `useWriteContract` (in future issues that consume `useWallet()`).
- **No proxy:** contract interactions for LPs go direct from browser wallet to chain — no backend relayer.
- **Chain:** Hoodi testnet (chain id 560048) by default; configurable via `VITE_EVM_CHAIN_ID` /
  `VITE_EVM_RPC_URL` at runtime using `vite-plugin-runtime-env`.

## Deployment image and runtime configuration

The production frontend image is built from the root Dockerfile target `frontend`:

```bash
docker build --target frontend -t pipeline-frontend .
```

The image builds `@pipeline/frontend` once, copies the static Vite output into nginx, and serves
the SPA on container port 80. Unknown routes fall back to `index.html`, so direct navigation to
TanStack Router routes returns the application shell instead of nginx 404.

Runtime configuration is injected at container start. The entrypoint writes
`/usr/share/nginx/html/__env.js` as `window.__ENV__ = { ... };`, and `index.html` loads that file
before the Vite module script. This keeps one image promotable across environments; do not rebuild
the image just to change API, chain, contract, or WalletConnect settings.

Supported runtime keys:

| Key                             | Default when unset                           |
| ------------------------------- | -------------------------------------------- |
| `VITE_API_BASE_URL`             | `http://localhost:8080`                      |
| `VITE_EVM_CHAIN_ID`             | `560048`                                     |
| `VITE_EVM_RPC_URL`              | `https://ethereum-hoodi-rpc.publicnode.com`  |
| `VITE_DEPOSIT_MANAGER_ADDRESS`  | `0x0000000000000000000000000000000000000000` |
| `VITE_WITHDRAWAL_QUEUE_ADDRESS` | `0x0000000000000000000000000000000000000000` |
| `VITE_STAKED_PLUSD_ADDRESS`     | `0x0000000000000000000000000000000000000000` |
| `VITE_WALLETCONNECT_PROJECT_ID` | `replace-me`                                 |

Local container verification:

```bash
docker run --rm -p 8081:80 \
  -e VITE_API_BASE_URL=http://host.docker.internal:8080 \
  -e VITE_EVM_CHAIN_ID=560048 \
  -e VITE_EVM_RPC_URL=https://ethereum-hoodi-rpc.publicnode.com \
  -e VITE_DEPOSIT_MANAGER_ADDRESS=0x0000000000000000000000000000000000000000 \
  -e VITE_WITHDRAWAL_QUEUE_ADDRESS=0x0000000000000000000000000000000000000000 \
  -e VITE_STAKED_PLUSD_ADDRESS=0x0000000000000000000000000000000000000000 \
  -e VITE_WALLETCONNECT_PROJECT_ID=replace-me \
  pipeline-frontend
```

Use a host port that does not conflict with the API dev server. Then check the runtime file and a
direct SPA route:

```bash
curl -s http://localhost:8081/__env.js
curl -i http://localhost:8081/deposit/123
```

The route request should return HTTP 200 with the SPA shell.

## Data fetching

All non-wallet data fetched from `packages/api` REST endpoints. Use SWR or React Query for caching and revalidation. No direct indexer queries from frontend.
