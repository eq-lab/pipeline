# Issue #465: [FE] Mobile home page: base responsive layout + wallet-not-connected state

Source: https://github.com/eq-lab/pipeline/issues/465

Sub-issue of Epic #463 (Home page). Frontend flow. Unblocks #466 (mobile balance states).

## Scope

Make the home route (`/`) and its global header render correctly on a mobile
viewport, and pixel-match the **wallet-not-connected (Disconnected)** state to
the mobile Figma frame `1989:8292`
(https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1989-8292&m=dev).

In scope:

- **Responsive `TopBar`** — at mobile widths, collapse the centred icon nav and
  the right-hand "Connect Wallet" button into a single hamburger (`menu-2`)
  icon button on the right; keep the logo on the left. Tapping the hamburger
  opens a mobile menu surface exposing the four nav destinations
  (Home / Convert / Earn / Activity) and a wallet-connect entry point that
  opens the existing `ConnectChooserModal`. Desktop (≥ breakpoint) keeps the
  current inline nav + Connect button unchanged.
- **Responsive home route shell** (`routes/index.tsx`) — below the breakpoint,
  the dashboard reflows from the 7-column desktop grid into the single-column
  mobile stack from Figma:
  1. `WelcomeHeader` title only (32px Title token; stats strip hidden here).
  2. `ConnectWalletPromoCard` — full-width, 256px tall on mobile.
  3. A two-column row: left = `StartHereCard` + `EarnedCard` stacked
     (`Balances` column, flexible width); right = `StakeCard` (fixed ~189px,
     224px tall, with the circular Stake CTA).
  4. The stats strip (Exchange rate / TVL / Current APY + external-link icon)
     moved to the bottom of the page as a horizontally-scrollable row.
- **Wallet-not-connected state** pixel-matched on a 402px-wide viewport
  (the Figma mobile frame width).
- **Tailwind responsive utilities** — use the project's existing Tailwind v4
  default breakpoints (`sm` 640 / `md` 768 / `lg` 1024). Pick one breakpoint as
  the desktop/mobile switch (see Open Questions) and gate layout with `lg:`/
  unprefixed-mobile-first utilities. No new breakpoint tokens unless a value is
  required that the default scale cannot express.
- **User-stories doc** at `docs/user-stories/epic-463/465-mobile-home-base.md`
  covering the disconnected state on a mobile viewport (directory does not yet
  exist; create it).

Out of scope (deferred):

- Connected-wallet balance states (0/0, has PLUSD, has sPLUSD) — that is #466.
  This plan only addresses the **disconnected** branch of the mobile layout,
  but it must lay the responsive scaffolding so #466 can drop the connected
  cards into the same stack.
- `RecentActivityCard` and `QnaSection` mobile treatment — neither appears in
  the mobile disconnected Figma frame `1989:8292`; leave their desktop
  rendering intact and hide/defer them on mobile (see Open Questions).
- Desktop visual changes — desktop output must be byte-for-byte unchanged.

## Assumptions and Risks

- **Assumption:** Tailwind v4 default breakpoints are available and the project
  has not customised them — confirmed: `packages/ui/src/styles/theme.css`
  defines no `--breakpoint-*` overrides, so `sm`/`md`/`lg` resolve to the
  framework defaults and are usable directly via `lg:` prefixes scanned from
  `packages/frontend/src` (the `@source` directive in
  `packages/frontend/src/index.css` covers both packages).
- **Assumption:** The existing card composers (`ConnectWalletPromoCard`,
  `StartHereCard`, `EarnedCard`, `StakeCard`, `WelcomeHeader`) can be reused
  as-is and only their container/layout wrappers change. The mobile frame uses
  the same copy, tokens, and card chrome — but with smaller fixed heights
  (promo 256px vs desktop 274px; Stake card 224px) and a smaller Title size
  (32px vs 64px). This likely means **adding responsive utilities inside the
  components** (e.g. `WelcomeHeader` Title `text-...title` on mobile vs
  `text-...title-lg` on desktop), which risks regressing desktop if the tokens
  differ. Verify each card's current desktop classes before adding `lg:`
  variants so the desktop branch keeps its exact current values.
- **Risk:** `FRONTEND.md` currently states "Desktop-first … Mobile layout
  should be readable but is not a primary concern for MVP." This epic
  contradicts that — the Responsive behavior section must be updated (see Docs
  to Update) so the doc stays the source of truth.
