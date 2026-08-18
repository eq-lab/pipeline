# Dashboard & LP components

Behavior, layout, and Figma-binding specs for the LP-facing components and routes in
`packages/frontend/src/components/**` and `packages/frontend/src/routes/**`. This is the home for
component behavior knowledge that previously lived as inline comments — see
[`docs/FRONTEND.md` → Code structure rules, rule 6](../FRONTEND.md#code-structure-rules).

Cross-cutting token/typography behavior stays in [`docs/FRONTEND.md`](../FRONTEND.md); this doc is
for per-component structure and behavior.

> **Migration status** ([issue #991](https://github.com/eq-lab/pipeline/issues/991), sub-issue #996):
> `packages/frontend/src/components/**` and `packages/frontend/src/routes/**` are migrated. Do not
> delete a source comment until its content lives in a section below.

## Cards

### ConnectWalletPromoCard


Disconnected-state hero card. Pale-yellow promo card that sits across the top of the left column
on the Disconnected dashboard (Figma frame `1497:94556`, node `1497:94566` "Portfolio"). Invites
the wallet-less visitor to connect: heading + subtitle + "Connect" CTA on the left, a striped-wallet
illustration bleeding off the right edge.

**Composition** (all primitives from `@pipeline/ui`):
- `Card` `variant="yellow"` supplies the pale-yellow promo surface, hairline border, 4px radius and
  24px interior padding; paints `--color-pipeline-promo` / `--color-pipeline-line` so the composer
  adds no raw colors.
- `WalletIllustration` `tone="primary"` paints the striped-wallet decoration in dark ink,
  absolutely positioned so the heading + button column flows naturally along the left edge while
  the artwork anchors to the right.
- `Button` `variant="primary-dark"` provides the 48px-tall black "Connect" CTA at the bottom-left.

**Layout:** the `Card` is the positioning context (`relative`); inner content is a vertical flex
column with `justify-between` so the heading hugs the top and the CTA hugs the bottom (Figma "Top
Container / Button" stack). `overflow-hidden` clips the illustration to the rounded card edge.
`min-h-[274px]` mirrors the Figma height.

**Illustration positioning (Figma anchor math):**
- Desktop: the Figma node positions the 313.672 × 200 vector at `left: 376.09px / top: 91.38px`
  inside a 274px-tall card; this is mirrored with a `right`-based offset (`md:top-[70%]
  md:w-[314px]`) so the composition reads identically while remaining width-agnostic.
- Mobile (< md, Figma node `1989:9179`): 235×150, anchored lower-right (card ≈ 386px wide,
  illustration x≈187 → right-bleed). Top edge at y=117px, height=150px → centre at ≈192px (≈70% of
  274px) — a wrapper sets responsive width while the illustration fills 100% of it.

Mobile heading uses `heading-m-mobile` (Figma node `1989:9176`); see FRONTEND.md's typography
step-down note. Interior padding: `"md"` (16px) on mobile per Figma frame `1989:8292`.

**Accessibility:** the `Card` is promoted to a landmark via `role="region"` + `aria-labelledby`;
the illustration is decorative (`WalletIllustration` sets `aria-hidden` internally); the CTA is a
real `<button>` with inherited focus-visible styling.

Reuse: page-local to the Disconnected home view (replaced by the portfolio summary once a wallet
connects); not hoisted into `@pipeline/ui`.

### EarnedCard


Disconnected-state "Earned" placeholder card. Smallest card in the left column of the Disconnected
dashboard (Figma frame `1497:94556`, node `1497:94691` `card-horizontal` → child `1497:94692`
"Earned Balance"). Announces a not-yet-shipped surface and reserves the footprint so the dashboard
composition reads complete.

**Composition:** `Card` `variant="white"` paints the paper surface, hairline border, 4px radius,
and 24px interior padding — no raw colors introduced.

**Typography:** label "Earned" is Body token, primary ink (Figma node `1497:94693`). The value
placeholder is Besley display at "Heading 20" (Figma node `1497:94698`), using
`--color-pipeline-ink-subtle` (content-test/tertiary, 30% alpha) so it reads as muted/disabled,
signalling the surface is reserved. Mobile step-down uses `heading-s-mobile` (Figma node
`1989:9030` for the default placeholder; node `1886:46777` for the PnL-value state) — see
FRONTEND.md's typography step-down note.

**Italics:** the Figma source is `Besley Regular` — not italic — so the placeholder renders
upright. The issue's acceptance criterion allows italics "per Figma if applicable"; here Figma does
not call for italics, so the component intentionally omits them.

**State → display-value table** (`mobileHomeState` + `earnedPnlLabel`):

| Condition | Displayed value |
|-----------|------------------|
| `earnedPnlLabel` present | That value (total realized + unrealized PnL from `GET /v1/pnl` `total_pnl`), rendered in the green positive token (`--color-pipeline-chart-positive`) instead of the muted placeholder color. |
| No PnL label, `mobileHomeState` is `"empty"` or `"plusd"` (States A/B) | `"Nothing yet"` (Figma frames `1988:7074` / `1984:6501`). |
| No PnL label, `mobileHomeState` is `"splusd"` (State C) or `undefined` (disconnected/desktop) | `"Tracked once you stake"`. |

**Accessibility:** `role="region"` + `aria-labelledby` referencing the "Earned" label; the
placeholder value never changes so no live-region semantics are needed.

Reuse: page-local, alongside `ConnectWalletPromoCard`; not hoisted into `@pipeline/ui` because the
muted-placeholder framing is specific to the wallet-less/pre-PnL dashboard state.

### StartHereCard


Disconnected-state "Get PLUSD" entry card. White card under the Connect Wallet promo on the
Disconnected dashboard (Figma frame `1497:94556`, node `1497:94676` "card-horizontal" inside the
"Balances" stack `1497:94675`). Primary on-ramp for a brand-new visitor: eyebrow label, "Get PLUSD"
headline with a small dollar glyph, a 1:1-USDC-swap subtitle, and a "Buy"/"Sell" action row.

**Composition** (all primitives from `@pipeline/ui`):
- `Card` `variant="white"` supplies the paper-white surface, hairline border, 4px radius.
- `Button` `variant="primary-blue"` provides the brand-navy "Buy" CTA (Figma node `1497:94688` /
  `1497:94689`).
- `Button` `variant="secondary"` provides the ghost "Sell" CTA (Figma node `1497:94690`) —
  ink-primary label, transparent fill. Sell navigates to `/deposit?direction=withdraw`, matching the
  Buy CTA symmetry: Buy → deposit, Sell → withdraw.
- PLUSD coin icon via `CoinIcon` `token="plusd"` `size="md"` (24px), matching Figma node
  `910:10281` — full blue circle with a white "$" glyph baked into the raster asset.

**Layout:** vertical flex column with `justify-between` (Figma "List" stack, space-between's the
title block and buttons row). Eyebrow/heading/subtitle: 4px gap between heading and subtitle
(Figma `gap-4` on `TextCont`), no gap between eyebrow and heading (Figma `gap-xs=0`). Buttons: 8px
gap (Figma `gap-2`).

**States A/B/C** (`mobileHomeState`, mobile-only):

| State | Behavior |
|-------|----------|
| `"empty"` (A) / disconnected | Disconnected "Start here / Get PLUSD" copy. Sell disabled, rendered at 32% opacity (Figma node `1989:9022`) — used for both the disconnected-mobile state and the connected-but-zero-balance state. |
| `"plusd"` / `"splusd"` (B/C) | "PLUSD Balance" connected variant: eyebrow "PLUSD Balance", formatted balance, USDC sub-line (Figma node `1984:6772`, since PLUSD is 1:1 with USDC the balance value doubles as the USDC-equivalent and is always shown even at $0.00), Buy + Sell both enabled. |
| `undefined` (desktop) | Default disconnected appearance without disabling Sell. |

**Typography** (no raw font sizes): eyebrow "Start here" is Body token; heading "Get PLUSD" is
Heading-S token in Besley display serif with the dollar glyph inline at 24px; subtitle is Caption
token, ink-muted.

**Accessibility:** `role="region"` + `aria-labelledby`; the PLUSD coin icon is decorative
(`aria-hidden`); both CTAs are real `<button>` elements, and the disabled "Sell" button retains its
semantic role so screen readers still announce it.

Reuse: paired with the Connect Wallet promo card and the Earned/Staked cards; page-local.

### StakeCard


Stake PLUSD entry-point card. Small white card in the lower-middle slot of the Disconnected
dashboard (Figma frame `1497:94556`, node `1497:94702` "card-horizontal"). Advertises the staking
yield and offers the circular "Stake" CTA.

**Composition** (all primitives from `@pipeline/ui`):
- `Card` `variant="white"` supplies the paper-white surface with hairline border, 4px radius and
  16px interior padding mirroring the Figma "card-horizontal" frame.
- `Button` `variant="circular-blue"` provides the round navy "Stake" CTA anchored bottom-right
  (Figma node `1497:94713`): 88px on mobile (Figma frame `1989-8292`, node `2113:9115`) and 128px
  on desktop.

**Layout:** vertical flex column with `justify-between` so the text block hugs the top and the
circular CTA hugs the bottom-right (Figma stack with `items-end`). `min-h-[274px]` mirrors the
Figma height; `overflow-hidden` clips the round CTA to the rounded card edge.

**Content:** the APY figure is sourced from `useStats` (`GET /v1/stats`), falling back to `—` when
the API returns null or the request fails.

**States A/B/C** (`mobileHomeState`):

| State | Behavior |
|-------|----------|
| `"empty"` (A) | Circular CTA disabled, labelled "Nothing to Stake". |
| `"plusd"` (B) | Circular CTA enabled, labelled "Stake". |
| `"splusd"` (C) | "Staked PLUSD" balance display + "Stake More" CTA + "Unstake" text link (Figma node `1497:95217`, shared by mobile and the desktop dashboard). |
| `undefined` | Marketing CTA appearance ("Stake PLUSD / Earn X%") is preserved. |

The empty/plusd labels are mobile-specific; the `"splusd"` staked layout is shared by mobile and
desktop.

In State C, the sub-line (sPLUSD coin icon + PLUSD-equivalent + USD value) matches Figma nodes
`1497:95225` / `1497:95226`; the bottom section (Unstake link + Stake More CTA) matches Figma node
`1497:95228`.

`splusdDecimals` defaults to 18 (EVM); pass 7 for Stellar SAC balances to avoid a ~1e11× scale error
when formatting (#688).

**Accessibility:** `role="region"` + `aria-labelledby` referencing the "Stake PLUSD" heading id; the
circular CTA has `aria-label="Stake PLUSD"` (or "Nothing to Stake" / "Stake More PLUSD" depending on
state) since the visible label is shorter.

Reuse: page-level glue around `@pipeline/ui` primitives.

### PortfolioPlaceholderCard


Connected-state replacement for `ConnectWalletPromoCard`. Renders in the top-left slot of the home
dashboard when `isConnected === true` (Figma node `1497:95048`). The balance and PnL labels are
supplied by the home route. Chart bars use `/v1/stats/prices` data when available and fall back to
a synthetic placeholder curve when the endpoint has no data.

**Header row:** mobile stacks balance-then-tabs (both left-aligned); `md+` restores a row with tabs
top-right.

**States A/B/C** (mobile-only CTA under the balance, via `mobileHomeState`):

| State | CTA / caption |
|-------|----------------|
| `"empty"` (A) | "Get PLUSD to start" → `/deposit` |
| `"plusd"` (B) | "Stake PLUSD to start earning" → `/stake` |
| `"splusd"` (C) | No link — the PnL caption is sufficient context |
| `undefined` (desktop) | "Get PLUSD to start" (same as State A) |

**Chart rendering:**
- 100 bar slots. Each slot has 3 nested rectangles (widths 3/2/1 px in SVG-coordinate terms,
  centred on the slot) at heights 30%/60%/100% of the slot's balance height, giving a "soft glow"
  stacked appearance.
- Bar fill: `--color-pipeline-chart-positive` (`#2D7B1F`) for real price data, `#D5D8C8` for the
  synthetic fallback.
- Fallback curve is deterministic per period (seeded LCG, see `usePortfolioChart`). Heights are
  monotonically non-decreasing and anchored to `Date.now()` at mount time.

**Hover interaction:**
- Pointer move over the chart wrapper snaps to the nearest slot index.
- A vertical cursor line is drawn at the slot's X position — **not** clamped (prototype behaviour
  verbatim).
- A tooltip floats above the cursor showing balance + period-appropriate timestamp, clamped
  horizontally to stay inside the chart bounds (half-width = 70px).
- Mouse only — touch support deferred (logged in tech-debt-tracker.md).

**Accessibility:** the chart wrap uses `role="img"` + a descriptive `aria-label` (period +
unrealized PnL); individual bar `<rect>` elements are decorative; the card region is labelled by
the balance heading.

**Data rule:** chart `priceItems` come from `/v1/stats/prices`; empty/invalid price data keeps the
fallback curve visible. Unrealized PnL caption is supplied by `/v1/pnl`, defaulting to `$0.00
unrealized`.

Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95048

### RecentActivityCard


Right-column card on the home dashboard. Renders in two states:

- **Connected + data** (Figma frame `1497:95119`): shows the top 3 most recent requests as
  `ActivityRow` entries (identical visuals to `/transactions`) followed by a right-aligned "View
  All" button (node `1497:95216`) that navigates to `/transactions`. The button renders ~48px tall,
  padded 12px horizontally, rounded 8px corners, Body Semi Bold typography, muted-ink color, and a
  right-chevron icon. Row rendering is delegated to the shared `renderRequestRow` helper so the
  home card and the transactions page always render rows from the same code path.
- **Everything else** (active chain disconnected, loading, error, connected but no rows): shows the
  existing `ActivityEmptyIllustration` + caption empty state (Figma node `1497:94567`). No "View
  All" button — there's nothing to navigate to. The empty state and list are mutually exclusive via
  `showList`.

Active-chain gating (Issue #644): `isConnected` is keyed off the active chain
(`useWalletView().kind`) rather than EVM unconditionally, mirroring `useRequests`. (Tech-debt: this
chain-selection derivation is duplicated in `useRequests` and `transactions.tsx`; a shared hook is
tracked in tech-debt-tracker.md.)

**Layout:** `min-h-[564px]` mirrors the Figma height (node `1497:94567` is 564px tall) so both
states stay visually balanced. Elevation border (Figma node `1497:95207`) uses the same "stamped"
asymmetric treatment (1px top/left, 3px right/bottom) as `StepsCard` (Figma node `1498:100130`).
Illustration is pinned to 240×240 (Figma node `1497:94570`) to match the Figma `IMG` slot so the
muted variant reads at the same scale as the design. Row cap: 5 rows (`MAX_ROWS`) — Figma frame
`1497:95207` shows 5 rows (Sell / Sell / Unstake / Stake / Buy) filling the card height with the
"View All" affordance below.

**Typography:** title uses the Heading M token, Besley display family (Figma heading instance
`1497:94568`). "View All" uses Body Semi Bold with `--color-pipeline-ink-muted`.

**Accessibility:** `role="region"` + `aria-labelledby` referencing the heading; the illustration is
decorative (`ActivityEmptyIllustration` sets `aria-hidden` internally).

Figma references: connected state `1497:95119`; empty/disconnected state `1497:94567`; View All
button `1497:95216`.

### WelcomeHeader


Dashboard top heading with stats strip. Implements Figma frame `1497:94558` ("Title" row inside
"Heading"): left is a large "Welcome" display heading in Besley serif, ink-subtle color; right is
`HomeStatsStrip` (three `Stat` readouts separated by hairline left-borders, plus a trailing
external-link icon button).

**Responsive behavior:**
- Desktop (`md+`): heading at 64px/64px (`--text-pipeline-title`, Figma frame `1497:94558`), stats
  strip visible on the right. Always renders "Welcome" — connected desktop states are out of scope
  for issue #466.
- Mobile (below `md`): heading at a raw 32px/36px (Figma mobile frame `1989:8292`; note this size
  is a literal, not a `-mobile` token variant like the other home cards), stats strip hidden here —
  the same stats render at the bottom of the home page via `HomeStatsStrip` in `routes/index.tsx`.
  When `isConnected` is `true`, renders "Welcome back" (Figma connected frames `1988:7074`,
  `1984:6501`, `1886:46777`).

The `isConnected` prop is **mobile-only**; the Tailwind responsive utilities (`md:`) gate the copy
change to viewports below 768px, and both "Welcome"/"Welcome back" variants are always rendered in
the DOM with visibility toggled by CSS (not a JS conditional) so screen readers pick up the right
string at each breakpoint without extra logic.

The exchange rate and APY stats are live, sourced from `HomeStatsStrip` (`useStakedPlusdConvertToAssets`
and `useStats`). TVL remains hardcoded pending a separate issue.

### HomeStatsStrip


Exchange rate / TVL / Current APY stat row. Extracted from `WelcomeHeader` so the same live stats
render in two places without prop-drilling or duplication:
- **Desktop:** inside `WelcomeHeader`, right side of the heading row.
- **Mobile:** a horizontally-scrollable strip at the bottom of the home page (`routes/index.tsx`)
  per the Figma mobile frame `1989:8292`.

Catalogued in `docs/frontend/utils.md`. Figma refs: stat cells from nodes `1989:9048`, `1989:9049`,
`1989:9050`, `1989:9051`. Separator-cell hairline styling matches Figma nodes `1497:94562` /
`1497:94563`; the trailing external-link icon button (40×40 tap target) matches Figma node
`1497:94564` and opens the Protocol Dashboard (`/dashboard`, Issue #716).

### QnaSection


Questions & Answers row at the bottom of the dashboard. Implements Figma frame `1497:94666`
("FAQ") — the narrow strip below the main Disconnected dashboard grid, the page's last block before
the footer, acting as secondary navigation into the help content.

**Composition:**
- An all-caps micro-label eyebrow ("QUESTIONS & ANSWERS") in caption typography, medium weight, the
  brand label tracking token (`--tracking-pipeline-label`, 7px) and muted ink-subtle color —
  matches the Figma `heading` instance `1497:94667` (Label style: caption + 500 + uppercase +
  0.84px tracking, node `I1497:94667;6539:2336`).
- A row of three `LinkCard` primitives from `@pipeline/ui`, one per question (Figma `Cell` frame
  `1497:94668`, three `flex-1` cells with a 16px gap). `LinkCard` already owns the hairline top
  border, 40px row height, muted-to-ink hover transition, and arrow-up-right icon — this composer
  only supplies labels, hrefs, and row layout.

**Layout:** outer flex column with a 16px gap between the eyebrow and the cards row (Figma
`gap-s`). The section spans the full width of its container; the page-level route clamps it to the
1200px grid the rest of the dashboard uses.

**Links:** each card targets the corresponding docs.pipeline.one URL (How it works, What is PLUSD,
What is sPLUSD) and opens in a new tab with `target="_blank" rel="noopener noreferrer"` for
security, wired through `LinkCard`'s `href` prop.

**Accessibility:** the section is a `<section>` landmark with `aria-labelledby` pointing at the
eyebrow (announces "Questions & Answers, region") rather than a hidden duplicate heading. The
eyebrow is a real `<h2>` so it appears in the document outline; CSS handles the visual uppercase +
tracking so the underlying text stays case-correct for screen readers.

Reuse: page-level, stays in `packages/frontend/src/components/` — the reusable atom is `LinkCard`.

### Footer


Global page footer, mounted once in the root layout (`__root.tsx`). Implements Figma frame
`3283-13463` ("Footer") — the two-row strip that renders on the page background
(`--color-pipeline-paper`), outside/below every route's content container (Figma `3283:12101`).
Figma reference (Issue #746, epic #712):
https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-13463&m=dev

**Structure:**
- **Row 1** ("Footer links container", node `3283:13464`): flex row, `items-center
  justify-between`, `border-y` in primary ink, `py-4` (16px, gap-s). Left: `Logo` at 232×64 (2× the
  116×32 intrinsic size), primary ink — the `Logo` default is brand navy, overridden via
  `currentColor`. Right: nav links row, `gap-6` (24px, gap-m), Body 16px, primary ink. On mobile,
  links stack vertically (Figma XS node `3283:74414`: `flex-col`, 24px gap) before switching to a
  horizontal flex-wrap row at `md+`.
- **Row 2** ("Footer Container", node `3283:13472`): flex row, `items-end justify-between`, Caption
  12px, muted ink. Left: 3-line disclaimer, `max-w-[480px]` (node `3283:13473`). Right: copyright
  (node `3283:13474`), `text-right whitespace-nowrap`.
- **Outer:** flex column, `gap-12` (48px, gap-xl) between rows, `p-8 md:p-24` (32px mobile → 96px
  desktop — layout sizing, not a token, same pattern as `dashboard.tsx`).

Responsive: both rows stack vertically below `md`; side-by-side at `md+`. The footer must carry its
own paper background because it's mounted globally outside each route's own paper wrapper —
otherwise it falls back to the bare body background.

Links: all five (Docs / White Paper / GitHub / X (Twitter) / Telegram) are placeholder stubs
(`href="#"`, `aria-disabled="true"`) per resolved Open Question 1 (Issue #746), pending real URL
decisions — see TD-29 in tech-debt-tracker.md.

### usePortfolioChart


Co-located hook for `PortfolioPlaceholderCard`. Owns: the active time-range period (7d / 1m / 3m /
1y / all); the price-history curve from `/v1/stats/prices` when available; a deterministic
balance-history curve generated per period as a fallback; and hover state (nearest slot index,
tooltip content). The hook does not fetch by itself — callers pass optional price samples from
`/v1/stats/prices`; when samples are absent or invalid, `generateCurve` keeps the placeholder chart
visible.

**Fallback algorithm:** mirrors the prototype in `docs.local/stacked_bars_natural_monotonic_growth.html`.
Given `N = 100` slots and `startBalance = endBalance − period.earning`, a random-looking but
deterministic non-decreasing sequence is produced by drawing increments from a seeded pseudo-random
pool (LCG) and normalising them to sum to the total earning. Heights are the balances normalised to
a 0–100 percentage of the final (maximum) balance.

## Navigation & wallet UI

### TopBar


Global page header (self-contained, no external props for wallet). Mounted in the root layout
(`__root.tsx`) so every page renders it automatically; all wallet state is read internally.

**Connected state:**
- Renders a `WalletPill` wrapped in a trigger button.
- Clicking the pill opens the `AccountDropdown` panel (address copy, USDC balance, namespace
  toggle, disconnect).
- When the active namespace is Stellar, the dropdown additionally shows non-zero PLUSD and sPLUSD
  balances (Issue #675).
- The wallet pill's balance shows the active namespace's balance, falling back to the other
  namespace's balance if the active one is disconnected but the other is connected (otherwise "—").

**Disconnected state** (neither namespace connected): renders a "Connect Wallet" `<Button>` that
opens `ConnectWalletModal` (Issue #558 — per-wallet selection with EVM / Soroban tabs).

**Figma references:** frame `1497:94715` (TopBar frame); WalletPill `1498:100168`; account dropdown
`1506:104728` inside `Header / Connected` (`1497:94752`); logo slot `1497:94716` (fixed 160px wide
so the centred nav reads symmetrically — Logo intrinsic width 116px). Mobile height: `p-2` (8px)
totaling 56px tall (8 + 40 + 8), Figma node `1989:9052`; restored to `p-4` (16px) at `md+`.

**Active nav** is derived from the current URL:

| Path | Nav key |
|------|---------|
| `/` | `"home"` |
| `/deposit` (incl. `?direction=withdraw` — direction is a search param, pathname stays `/deposit`) | `"deposit"` (Convert) |
| `/stake` | `"stats"` (Earn) |
| `/transactions` | `"history"` (Activity) |
| other | `"home"` (safe fallback) |

### AccountDropdown


**Source:** `AccountDropdown.tsx` + `useAccountDropdown.ts`.

The panel that opens when the user clicks the `WalletPill`. Anchored under the pill (absolute,
right-aligned), dark surface. Figma node `1506:104728` inside `Header / Connected` (`1497:94752`).
Composed inside `TopBar`; not exported from `@pipeline/ui` (single-component-owner rule per
FRONTEND.md rule 2).

**Props contract:**

| Prop | Behavior |
|------|----------|
| `kind` / `onKindChange` | Active namespace (`evm`/`stellar`); tab click switches it. |
| `address` | Connected address for the active namespace, `undefined` when not connected. |
| `formattedBalance` | Pre-formatted USDC balance (e.g. `"$1,000.00"`), `undefined` when disconnected/loading. |
| `stellarPlusdBalance` | Pre-formatted PLUSD balance. Only passed when Stellar is active **and** balance is non-zero; `undefined` hides the PLUSD row entirely (Issue #675: zero/no-trustline rows are hidden, not zeroed). |
| `stellarSplusdBalance` | sPLUSD token count string. Same non-zero/Stellar-only gating and hide-when-absent rule as PLUSD (#675). |
| `onConnect` | "Connect {namespace}" affordance in the not-connected state. |
| `onClose` / `onDisconnect` | Panel dismissal / disconnect action. |

EVM header stays USDC-only — the PLUSD/sPLUSD rows only ever render for the Stellar namespace.

**Dark panel styling:** the panel has no dedicated "dark surface" token in `theme.css`, so it
reuses `--color-pipeline-ink` (#262524, near-black — otherwise used for primary CTA buttons) as the
closest match, with `--color-pipeline-on-dark` (#ffffff) for text. The divider between rows is a
thin low-opacity white line, matching the Figma separator between blocks.

**`useAccountDropdown` hook** owns: address truncation (via the shared `truncateAddress` util),
clipboard copy with a 1.5 s `copied` affordance, and outside-click / Escape / route-change dismissal
effects.

### MobileNavMenu


**Source:** `MobileNavMenu.tsx` + `useMobileNavMenu.ts`.

Full-screen slide-in nav panel for mobile viewports. Shown when the user taps the hamburger
(`menu-2`) icon in `TopBar` at viewport widths below the `md` (768px) breakpoint.

**Disconnected state** (Figma node `1989:9231`):
- Logo + close (×) button.
- Four nav items: Home / Convert / Earn / Activity.
- Pipeline Overview item (divider-separated).
- "Connect Wallet" full-width dark CTA.

**Connected state** (Figma node `1993:6527`):
- Same nav items.
- Wallet address row (icon + truncated address + copy).
- USDC balance row (coin icon + balance).
- "Disconnect" button (red text, borderless).

**Accessibility:** `role="dialog" aria-modal="true"` (announces as a modal); focus moves to the
first focusable element on open; focus is trapped inside while open; Escape closes (handled by
`useMobileNavMenu`); scrim click closes.

**`useMobileNavMenu` hook** is intentionally narrow: it owns only the open/close boolean toggle and
its side effects (body-scroll lock, Escape-to-close). The host component (`TopBar`) holds the
wallet state and passes action handlers into `MobileNavMenu` as props. Extracted per FRONTEND.md
rule 2 (separate view from logic via a co-located hook).

### ConnectChooserModal


Small modal that lets the user choose which wallet namespace to connect when neither EVM nor
Stellar is connected. Shown when the user clicks "Connect Wallet" and no wallet is connected.

Each connect button ("Connect EVM" / "Connect Stellar") calls the namespace's `connect()` (passed
from `TopBar`) then dismisses the chooser. The chooser does **not** implement its own terms gate —
each `connect()` already routes through the shared chain-agnostic gate.

Accessibility: `role="dialog" aria-modal="true"`, focus trap, Escape dismiss, body-scroll lock.
Mirrors `FirstConnectionModal`'s structural patterns.

### ConnectWalletModal


Full wallet-selection modal (Issues #558, #563). Figma:
https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=2858-57637

Renders a full-viewport two-pane layout (desktop) or single-column (mobile):
- **Left:** "Connect Wallet" heading, EVM / Soroban tab control, per-wallet rows with brand icons
  and direct connect actions.
- **Right:** background photo + Pipeline logo + marketing headline ("Access real-world yield
  on-chain"). Hidden on mobile (below `lg` breakpoint). The dark scrim over the hero photo is an
  upper-left-to-transparent gradient (matching Figma node `2858:57637`) so the white wordmark and
  headline stay legible over the lighter sky/sea in the photo.

Tab set: EVM (Ethereum-compatible wallets) | Soroban (Stellar wallets). No "All" aggregate tab.

Per-wallet behavior:
- Wallet available → connect directly (wagmi connector or kit `setWallet`).
- Wallet unavailable → open the wallet's website in a new browser tab.

"Show More" appears when a tab has more than 5 wallets (`SHOW_MORE_THRESHOLD`); toggles the full
list. Switching tabs resets `showMore` back to collapsed. Currently dormant: EVM lists 4 wallets
and Soroban 5 — **Hana was removed from the Soroban catalogue (#1108)** because its `signMessage`
returns a constant unrelated to the message (verified: two different messages → byte-identical
signature, verifying under no known scheme for the signing account), so signature sign-in can
never succeed. The kit plumbing (`HANA_ID` exports) is kept for a one-line re-enable once Hana
ships a fix; re-enable criterion: different messages produce different signatures AND the
signature verifies per SEP-53.

Entry point: called from `TopBar` (replaces `ConnectChooserModal`).

Accessibility: `role="dialog" aria-modal="true"`, focus trap, Escape dismiss, body-scroll lock.
Dismissal is via the × button and Escape only — no scrim click (unlike `ConnectChooserModal`).

### FirstConnectionModal


"Before you continue" jurisdiction self-attestation modal that gates wallet connect. Shown the
first time a user clicks Connect Wallet (when `pipeline.wallet.termsAcknowledged.<address>` is not
yet set in localStorage).

Visual specs (Figma):
- Init state (toggle off, Continue disabled): node `1572:123328`.
- Ready state (toggle on, Continue enabled): node `1582:69059`.

Dimensions: width 420px, max-height 80vh desktop / 90vh mobile. Scrim `rgba(56,55,53,0.6)`, modal
background `#f8f7f6`, padding 24px, radius 32px (`radius-3xl`). The inline Toggle switch has no
`@pipeline/ui` primitive yet (tracked in tech-debt-tracker.md); track colors are off →
`rgba(56,55,53,0.18)`, on → `#208000` (positive primary), thumb a white circle.

Toggle state resets to off every time the modal (re)opens.

**Accessibility:** `role="dialog" aria-modal="true"` on the panel; focus trap (Tab/Shift+Tab cycle);
Escape and scrim click both call `onDismiss`; on open, focus moves to the toggle; on close, focus is
restored to the element that triggered the modal (handled by the caller via `triggerRef`).

## Activity

### renderRequestRow


Shared row renderer for `RequestItem` data. Both `RecentActivityCard` (home, connected state, Figma
`1497:95119`) and the `/transactions` page (Figma `1497-94912`) render rows with identical visuals.
This helper is the single source of truth for the type→icon, status→tone, and amount-formatting
logic so neither call site can drift.

**Rule:** row visuals must stay identical between the home card and `/transactions`. Any change to
row appearance belongs here, not in the individual consumers.

**Chain-aware decimal scaling (Issue #674):** the renderer accepts the active chain kind and
derives decimal scales from it rather than hardcoding EVM values. Stellar SAC tokens are all 7
decimals (`SAC_DECIMALS`), while EVM uses 6 for payment tokens (USDC) and 18 for stake tokens
(PLUSD / sPLUSD).

| Chain | Deposit / Withdraw | Stake / Unstake (assets / shares) |
|-------|---------------------|-------------------------------------|
| EVM | 6 | 18 |
| Stellar | 7 (`SAC_DECIMALS`) | 7 (`SAC_DECIMALS`) |

**Fail-loud contract for Stake/Unstake fields:** both `assets` and `shares` are required by the
`/v1/requests` API contract for Stake/Unstake items. If either field is absent from the API
response, the renderer deliberately renders `—` (em-dash) instead of silently falling back to a
zero or approximate value, so data regressions are immediately visible rather than silently
zeroing out amounts.

## Ops console panels

### BalanceSheetPanel

**Source:** `BalanceSheetPanel.tsx` + `useBalanceSheetPanel.ts`.

Protocol Dashboard Panel A — Statement of Financial Position (Figma `3283:14275` desktop /
`3283:72288` mobile). Data is blended from REST `GET /v1/financial-position` + Soroban on-chain
reads (`useStellarPlusdTotalSupply`, `useStellarUsdcCustodyBalance`).

**Layout:** two-column (Assets | Liabilities) on desktop (`md+`), stacked on mobile. A 1px vertical
divider separates the columns on desktop only (Figma `3283:14298`, full height, hidden on mobile).
There is **no outer border/card** wrapping the section — the Figma `3283:14275` section frame is
borderless; chrome lives only on the inner bordered column cards. `gap-8` (32px) = Figma `size-32`
between the title row and the ready-state container; the ready-state container itself
(Figma `3283:14277`) uses `flex-row`, `gap-32` between the two Card Containers, `items-start`
(top-aligned header rows) with cards stretching via `flex-1`; on mobile it collapses to `flex-col`,
`gap-8`.

Stable `data-testid` attributes are present on every row. Token discipline: no raw hex/font/size
literals (pixel values below are doc-only).

**Figma token mapping (pixel-authoritative):**

| Element | Token | Value |
|---|---|---|
| Title ("Statement of Financial Position") | `--text-pipeline-heading-l` | 48px/56px desktop; steps down to heading-m (28/36) below `md`, matching Figma `3283:72288` |
| Section headers ("Assets"/"Liabilities") | `--text-pipeline-heading-m` | 28px/36px; no mobile step-down (mobile frame uses same size) |
| Column total (muted rollup) | `--text-pipeline-heading-m` | same size as section name, muted ink |
| Sub-section headers | `--text-pipeline-heading-s` | 20px/28px, normal weight, ink |
| Row labels + values | `--text-pipeline-body` | 16px/22px |
| Caption ("1:1 redeemable") | `--text-pipeline-caption` | 12px/16px, muted ink |
| Border color | `--color-pipeline-line` | border-test/secondary |
| Card padding | — | 16px all sides (`size-16` → `p-4`) |
| Card gap (between sub-sections) | — | 32px (`size-32` → `gap-8`) |
| Container gap (between columns) | — | 32px (`size-32` → `gap-8`) |
| Row pad-top/right | — | 16px (`gap-s` → `pt-4 pr-4`) |
| Row content↔amount gap | — | 12px (`size-12` → `gap-3`) |

Per-element Figma bindings:
- **Row** (Figma list-item): `border-t` (border-test/secondary), `pt-4 pr-4`, `gap-3` between content
  and amount.
- **Column heading row** (Figma `3283:14281`): `items-baseline`, `justify-between`, sits OUTSIDE the
  card border.
- **Card body**: white surface, asymmetric border (1px top+left, 3px bottom+right), radius `radius-xxl`
  (Figma) → `--radius-pipeline-card` (4px), 16px padding all sides, `gap-8` between sub-sections;
  `flex-1` so the Liabilities card grows to match the taller Assets card.
- **Column wrapper**: both columns share equal width (50/50) via `flex-1`; `flex-col` so the header row
  sits above the card; `gap-4` (16px) between header row and card, matching Figma Card Container
  `gap-16`.
- **Sub-section**: `gap-4` (16px) between the sub-section header and its rows, matching Figma
  card-horizontal `gap-s`.

### useBalanceSheetPanel

Blends REST `GET /v1/financial-position` + on-chain reads:
- PLUSD outstanding → `useStellarPlusdTotalSupply()` (Horizon decimal string)
- Cash — stablecoins → `useStellarUsdcCustodyBalance()` (Soroban raw i128 bigint)
- Deployed / Junior tranche → REST base-6 decimal strings
- USYC → `convertUsycToUsdc` seam → `—` (no holding in v1)
- Off-chain USD → `—` (off-chain, no source)

**Decimal discipline:**
- PLUSD: Horizon returns human-decimal strings (e.g. `"10000711.9961018"`) — call `parseFloat(str)`
  directly, no SAC scaling needed.
- USDC: Soroban `balance()` returns a raw i128 bigint at 7-decimal SAC scale — use
  `sacRawToDisplay(bigint)` → human string → `parseFloat()`.
- REST rows are base-6 decimal strings — pass directly to `formatCompactUsd()`.

**Totals:** section totals are CLIENT-RECOMPUTED (the REST roll-up excludes on-chain leaves). Only
sourced rows contribute to the total; unsourced rows (`—`) are excluded and `showTotalsDisclaimer`
is set so a muted footnote can be shown.

**Panel state:** `loading` while REST is in flight; `error` when the REST fetch failed (Horizon reads
never cause a whole-panel error — they surface as per-row `—`); `ready` once REST has data, with rows
rendered best-effort blended with on-chain fills.

`secured_loans_outstanding` (and `accrued_interest_receivable`) are displayed exactly as served by
the backend — issue #906 removed the former `scaleRegistryAmount` ×1000 workaround; the backend now
serves the corrected value directly.

### DeploymentMonitorPanel

**Source:** `DeploymentMonitorPanel.tsx` + `useDeploymentMonitorPanel.ts`.

Protocol Dashboard Panel B — Loan Book. Wires the `useLoanBook` hook via the co-located
`useDeploymentMonitorPanel` logic hook. Panel title is "Loan Book" (Figma node `3283:14431`,
confirmed in issue #717). `data-testid`/`data-node-id` are stable anchors for tests and Figma QA
tooling.

**Tabs (issue #755):** Active Loans / In Origination tab bar (Figma node `3283:14480`). Both tabs are
selectable and carry a live count badge:
- Active Loans → `loans.length` from `GET /v1/loan-book`.
- In Origination → **in-flight** submission count from `GET /v1/loan-book/submissions` (issue #1053 —
  see `useDeploymentMonitorPanel` below for the filter).

The In Origination tab renders its own `OriginationTable` (issue #814, Figma node `4116-9155`) — a
distinct 7-column field set (Commodity/Facility/Corridor/Rate/Maturity/Submitted/Status, #1104 dropped Originator)
derived from each submission's `loan_data` payload via `mapSubmissionToRow`; it no longer shares
`LoanBookTable`'s Active-Loans column set. The In Origination tab body renders its own
loading/error/empty/ready state, independent of the panel-level Active Loans state, so a slow or
failed submissions fetch never blanks the whole panel.

Figma: desktop `node-id=3283-14431`, mobile `node-id=3283-72323`.

**Tab bar styling** (Figma nodes `3283:14480` desktop / `3283:72372` mobile — segmented control). The
two Figma variants are structurally identical (`flex-1` tabs in a `size-full` track) but render
differently by context:
- Desktop (`md+`, `3283:14480`): the track HUGS its content and sits left-aligned; tabs are sized to
  their own label+badge (NOT split 50/50) → `md:w-auto md:self-start` on the track, `md:flex-none` on
  the tabs.
- Mobile (`<md`, `3283:72372`): the track fills the section width and the two tabs split it equally
  → `w-full` track, `flex-1` tabs.

Container (`.tabs`): muted fill track (`--color-pipeline-fill-muted`), 2px padding (`size-2`),
`radius-xl` = 6px (`--radius-pipeline-card-sm`). Each `.tab`: `h-8`, `min-w-8`, `px-1.5`, `radius-l` =
4px (`--radius-pipeline-card`), `gap-0`. Label sits in its own LabelCont with 6px horizontal padding.
Both tabs use caption-size Medium (500) — selected vs. unselected differ only by background (white
chip vs. transparent) and text colour (ink vs. ink-muted), NOT weight. Badge: muted fill bg, 4px
radius, caption-size Regular ink-muted, min-width 20px, outer `px-1` + inner LabelCont `px-0.5`,
`py-0.5`. (Figma specifies a background-blur on the badge — omitted: no blur token exists and it's
invisible over the flat panel background.) Both tabs are interactive (issue #755) — the previous
disabled-tab styling (opacity-50/cursor-not-allowed) is retired.

**Layout spacing** (Figma node `3283:14431` Section): heading h=56, cards start y=88 → 32px
heading→cards gap; `gap-8` between `LoanBookSummary` and the table container (cards end y=232,
Container starts y=264 → 32px below cards). Tab bar + table container (Figma node `3283:14479`) is a
bordered card: radius `--radius-pipeline-card`, border-top/left 1px, border-right/bottom 3px (same
asymmetric "depth" border as the summary cards), white background, `p-4` inner padding, `gap-6`
(24px) between tabs and table.

### useDeploymentMonitorPanel

Maps raw `useLoanBook` + `useLoanSubmissions` data → formatted summary cards, Active Loans rows, In
Origination rows, per-tab state, and the selected-tab state machine.

**Tabs (issue #755):** Active Loans → `useLoanBook` (`GET /v1/loan-book`); In Origination →
`useLoanSubmissions` (`GET /v1/loan-book/submissions`). The panel-level `state` follows the Active
Loans query (drives the summary cards + shared `PanelContainer` chrome). The In Origination tab
carries its own `originationState` (`loading`/`error`/`empty`/`ready`) so a slow/failed submissions
fetch never blanks the whole panel. Panel-level `ready` fires even with zero active loans, so the
Active Loans tab can render its own inline empty state while keeping the In Origination tab
reachable.

The In Origination tab's row shape (`OriginationTableRow`) and its submission→row mapping
(`mapSubmissionToRow`) live in `originationRow.ts` (issue #814 — the tab now shows a distinct Figma
`4116-9155` field set, replacing the Active-Loans-shaped `LoanBookRow` it previously reused).

**In-flight filter (issue #1053):** only submissions whose normalized status is `InReview`,
`ChangesRequested`, or `Rejected` are shown — `Approved` and the backend's merged loan-lifecycle
statuses (`Performing`, `Closed`, `Past Due`, …, #892) are already loans and belong on the Active
Loans tab, so they are excluded from both the rows and the count badge, and the tab reports `empty`
when only such submissions are served. The normalization helper
(`normalizeOriginationSubmissionStatus`, `src/api/useLoanSubmissions.ts`) is a port of the trustee
app's equivalent (#1044) — the two apps deliberately don't share code (TD-42). Mirrors the trustee
origination table's behavior; spec: `docs/product-specs/trustee-dashboard.md` (#1044 paragraph).

`headerAggregates` — pre-formatted aggregate strings for the table column headers, populated from
`summary` by the hook (formatting stays in the hook, not the table component):
- `principal` — always defined when ready (`total_deployed` is non-null); displayed as served by the
  backend (issue #906 — no frontend rescaling).
- `collateral` — defined only when `total_collateral` is non-null; `undefined` while TODO #706
  (commodity price feed) is not yet merged. Also displayed as served (#906).
- `ltv` — user-approved average LTV (null → 0), defined only when `loans.length > 0` (seam refs
  #729/#765). Formula: `Σ(perRowLtv, null→0) / loans.length`, formatted as an integer percent
  (e.g. `"85%"`). This is an approved exception to the "no frontend-computed metrics" rule.

Same-scale rule applies to `formatRow`'s `principal`/`collateral` fields (issue #906, displayed as
served).

### LoanBookSummary

Five summary header cards for the Loan Book panel. Presentational: all values are pre-formatted
strings.

- **Mobile** (below `md`): horizontally-scrollable flex row — each card is fixed `w-[200px] shrink-0`
  (Figma `3283:72325` "Second card pair": cards are 200px, gap 16px, container h=144). The outer
  `overflow-x-auto` wrapper lets the user scroll to reach all 5 cards without wrapping or page
  overflow.
- **Desktop** (`md+`): flex row that stretches cards to fill the full width equally (`flex-1` on each
  card), matching the 5-column desktop layout.

Figma: desktop node `3283:14434` "card-horizontal" (single card), node `3283:14433` "Second card
pair" (full row of 5); mobile node `3283:72325` "Second card pair" XS (200px cards, 16px gap,
scrollable).

Card surface: white background, asymmetric border (1px top+left, 3px bottom+right, Figma
"border-b-3 border-r-3"), radius `radius-xxl` = 4px (`--radius-pipeline-card`), 16px padding all
sides. Fixed height 144px, confirmed from Figma frame `3283:14434` (label at y=16, value at y=100).

Card label: Heading S — Graphik LC (body font), 16px/20px, weight regular (400). Note: the Figma
Heading S style lists weight 700 in its source-font name, but the CSS variable
`font/title-font-weight` resolves to "normal"/400 — use `font-normal`. Card value: Heading 20 —
Besley (display font), 20px/28px, weight 400.

### LoanBookTable

Active-loan table for the Loan Book panel. All viewports render a semantic `<table>` with 7 columns:
Commodity, Principal, Collateral, LTV, Duration, Rate, Protection. The first column shows the
commodity only — borrower identity is not displayed on the LP-facing protocol dashboard (issue
#1058; the Figma header row's "Borrower / Commodity" label predates that decision). Wrapped in `overflow-x: auto` so it horizontally scrolls at mobile widths where the full
1024px table exceeds the 370px content area (FRONTEND.md wide-content rule).

The Figma XS mobile frame `3283-71053` renders the full 7-column table scrolling horizontally inside
the section — NOT stacked label/value cards. The previous `MobileCards` path (`block md:hidden`) was
removed to match Figma exactly (resolved decision for issue #749) — this table now renders at every
width, and `headerAggregates` populates the header row at all widths too.

**Column widths** (Figma node `3283-14552`, Table container): Commodity is flexible (fills
remaining space, `min-w 1px`); Principal 112px (node `3704:1076`); Collateral 112px (`3704:1079`);
LTV 112px (`3704:1082`); Duration 96px (`3704:1085`); Rate 96px (`3704:1088`); Protection 128px
(`3704:1091`) — fixed columns total 656px, remainder goes to Commodity. `table-layout: fixed`
+ `<colgroup>` enforces these widths so long strings in the commodity column don't push the
numeric columns together; the commodity cell truncates (`overflow-hidden` + `text-ellipsis` +
`whitespace-nowrap`) so overflow clips with an ellipsis.

**Spacing** (Figma node `3283-14552` metadata): row height 64px (node `3704:1095`); row padding `py-3`
(12px top+bottom); header→row gap `pb-2` (8px, Table container `gap-8` between Header and Content
slots); inter-column gap `pr-3` (12px, row Slot `gap-12` between list-items); row divider `border-t`
1px `--color-pipeline-line-subtle` (`#F1F1F1`) on `<td>` cells (not `<tr>`, so `border-collapse`
renders it correctly). Body cell geometry: the Figma `.row` has 12px top/bottom padding — `py-3` on
the `<td>` only, with the inner `<span>` contributing no vertical padding, matches the h=64 row
height exactly (an earlier "two-layer" `py-3` + `py-2` approach double-counted padding and made rows
too tall; that has been fixed).

**Typography:** header captions 12px/16px, font-normal, muted ink; body cells 16px/22px, font-normal,
ink.

Figma also specifies `border-radius: 4px` on rows; unsupported on `<tr>` — logged as **TD-26** in
`tech-debt-tracker.md`.

`headerCellClasses`/`firstBodyCellClasses`/`firstBodyCellInnerClasses` are exported for reuse by
`OriginationTable.tsx` (issue #814 decision: keep the dashboard's existing table visual language for
the In-Origination tab's new column set, rather than adopting the trustee's grid layout).

`headerAggregates` — `undefined` means "render the plain label with no aggregate" (not `"—"`); this
avoids rendering `Collateral · —` when `total_collateral` is null. When present, the Principal and
Collateral headers render as `"Principal · $31.6M"` (label + middot + aggregate in one caption run).

Figma refs: desktop `node-id=3283-14431`, table container `node-id=3283-14552`, mobile XS
`node-id=3283-71053`.

### OriginationTable

**Source:** `OriginationTable.tsx` + `originationRow.ts`.

The In-Origination tab's submissions table for the Loan Book panel (issue #814, Figma node
`4116-9155` — the same field set as the trustee Origination page, #813).

Seven columns: Commodity · Facility · Corridor · Rate · Maturity · Submitted · Status (#1104 removed
the Originator column; `loan_data.originator` keeps being served, just not rendered here).
Rows come pre-formatted from `mapSubmissionToRow` (`originationRow.ts`) via
`useDeploymentMonitorPanel`.

**Resolved Open Questions from issue #814 (human-confirmed):**
1. The "Commodity · valuation" sub-line is OMITTED — no valuation-mode source exists for pre-mint
   submissions (mirrors #813).
2. Status renders as the dashboard's existing simple color-coded label (`statusColorClass`), NOT the
   trustee's Review-button / "Approved & minted" pill — the LP app is read-only for submissions.
3. Table styling reuses the dashboard Loan Book table's existing visual tokens
   (`headerCellClasses`/`bodyCellClasses` from `LoanBookTable.tsx`) rather than the trustee's grid
   layout — there is no LP-specific Figma frame for this column set.

`table-fixed` + `<colgroup>` + `overflow-x-auto` mirror `LoanBookTable`'s geometry (FRONTEND.md
wide-content rule). Every column has a fixed width and truncates — the truncation-capable cell
pattern (`overflow-hidden max-w-0` on the `<td>` + `truncate` on the inner span, normally reserved for
the first column elsewhere) is applied to ALL columns here, so long values (e.g. a long commodity or
a "South Korea → Mongolia" corridor) clip with an ellipsis instead of spilling into the neighbouring
column. Columns are separated by 12px via `pr-3` on every cell except the last. `width: undefined` on
the `Commodity` column definition means it's left flexible so it absorbs the remaining table width
(the flexible slot moved from the removed Originator column, #1104).

Status column text colour mirrors the `WithdrawalQueueTable` status-colour pattern (same mapping as
the retired `LoanBookTable.statusColorClass`, issue #755), keyed on the row's **normalized** status:
`Approved` → positive (green); `Rejected` → negative (red); `InReview` / `ChangesRequested` →
pending (amber); anything else → muted ink (neutral fallback). The cell TEXT is the human-readable
`statusLabel` (`STATUS_LABELS` in `originationRow.ts`, #1053) — "In review", "Changes requested",
"Rejected" — not the backend literal.

**`originationRow.ts` field mapping** (`SubmissionView` → table row; mirrors
`packages/trustee/src/routes/-useOriginationTable.ts`'s `mapSubmissionToRow`, minus the trustee-only
router-nav `submission` threading and Review action):

| Field | Source | Notes |
|---|---|---|
| Commodity | `loan_data.commodity` | Figma also shows a valuation sub-line ("NSR · Net Smelter Return" / "Standard · price × quantity"), but no field in `loan_data`/`SubmissionView` carries a valuation mode for pre-mint submissions (`ValuationMode` lives in `loan_collateral_valuations`, keyed by an on-chain `loan_id` submissions don't have yet). Resolved (human, issue #814, mirroring #813): OMIT the sub-line entirely rather than infer it from the commodity name. |
| Facility | `loan_data.economics.original_facility_size` | Served at the on-chain 7-decimal base-unit scale — normalized ÷10^7 via `economicsBaseUnitsToUsdDecimal` (issue #912, BigInt-safe) before `formatCompactUsd` (compact M/K, e.g. `"$3.5M"`) to match the Active Loans table (#841). |
| Corridor | `loan_data.corridor` | Hyphen separator rendered as the Figma's arrow glyph ("PE-CN" → "PE → CN") — same data, design-matching glyph. |
| Rate | `loan_data.economics.senior_interest_rate_bps` | Via `formatBpsRate` (e.g. `1400` → `"14.0%"`). |
| Maturity | `loan_data.economics.original_maturity_date` (Unix seconds) | Via `formatMaturityDate` (e.g. `"15 Dec 2026"`). |
| Submitted | `SubmissionView.created_at` (RFC 3339) | Via `formatSubmittedDate` (e.g. `"18 Jun"`). |
| Status | Raw `SubmissionView.status` string | Resolved (human, issue #814): the LP dashboard keeps its existing simple color-coded status label rather than adopting the trustee's Review-button / "Approved & minted" pill — the LP app is read-only for submissions and has no review route. |

Every field is read defensively: `loan_data` is `serde_json::Value` on the wire (declared as
`SubmitLoanRequest` for convenience, but not guaranteed to match at runtime), so missing/malformed
nested fields render `"—"` rather than fabricating a value or throwing. See **TD-42**
(`docs/exec-plans/tech-debt-tracker.md`) for the trustee↔LP extractor duplication this creates.

### Panel states

**Source:** `PanelContainer.tsx`, `PanelEmpty.tsx`, `PanelError.tsx`, `PanelLoading.tsx`.

`PanelContainer` is the shared surface for the four Protocol Dashboard panels (A Balance Sheet, B
Deployment Monitor, C Withdrawal Queue, D Yield History). It wraps the `@pipeline/ui` `Card` (`white`
variant) with an optional panel title header and a body region.

**State handling:** a single `state` discriminator selects which body renders, so all four panels
share one loading/empty/error treatment:
- `"ready"` (default) — renders `children` (the panel's real content).
- `"loading"` — renders `<PanelLoading/>`.
- `"empty"` — renders `<PanelEmpty caption={emptyCaption}/>`.
- `"error"` — renders `<PanelError onRetry={onRetry}/>`.

In #716 the panels shipped as placeholders passing `state="empty"`; follow-up sub-issues of #712
flip them to `"loading"`/`"error"`/`"ready"` as they wire real data. `PanelContainer` itself is
pure/presentational — no data fetching.

`title` is optional: panels whose Figma section has no heading (e.g. Panel D Yield History —
`3283:67619`) omit it, and no `<h2>` is rendered. Panel heading typography: display serif at
heading-l (48px/56px) on desktop, stepping down to heading-m (28px/36px) below `md`, matching the
applied Figma values on section title nodes `3283:14432` (Loan Book) and `3283:14894` (Withdrawal
Queue); mobile step-down follows the home page responsive type-scale convention (see FRONTEND.md
"Responsive behavior").

`borderless` (bool): when `true`, the outer `Card` surface (border + background) is suppressed. Used
by the Loan Book (`DeploymentMonitorPanel`) and Withdrawal Queue panels, whose Figma section frames
(`3283:14431`, `3283:12101`) are borderless — the visual chrome lives on the inner summary cards and
table-container card instead. All other panels keep the default bordered white Card. `gap-8` (32px) =
Figma `size-32`: heading h=56, content starts y=88 → 32px gap (measured on nodes `3283:14432` Loan
Book, `3283:14894` Withdrawal Queue) — applies in both bordered and borderless modes.

`PanelEmpty` is a thin wrapper over the `@pipeline/ui` `EmptyState` primitive (caption-only, no
illustration) so every panel's "nothing to show yet" state reads the same; the placeholder panels
shipped in #716 render it with a "Coming soon" caption until follow-up sub-issues of #712 wire real
data.

`PanelError` renders a muted message plus a Retry button, mirroring the error/retry block on the
Transactions page (`routes/transactions.tsx`). The owning panel passes an `onRetry` callback
(typically the query's `refetch`) via `PanelContainer`'s `state="error"`.

`PanelLoading` renders muted "Loading…" copy, mirroring the loading treatment used by the
Transactions page. All three are pure/presentational; the panel that owns the data decides when to
render each (via `PanelContainer`'s `state` prop), so the loading/empty/error affordance is identical
across the whole dashboard. Token discipline for all three: muted-ink + body type tokens only, no raw
colors/sizes.

### TvlCard

Protocol Dashboard TVL card — left column of the Figma "Top" row (node `3283:67622`). Pure view: all
values are derived by `useYieldHistoryPanel` and passed in as props; no data fetching in the
component itself.

Renders:
- "TVL" eyebrow + headline value (e.g. `"$43.1M"`), Figma node `3283:67623` (528×56, two halves each
  264 wide).
- "Outstanding in Loans" label + value (muted, right-aligned), or `"—"` when null.
- Horizontal progress bar (Figma instance `3380:1410`, y=64, 528×4) + "X.X% deployed" caption (Figma
  `3380:1895`) — fill width is `outstanding_in_loans / tvl`, an **approved exception** to the "no
  frontend-computed metrics" rule for this ratio-of-served-values visualisation (issue #760
  open-question resolution). Guard: null/zero `tvl` → `deployedRatio` is `null` → empty bar + `"—%
  deployed"` caption. Track: `bg-pipeline-line`; Fill: `bg-pipeline-ink`.
- Dark TVL bar chart (`fill="var(--color-pipeline-ink)"`), fixed 240px tall anchored to the bottom
  (`mt-auto`), matching Figma chart container `3283:67630` (240h) on both desktop (`3283:67622`,
  460-tall card) and mobile (`3283:71067`, 404-tall card).

Card is fixed 404px tall on mobile (Figma `3283:71059`) and fills the 460px row on desktop.

Figma: `node-id=3283-67622`. Tokens: eyebrow/caption = Caption (Graphik LC 12/16); headline =
Heading M (Besley 28/36).

### WithdrawalQueuePanel

**Source:** `WithdrawalQueuePanel.tsx` + `useWithdrawalQueuePanel.ts`.

Protocol Dashboard Panel C — Withdrawal Queue. Wires the `useWithdrawalQueue` hook via the co-located
`useWithdrawalQueuePanel` logic hook.

**Content** per Figma section `3283:14893`:
- Title "Withdrawal Queue".
- Four summary cards: In Queue / Requests / Estimated wait / Liquid Cover.
- Table: Holder / Amount / Status (3 columns).
- "Show more" affordance when there are more than 5 items (client-side).

Figma: desktop `node-id=3283-14893`, mobile `node-id=3283-72387`.

**Layout:** section is borderless per Figma `3283:12101` — the withdrawal section has no outer
container border; visual chrome lives only on the summary cards (unlike the Loan Book table, the
withdrawal table sits on the section background with only row dividers, no surrounding card box).
Section spacing (Figma section `3283:14893`): heading h=56, cards start y=88 → 32px heading→cards
gap; `gap-8` (32px) between summary cards and table container (cards end y=232, table starts y=264 →
32px below cards).

Summary card surface matches the `LoanBookSummary` card treatment: white surface, asymmetric depth
border (1px top+left, 3px bottom+right), 4px radius, 16px padding, 144px tall (Figma frame
`3283:14895`). Mobile: `w-[200px] shrink-0`, fixed per Figma card-horizontal node `3283:72377`
(w=200); the outer `overflow-x-auto` wrapper handles scroll (2×200+gap=416px > 370px viewport).
Desktop: `md:w-auto md:flex-1`, stretches to fill the 4-column row equally. Card label: Heading S
token (body font, 16px/20px, regular weight). Card value: display serif, 20px/28px, regular weight.

"Show more" button: caption-size, muted ink, minimal chrome, matching the panel's typographic scale
for supplementary controls; renders only when there are hidden rows.

### useWithdrawalQueuePanel

Maps raw `useWithdrawalQueue` data → formatted summary cards + table rows + panel state.

**Panel state:** `loading` → `PanelLoading`; `error` → `PanelError` with retry; `empty` → no queue
items, `PanelEmpty`; `ready` → formatted summary + rows available.

**Row expand** (resolved Open Question 2): the first `WITHDRAWAL_QUEUE_DEFAULT_VISIBLE` (5) rows are
visible by default; `expanded` toggles the "Show more" affordance. The hook owns this state so the
view stays JSX-only.

**Liquid Cover calc** (`"5.6x"` or `"—"`) — frontend calc, user-approved: `(cash + tokenized-T-bills) /
queue`.
- `cash` = REST `assets.liquid.cash_stablecoins` (null/non-finite → 0).
- `tbills` = REST `assets.liquid.tokenized_tbills` (null/non-finite → 0).
- `queue` = `in_queue_usd` (null/non-finite → 0). Divide-by-zero → `"—"`.
- Both `cash` and `tbills` are null in v1 (no commodity price feed, no USYC holding), so this reads
  `"0.0x"` today. Seam: wire on-chain sources (USDC custody balance, USYC NAV) when available.

### WithdrawalQueueTable

Withdrawal queue table for Panel C. All viewports render a semantic `<table>` with 3 columns: Holder
/ Amount / Status, wrapped in `overflow-x: auto` (FRONTEND.md wide-content rule).

The Figma XS mobile frame `3283-71053` renders a real 3-column table at mobile (Table container
w=370, three ~115px `Item` columns) that fits within the 370px content area without horizontal
scroll. The previous stacked-card `MobileCards` path was removed to match Figma exactly (issue #749
resolved decision).

Spacing and typography follow the same conventions as `LoanBookTable` (Figma section `3283:14893`):
row height 64px, row padding `py-3` (12px top+bottom), header gap `pb-2` (8px after header), row
divider `border-t` 1px `--color-pipeline-line-subtle` on `<td>`; header captions 12px/16px
font-normal muted ink, body cells 16px/22px font-normal ink. Column widths are three equal columns
(~1/3 each), matching the Figma `flex-1` distribution for Holder/Amount/Status.

Status colour: `Completed` → green (`--color-pipeline-positive`, the "done" state); `Queued` → muted
ink (neutral/pending); unknown status → muted ink (safe fallback).

Figma refs: Panel C desktop `node-id=3283-14893`, mobile XS `node-id=3283-71053`.

### YieldBarChart

Reusable inline-SVG bar chart for the Yield History panel (also reused by `TvlCard`). Renders a fixed
number of thin vertical bars, each a single solid `<rect>` in one flat colour, matching the Figma
chart (no glow/opacity layering).

On hover, the chart shows a tooltip with the bar's value and date, and a faint highlight band marks
the hovered slot. Pointer tracking is mouse-only — touch is deferred (logged in
`tech-debt-tracker.md`).

Props:
- `bars` — array of `{ height: number (0–100), value: number, timestamp: number }`.
- `fill` — bar fill colour; defaults to the green chart-positive token.
- `formatValue` — formats a bar's numeric value for the tooltip; defaults to compact USD (both
  series this chart backs are USD).
- `className` — appended to the wrapper element.

Figma reference: `node-id=3283-68337`.

### YieldHistoryPanel

**Source:** `YieldHistoryPanel.tsx` + `useYieldHistoryPanel.ts`.

Protocol Dashboard "Top" row (Figma frame `3283:67619`, no section heading — the Figma frame has no
heading text). Wires the `useYieldHistoryPanel` logic hook and renders:

- **Left column** (node `3283:67622`, spans the full column height): TVL card — headline,
  Outstanding in Loans, progress bar ("% deployed"), and dark TVL bar chart. Backed by
  `GET /v1/dashboard/summary` + `GET /v1/dashboard/tvl-history`.
- **Right column** (`3380:1920`, vertical stack): Cumulative Yield card — headline value + green bar
  chart (no time-range selector — the Figma "Top" frame shows none). Backed by
  `GET /v1/dashboard/summary` + `GET /v1/dashboard/yield-history`. Below it, three metric cards in a
  row (Figma `3380:1921`, three 176×144 cards, 16px gap) — "Current APY, Net to sPLUSD", "Loan Book
  Yield", "Target Net to sPLUSD". All three metric cards are shown at every viewport (#749 Q3); on
  mobile the row scrolls horizontally (`overflow-x-auto`), on desktop (`md+`) all three are equal
  `flex-1` cards.

Layout mirrors Figma `3283:67619` (1136×460): two equal 560-wide columns with a 16px gap, stacked
below `md`. The Cumulative Yield card (Figma `3283:68333`) has no period tabs per design; it's fixed
248px tall on mobile (Figma `3283:71770`) and fills the right column on desktop. Its chart uses green
bars (Figma `3283:68337`); when the API returns data but all `cumulative_yield` values are zero, the
chart area renders as an empty seam while metric cards still render — the full empty state (all
series null) is handled by `PanelContainer`'s `state="empty"` instead.

"Target Net to sPLUSD" is a static product constant (8–12%); a seam for #738 (wiring a live
decomposed target APY) is labelled `TODO(#738)` in the code.

**Data not served by the API today** — by-source cumulative minted split, real-time T-bill accrual,
trailing-30d loan/T-bill breakdown — is intentionally omitted, not fabricated. Seams for those series
will be wired once #738 delivers the backend endpoints.

Metric card surface (Figma node `3380:1921`): asymmetric depth border, white surface, 16px padding,
matching the inner card treatment in `DeploymentMonitorPanel`/`LoanBookSummary`. `h-[144px]` +
`justify-between` pins the label to the top and value to the bottom (176×144 cards). Mobile:
`w-[200px] shrink-0` (row scrolls); desktop: `flex-1 min-w-0` (cards expand to fill equal widths).

Figma: top row `node-id=3283-67619`, TVL card `node-id=3283-67622`, yield `node-id=3283-68333`,
mobile `node-id=3283-72387`.

### useYieldHistoryPanel

Resolves chain from ENV defaults (no wallet connection on the Protocol Dashboard), fans out API calls
to the three `/v1/dashboard/*` endpoints, and derives panel state + formatted values for the view
layer.

**Endpoints used (issue #760):**
- `GET /v1/dashboard/summary?chain_id` — five headline KPIs.
- `GET /v1/dashboard/tvl-history?chain_id&days&interval` — TVL series.
- `GET /v1/dashboard/yield-history?chain_id&days&interval` — yield series.

Both series are fetched at the default daily interval, showing full history with no range selector.

**Decisions (issue #760):**
- `chainId` = `ENV.STELLAR_CHAIN_ID` — the Protocol Dashboard is Stellar-scoped (real data lives on
  chain `99000001`; the EVM chain carries malformed test data, #765).
- All three endpoints are protocol-level (no vault address needed). The zero-address vault guard from
  the pre-#760 version has been dropped — these endpoints are unconditionally enabled (wallet-less,
  and the panel's empty state handles `200 []`).
- "Target Net to sPLUSD" is a static product constant (`"8–12%"`) — no endpoint serves a target APY
  yet (#738 backend follow-up); the value is fixed in the Figma spec and product docs.
- "Current APY, Net to sPLUSD" → `summary.current_apy_net_to_splusd`. "Loan Book Yield" →
  `summary.loan_book_yield`. Cumulative Yield headline → `summary.cumulative_yield_total`.
- Headline value comes from `summary.cumulative_yield_total`, not the last chart bar, so the KPI
  matches even when the chart resamples/aggregates.
- Progress bar fill → `outstanding_in_loans / tvl` (same approved exception to "no
  frontend-computed metrics" as `TvlCard`, for ratio-of-served-values; null/zero `tvl` → `null`,
  render empty bar + `"—%"`).
- `outstanding_in_loans` is displayed exactly as served by the backend (issue #906 — the former
  `scaleRegistryAmount` ×1000 workaround has been removed; the backend now serves the corrected
  value directly).

Panel state: `loading` while summary or any series query is loading; `error` on the first query error
found (summary, then TVL history, then yield history); `empty` when both bar arrays are empty AND the
summary is null/all-zero; otherwise `ready`.

### usycNav

USYC NAV conversion seam for the Balance Sheet panel (Panel A). v1 is an identity stub: returns
`usycAmount` unchanged (1:1 USYC → USDC). When real NAV data is available, replace the function body
with a call to the issuer's NAV endpoint or the USYC `convert_to_assets`-style view.

The module is intentionally tiny and self-contained so the swap is a single-file edit.
`useBalanceSheetPanel` calls this; with no USYC holding configured, the input is `0n`/`undefined` and
the row renders `—`. `usycAmount` and its return value are both raw USYC/USDC amounts at 7-decimal
SAC scale.

## Routes

### Root layout

**Source:** `packages/frontend/src/routes/__root.tsx`

Wraps every route with the global `TopBar` and `Footer`. `Footer` sits below/outside each route's `<Outlet>` content so it renders on the page background (`--color-pipeline-paper`) on all routes, matching Figma `3283-13463` (Issue #746, epic #712).

### Home route

**Source:** `packages/frontend/src/routes/index.tsx`

Full page composition. Figma: `1497:94556` (desktop), `1989:8292` (mobile).

**Desktop (md+) visual structure, top → bottom:**

1. Sticky `TopBar` along the top edge of the viewport.
2. A centred content column (`max-w-[1200px]`) with `py-32` breathing room under the bar (48px gives the welcome heading air; horizontal padding lets the column breathe at narrower widths without exceeding the 1200px design cap). The column stacks `WelcomeHeader` and a white outer `Card` with a 48px gap.
3. Inside the outer card, a 7-column CSS grid (mirrors Figma's `grid-cols-[repeat(7,minmax(0,1fr))]`, 16px gap matching the design's `gap-x-16`/`gap-y-16`, node `1497:94565`):

   | Slot | Grid position | Content |
   |------|---------------|---------|
   | Portfolio | col 1–4, row 1 | Disconnected: `ConnectWalletPromoCard`; connected: `PortfolioPlaceholderCard`. Both use `Card variant="yellow"` + `min-h-[274px]` so the grid never reflows when wallet state changes. |
   | Recent activity | col 5–7, `row-span-2` starting row 1 | `RecentActivityCard` — the row-span lets it stretch across both rows so it sits flush with the bottom of the StakeCard. |
   | Balances | col 1–2, row 2 | Vertical stack of `StartHereCard` + `EarnedCard` (Figma "Balances" frame `1497:94675`). |
   | StakeCard | col 3–4, row 2 | Once the user holds sPLUSD the card switches to the "Staked PLUSD" balance layout (Figma node `1497:95217`); otherwise it keeps the marketing CTA. The empty/plusd button labels are mobile-specific, so the desktop instance only opts into the `"splusd"` state. |
   | QnaSection | col 1–7, row 3 | Questions & Answers strip. |

**Mobile (below md) visual structure — single-column stack**, rendered directly (no outer white Card wrapper — Figma frame `1989:8292` uses the page background, not a white card):

1. `WelcomeHeader` — title only (32px), stats strip hidden. On mobile the `isConnected` prop drives "Welcome back" vs "Welcome" copy; the prop is ignored on desktop (the desktop block renders at md+ instead).
2. `ConnectWalletPromoCard` / `PortfolioPlaceholderCard` — full width, 256px tall.
3. A flex row (Figma node `1989:9006`): left = `StartHereCard` + `EarnedCard` stacked, `flex-1` (node `1989:9007`); right = `StakeCard`, fixed 189px wide, 224px tall.
4. `RecentActivityCard` — shown only when connected with a non-empty mobile home state (States B/C). Per issue #466 answer Q6: if there is no activity the entire block is hidden on mobile.
5. `HomeStatsStrip` — horizontally scrollable, at the bottom (replaces the `WelcomeHeader` stats strip, which is hidden on mobile).
6. `QnaSection` and the desktop `RecentActivityCard` column are hidden on mobile.

**Top-left card branching:** connection state is derived from the *active wallet view namespace* (`useWalletView().kind`), mirroring the deposit/stake convention — `kind === "stellar"` reads `useStellarWallet().isConnected`, `kind === "evm"` (default) reads `useEvmWallet().isConnected`. When disconnected, `ConnectWalletPromoCard` gets an `onConnect` prop wired to `useWallet().connect()` so the home CTA opens the same AppKit modal as the header (#224, #250). When connected, `PortfolioPlaceholderCard` sources balances from the active chain (EVM via `useEvmToken`, Stellar via `useStellarSacToken` + `useStellarStakedPlusdBalance`) so a Stellar-only session sees real PLUSD/sPLUSD totals (#688). Chart history remains a placeholder pending further wiring.

**Mobile home state** (`deriveMobileHomeState`, scale-agnostic — only compares `> 0n`):

- `"splusd"` — wallet has sPLUSD shares (State C, Figma `1886:46777`)
- `"plusd"` — wallet has PLUSD but no sPLUSD (State B, Figma `1984:6501`)
- `"empty"` — connected but zero balances (State A, Figma `1988:7074`)

Only meaningful when `isConnected === true`; callers short-circuit to the disconnected layout otherwise.

Token discipline: this composer adds no raw colors, fonts, sizes, or radii — every value comes from `@pipeline/ui/styles/theme.css` via component primitives or Tailwind utilities that resolve theme tokens.

### Deposit and withdraw route

**Source:** `packages/frontend/src/routes/deposit.tsx`, `packages/frontend/src/routes/withdraw.tsx`

Merged three/four-step conversion page. Direction is driven by the `?direction=deposit|withdraw` search param; unknown values fall back to `"deposit"`.

**URL contract:**

| URL | Resulting direction |
|-----|----------------------|
| `/deposit` | `"deposit"` |
| `/deposit?direction=deposit` | `"deposit"` |
| `/deposit?direction=withdraw` | `"withdraw"` |
| `/deposit?direction=<anything else>` | `"deposit"` (fallback) |
| `/withdraw` | Redirected to `/deposit?direction=withdraw` |

`/withdraw` (`withdraw.tsx`) is a one-time `redirect` to `/deposit?direction=withdraw`, kept only so external links/bookmarks to `/withdraw` continue to work — the actual page lives at `/deposit`. `replace: true` keeps the redirect out of the back-button history (reload does not flash `/withdraw` before `/deposit`, and back-button does not accumulate redirect hops). Incoming search params are preserved.

**Chain-aware wiring** (issue #552): the page reacts to `useWalletView().kind`. When Stellar is active, the `useDepositFlow` adapter switches all data and actions to the Stellar/Soroban stack (trustline step, SAC balances, XLM fee, etc.); flipping back to EVM restores the original behavior. All hooks are called unconditionally per React's Rules of Hooks.

**Step sequences per chain/direction:**

| Step | EVM deposit | EVM withdraw | Stellar deposit & withdraw |
|------|-------------|--------------|------------------------------|
| 1 | Allow Pipeline to use USDC (Approve) | Allow Pipeline to use PLUSD (Approve) | Enable PLUSD (`changeTrust`, complete when trustline exists) |
| 2 | Confirm USDC transfer (Confirm) | Confirm PLUSD burn (Confirm) | Enable USDC (`changeTrustUsdc`, complete when trustline exists) |
| 3 | Claim your PLUSD (Claim) | Claim your USDC (Claim) | Confirm USDC transfer / PLUSD burn (`request_deposit` / `request_withdrawal`) |
| 4 | — | — | Claim your PLUSD / USDC (`claim_request` + verifier signature) |

Both Stellar trustline rows are always shown in both directions (issue #604); Confirm is gated until BOTH trustlines exist — the page renders the four-step `StepsCard` when `isStellar && flow.trustlines.length === 2`, otherwise the three-step EVM `StepsCard`.

**Banner precedence** (checked top to bottom; conditional: disconnected → data-pending → USDC-trustline → low-balance → steps card):

1. **Wallet-not-connected banner** (Figma node `1994-7226`) — shown whenever `!flow.isConnected`.
2. **Initial data load** — first load only: chain data / requests API still loading; renders nothing until first resolved (avoids re-hide flicker on background refetches). Not shown again on later background refetches.
3. **USDC trustline banner** — Stellar deposit, no USDC trustline, no USDC balance. Takes the place of the low-balance banner (same layout) but the action adds the USDC trustline instead of prompting to add funds — the account must hold a USDC trustline before it can hold or deposit USDC on Stellar.
4. **Insufficient-balance banner** (Figma node `1825-10214`) — deposit only, `flow.hasBalance === false`.
5. Otherwise, the steps card (four-step Stellar or three-step EVM, above).

**Toast ids** are scoped per chain+direction so a stale toast from one direction/chain does not collide with a new one:

- EVM deposit: `approve-tx` / `deposit-tx` / `claim-tx`
- EVM withdraw: `withdraw-approve-tx` / `withdraw-tx` / `withdraw-claim-tx`
- Stellar trustlines (direction-independent): `stellar-trust-plusd-tx` / `stellar-trust-usdc-tx`
- Stellar deposit: `stellar-deposit-tx` / `stellar-deposit-claim-tx`
- Stellar withdraw: `stellar-withdraw-tx` / `stellar-withdraw-claim-tx`

**Claim toast copy:** PLUSD claims (deposit direction) surface the claimed amount plus a "Stake" CTA; USDC claims (withdraw direction) keep a plain confirmation, since staking USDC doesn't apply.

Figma references: [deposit page](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100812), [withdraw page](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100351), [swap button](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100157), [wallet not connected](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1994-6885).

See also [`wallet-flows.md` § Request state model](./wallet-flows.md#request-state-model) for the completed-deposit auto-reset behavior driving this page's form-reset effect.

### Stake route

**Source:** `packages/frontend/src/routes/stake.tsx`

Chain-aware stake/unstake page driving two flows via the `useStakeFlow` adapter, which selects between the EVM and Stellar/Soroban stacks based on `useWalletView().kind`.

**Step sequences per chain/tab:**

- EVM Stake tab: 1. Allow Pipeline to use PLUSD (Approve) → 2. Confirm and stake PLUSD (Stake)
- EVM Unstake tab: 1. Confirm and unstake sPLUSD (Unstake)
- Stellar Stake tab: 1. Enable sPLUSD (`changeTrust` for share asset) → 2. Confirm and stake PLUSD (vault deposit)
- Stellar Unstake tab: 1. Enable PLUSD (`changeTrust` — receiver needs PLUSD trustline) → 2. Confirm and unstake sPLUSD (vault redeem)

Amount is reset on chain switch via the same `prevKindRef` pattern used by `deposit.tsx`.

**URL contract:** `/stake?tab=unstake` deep-links the Unstake tab (e.g. the home `StakeCard`'s "Unstake" link). The URL only seeds the *initial* tab — in-page switching is local state, so subsequent tab toggles do not push history entries.

**Toast ids** scoped per chain+tab: EVM stake — `stake-approve-tx` / `stake-tx`; EVM unstake — `unstake-tx`; Stellar stake — `stellar-splusd-trust-tx` / `stellar-stake-tx`; Stellar unstake — `stellar-plusd-trust-tx` / `stellar-unstake-tx`.

Wallet-not-connected banner uses the same Figma node as the deposit page (`1994-7226`).

Figma references: [disconnected](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1994-7280), [init](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95311), [approved](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-101158).

### Transactions route

**Source:** `packages/frontend/src/routes/transactions.tsx`

Activity page wired to `GET /v1/requests`.

**Responsive layout:**

- Mobile (< 768px, Figma node `1993-9592`, 402×874): 8px side margins (`px-2`); `ActivityHeader` shows a left-aligned heading with no arrow-clock icon.
- Desktop (≥ 768px, Figma node `1497-94912`): centred content column capped at `max-w-[480px]`; `ActivityHeader` shows a centred icon + heading.

**Visual structure, top → bottom:** centred content column (`max-w-[480px]`, `px-2 py-8` page padding) → `ActivityHeader` → `SegmentedTabs` (Buy / Sell / Stake / Unstake — the "All" tab has been removed; "Buy" is the default; selecting a tab filters the in-memory array client-side with no re-fetch) → activity rows from `useRequests()`, filtered by the active tab.

**Empty-state behavior:** the full `EmptyState` illustration + caption renders whenever the visible row count is zero — whether the wallet is disconnected, the API returned zero rows, or the active tab filter yields zero rows. The intent is a single consistent visual rather than a different treatment per cause (a deliberate reversal of part of #257). The empty state and the rows list are mutually exclusive: at most one of {loading, error, empty-state, rows} is visible at a time.

**Empty-state layout:**

- Mobile (< 768px, Figma node `1993-9958`): illustration (240×240) and caption are top-anchored just below the tab bar with natural spacing; no tall centering wrapper.
- Desktop (≥ 768px, Figma node `1497-94912`): illustration is vertically centred inside a `min-h-[400px]` wrapper. The wrapper uses responsive utilities (`md:min-h-[400px] md:justify-center`) to gate the desktop centering treatment without affecting mobile.

**Active-chain gating** (issue #644): connection is keyed off the active chain's wallet (`useWalletView().kind`), not EVM unconditionally — mirroring the `useRequests` hook. With Stellar active, `isStellarConnected` drives the empty-state gate; with EVM active, `isEvmConnected` does.

Figma references: [desktop](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-94912&m=dev), [mobile with data](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1993-9592&m=dev), [mobile empty](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1993-9958&m=dev).

### Dashboard route

**Source:** `packages/frontend/src/routes/dashboard.tsx`

Protocol Dashboard route (`/dashboard`) — issues #716, #728. Hosts the four Operations Console panel slots in a full-width single-column stack at every viewport width. The page is protocol-wide, **not** wallet-gated — it renders fully with no wallet connected (it pulls no wallet hooks at all). Entry point: reached from the home page's "Current APY" external-link icon (`HomeStatsStrip`, Figma node `1497:94564`), not a `TopBar` slot.

**Layout** (issues #728, #744 — matches Figma `3283-12098`):

- Centred content column capped at `max-w-[1200px]` (matches the desktop frame's 1200px content width), `px-4` (16px) on mobile / `md:px-8` (32px) on desktop (matching the Figma XS 16px gutter and desktop 32px gutter), `py-8` vertical padding.
- Page background is `#F8F7F6` (`--color-pipeline-paper`); the panels live inside a white (`--color-pipeline-surface`) rounded content container (Figma `3283:12101`). The "Protocol Dashboard" title sits above the container on the page background, not inside the white surface.
- All viewports render a full-width single-column stack (`grid-cols-1`) so every panel spans the full ~1136px content width. Sections are separated by `gap-12` (48px) stepping to `md:gap-24` (96px) on larger desktop. (The previous `md:grid-cols-2` 2×2 grid was a #716 shell placeholder — Figma `3283-12098` shows a full-width vertical stack.)
- **Panel order** (Figma `3283-12098`, per coordinator decision for #720): Yield History (Charts/Yield, no section heading, Panel D, Figma `3283:67619`) → Balance Sheet (Panel A) → Loan Book / DeploymentMonitor (Panel B) → Withdrawal Queue (Panel C).
- Page title: display serif, `heading-l` (48px) on desktop stepping down to `heading-m` (28px) below `md`, matching the home page's responsive type scale.

Token discipline (per `FRONTEND.md`): no raw hex/font names; all colors and typography flow through `@pipeline/ui` primitives and theme-token utilities. The `max-w`/`min-h` pixel hints are layout sizing, not design tokens.

Figma references: [desktop](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-12098&m=dev), [responsive](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72387&m=dev).

### Diagnostics route

**Source:** `packages/frontend/src/routes/test.tsx`, `packages/frontend/src/routes/test/-scenarios.ts`

`/test` is a developer/manual-QA-only diagnostic page — intentionally **not** linked from `TopBar`.

**Three-tab layout**, driven by a TanStack Router search param (`?tab=status|mocks|toasts`; invalid values fall back to `"status"`; the active tab is reflected in the URL and survives reload):

- **Status** (default) — read-only sections surfacing runtime state: ENV, Wallet, DepositManager, USDC balance, ERC-20 approval. No buttons; pure observability.
- **Mocks** — a global "Clear mocks" button + one scenario card per meaningful app state. Clicking Enable wipes all `pipeline.mock.*` keys, seeds only the scenario's keys, and reloads the page.
- **Toasts** — trigger buttons for every toast flavour (tones, actionable, pending→resolved lifecycle, custom icon) so the restyled toasts can be eyeballed on the real site (Storybook can't render the Tailwind utilities involved).

**Scenario registry** (`test/-scenarios.ts`): each scenario is a pure data record describing a meaningful app state; the Mocks tab renders one card per scenario. Activation flow: (1) `clearAllMocks()` removes every `pipeline.mock.*` key from `localStorage`; (2) `localStorage.setItem(key, value)` for every entry in `scenario.keys`; (3) `reloadPage()` calls `window.location.reload()` so every hook re-reads its keys from a clean slate. Page reload is chosen deliberately over reactive wiring since `/test` is a developer surface where a reload is both acceptable and simpler.

Convention — every request-flow feature ships with full mock state: balance and allowance keys so the UI renders the correct CTA step; a write-side contract mock (e.g. `depositManager.requestDeposit`, `withdrawalQueue.requestWithdrawal`) so clicking Confirm settles synchronously inside the Mocks tab without falling through to a real wagmi/RPC call — shape `{ hash: "0x...", requestId?: "123" }` for deposit, `{ hash: "0x...", requestId?: "123", queued?: "0" }` for withdrawal; and API mock keys for in-flight request states (`pipeline.mock.api.GET./v1/requests`).

Addresses used across scenarios: wallet `0x1234…`, USDC `0x2222…02`, DepositManager `0x3333…03`, PLUSD `0x1111…01`, WithdrawalQueue `0x4444…04`, StakedPLUSD `0x5555…05`.
