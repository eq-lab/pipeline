# Issue #1602: Trustee: clear copy for unknown/missing chain_id 400s outside wallet auth

Source: https://github.com/eq-lab/pipeline/issues/1602 — epic #1521, follow-up to #1528–#1531.
Branch: `feat/1602-trustee-chain-id-400-copy`.

## Scope

`packages/trustee` only.

- `utils/userError.ts`: `isChainIdError(error)` — an `ApiError` 400 whose message starts with
  `unknown chain_id`, `chain_id is required` or `invalid chain_id` (the three server shapes); the
  400 arm of `matchApiStatus` returns "This network isn't enabled on the server. Contact your
  administrator." for it (raw text stays in `details`), the generic "This request was invalid."
  otherwise. `mapWaterfallError` falls through to `toUserError` for a chain-id 400 instead of the
  "amount too high" copy.
- `auth/TrusteeSessionProvider.tsx` reuses `isChainIdError` (its sign-in-specific copy stays).
- Tests for the three shapes, the non-chain 400, the waterfall fall-through; docs
  (`error-handling.md` trustee layer, `trustee-flows.md` waterfall mapping); user-stories doc +
  index row.

Out of scope (noted on the issue): hiding target-chain options the API does not serve — there is
no configured-chains endpoint yet.

## Open Questions

_None._

## Implementation Steps

1. `userError.ts` + tests. 2. Auth provider reuse. 3. Docs.

## Test Strategy

`yarn workspace @pipeline/trustee lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`,
`npx tsx scripts/lint-comments.ts`.

## Docs to Update

`docs/frontend/error-handling.md` (trustee mapping layer: 400 arm, waterfall D5);
`docs/frontend/trustee-flows.md` (Waterfall error mapping #916; sign-in step 2 pointer);
`docs/user-stories/epic-1521/1602-trustee-chain-id-400-copy.md` + index row.