- **Risk:** The mobile menu (hamburger) is a brand-new interactive surface with
  no existing component. It needs focus trapping, Escape-to-close, and an
  accessible name. Reuse the existing modal/overlay primitives if present
  (`ConnectChooserModal` already implements a dialog overlay) rather than
  hand-rolling focus management.
- **Risk:** `TopBar` is mounted in `__root.tsx` for every route, so any
  responsive change affects `/deposit`, `/stake`, `/transactions`, `/ops` as
  well. The hamburger menu must list the same nav destinations on every route,
  and the change must not break the existing `TopBar.test.tsx` desktop
  assertions.
- **Risk:** Hidden-on-mobile elements (`RecentActivityCard`, `QnaSection`,
  desktop stats strip in `WelcomeHeader`) must use `hidden lg:block`-style
  utilities rather than conditional unmount, to avoid layout-shift and to keep
  the same DOM for the desktop tests.

## Open Questions

1. **Breakpoint choice.** The Figma mobile frame is 402px wide and the desktop
   frame is 1728px. Which Tailwind breakpoint is the intended desktop/mobile
   switch — `lg` (1024px), `md` (768px), or a custom value? Tablet widths
   (768–1023px) are undefined by the designs. Defaulting to `lg` (mobile layout
   below 1024px) unless the designer specifies otherwise.
2. **Hamburger menu surface.** The Figma frame shows only the closed hamburger
   (`menu-2`) icon — there is no open-menu frame in the references. What should
   the opened menu look like (full-screen overlay, top-anchored sheet, side
   drawer), and does it list the four nav items plus a Connect Wallet action, or
   something else? Need the open-state design or explicit direction.
