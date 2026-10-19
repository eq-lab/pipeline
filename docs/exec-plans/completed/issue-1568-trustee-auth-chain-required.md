# Issue #1568: Trustee: wallet auth always sends chain_id; clear error for an unsupported network

**Status: implemented (2026-10-19)** — all steps done; trustee lint/build/test (72 files, 1038 tests) and `lint-docs` green. See PR #1582.

Source: https://github.com/eq-lab/pipeline/issues/1568

Frontend follow-up of epic #1521, after backend #1559 (PR #1560, merged): `GET /v1/auth/challenge`
and `POST /v1/auth/verify` require a configured `chain_id` — missing → 400 `chain_id is required`;
not in `CHAINS` → 400 `unknown chain_id: <id> (configured: …)`. Branch:
`feat/1568-trustee-auth-chain-required`.

## Scope

`packages/trustee` only.

- `VerifyRequest.chainId: number` (required); the two wrapper doc comments state the required
  contract. The stale "omits chain_id when not provided" test is replaced by one asserting it is
  always sent (issue comment).
- `TrusteeSessionProvider.runSignIn`: a `400` whose message starts with `unknown chain_id` (from
  either endpoint) becomes an `unauthorized` status with a clear message — "This network isn't
  supported by the sign-in server. Contact your administrator." — instead of the generic
  "could not reach" / "verification failed" copy. Other failures keep their current mapping.
- `docs/frontend/trustee-flows.md`: "Auth endpoint wrappers" (required contract, backend path now
  `packages/api/src/routes/auth/wallet.rs`) and the sign-in flow's step 2/4 error mapping.
- Tests: wrapper (`chain_id` always sent on both calls), provider (unsupported-network message on
  challenge and on verify), user-stories doc + index row.

Out of scope: a chain picker in the Trustee app (the chain is deployment config), the LP app.

## Assumptions and Risks

- The match is on the server's message prefix `unknown chain_id` with status 400 — the only
  signal the API gives; a `chain_id is required` 400 cannot happen once `chainId` is required by
  type, so it is left on the generic path.
- `SignInCard` already renders `sessionState.error` for `unauthorized`, so no UI change is needed.

## Open Questions

_None._

## Implementation Steps

1. `src/api/auth.ts`: type + doc comments. `src/api/-auth.test.ts`: replace the omit test.
2. `src/auth/TrusteeSessionProvider.tsx`: `isUnsupportedNetwork(err)` (`ApiError`, `status === 400`,
   message starts with `unknown chain_id`), used in the challenge and verify catch blocks;
   `UNSUPPORTED_NETWORK_MESSAGE` constant. Tests in `-TrusteeSessionProvider.test.tsx`.
3. Docs per **Docs to Update**.

## Test Strategy

`yarn workspace @pipeline/trustee lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`.

## Docs to Update

`docs/frontend/trustee-flows.md` (two sections), `docs/user-stories/epic-1521/1568-trustee-auth-chain-required.md`
+ index row.
