# Issue #1567: LP: activity feed scoped to the active wallet view's chain

**Status: implemented (2026-10-19)** — all steps done; frontend lint/build/test (154 files, 2462 tests) and `lint-docs` green. See PR #1581. Backend PR #1566 was still open at implementation time; the `chain_id` query is ignored by the current API and takes effect when it merges.

Source: https://github.com/eq-lab/pipeline/issues/1567

Frontend follow-up of epic #1521, after backend #1565 (PR #1566: `GET /v1/requests` takes an
optional `chain_id` — omitted = all chains, configured = that chain, well-formed unconfigured = 200
empty, malformed/repeated = 400; `RequestItem.chain_id` added). Branch:
`feat/1567-activity-feed-chain-scope`.

## Scope

`packages/frontend` only.

- `useRequests` sends `chain_id` for the active wallet view (`ENV.EVM_CHAIN_ID` for EVM,
  `ENV.STELLAR_CHAIN_ID` for Stellar) — the `usePnl` pattern — and keys the query on it.
- `RequestItem` += `chain_id: number`; test fixtures gain the field.
- Stale "dispatches by wallet address format" text replaced in the hook header and
  `src/api/README.md`; the `?wallet=…&chain_id=…` mock key documented (un-keyed fallback kept).
- `/test` scenario mocks keep working (they use the un-keyed `GET./v1/requests` alias, which the
  client still matches after the query string is stripped); items gain `chain_id` for fidelity.

Out of scope: any other consumer of `/v1/requests`; `transactions.tsx`'s own chain derivation
(#1333 / TD-22).

## Assumptions and Risks

- **PR #1566 is not merged yet.** Today's API ignores an unknown `chain_id` query, so the frontend
  change is harmless against the current backend and becomes effective when #1566 lands. The
  user-stories doc is written against the post-#1566 contract.
- The query key becomes `["requests", kind, address, chainId, mockVer]`; switching the view changes
  both `kind` and `chainId`, so the feed refetches (acceptance 2).
- Making `chain_id` required on `RequestItem` touches every typed fixture (`tsconfig` includes
  tests); the `/test` scenario JSON strings are untyped.

## Open Questions

_None._

## Implementation Steps

1. `src/api/useRequests.ts`: import `ENV`; `chainId = kind === "stellar" ? ENV.STELLAR_CHAIN_ID :
   ENV.EVM_CHAIN_ID`; URL `/v1/requests?wallet=<addr>&chain_id=<id>`; key adds `kind`, `chainId`;
   header text updated; `RequestItem.chain_id: number`.
2. Tests: `useRequests.test.tsx` asserts `chain_id=560048` on the EVM view, `chain_id=99000001` on
   the Stellar view, the exact-match mock key with `&chain_id=`, and that switching the view
   refetches; other fixtures gain `chain_id`.
3. `src/api/README.md`: `useRequests` section + mock-key table rows.
4. `src/routes/test/-scenarios.ts`: `chain_id` on request items.
5. Docs: `docs/frontend/dashboard-components.md` (Recent activity / Activity page `useRequests`
   notes), user-stories doc + index row.

## Test Strategy

`yarn workspace @pipeline/frontend lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`.

## Docs to Update

`packages/frontend/src/api/README.md`, `docs/frontend/dashboard-components.md`,
`docs/user-stories/epic-1521/1567-activity-feed-chain-scope.md` + index row.