3. **Stake / Start here / Earned cards in the disconnected mobile state.** The
   mobile disconnected frame `1989:8292` renders the `Start here`, `Earned`, and
   `Stake` cards (the same cards #466 will populate for connected states). Are
   these in scope for #465 (the "base layout + disconnected" issue), or does
   #465 stop at the Connect promo + header + stats and #466 owns all three
   cards? The Figma frame implies they belong to the disconnected state, so the
   plan assumes #465 renders them — but this overlaps with #466's stated scope
   and should be confirmed to avoid duplicated/contradictory work.
4. **`RecentActivityCard` and `QnaSection` on mobile.** Neither appears in the
   mobile disconnected frame. Confirm they should be hidden on mobile (assumed)
   rather than restyled into the stack — there is no mobile frame for either.
5. **Stats strip placement.** The mobile frame moves the WelcomeHeader stats
   (Exchange rate / TVL / APY) to the bottom of the page as a horizontally
   scrollable row, detached from the "Welcome" title. Confirm this relocation is
   intended (vs. simply hiding the strip on mobile).

## Implementation Steps

1. **Confirm breakpoint + read current desktop classes.** Decide the switch
   breakpoint (Open Question 1; default `lg`). Re-read the exact Tailwind
   classes on `WelcomeHeader`, `ConnectWalletPromoCard`, `StakeCard`,
   `StartHereCard`, `EarnedCard`, and `TopBar` so every responsive change is
   additive (mobile-first base + `lg:` desktop override that reproduces today's
   value).

2. **Responsive `TopBar`** (`packages/frontend/src/components/TopBar.tsx`).
   - Wrap the centre `<nav>` (icon buttons) and the right-slot Connect/Pill
     content so the inline nav is `hidden lg:flex` and a new mobile control is
     `flex lg:hidden`.
   - Add a hamburger `IconButton`/button (the `menu-2` glyph; check
     `@pipeline/ui` `NavIcon`/icon set for an existing menu icon, add one to the
     UI package only if missing) on the right at mobile widths.
   - Introduce a mobile menu surface (new component
     `packages/frontend/src/components/MobileNavMenu.tsx` + co-located
     `useMobileNavMenu.ts` per FRONTEND.md rule 2) opened by the hamburger.
     It lists the four `NAV_ITEMS` destinations and a wallet entry point
     (connected → reuse `AccountDropdown` content or open the dropdown;
     disconnected → open `ConnectChooserModal`). Reuse the dialog/overlay
     pattern from `ConnectChooserModal.tsx` for focus trap + Escape close.
   - Keep all wallet hooks called unconditionally (current pattern) so the
     connected/disconnected logic is shared between desktop and mobile.

3. **Responsive home shell** (`packages/frontend/src/routes/index.tsx`).
   - Replace the single 7-column `grid` with a layout that is a mobile-first
     vertical stack and switches to the existing 7-column grid at `lg:`.
   - Mobile order: `WelcomeHeader` (title only) → `ConnectWalletPromoCard`
     (full width) → a `flex` row with the `Balances` stack
     (`StartHereCard` + `EarnedCard`) on the left and `StakeCard` (fixed width)
     on the right → bottom stats strip.
   - `RecentActivityCard` and `QnaSection`: `hidden lg:block` (pending Open
     Question 4).
   - Pull the stats strip out of `WelcomeHeader` for the mobile bottom
     placement, OR render a mobile-only stats row that reuses the same `Stat`
     primitives. Prefer extracting the stats strip into its own component
     (`HomeStatsStrip.tsx`) reused by both `WelcomeHeader` (desktop, top-right)
     and the mobile bottom row, per FRONTEND.md reuse rule — and catalogue it.

4. **Responsive `WelcomeHeader`** (`packages/frontend/src/components/WelcomeHeader.tsx`).
   - Title: `text-...title` mobile (32px) with `lg:` override to the current
     64px value; verify the token names against `theme.css`.
   - Stats strip: `hidden lg:flex` so it only shows inline on desktop (the
     mobile stats live in the bottom strip from step 3).

5. **Card height/width responsive tweaks.** Add mobile heights matching Figma
   (`ConnectWalletPromoCard` 256px, `StakeCard` 224px / ~189px wide in the row)
   guarded so desktop keeps `min-h-[274px]`. Verify the disabled "Sell" button
   (opacity-32) and the circular Stake CTA already match the mobile frame.

6. **User-stories doc.** Create
   `docs/user-stories/epic-463/465-mobile-home-base.md` documenting the
   disconnected mobile state: header collapses to hamburger; menu opens nav +
   connect entry; Welcome title; Connect promo; Start here / Earned / Stake
   cards; bottom stats strip. Specify the mobile viewport (≈402px) per story.

7. **Lint & build.** Run `npx tsx scripts/lint-docs.ts` (TS/docs lint) and the
   frontend build/test commands; fix all errors before handing back.

## Test Strategy

- **Unit / integration (Vitest + Testing Library)** — extend
  `packages/frontend/src/routes/-index.test.tsx` and
  `packages/frontend/src/components/TopBar.test.tsx`:
  - TopBar: at a mobile width the inline nav is not visible and a hamburger
    control is present; clicking it opens the mobile menu; the menu lists the
    four nav destinations and a connect entry point; desktop assertions
    (existing tests) still pass. (JSDOM has no real media queries — assert on
    the presence of the responsive utility classes / the always-rendered DOM
    rather than computed visibility, mirroring the existing "Card height parity"
    test that asserts on the `min-h-[274px]` class.)
  - Mobile menu component: a focused unit test for open/close, Escape-to-close,
    nav item click → navigate, connect action → opens chooser.
  - Home route: disconnected branch still renders `ConnectWalletPromoCard`,
    `StartHereCard`, `EarnedCard`, `StakeCard`, and a stats strip; the
    `hidden lg:block` elements are present in the DOM.
- **Extracted util/component tests** — if `HomeStatsStrip` is extracted, ship
  its unit test in the same commit (FRONTEND.md rule 3).
- **Figma-based visual verification (manual, by the coder before handoff)** —
  run the app, resize the viewport to 402px, and compare `/` disconnected
  against Figma frame `1989:8292`: header (logo + hamburger), Welcome title,
  Connect promo (256px), the Balances + Stake row, and the bottom stats strip.
  Then verify desktop (≥1024px) is visually unchanged against `1497:94556`.
  (Per the frontend flow there is no separate ux-tester phase here; the QA pass
  for the epic is human-requested via #464.)

## Docs to Update

- `docs/FRONTEND.md` — rewrite the **Responsive behavior** section: the home
  page now has a designed mobile layout (breakpoint switch, hamburger nav,
  single-column stack). Remove the "not a primary concern for MVP" framing for
  the home route.
- `docs/frontend/utils.md` and/or `docs/frontend/hooks.md` — catalogue any
  extracted shared util/hook (e.g. `HomeStatsStrip`, `useMobileNavMenu` if it
  qualifies as reusable) per FRONTEND.md rules 4–5.
- `docs/user-stories/epic-463/465-mobile-home-base.md` — new stories doc (see
  step 6); required by the issue's Definition of Done.
- No product-spec change required — `docs/product-specs/dashboards.md` describes
  LP Dashboard data, which is unchanged; this is a presentation-only mobile
  layout.
