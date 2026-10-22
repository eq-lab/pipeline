# Issue #1605: LP: explicit state when the active chain isn't served by the API

Source: https://github.com/eq-lab/pipeline/issues/1605 — follow-up to #1564 / #1566 / #1584 /
#1586 / #1597. Branch: `feat/1605-lp-chain-not-served`.

## Detection — a probe, since there is no configured-chains endpoint

The API still exposes no chain list, so the signal is the one the issue names: a required-chain
endpoint's `400 unknown chain_id`. `GET /v1/pnl` validates `chain_id` (`RequiredChain`) **before**
it parses `wallet`, so `GET /v1/pnl?wallet=<zero address>&chain_id=<id>` is a side-effect-free
probe that answers 200 (served, zeros) or 400 `unknown chain_id` (not served) without a wallet.
`useChainServed()` (`api/`) runs it once per EVM chain id (`staleTime: Infinity`, `retry: false`,
key `["chain-served", chainId]`); the Stellar view is served by construction (the issue: "the
Stellar view is unaffected") and skips the request. Any other failure counts as served, so a
flaky probe can never hide a working chain. When a configured-chains endpoint lands, the hook's
body is the only thing to swap.

## Surfaces — hide the protocol widgets, show one message

`ChainNotServedNotice` ("Pipeline isn't available on <chain> yet. Switch your wallet to a
supported network to see protocol data.", `data-testid="chain-not-served"`) replaces, on the EVM
view only when the probe says not served:

- Home: the mobile stack and the desktop dashboard card (the stats strip's TVL/APY cells go too —
  `HomeStatsStrip` renders Exchange rate only). `WelcomeHeader` stays.
- `/dashboard`: the panel grid.
- `/transactions`: the tabs + feed.
- `/deposit` and `/stake`: the form — an on-chain request on an unserved chain can never get a
  voucher, so the flow is closed, not just warned.

Nothing renders while the probe is in flight that would later be replaced by the notice: the
surfaces treat `served === undefined` as "not yet known" and keep today's loading states.

## Scope

`packages/frontend` only. Tests: hook (200 / 400 unknown chain_id / other error / Stellar skips);
each surface renders the notice when not served and its normal content when served; `@/api`
module mocks gain `useChainServed`. Docs: `wallet-flows.md` Active chain for protocol reads,
`dashboard-components.md` (HomeStatsStrip, Dashboard route, Activity), user-stories doc + index row.

## Open Questions

_None._

## Test Strategy

`yarn workspace @pipeline/frontend lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`,
`npx tsx scripts/lint-comments.ts`.
