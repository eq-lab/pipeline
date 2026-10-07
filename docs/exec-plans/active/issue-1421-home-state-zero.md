# Issue #1421: Home state 1: zero state — not signed in, no account, wallet not connected

Source: https://github.com/eq-lab/pipeline/issues/1421

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-98220&m=dev — frame `6701:98220` ("No Authenticated")

## Scope

Render the LP home route `/` (`packages/frontend/src/routes/index.tsx`) per Figma frame `6701:98220` when the
visitor has **no auth session**, and introduce the state-selection seam the rest of epic #1419 will extend.

In scope:

- A named home-state derivation (`"zero"` + a fall-through to today's behaviour) driven by backend-served
  values only: auth session, wallet connection, `kyb_status` from `GET /v1/lps/me`, on-chain balances.
- The zero-state desktop composition (grid reshuffle + one card swap + one card mount — see
  "Figma delta" below).
- The zero-state mobile composition, adapted per epic #463 conventions.
- The precedence rule recorded in `docs/product-specs/dashboards.md` (§ LP Dashboard).
- A user-stories doc at `docs/user-stories/epic-1419/1421-home-zero-state.md`.

Out of scope (per epic #1419):

- Header auth buttons, the composite Total-Balance graph, the merged activity feed (#1282 and its backend
  blockers #1313, #1314, #1285).
- Home states 2–6 (#1422–#1426). This issue only adds the seam; the other branches keep today's behaviour.
- KYB onboarding modals (epic #1247), the Account page, deposit/stake flows.
- The `AddUsdCard` component itself — it already exists and is already Figma-verified against this frame.

## Figma delta (what actually differs from today)

Node tree read from the local Dev Mode MCP (`get_metadata` + `get_design_context` on `6701:98229`).
The frame uses the **same 7-column desktop grid** the route already renders (`6701:98377` codegens as
`col-[3/span_2]`), so the container, gaps and the `max-w-[1200px]` column are unchanged.

| Figma node | Slot | Today | Zero state |
| --- | --- | --- | --- |
| `6701:98222` Title row | heading + stats cell | `WelcomeHeader` (already renders `HomeStatsStrip` at `md+`) | unchanged — no work |
| `6701:98331` Portfolio, col 1–4 row 1 | `ConnectWalletPromoCard`: "Connect Wallet" / "Connect" / `WalletIllustration` | **"Get Started"** / "Access real-world yield on-chain" / **"Sign Up"** / new 288×288 illustration (`6702:105867`) |
| `6701:98230` Section, col 5–7 rows 1–2 | `RecentActivityCard` empty | unchanged — "Recent activity" + 240×240 IMG + "You will see all transactions here" |
| `6701:98347` col 1–2 row 2 | `StartHereCard` + `EarnedCard` | **`StartHereCard` + `StakeCard`** (two 164px cards) |
| `6701:98377` col 3–4 row 2 | `StakeCard` (single) | **`AddUsdCard variant="locked"` (246px) + `EarnedCard` (82px)** |
| `6701:98338` FAQ, col 1–7 row 3 | `QnaSection` | unchanged — "Questions & answers" / "How it works?" / "What is PLUSD?" / "What is sPLUSD?" |
| `6701:98403` header | `TopBar` | out of scope (#1282) |

Card copy in the frame matches what the existing components already render, with two exceptions: the
top-left promo card (above), and `EarnedCard`, whose "Earnings" / "Tracked once you stake" is already its
`earnedPnlLabel === undefined` branch.

Design tokens resolve onto the existing theme: `fill/brand` `#000080` → `--color-pipeline-brand`,
`bg/primary` `#f8f7f6` → `--color-pipeline-paper`, `content-test/primary` `#262524` → `--color-pipeline-ink`,
`border-test/secondary` `#3837352e` → `--color-pipeline-line`. No new tokens.

## Assumptions and Risks

- **`AddUsdCard` is already built and Figma-verified against this exact frame.**
  `packages/frontend/src/components/AddUsdCard.tsx` maps `variant="locked"` to node `6701:98378`
  (`docs/frontend/bank-transfers.md` § "Per-variant presence table"). It is currently mounted only on
  `/test`. This issue mounts it on `/` — no component work, no new copy.
- **`WelcomeHeader` already satisfies the frame's title row.** It renders `HomeStatsStrip` at `md+`
  (3 stats + the dashboard icon-link), matching `6701:98224`'s three `list-item`s + `button-icon`.
  Risk: on mainnet `isMainnetDeployment()` collapses the strip to one cell (#1243) — expected, not a regression.
- **New illustration asset.** `6702:105867` is a dense 288×288 line-art vector, not `WalletIllustration`.
  It must be exported from the Dev Mode MCP and committed (asset URLs expire in ~7 days). Do not hand-author
  the vector.
- **"Sign Up" maps to the existing email flow.** `useAuthFlow().open("create-account")` —
  `EmailAuthScreen` has no `"sign-up"` member (`packages/frontend/src/components/useEmailAuthFlow.ts`).
- **Session reads are synchronous and local.** `useAuthSession()` is `useSyncExternalStore` over
  `localStorage`, so the zero state renders on first paint with no loading flash. `kyb_status` is *not*
  fetched today on `/`; adding `getMyLp` must not run (or must not block) while unauthenticated — the
  request would 401.
- **Risk — regression surface.** `-index.test.tsx` is the route's existing test file and asserts today's
  disconnected layout. The zero state replaces exactly that rendering path, so several existing assertions
  will need updating rather than extending.
- **Risk — `ConnectWalletPromoCard` is shared.** States 2–6 may still need the "Connect Wallet" variant,
  so the promo card must gain a variant rather than have its copy overwritten in place.
- **Dependency.** No unmerged blockers. Branch `feat/home-state-zero` and draft PR #1427 already exist.

## Open Questions

1. **Who owns the home state machine?** `docs/frontend/bank-transfers.md` § AddUsdCard states explicitly that
   deriving the `AddUsdCard` variant from `(authenticated?, kybStatus, trustAccountBalance)` "is #1282's state
   machine", and that guessing a precedence order elsewhere "would be a fabricated contract". Epic #1419 says it
   is independent of #1282 and asks *this* issue to record the precedence rule. Does epic #1419 take ownership
   (and `bank-transfers.md` gets corrected to point at `dashboards.md`), or must the derivation wait on #1282?
2. **Unauthenticated but wallet connected — which state wins?** The epic's state table pairs "not signed in"
   with "wallet not connected", but a visitor can connect a wallet without a session. Does the zero state win on
   `!session` alone (wallet ignored), or does a connected wallet promote them to a balance-driven state? This is
   the precedence rule the issue asks to write down, and the epic does not settle it.
3. **Mobile zero-state layout.** No mobile frame exists for this state. Does mobile adopt the desktop reshuffle
   (StartHere+Stake in the left stack, AddUsdCard+Earned in the right) and mount `AddUsdCard`, or does it keep
   epic #463's current mobile disconnected stack (`docs/user-stories/epic-463/465-mobile-home-base.md`) with only
   the promo-card copy/CTA changed?

## Implementation Steps

1. **Add the state seam.** New `packages/frontend/src/components/homeState.ts`:
   - `export type HomeState = "zero" | "legacy";` (states 2–6 extend this union in #1422–#1426).
   - `export function deriveHomeState(input: { hasSession: boolean; isConnected: boolean; kybStatus?: string; ... }): HomeState` —
     returns `"zero"` when there is no session, `"legacy"` otherwise. Resolve Open Question 2 before writing
     the `!hasSession` guard; it determines whether `isConnected` participates.
   - Colocated `homeState.test.ts` covering the truth table.
2. **Wire it into the route.** In `packages/frontend/src/routes/index.tsx`:
   - `const session = useAuthSession();` (from `@/auth`), feed `deriveHomeState`.
   - Branch the desktop grid and mobile stack on `homeState === "zero"`. Keep every existing
     `isConnected` / `mobileHomeState` code path intact for the `"legacy"` branch — this issue adds a branch,
     it does not refactor the existing one.
   - Do **not** add a `getMyLp` call on this path (unauthenticated → 401). `kyb_status` enters the derivation
     in #1422+.
3. **Promo card variant.** Add `variant?: "connect-wallet" | "get-started"` to
   `packages/frontend/src/components/ConnectWalletPromoCard.tsx`, defaulting to `"connect-wallet"` so every
   existing call site is unchanged. `"get-started"` renders heading "Get Started", CTA label "Sign Up"
   (`Button variant="primary-dark" size="m"`, node `6701:98336`), the new illustration, and
   `data-node-id="6701:98331"`. The sub-line "Access real-world yield on-chain" is shared.
4. **Export the illustration.** Pull `6702:105867` via the Dev Mode MCP, commit the exact asset bytes under
   `packages/ui/src/components/` as a new illustration alongside `WalletIllustration`, export it from
   `packages/ui/src/index.ts`. Size it with an explicit 288×288 box; never `width:auto`.
5. **Zero-state desktop grid** inside the existing `hidden md:block` outer `Card`:
   - col 1–4 row 1: `ConnectWalletPromoCard variant="get-started"` with `onConnect` → `useAuthFlow().open("create-account")`.
   - col 5–7 rows 1–2: `RecentActivityCard` (unchanged).
   - col 1–2 row 2: `StartHereCard` + `StakeCard` stacked, `gap-4`.
   - col 3–4 row 2: `AddUsdCard variant="locked"` + `EarnedCard` stacked, `gap-4`.
   - col 1–7 row 3: `QnaSection` (unchanged).
   - CTAs stay disabled/inert exactly as the frame shows: `AddUsdCard`'s circular Add Funds is already
     disabled in `locked`; `StartHereCard` Sell disabled; Buy/Stake open the auth flow rather than the
     connect modal in this state.
6. **Zero-state mobile stack** in the `md:hidden` block — per Open Question 3.
7. **Record the precedence rule** in `docs/product-specs/dashboards.md` under `## LP Dashboard`: a new
   "Home screen states" subsection with the epic's six-row condition table and an explicit ordered precedence
   list, marking states 2–6 as not-yet-implemented.
8. **Update frontend docs.** `docs/frontend/dashboard-components.md` § "Home route": add the zero-state grid
   table and the `deriveHomeState` seam; § "ConnectWalletPromoCard": document the `variant` prop.
   `docs/frontend/bank-transfers.md` § AddUsdCard: replace the "#1282 owns the derivation" note per Open
   Question 1.
9. **Lint.** `yarn workspace @pipeline/frontend lint`, `yarn workspace @pipeline/frontend build`,
   `npx tsx scripts/lint-docs.ts`. Keep the repo's comment-minimal rule: one 2–3-line spec-pointer header per
   new file, nothing else.

## Test Strategy

Vitest + React Testing Library, colocated. Commands:
`yarn workspace @pipeline/frontend test`, `yarn workspace @pipeline/frontend lint`, `yarn workspace @pipeline/frontend build`.

- **New `packages/frontend/src/components/homeState.test.ts`** — `deriveHomeState` truth table: no session →
  `"zero"`; session present → `"legacy"`; and the no-session/wallet-connected row once Open Question 2 is
  answered.
- **`packages/frontend/src/routes/-index.test.tsx`** (update + extend), with `localStorage` cleared so
  `readSession()` returns `null`:
  - Desktop zero state renders "Get Started" + a "Sign Up" CTA, and clicking it calls `useAuthFlow().open`
    with `"create-account"` — not the connect-wallet modal.
  - `AddUsdCard` is present in its `locked` variant with its action disabled.
  - Grid occupancy: `StartHereCard` and `StakeCard` share the left stack; `AddUsdCard` and `EarnedCard` share
    the right stack.
  - `RecentActivityCard` shows its empty placeholder; `QnaSection` and the `md+` `HomeStatsStrip` render.
  - No `GET /v1/lps/me` request is issued while unauthenticated (assert on the mocked fetch).
  - Regression: with a session seeded into `localStorage`, the existing connected/disconnected assertions
    still pass unchanged (the `"legacy"` branch).
- **`ConnectWalletPromoCard.test.tsx`** — default `variant` still renders "Connect Wallet"/"Connect";
  `"get-started"` renders "Get Started"/"Sign Up".
- **Figma verification** — `ux-tester` runs the epic's QA pass against frame `6701:98220`
  (`https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-98220&m=dev`) using the new
  user-stories doc. Token-exact check: no raw hex, font, size or radius literals introduced — every value
  resolves through `packages/ui/src/styles/theme.css`.

## Docs to Update

- `docs/product-specs/dashboards.md` — § LP Dashboard: new "Home screen states" subsection with the state
  table and the precedence rule (required by the Issue).
- `docs/frontend/dashboard-components.md` — § "Home route" (zero-state grid + `deriveHomeState` seam);
  § "ConnectWalletPromoCard" (`variant` prop).
- `docs/frontend/bank-transfers.md` — § AddUsdCard: the variant-derivation ownership note (Open Question 1).
- `docs/user-stories/epic-1419/1421-home-zero-state.md` — new, in the epic-463 story format
  (Persona / Pre-conditions / Steps / Expected outcomes per scenario).
- `docs/user-stories/index.md` — new "Epic #1419 — LP home screen states" section with the #1421 row.
