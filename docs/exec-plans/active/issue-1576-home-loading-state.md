# Issue #1576: Home: loading state while `GET /v1/lps/me` is in flight instead of a legacy-layout flash

Source: https://github.com/eq-lab/pipeline/issues/1576 (TD-121, LP-read half; epic #1419)

Branch: `feat/1576-home-loading-state`.

## Scope

`packages/frontend` only.

- `deriveHomeState` gains `"loading"`: returned when a session exists and `lpRead === "unknown"`
  (the `GET /v1/lps/me` read has not resolved). `"error"` keeps falling through to `"legacy"`.
- The desktop grid renders a neutral skeleton composition for `"loading"` through the shared
  `HomeDashboardGrid` (#1577): a 274px hero block, two 164px blocks in the Balances slot, a 246px +
  82px pair in the third slot — the compact states' geometry — with Recent activity and the FAQ
  strip rendered as usual, `aria-busy` on the grid. No CTA renders during the window.
- Tests, docs (`dashboard-components.md`, `home-screen-states.md`), TD-121 partially resolved
  (the balance-read flash in its 2026-10-07 extension stays open), user-stories doc + index row.

Out of scope: the balance-read flash (TD-121 extension — a connected `UnderReview` LP holding
PLUSD renders state 3 for one balance round-trip), the mobile stack (it never reads `homeState`),
a designed loading frame (none exists; the skeleton derives from the compact-card geometry).

## Assumptions and Risks

- `AuthFlowProvider` maps `setup.status` `"loading"`/`undefined` to `lpRead: "unknown"` and only
  starts the read when a token exists, so `"loading"` is exactly the in-flight window for a
  signed-in visitor; sessionless visitors resolve to `"zero"`/`"wallet-only"` before the check.
- The `-index.test.tsx` harness defaults to `lpRead: "unknown"` with a session, i.e. today's
  legacy grid for most tests. The default becomes `lpRead: "loaded"` with `kybStatus` undefined,
  which still derives `"legacy"` for every connection/balance combination those tests use; only the
  one test that asserts the in-flight read explicitly changes to expect the skeleton.
- `HomeDashboardGrid` gains optional `busy` and makes `balancesNodeId` optional; both are omitted
  attributes for the seven existing states, so their markup is unchanged.

## Open Questions

_None._

## Implementation Steps

1. `components/homeState.ts`: `HomeState` += `"loading"`; `if (lpRead === "unknown") return "loading"`
   right after the sessionless short-circuit. `homeState.test.ts` updated + new cases.
2. `routes/-HomeDashboardGrid.tsx`: `busy?: boolean` → `aria-busy`; `balancesNodeId?: string`;
   `LoadingBlock({ className })` (`animate-pulse`, surface-muted, card radius, `aria-hidden`,
   `data-testid="home-loading-block"`).
3. `routes/index.tsx`: `"loading"` branch first in the ternary.
4. `-index.test.tsx`: harness default; the in-flight test; new "loading grid" tests (skeleton blocks
   present, no Connect/Sign Up CTA, Recent activity + FAQ present, `aria-busy`).
5. Docs per **Docs to Update**.

## Test Strategy

`yarn workspace @pipeline/frontend lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`.

## Docs to Update

- `docs/frontend/dashboard-components.md` — Home route: `HomeState` union, derivation paragraph,
  a "Loading composition" note.
- `docs/product-specs/home-screen-states.md` — the "unknown or failed LP read renders legacy"
  sentences: unknown → loading skeleton, failed → legacy.
- `docs/exec-plans/tech-debt-tracker.md` — TD-121 partially resolved.
- `docs/user-stories/epic-1419/1576-home-loading-state.md` + index row.
