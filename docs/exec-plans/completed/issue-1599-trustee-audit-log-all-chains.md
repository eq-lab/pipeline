# Issue #1599: Trustee: audit log across all chains with a chain column; render reference as the loan name

Source: https://github.com/eq-lab/pipeline/issues/1599 — epic #1521, follow-up to backend #1595
(PR #1597, merged 2026-10-21). Branch: `feat/1599-trustee-audit-log-all-chains`.

**Status: implemented (2026-10-22)** — all steps done; trustee lint/build/test (73 files, 1041 tests), `lint-docs` and `lint-comments` green. See PR #1606.

Backend contract (`docs/product-specs/audit-logging.md`): `GET /v1/audit-log` — `chain_id`
optional; omitted = every configured chain merged newest-first; unconfigured id = 200 empty;
malformed/repeated = 400. Each item carries `chain_id`; `reference` is the friendly loan name
`"<originator> — <commodity>"` or `""` (no tx hash since #1094); ~28 new event types (Minter cash,
CollateralRegistry, DealTokenFactory).

## Scope

`packages/trustee` only.

- `api/useAuditLog.ts`: `AuditLogItem.chain_id: number`; no `chain_id` query (all chains); key
  `["audit-log", "all"]`; the retired `YieldMinted` example dropped from the scope comment.
- `routes/-useAuditLog.ts`: loan-name map keyed by `loanRowKey(chain_id, loan_id)` with no Stellar
  filter; `resolveScopeLabel` looks up `(item.chain_id, item.scope.loan_id)` — two loans with the
  same id on different chains keep their own names (#1537 Story 5). **Bug fix:** `reference` is
  rendered in full (it is the loan name, not a hash); `""` → `"—"`; `truncateReference` and
  `referenceFull` removed. Rows gain `chain: targetChainLabel(item.chain_id)`.
- `routes/audit-log.tsx`: Chain column after Time (Time · Chain · Action · Loan / scope ·
  Reference); the Reference cell drops the monospace tx-hash styling (body text, wraps); caption
  extended to cash (Minter), collateral (CollateralRegistry) and deal-token (DealTokenFactory)
  events.
- Tests: presenter (cross-chain same-id fixture, full reference, "—"), page (Chain header + cell),
  new `api/-useAuditLog.test.tsx` (no `chain_id` in the URL). Docs: `trustee-flows.md` Audit Log
  section, user-stories doc + index row.

Out of scope: a chain filter (the feed is a merged stream and is unpaginated, #1006 — a filter
would re-fetch the whole feed per chain; revisit when #1006 lands), pagination.

## Assumptions and Risks

- The merged all-chains feed is larger per 30 s poll (noted on the issue); the page already bounds
  rendering to 50 rows with "Show older".
- The Chain column reuses `targetChainLabel` (`lib/targetChains.ts`): "Stellar" / "Hoodi" /
  `Chain <id>` for an id this deployment does not know.

## Open Questions

_None._

## Implementation Steps

1. Data hook. 2. Presenter. 3. Page. 4. Tests. 5. Docs.

## Test Strategy

`yarn workspace @pipeline/trustee lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`,
`npx tsx scripts/lint-comments.ts`.

## Docs to Update

`docs/frontend/trustee-flows.md` (Audit Log: sources, architecture, scope, Figma mapping);
`docs/user-stories/epic-1521/1599-trustee-audit-log-all-chains.md` + index row.
