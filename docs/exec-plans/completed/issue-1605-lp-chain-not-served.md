# Issue #1605: LP: explicit state when the active chain isn't served by the API

Source: https://github.com/eq-lab/pipeline/issues/1605 — follow-up to #1564 / #1566 / #1584 /
#1586 / #1597. Branch: `feat/1605-lp-chain-not-served`.

**Status: implemented (2026-10-22)** — all surfaces gated; frontend lint/build/test (155 files, 2473 tests), `lint-docs` and `lint-comments` green. See PR #1619.

## Detection — `GET /v1/chains`

Resumed 2026-10-27: the original `/v1/pnl` zero-wallet probe was replaced by `GET /v1/chains` (#1608).
`useChainServed()` (`api/`) fetches the list once (`queryKey: ["chains"]`, `staleTime: Infinity`,
`retry: false`, shared across chain ids and wallet views) and reports
`served = chains.some(c => c.chain_id === chainId)`, Stellar included. If the request itself fails the
chain counts as served, so a flaky request can never hide a working chain.

## Surfaces — hide the protocol widgets, show one message

`ChainNotServedNotice` ("Pipeline isn't available on <chain> yet. Switch your wallet to a
supported network to see protocol data.", `data-testid="chain-not-served"`) replaces, on the EVM
view only when the list omits the active chain:

- Home: the mobile stack and the desktop dashboard card (the stats strip's TVL/APY cells go too —
  `HomeStatsStrip` renders Exchange rate only). `WelcomeHeader` stays.
- `/dashboard`: the panel grid.
- `/transactions`: the tabs + feed.
- `/deposit` and `/stake`: the form — an on-chain request on an unserved chain can never get a
  voucher, so the flow is closed, not just warned.

Nothing renders while the list is in flight that would later be replaced by the notice: the
surfaces treat `served === undefined` as "not yet known" and keep today's loading states.

## Scope

`packages/frontend` only. Tests: hook (listed / unlisted / request failure / Stellar);
each surface renders the notice when not served and its normal content when served; `@/api`
module mocks gain `useChainServed`. Docs: `wallet-flows.md` Active chain for protocol reads,
`dashboard-components.md` (HomeStatsStrip, Dashboard route, Activity), user-stories doc + index row.

## Open Questions

_None._

## Test Strategy

`yarn workspace @pipeline/frontend lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`,
`npx tsx scripts/lint-comments.ts`.
