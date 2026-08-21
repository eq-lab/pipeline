# UI components

Design and behavior specs for the shared component library in `packages/ui/src/**` — surface
primitives, typography-bearing components, icons/illustrations, and input widgets consumed by the
LP app (`packages/frontend`) and the Trustee panel (`packages/trustee`). This is the home for
Figma-binding and design-intent knowledge that previously lived as inline comments and docblocks —
see [`docs/FRONTEND.md` → Code structure rules, rule 6](../FRONTEND.md#code-structure-rules).

Cross-cutting rules stay in their existing homes and are referenced, not restated, here:
typography-token responsive behavior in [`docs/FRONTEND.md`](../FRONTEND.md), the error-UX pattern
(`InlineError`, `ErrorDetailsDialog`, `StepRow` error slot) in
[`error-handling.md`](./error-handling.md), and the network-switch dialog flow in
[`wallet-flows.md`](./wallet-flows.md#network-switcher-cross-deployment-links).

> **Status:** migrated (#998, part of epic
> [#991](https://github.com/eq-lab/pipeline/issues/991)). Do not delete a source comment until its
> content lives in a section below. `styles/theme.css` keeps its definition-site token/license
> comments by design (rule-6 compliant: short constraints at the definition, not flow narration).

Sections are alphabetical by component. Each covers the component's role, its Figma bindings
(nodes, tokens, px values), and any design decisions that shaped its API. Three components have no
section here because their specs live in the flow docs above: `ErrorDetailsDialog` and
`InlineError` (error-handling.md) and `NetworkSwitchDialog` (wallet-flows.md).

## ActivityEmptyIllustration

**Source:** `packages/ui/src/components/ActivityEmptyIllustration/ActivityEmptyIllustration.tsx`.

Striped square silhouette for the Recent-activity empty state — Figma node `1497:94570` (file
`A43rjYYjSwdTmiwwf5cx5n`). The artwork ships as
`packages/ui/src/assets/illustrations/striped-activity-empty.svg` (downloaded in Issue #202).

- **Rendering technique:** rather than inlining the ~90 stroke paths into a React tree, the
  component paints the SVG as a CSS `mask-image` over a `currentColor` background. The `tone`
  prop swaps the fill between ink tokens without duplicating SVG paths, and the artwork
  preserves its intrinsic 240 × 240 (`1 / 1`) aspect ratio at any rendered width.
- **Sizing:** intrinsic size 240 × 240 px; the default `width` of 240 matches the Figma `IMG`
  slot in the Recent-activity `Placeholder` frame. `width` accepts a number (px) or any CSS
  length; height always tracks via `aspect-ratio: 1 / 1`.
- **Tone semantics:**
  - `muted` (default) — strokes in `--color-pipeline-ink-muted`; the production use for the
    Recent-activity empty state.
  - `primary` — strokes in `--color-pipeline-ink`; available for future surfaces needing a
    high-contrast variant of the same silhouette.
- **Not `WalletIllustration`:** distinct from `WalletIllustration` (Figma node `1497:94556`,
  313.672 × 200 landscape striped wallet with a coin-slot detail). Use `WalletIllustration`
  for the Connect Wallet promo card; use this component for the Recent-activity empty state.
- **Accessibility:** purely decorative — renders with `aria-hidden="true"` and conveys no
  meaning by itself; meaning is provided by the surrounding `EmptyState` caption.
- **Reuse points:** Recent activity empty state (Figma node `1497:94570`) — muted tone,
  width 240.

## ActivityHeader

**Source:** `packages/ui/src/components/ActivityHeader/ActivityHeader.tsx`.

Responsive header displayed above the transaction list on the Activity page. Two treatments
driven by the `md` (768 px) breakpoint:

- **Mobile (< 768 px)** — Figma node `1993-9592`: full-width flex column, left-aligned
  (`items-start`); the `HeroIcon` with `icon="arrow-clock"` is **hidden**; heading is
  `heading-m` 28 px / 36 px, Besley Regular (400), left-aligned.
- **Desktop (≥ 768 px)** — Figma node `1497-94912`: centered flex column (`items-center`);
  `HeroIcon` `arrow-clock` (72 × 72 px muted-fill circle) above the heading; heading is
  `heading-m` 28 px / 36 px, Besley Regular (400), centered.

Weight decision: Besley Regular (`font-normal`) at **both** breakpoints, matching
`DepositHeader` per maintainer confirmation ("regular at both").

### Figma → token mapping

- `--font-display` — Besley serif typeface.
- `--text-pipeline-heading-m` / `--text-pipeline-heading-m--line-height` — 28 px / 36 px.
- `--color-pipeline-ink` — primary ink colour.
- Root is `w-full` so left-alignment fills the row on mobile; `gap-3` between icon and
  heading. No raw hex codes, sizes, or hard-coded font names outside token references.

### Implementation note (CSS precedence)

The `hidden md:block` visibility toggle lives on a plain wrapper `<div>` around `HeroIcon`,
not on `HeroIcon` itself: `HeroIcon` applies its own `inline-flex` Tailwind utility, which
shares the `display` property with `hidden` and compiles later in the stylesheet, so passing
`hidden md:block` directly to `HeroIcon` would leave the circle visible on mobile (same
CSS-precedence class as Issue #547 / `CoinIcon`).

Accessibility: the `HeroIcon` is decorative by default; the heading is a semantic `<h2>` so
it integrates into the page heading hierarchy. Default `title` is `"Activity"`.

## ActivityIcon

**Source:** `packages/ui/src/components/ActivityIcon/ActivityIcon.tsx`. Figma reference:
node `1497-94912`.

40 × 40 tonal tile that leads every transaction row: a 20 px glyph centered inside a 40 × 40
square tile with `--radius-pipeline-card` corner radius.

- **Tones** (tile background + glyph colour, `tone` prop, default `neutral`):
  - `success` — green fill (`--color-pipeline-success`), white glyph (completed state).
  - `warning` — amber/gold fill (`--color-pipeline-warning`), white glyph (pending state).
  - `neutral` — muted gray fill (`--color-pipeline-fill-muted`), dark muted glyph — no
    colour inversion.
- **Icon map** (`icon` prop):
  - `check-circle` — completed / success transaction.
  - `clock-pending` — pending transaction.
  - `arrow-up-circle` — send / withdraw.
  - `arrow-down-circle` — receive / deposit.
  - `exchange` — exchange / swap.
- **Glyph colouring:** the monochrome SVG glyph is tinted with a CSS filter —
  `brightness(0) invert(1)` for the white-on-fill tones, `brightness(0)` for neutral.
- **Accessibility:** decorative by default (`aria-hidden="true"`); passing an explicit
  `aria-label` makes it meaningful (`role="img"`). Fallback alt labels per icon:
  Completed / Pending / Sent / Received / Exchange.

## ActivityRow

**Source:** `packages/ui/src/components/ActivityRow/ActivityRow.tsx`. Figma reference:
node `1497-94912`.

Single row in the activity list. Horizontal flex row with a top border separator:

- Leading `ActivityIcon` (40 × 40 ink tile; `icon` and `tone` are forwarded — the tone union
  is re-exported here as `ActivityRowTone`, the icon union as `ActivityIconName`).
- Two-line content block: title (Body 16/22) + timestamp (Caption 12/16).
- Right-aligned `amount` slot (`shrink-0`) — accepts any `ReactNode` so callers can pass an
  `<AmountPill>` (success rows) or a custom two-line block (stake / unstake / convert /
  pending rows).

`ActivityRow` is intentionally dumb — no per-state styling logic lives in the row.

### Acceptance criteria / token mapping

- Top border uses the secondary border token (`--color-pipeline-line`); 16 px top padding
  (`pt-4`).
- 12 px gap (`gap-3`) between icon and content; content block uses `flex-1 min-w-0`.
- Title truncates with ellipsis when it overflows (e.g. `"PLUSD → USDC"`).
- Timestamp (e.g. `"Apr 17, 2:17 PM"`) uses the secondary-ink token
  (`--color-pipeline-ink-muted`); both text lines use `--font-body` at regular weight.
- Right slot is right-aligned with `shrink-0`.
- No raw colors or raw sizes.

## AmountPill

**Source:** `packages/ui/src/components/AmountPill/AmountPill.tsx`. Figma reference:
node `1497-94912`.

Static, non-interactive ink-filled pill displaying a formatted amount string (e.g.
`+500.00 USDC`) with white (on-dark) text. Used on the right side of success transaction
rows.

Intentionally non-interactive: renders as a `<span>` with no hover, focus, or disabled
state — use `Button` for clickable pill-shaped controls.

### Figma → token mapping

- `--color-pipeline-ink` — ink fill background.
- `--color-pipeline-on-dark` — white text on the ink background.
- `rounded-full` — fully-rounded pill radius (per Figma).
- `--font-body` — Graphik LC body typeface.
- `--text-pipeline-body` (+ line-height) — 16 px body size.
- `--font-weight-emphasized` — 600 semi-bold weight.
- Padding `px-3 py-1`; `whitespace-nowrap select-none` keeps the amount on one line and
  non-selectable.

## Button

**Source:** `packages/ui/src/components/Button/Button.tsx`. A shorter variant/size summary
also lives in [`docs/FRONTEND.md` → Component library → Button](../FRONTEND.md).

Five variants, matching Figma frame `1497-94556` and the toast spec `1497:95175`:

- **`primary-dark`** — 48 px tall rect, ink/CTA background (`--color-pipeline-cta`,
  #262524). Matches the header "Connect Wallet" button (node `1497:94725`) and the
  "Connect" CTA inside the wallet card (node `I1497:94566;1360:49021`).
- **`primary-blue`** — 48 px tall rect, navy/cobalt brand background
  (`--color-pipeline-brand`, #000080). Visual sibling of `primary-dark`; differs only in
  fill colour. Matches the "Connect"/"Buy" CTAs (node `1497:94689` etc.). Default variant.
- **`secondary`** — 48 px tall pure ghost rect: transparent fill, **no border**, ink-primary
  label (Figma nodes `1497:94688–90`). Used for the "Sell" action in `StartHereCard` (node
  `1497:94690`), rendered with the `disabled` prop at opacity 0.32 (matching Figma
  opacity-32) to signal the action is not yet available.
- **`circular-blue`** — 128 px round CTA (`size-32`, pill radius), brand/navy background.
  Matches the "Stake" button (node `1497:94713`). Disabled state (node `1497:95069`):
  fill `rgba(184,191,190,0.12)` (Figma `fill-test/primary` in this mode — no theme token
  holds this value, so the literal is used) and label `--color-pipeline-ink-subtle`
  (`content-test/tertiary`); hover is suppressed back to the same fill.
- **`toast-action`** — compact CTA for right-aligned actions inside toasts (Figma node
  `1497:95175` — "Stake" CTA). White fill, ink text, 32 px tall, 4 px radius
  (`radius/radius-s`), Body Emphasized label. No explicit focus ring-offset colour is
  needed: the toast's outer surface is always dark/coloured and serves as the ring backdrop
  (`ring-offset-0`).

Common rules:

- All variants use design tokens from `@pipeline/ui/styles/theme.css` — no raw colours.
- Label uses the Body Emphasized type style (Graphik LC 16/22, weight 600).
- Focus-visible rings: `--color-pipeline-brand` for the dark/blue rectangles;
  `--color-pipeline-ink` for `circular-blue`, `secondary`, and `toast-action` (which sit on
  light/dark cards), so the ring always has sufficient contrast.
- Hover/active states are `color-mix` lighten/darken blends of the variant fill.
- The inner `<span>` label wrapper mirrors the Figma "Label" inset: `px-2` at default size,
  `px-1` (4 px) at compact size.

### Size variants (rectangular variants only: `primary-dark`, `primary-blue`, `secondary`)

- `"default"` (omitted) — 48 px tall (the design's L).
- `"m"` — 40 px tall, 8 px box (`px-2`) + 8 px inner label (`px-2`) = 16 px per side, matching
  Figma node `1497:94689` (LP review size reference — home Buy/Sell and the promo card
  Connect, epic #1145). Radius and colours are unchanged.
- `"compact"` — 32 px tall with tighter horizontal padding: 6 px box (`px-1.5`) + 4 px inner
  label (`px-1`), matching Figma node `1994-7226` (inline banner CTAs such as the wallet
  banner "Connect" button; the design's S). Radius and colours are unchanged.

## Card

**Source:** `packages/ui/src/components/Card/Card.tsx`.

Surface primitive — controls fill, border, radius, and inner padding only. Children render
unstyled so callers compose their own layout (heading rows, value stacks, CTAs) on top of
the surface. All visual values come from design tokens in `@pipeline/ui/styles/theme.css`
(no raw colours). Radius is `--radius-pipeline-card` (4 px), mirroring the Figma card
frames.

### Variants

- **`white`** (default) — paper-white surface (`--color-pipeline-surface`, #ffffff) with a
  subtle hairline border in `--color-pipeline-line`. Used for Get PLUSD (node
  `1497:94567`), Stake (node `1497:94707`), Earned, Recent activity, QnA cards, and the
  outer container that wraps the dashboard (node `1497:94565`). Figma frame `1497-94556`.
- **`yellow`** — pale yellow promo surface (`--color-pipeline-promo`, #F8FCE9 — the solid
  Figma value from issue #606) with the same hairline border so it sits visually alongside
  the white surfaces. Matches the Connect Wallet promo card (node `1497:94688`) on the
  deposit/stake pages and the home dashboard.
- **`muted`** — slightly-grey surface (`--color-pipeline-paper`, #f8f7f6) that visually
  recedes behind white surfaces; border from `--color-pipeline-line`. Used for step rows in
  the deposit/conversion flow — the `StepsCard` container (Figma node `1498-100130`).
  `StepsCard` overrides individual border side widths to produce the asymmetric 1 px
  top/left + 3 px right/bottom effect from that node; generic muted cards keep a uniform
  1 px border.
- **`danger`** — red danger surface (`--color-pipeline-danger`, #c0392b) with white text
  (`--color-pipeline-on-danger`) and a matching red border. Used for error/unreachable
  banners on `/withdraw` and `/deposit`.

### Tailwind v4 specificity design (Issue #357)

Three deliberate structural choices avoid Tailwind v4 equal-specificity conflicts:

- `danger` is a **first-class variant**, not a caller-appended class override — appended
  `bg-[var(--color-pipeline-danger)]` classes can lose to the white variant's
  `bg-[var(--color-pipeline-surface)]` rule at equal specificity.
- **Padding is a first-class prop**: it is NOT in `baseClasses`; each instance gets exactly
  one padding utility injected from the `paddingClasses` map, so no same-specificity
  competitor exists for a caller className to lose to.
- **Text colour lives per-variant**, not in `baseClasses`, so the danger variant can
  override it without a competing text-colour utility at the same specificity.

### Padding map

- `"none"` — 0 px (`p-0`). Caller manages all internal padding via child elements (e.g.
  multi-section cards where each section has its own padding).
- `"sm"` — 8 px (`p-2`). Mobile home small cards (StartHere, Earned, Stake) per Figma frame
  `1989:8292`.
- `"md"` — 16 px (`p-4`). Mobile home promo card (`ConnectWalletPromoCard`) per Figma frame
  `1989:8292`.
- `"lg"` — 24 px (`p-6`). Default; matches every desktop card and all consumers that don't
  pass an explicit padding value.

## CoinIcon

**Source:** `packages/ui/src/components/CoinIcon/CoinIcon.tsx`.

Displays a USDC, PLUSD, or sPLUSD coin icon at a fixed size. All three tokens render from
real vector SVG assets imported via Vite's `?url` mechanism, matching the approach used for
`HeroIcon` (Issue #238). Vector assets landed in Issues #246 and #534; PLUSD was vectorised
in Issue #535 (Figma node `910:10281`).

### Size map (contexts from the Figma spec)

- `sm` (20 px) — wallet pill / conversion-card row.
- `md` (24 px) — default / general use.
- `lg` (40 px) — `TokenInput` / `TokenAmountDisplay` row icon.
- `xl` (72 px) — `DepositHeader` hero slot (Issue #595).

### Behavior notes

- **Accessibility:** decorative by default (`aria-hidden="true"`, empty `alt`); passing an
  explicit `aria-label` makes the icon meaningful to assistive tech (`role="img"`).
- **Display handling (Issue #547):** the default `block` display is applied as a _class_,
  never as an inline style, so callers can override it with responsive Tailwind utilities
  (e.g. `className="hidden md:block"`) — class-based rules share specificity and the
  caller's classes appear later in the stylesheet, whereas an inline `display` style would
  out-rank the utilities and break responsive hiding. `flexShrink: 0` is applied inline so
  the icon never squashes in flex rows.

## ConversionCard

**Source:** `packages/ui/src/components/ConversionCard/ConversionCard.tsx`. Figma
reference: node `1498-100130` (input section, file `A43rjYYjSwdTmiwwf5cx5n`); swap button
node `1498-100157`.

Full conversion UI card — two white cards stacked vertically with a 2 px gap, with a
swap-direction button straddling the seam.

### Card A (top) — sell side

`TokenInput` (USDC token row + quick-amount chips) inside a white wrapper matching Figma
node `1498:100136` ("input-sum-inline"):

- Background `--color-pipeline-surface` (white); corner radius `--radius-pipeline-card`
  (4 px — Issue #595 changed this from 16 px); padding 16/16/24/16
  (`pt-4 pr-4 pb-6 pl-4`); **no border** (Figma shows none).
- The wrapper carries `relative` (the outer flex wrapper deliberately does not) so the
  absolutely-positioned swap button anchors to this card's bottom edge via `top-full`.
- The input receives `signPrefix="−"`: the minus sign (outflow) shows when a non-zero value
  is present, while the underlying input value stays positive.

### Card B (bottom) — receive side

`TokenAmountDisplay` (PLUSD token row) **plus** the nested "Exchange rate" / "Network fee"
`InfoRow` details block, both inside a single white `Card` so the details are visually
nested within the PLUSD card, matching Figma node `1498-100135`.

- `TokenAmountDisplay`'s self-styling (border, background, radius, padding) is suppressed
  via inline styles so it renders flush inside Card B without a nested border. Its padding
  becomes `16px 0 0` — no left/right padding (Issue #595 fix 6); bottom padding is handled
  by `TokenAmountDisplay`'s own `pb-8` default.
- `border-0` removes the white Card's default hairline border (fix 8, Issue #595).
- The output value is prefixed with `+` when non-zero (purely visual); zero values stay
  un-prefixed to match the Figma "0" placeholder state.

### Swap button (Figma node `1498-100157`)

Absolutely positioned over the 2 px seam between the two cards: anchored to the bottom edge
of Card A's wrapper (`top-full`), shifted up by half its own height (`-translate-y-1/2`),
and centered horizontally (`left-1/2 -translate-x-1/2`). Styling:

- `rounded-[4px]` — square-ish corners, not a full pill.
- 32 × 32 (`size-8`) — a quiet recessed affordance, not a boxy chip.
- Fill `--color-pipeline-fill-muted` (subtle gray, same family as the USDC panel); hover
  `--color-pipeline-surface-muted`; **no visible border** — the design omits the hairline.
- Cursor-pointer + focus ring consistent with the TopBar pill trigger;
  `disabled:opacity-50 disabled:cursor-not-allowed`.
- Rendered with the HTML `disabled` attribute when `onSwap` is omitted or the input side's
  `disabled` prop is true, so it cannot fire during an in-flight wallet action.
  (`onSwap` toggles direction, deposit ↔ withdraw.)

### Token roles

- `--color-pipeline-surface` — white card fill (Card `white` variant and Card A wrapper).
- `--color-pipeline-fill-muted` / `--color-pipeline-surface-muted` — swap button fill /
  hover fill.
- `--color-pipeline-line` — card border.
- `--color-pipeline-ink-muted` / `--color-pipeline-ink` — InfoRow label / value colour
  (via `InfoRow`).
- `--radius-pipeline-card` — 4 px card corner radius (via `Card`; Issue #595).

## DepositHeader

**Source:** `packages/ui/src/components/DepositHeader/DepositHeader.tsx`. The deposit-page
mobile treatment is also summarized in
[`docs/FRONTEND.md` → Responsive behavior](../FRONTEND.md#responsive-behavior).

Responsive header displayed above the deposit / conversion card. Two treatments driven by
the `md` (768 px) breakpoint:

- **Mobile (< 768 px)** — Figma node `1993:7911`: full-width flex column, left-aligned
  (`items-start`); coin icon **hidden**; heading `heading-m` 28 px / 36 px, Besley
  Regular (400), left-aligned.
- **Desktop (≥ 768 px)** — Figma node `1498:100130`: centered flex column (`items-center`);
  large PLUSD coin icon (`CoinIcon` `xl` = 72 px) above the heading; same heading type,
  centered.

Weight decision: Besley Regular (`font-normal`) at both breakpoints — per Figma desktop
node `1498:100130` and the confirmed human answer overriding the plan's Q2.

### Figma → token mapping

- `--font-display` — Besley serif typeface.
- `--text-pipeline-heading-m` / `--text-pipeline-heading-m--line-height` — 28 px / 36 px.
- `--color-pipeline-ink` — primary ink colour.
- Root is `w-full` so left-alignment fills the row on mobile; `gap-3` between icon and
  heading; `mb-8` (32 px) provides the required bottom spacing (fix 2, Issue #595).
- No raw hex codes, sizes, or hard-coded font names outside token references.

Default `title` is `"1:1 Conversion"`. Accessibility: the coin icon is decorative
(`aria-hidden="true"`); the heading is a semantic `<h2>` so it integrates correctly into
the page heading hierarchy beneath the dashboard's `<h1>`.

## EmptyState

**Source:** `packages/ui/src/components/EmptyState/EmptyState.tsx`.

Generic centred "no data yet" placeholder used inside a parent container (Card, panel,
section body) when a list or surface has nothing to show yet. The dashboard's Recent
activity card is the canonical example — Figma frame `1497-94556` → node `1497:94569`
`Placeholder`, with the caption "You will see all transactions here".

Pure composition primitive — no surface fill, border, padding, or radius. The parent
(typically `Card`) supplies the chrome; all visual values come from the design tokens in
`@pipeline/ui/styles/theme.css`.

### Layout (mirrors the Figma `Placeholder` frame)

- Two-row vertical stack, centred horizontally and vertically inside the parent container.
  The parent gives the EmptyState its height; the block stretches to fill via
  `h-full w-full` so it centres on the available space — mirroring
  `flex-[1_0_0] items-center justify-center` from Figma node `1497:94569`.
- **`illustration` slot** (optional) — usually a 240 × 240 SVG (e.g.
  `ActivityEmptyIllustration` from Issue #202). EmptyState does not constrain the slot's
  size, so the illustration owns its own dimensions; the slot renders above the caption
  with no enforced gap (matches Figma, which lets the illustration's intrinsic height drive
  the spacing). Optional so callers can render a caption-only empty state.
- **`caption` slot** (required — every empty state in the Figma frame carries a caption) —
  body-size muted ink, centred. Matches Figma node `1497:94665` (Figma tokens
  "font/line-height/body" 22 px and "content-test/secondary"), i.e.
  `--text-pipeline-body` (+ line-height) and `--color-pipeline-ink-muted`. Accepts a
  `ReactNode` so callers can compose multi-line strings — the Recent activity copy in
  Figma is rendered as two `<p>` lines.

## HeroIcon

**Source:** `packages/ui/src/components/HeroIcon/HeroIcon.tsx`.

Page-hero badge rendered above a page heading — a 72 × 72 px muted-fill circle with a 36 px
ink-tinted icon centered inside (see the Activity hero in Figma node `1497-94912`). Built as a
generic primitive so future page heroes can reuse it by extending the `HeroIconName` string-literal
union (currently `"arrow-clock" | "chart"`; the `chart` glyph reuses `nav-stats.svg`).

### Visual spec (Figma nodes `1497-94912`, `1497-95313`)

- **Outer circle** — 72 × 72 px, `--color-pipeline-fill-muted` background, fully rounded
  (`--radius-pipeline-pill`).
- **Icon slot** — 36 × 36 px, painted with an ink token via CSS mask.

### Per-icon tint (ink roles)

The two icons deliberately use different ink tokens so their _composed_ opacity matches the design:

- `chart` — `--color-pipeline-ink-subtle` directly (the SVG bakes no opacity).
- `arrow-clock` — full `--color-pipeline-ink`, because the SVG asset bakes `fill-opacity="0.3"`;
  full ink composed with the baked opacity lands at ~0.3.

### Tint technique

The icon assets use `fill="currentColor"`, so the component tints them by applying the SVG as a
CSS mask on a `<span>` and setting `background-color` to the ink token — the same pattern used by
the nav icon buttons (see `IconButton.stories.tsx → MaskIcon`).

### Accessibility

Decorative by default (`aria-hidden="true"`). Passing an explicit `aria-label` makes the element
meaningful to assistive tech (it then renders with `role="img"`).

## IconButton

**Source:** `packages/ui/src/components/IconButton/IconButton.tsx`.

40 × 40 square button used for the four navigation icons in the top bar (Figma frame `1497-94556`
→ nodes `1497:94719` / `94720` / `94721` / `94722`). It renders the supplied `icon` — a 24 × 24
ReactNode, typically an `<img>`, `<svg>`, or imported icon component — centered inside a
transparent slot, and applies an accessible `aria-label` derived from `label`.

### Visual states

- `active` — icon coloured with `--color-pipeline-brand` (navy/cobalt).
- inactive — icon coloured with `--color-pipeline-ink-subtle` (content/tertiary; was `ink-muted` — LP review #1, #1147).

The icon is coloured via `color` on the button, so SVGs using `currentColor` (the convention for
the nav icons) pick up the active/inactive state automatically. Raster `<img>` icons must be
supplied pre-coloured.

### Chrome

The button is intentionally borderless and transparent at rest — hover, focus-visible, and active
states layer on top:

- Hover background is a faint tint of the ink colour (`color-mix` 8 % ink; 14 % while pressed) so
  the affordance is visible against both the light card and paper backgrounds.
- Hover and focus-visible reuse the brand focus ring used by the rectangular `Button` variants.
- The icon sits in a fixed 24 px slot mirroring the Figma icon container, so layout is stable
  regardless of which icon is supplied.

### Tooltip

When `showTooltip` is `true` (the default) and `label` is non-empty, a small dark caption tooltip
fades in below the button on `:hover` and `:focus-visible`:

- Centred below the button with an ~8 px gap (`mt-2`); `min-w-12` / `max-w-60`;
  `--radius-pipeline-button` radius; ink background with `--color-pipeline-on-dark` text; caption
  type in the body family; single line (`whitespace-nowrap`).
- The tooltip is `aria-hidden="true"` — screen-reader users already receive the label via
  `aria-label` and must not hear it announced twice.
- Set `showTooltip={false}` to opt out for consumers that supply their own tooltip layer or where
  a tooltip would be distracting.

## InfoRow

**Source:** `packages/ui/src/components/InfoRow/InfoRow.tsx`.

Label-on-left, value-on-right row. Used for the `Exchange rate` and `Network fee` lines at the
bottom of the conversion card (Figma nodes `1498-100130` / `1498-99897`).

- **Layout** — horizontal flex row filling the full width: label in muted ink
  (`--color-pipeline-ink-muted`) on the left, value in primary ink (`--color-pipeline-ink`) on the
  right.
- **Type** — body size (16 px / 22 px) per Figma node `1498-99897`, applied to all InfoRow
  instances (Issue #595 fix 7).
- **Test ids** — each row derives a stable `data-testid` from its label
  (`info-row-exchange-rate`, `info-row-network-fee`) so the two rows rendered inside a
  `ConversionCard` stay individually addressable; a caller-supplied `data-testid` still wins.

## LinkCard

**Source:** `packages/ui/src/components/LinkCard/LinkCard.tsx`.

Row used in the QUESTIONS & ANSWERS section (Figma frame `1497-94556`, nodes `1497:94669` /
`1497:94671` / `1497:94673`). A label on the left and an arrow-up-right icon on the right; the
whole row is a focusable anchor.

### Visual structure

- Top border hairline (`--color-pipeline-line`) separating rows.
- Label text in Body style (`--text-pipeline-body`), muted ink in the resting state, transitioning
  to full ink on hover/focus; single line with ellipsis truncation.
- Arrow-up-right icon — a 12.5 × 12.5 inline SVG painted with `currentColor`, so it tracks the
  text colour and brightens with the label. It sits inside a fixed 24 px container that mirrors
  the Figma drill-in node (`.drill-in`, `1497:94670;8902:3678`) so the icon is optically centered
  inside a consistent touch target.
- Minimum row height 40 px, vertical padding 8–9 px (mirrors Figma).
- Focus ring mirrors the pattern used by `Button` and `IconButton`.

## Logo

**Source:** `packages/ui/src/components/Logo/Logo.tsx`.

Inline SVG rendering of the "Pipeline" wordmark from the top-left of Figma frame `1497-94556`.

### Design decisions

- **Inlined paths, not a URL import.** The SVG paths are inlined directly (rather than loaded via
  a Vite URL import) so the component is self-contained — no external request, no build-system
  dependency on SVGR — and can be themed via `currentColor`.
- **Sizing.** Intrinsic size matches the Figma asset: 116 × 32 (a 29:8 aspect ratio). Callers can
  override the rendered width via the `width` prop (px number or any valid CSS length); height
  scales proportionally because the `<svg>` uses `viewBox` preservation rather than fixed
  dimensions — a numeric width gets a computed proportional `height` attribute, while string
  widths (`"100%"`, `"8rem"`) pass through and let the viewBox keep the shape.
- **Colour.** The wordmark paints with `currentColor`, defaulting to the brand navy token
  (`--color-pipeline-brand`). Override by passing a `className` (e.g.
  `text-[color:var(--color-pipeline-paper)]` for a dark surface) or a `style={{ color }}` value.

### Accessibility

Rendered with `role="img"` and `aria-label="Pipeline"` so screen readers announce the brand name.
Pass `aria-label` to override — and when the component is used inside a link to the home route,
the parent anchor usually owns the label, so the SVG should be hidden instead: set `aria-hidden`
to avoid a double announcement.

## NavIcon

**Source:** `packages/ui/src/components/NavIcon/NavIcon.tsx`.

Inline SVG icons for the five top-bar navigation slots. The icons are rendered as inline `<svg>`
elements so they inherit `fill="currentColor"` from the surrounding CSS `color` property — this
makes them fully responsive to `IconButton`'s active/inactive state without requiring a CSS mask
or any URL import at all.

### Supported names

| Name        | Glyph                | Figma asset                                    |
| ----------- | -------------------- | ---------------------------------------------- |
| `"home"`    | filled house         | `nav-home.svg`                                 |
| `"deposit"` | dollar-in-circle     | `nav-dollar.svg`                               |
| `"stats"`   | three bar-chart bars | `nav-stats.svg` (three separate path elements) |
| `"history"` | clock with arrow     | `nav-history.svg` (two separate path elements) |
| `"overview"` | pie chart           | `nav-overview.svg` (three separate path elements, #1125) |

All path data is lifted verbatim from the SVG assets in `packages/ui/src/assets/icons/`.

### Sizing and usage

`size` defaults to 24 to match the 24 × 24 icon slot inside `IconButton`:

```tsx
<IconButton icon={<NavIcon name="home" />} label="Home" active />
```

## QuickAmountChip

**Source:** `packages/ui/src/components/QuickAmountChip/QuickAmountChip.tsx`.

Selectable amount pill used in the conversion card. Renders as a `<button type="button">`
slightly-rounded rectangle chip without a border. Matches Figma node `1497-95326` ("suggestion bar
chip") in file `A43rjYYjSwdTmiwwf5cx5n`, which uses `radius-s` = 4 px (Issue #614).

### Variants

- **Default** — unselected state with primary ink label (no border).
- **Selected** — filled with surface and primary ink.
- **Special label** — `"Max"` (same visual; the distinction is semantic, in the label only).

### Issue #595 decisions

- White chip fill (`--color-pipeline-surface`) on the gray container, no border.
- Caption size (12 px), regular weight.
- Primary ink text colour for **both** selected and unselected states.

### Label contract

`label` carries display text such as `"$1,000 (Min)"`, `"$5,000"`, `"Max"` — whole-dollar amounts
omit the `".00"` suffix.

### Design tokens used

- `--color-pipeline-surface` — chip fill (white on gray container)
- `--radius-pipeline-card` — 4 px radius (`radius-s` per Figma)
- `--color-pipeline-paper` — focus-ring offset
- `--color-pipeline-ink` — label colour (selected and unselected)
- `--color-pipeline-brand` — focus-visible ring
- `--font-body`, `--text-pipeline-caption`, `--font-weight-regular`

## SegmentedTabs

**Source:** `packages/ui/src/components/SegmentedTabs/SegmentedTabs.tsx`.

A purely presentational segmented-control / filter bar. The owning page manages active state; the
component is visual-only (`onSelect` fires only when an _inactive_ tab is clicked).

### `"track"` variant (default)

Anatomy (Figma node `1497-94917`):

- **Container pill** — muted-fill background (`--color-pipeline-fill-muted`, the same fill token
  as `HeroIcon`), 2 px padding around the tabs, `radius-xl` (6 px — matches Figma
  `var(--radius/radius-xl, 6px)`), full width.
- **Active tab** — paper-white background (`--color-pipeline-surface`), `radius-s` (4 px), primary
  ink label.
- **Inactive tabs** — transparent background, secondary-ink label
  (`--color-pipeline-ink-muted`).
- All tabs equal-width (`flex-1`), 32 px tall, 6 px horizontal padding (Figma `size-6`),
  caption-emphasized type style (Graphik LC Medium 12/16).

### `"floating"` variant

Compact, right-aligned pill style with **no outer track**. Used for chart time-range selectors
(e.g. `7D 1M 3M 1Y All` in the Portfolio chart card):

- No container background — tabs sit directly on the card surface.
- Active tab: white pill (`--color-pipeline-surface`) with subtle shadow, medium-weight caption
  text.
- Inactive tabs: transparent, muted gray caption text (regular weight), no background.
- Tabs size to their label (intrinsic width, no `flex-1`), 28 px tall, 8 px horizontal padding,
  4 px radius.

### Design tokens used

- `--color-pipeline-fill-muted` — track container background (track variant)
- `--color-pipeline-surface` — active tab background
- `--color-pipeline-ink` — active tab label colour
- `--color-pipeline-ink-muted` — inactive tab label colour
- `--font-body` — Graphik LC family
- `--text-pipeline-caption` — 12 px font size
- `--text-pipeline-caption--line-height` — 16 px line height
- `--font-weight-medium` — weight 500 (Caption Emphasized)

## StakeHeader

**Source:** `packages/ui/src/components/StakeHeader/StakeHeader.tsx`.
**Figma:** node `1497-95313`. **Consumer:** the Stake page — centered header displayed above the
stake card. Issue #612.

A vertically-stacked flex column, centred on both axes:

- `HeroIcon` with `icon="chart"` (72×72 px muted-fill circle) above the heading, with a small gap
  (`gap-3`). The icon is decorative (`aria-hidden`).
- Display-serif heading at the `heading-m` scale (28 px / 36 px line-height). Figma node
  `1497-95313` specifies **Besley Regular (font-weight 400), not Bold**.
- `mb-8` (32 px) bottom margin matches `DepositHeader`'s bottom spacing so the header → card gap is
  consistent across the Stake and Deposit pages (Issue #612).
- No fixed width on the root — it fills its parent.

### Tokens

- `--font-display` — Besley serif typeface.
- `--font-weight-regular` — 400 (Besley Regular, per Figma node `1497-95313`).
- `--text-pipeline-heading-m` / `--text-pipeline-heading-m--line-height` — 28 px / 36 px.
- `--color-pipeline-ink` — primary ink colour.

No raw hex codes, sizes, or hard-coded font names are used outside of token references.

### Accessibility

The heading is a semantic `<h2>` so it integrates correctly into the page heading hierarchy. The
`title` prop defaults to `"Earn 8.42% p.a."`.

## Stat

**Source:** `packages/ui/src/components/Stat/Stat.tsx`.
**Figma:** frame `1497-94556` → nodes `1497:94561` "Exchange rate", `1497:94562` "Total Value
Locked", `1497:94563` "Current APY". **Consumer:** the dashboard header stats strip.

Small "label above value" readout primitive. One of the stats in the strip is paired with an
external-link icon — `Stat` exposes an optional `trailingIcon` slot rendered inline after the value
so callers can compose that pairing without a wrapping element.

### Layout

Matches the Figma `Content` node (e.g. `I1497:94561;8901:3390`):

- Two-row stack, right-aligned, baseline-free — each row owns its own line-height so the rows align
  visually with the icon.
- Label row: 12 / 16 body (`--text-pipeline-caption`), muted ink, `whitespace-nowrap`. A minimum
  row height keeps the row stable when the label is short (mirrors the Figma min-w-full /
  line-height behaviour).
- Value row: 16 / 22 body (`--text-pipeline-body`), muted ink, with an optional 24×24 trailing icon
  rendered to the right with a 4 px gap (matches the Figma `TitleCont` gap). The row's `min-h-6`
  mirrors Figma `TitleCont` (node `I1497:94561;8901:3392`) so the strip baselines stay aligned even
  when the value is short.
- The trailing icon slot is a fixed 24×24 container (matches the Figma icon container) so layout is
  stable regardless of which icon node is supplied. `trailingIcon` is used by the APY stat, which
  pairs with an external-link affordance; callers should prefer SVG that paints with `currentColor`
  so the icon inherits the value's ink colour.

### Design decisions

The component is a pure readout — it owns typography and alignment only. No surface fill, border,
or padding; the parent strip handles the dividing left border (see node `1497:94562`). All visual
values come from the design tokens declared in `@pipeline/ui/styles/theme.css`. The `value` prop
accepts a `ReactNode` so callers can mix in inline formatting (units, deltas) while keeping the
typography token consistent.

## StepRow

**Source:** `packages/ui/src/components/StepRow/StepRow.tsx`.
**Figma:** node `1498-100694` (card-horizontal / List item) — node
`I1498:100694;8980:3384;1498:100676` (step 1, disabled), node
`I1498:100694;8980:3384;1498:100685` (step 2, disabled). **Consumer:** rendered inside `StepsCard`.

Numbered step row: a numbered square (e.g. `1`) + a label (e.g. "Allow contract to use USDC") + a
trailing action `Button` (e.g. "Approve" / "Convert").

The error-UX pattern for the error slot (`InlineError`, `ErrorDetailsDialog`, `errorDetails` "View
details" trigger) is specified in [`error-handling.md`](./error-handling.md) and the step error
state in [`wallet-flows.md#step-error-state`](./wallet-flows.md#step-error-state) — not restated
here.

### Layout

- Root: `flex items-center gap-3`, full width. `items-center` vertically centers the step badge,
  label, and action button within the row; when the label wraps to two lines the badge and button
  align to the mid-point of the label block, which matches the Figma intent.
- Step badge: 40 × 40 px numbered square with muted fill (`--color-pipeline-line`), card radius —
  matches the Figma `image` node. Number is body-family, `heading-s` scale, bold, primary ink.
- Label: body 16 / 22, regular, primary ink, `flex-1 min-w-0`. Labels are allowed to **wrap** so
  long step descriptions (e.g. "Allow Pipeline to use USDC") remain fully readable on mobile —
  a `truncate` utility previously clipped them at the 402 px mobile width and was removed.
- Action wrapper: `shrink-0 p-1` — matches the Figma `ButtonCont` node.
- Action button: `primary-dark` `Button` overridden from the default 48 px height to the 32 px
  height used in the step card (Figma button size: 32 px × 88 px).

### States

- **Disabled** (`disabled`): matches Figma — the entire row renders at 30 % opacity (`opacity-30`)
  and the action button additionally receives the HTML `disabled` attribute so it is inert. The
  30 % opacity applies only when the row is _not_ in a success/error/loading state — those always
  render at full opacity so the user can see the check badge / error line / spinner clearly.
- **Loading** (`loading`): the action button is disabled and shows an inline CSS-only spinner
  (16 px ring in `--color-pipeline-on-dark` with transparent top, `animate-spin`) to communicate a
  pending transaction. Full row opacity is kept.
- **Success** (`state="success"`): keeps the numeric step badge on the left and replaces the action
  button on the right with a wide green pill (32 px tall, `w-22`, button radius,
  `--color-pipeline-positive-secondary` fill) containing a centred check icon — Figma node
  `1497-95272`. The check icon is a 20×20 viewport stroke in `--color-pipeline-positive`;
  `strokeWidth` 2.5 matches the medium-heavy Figma weight (node `1498:100802;9285:26314`), and the
  path spans the full usable height so the glyph clearly reads inside the 32 px pill.
- **Error** (`state="error"`): red-tinted badge (`rgba(192, 57, 43, 0.12)` fill, number in
  `--color-pipeline-negative`) + the `errorMessage` line under the label; the action button is
  **kept** so the user can retry. See
  [`wallet-flows.md#step-error-state`](./wallet-flows.md#step-error-state).

## StepsCard

**Source:** `packages/ui/src/components/StepsCard/StepsCard.tsx`.
**Figma:** node `1498-100130` (StepsCard container with two step rows). **Consumer:** the
deposit/conversion screen, guiding the user through a numbered sequence of on-chain actions
(e.g. Approve token spend, then Convert).

A thin wrapper that renders a list of `StepRow` items inside a `muted` `Card` surface.

### Layout

- The card's inner padding (`p-6`) comes from `Card`.
- Step rows are stacked with a `gap-2` (8 px) gutter matching the Figma spacing.
- **Asymmetric border** per Figma node `1498-100130`: 1 px on left + top, 3 px on right + bottom —
  producing a subtle "stamped" elevation effect. Border colour is inherited from the muted
  variant's border-color token (`--color-pipeline-line`).

### Props

`steps` — ordered array of step descriptors; each entry maps 1:1 to a `StepRow`, with step numbers
derived from the array index (1-based). Minimum two items expected (Approve + Convert), but the
component accepts any number. Each item forwards `label`, `actionLabel`, `disabled`, `onAction`,
`loading`, `state`, `errorMessage`, and `errorDetails` to `StepRow` (see [StepRow](#steprow) for
their semantics; the error slot is specified in [`error-handling.md`](./error-handling.md)).

## Toast

**Source:** `packages/ui/src/components/Toast/Toast.tsx`.
**Figma:** Success (claim, actionable) — node `1497:95175`; Success (stake, informational) — node
`1497:95270`. **Consumers:** rendered by `<ToastProvider>` / emitted via `useToast()` (see
`docs/FRONTEND.md` → Toast notifications and `docs/frontend/hooks.md`).

Pipeline UI notification: a near-rectangular surface (4 px radius, `--radius-pipeline-card`) with
16 px padding (`p-4`), a 20 px leading icon, and a Body-weight title. Two visual shapes:

- **Informational** — icon + title text.
- **Actionable** — same surface plus a right-aligned action button (the `toast-action` `Button`
  variant), rendered only when the `action` prop is provided.
- **Dismissable (#1142)** — an optional `onDismiss` prop renders a trailing × button
  (`data-testid="toast-dismiss"`, `aria-label="Dismiss"`) after the action slot, on **all tones
  including `pending`** so a stuck pending toast can always be cleared by hand. `ToastProvider`
  wires it to `dismiss(id)` for every stacked toast; auto-dismiss timing is unchanged.

The title sits between the icon and the button with 8 px horizontal padding (`px-2`) providing the
gap to both.

### Tones

Four tones, each mapping to a `--color-pipeline-*` fill token:

- `neutral` → `--color-pipeline-ink` (dark)
- `success` → `--color-pipeline-positive-primary` (green `#208000`)
- `danger` → `--color-pipeline-danger` (red)
- `pending` → `--color-pipeline-ink-muted` (muted; applied as the raw `rgb(56 55 53 / 0.6)` value
  because the token is rgba)

Text/icons paint in `--color-pipeline-on-dark` on all tones.

### Default icons

Icons render at 20 px to match the restyled toast (Figma node `1497:95270`):

- `success` → a plain checkmark (Figma node `1497:95270`).
- `neutral` / `danger` → a circle-enclosed check (`check-circle`).
- `pending` → a clock glyph (`clock-pending`).

Pass the `icon` prop to override (e.g. a token glyph for a claim toast).

### Accessibility

- `danger` → `role="alert"` + `aria-live="assertive"`.
- All other tones → `role="status"` + `aria-live="polite"`.

## TokenAmountDisplay

**Source:** `packages/ui/src/components/TokenAmountDisplay/TokenAmountDisplay.tsx`.
**Figma:** node `1498-100130` (PLUSD side of the conversion card). **Consumer:** the PLUSD
(output) side of the conversion card, where the value is computed, not entered.

Read-only counterpart to `TokenInput`. Renders the same top-half layout as `TokenInput`:

- Token coin icon (`CoinIcon` at lg / 40 px) + token label + balance subtitle on the left.
- A large display-serif numeric value on the right — display only, mirrors `TokenInput`'s
  `<input>` visual style (display family, 24 px / 28 px, `--color-pipeline-ink-subtle`,
  right-aligned, `select-all`).

No interactive elements, no `<input>`. `token` accepts `"usdc" | "plusd" | "splusd"`; `tokenLabel`,
`balanceLabel`, and `value` are pre-formatted strings.

### Layout

- Outer card: white fill, subtle 1 px border, card radius. **No horizontal padding** (`px-2` was
  removed — Issue #595 fix 6); `pt-4` top and `pb-8` (32 px) bottom spacing (Issue #595 fix 6).
- Token label: body 16 / 22, regular, primary ink, single-line ellipsis.
- Balance subtitle: caption 12 / 16, regular, muted ink, single-line ellipsis.
- The value cell exposes an `aria-label` (`"<tokenLabel> amount: <value>"`) while the visual span
  is `aria-hidden`.

### Tokens

`--color-pipeline-surface` (card fill), `--color-pipeline-line` (border), `--color-pipeline-ink`
(primary text), `--color-pipeline-ink-muted` (balance subtitle), `--color-pipeline-ink-subtle`
(numeric value colour — matches the `TokenInput` placeholder), `--radius-pipeline-card`,
`--font-display` / `--font-body`, `--text-pipeline-*` size/line-height pairs,
`--font-weight-regular`.

## TokenInput

**Source:** `packages/ui/src/components/TokenInput/TokenInput.tsx`.
**Figma:** node `1498-100136` (USDC value container) in file `A43rjYYjSwdTmiwwf5cx5n`.
**Consumer:** top half of the conversion card.

Renders:

- Token coin icon (`CoinIcon` at lg / 40 px) + token label + balance subtitle on the left.
- A large display-serif numeric input on the right (right-aligned, with a caret indicator).
- A row of `QuickAmountChip` buttons below.

Originally shipped styling-only (a real `<input>` for accessibility, no controlled-value logic,
validation, or formatting); controlled mode was added later via the optional `value` /
`onValueChange` pair — when `value` is provided the input is controlled, otherwise it stays
uncontrolled and existing call sites render unchanged.

### Layout

- Outer panel: subtle gray fill (`--color-pipeline-fill-muted`), 1 px hairline border
  (`--color-pipeline-line`), 8 px radius, uniform 8 px padding, `gap-8` between the input row and
  the chip row.
- Token label: body 16 / 22, regular, primary ink, single-line ellipsis. Balance subtitle: caption
  12 / 16, regular, muted ink, single-line ellipsis.
- Numeric input: display serif, 24 px / 28 px, right-aligned, transparent background with no native
  border/outline. Placeholder digits and typed value paint in `--color-pipeline-ink-subtle`; the
  caret is a thin ink-coloured bar (`--color-pipeline-ink`). The focus ring belongs on the overall
  card, not the input itself, so the input suppresses its own focus outline
  (`--color-pipeline-brand` is the focus-visible ring token).
- Quick-amount chips stretch equally (`flex-1`) across the full row width.

### Interaction (Issue #595)

- **Click-to-focus (fix 3b):** clicking anywhere on the top row focuses the numeric input, guarded
  so a disabled input is never focused and a click directly on the input is not double-focused.
- **Identity alignment (fix 3a):** when the sign prefix is shown the left identity block aligns
  `justify-start` with the sign/number; when hidden (value `"0"` or no `signPrefix`) it switches to
  `justify-center` to vertically center the USDC identity.

### Props / contracts

- `signPrefix` — optional sign rendered visually to the left of the numeric input in the same
  display-serif style (e.g. `"−"` for outflow). Purely presentational: never part of the `<input>`
  value passed back via `onValueChange`, and only shown when `value` is non-empty and not `"0"`.
  The prefix span carries no width or text-alignment overrides so it is sized to its content and
  sits flush against the first digit (the input uses `field-sizing: content` for the same reason).
- `disabled` — disables the numeric input and all chips (e.g. wallet disconnected or data not yet
  loaded); call sites that omit it render an enabled input unchanged.
- `QuickAmountItem.disabled` — disables an individual chip (e.g. the amount input is locked to an
  active on-chain request); forwarded to `QuickAmountChip`, which already handles the disabled
  visual state natively via `disabled:opacity-50 disabled:cursor-not-allowed`. Existing call sites
  that omit it render unchanged.
- `inputTestId` — optional `data-testid` applied directly to the inner numeric `<input>` (the
  component's own `...rest` spread targets the wrapper `<div>`), the supported way to give tests a
  stable handle on the field itself.
- The input's `size={8}` keeps it wide enough for typical amounts while collapsing naturally.

## WalletIllustration

**Source:** `packages/ui/src/components/WalletIllustration/WalletIllustration.tsx`.
**Figma:** frame `1497-94556`; the artwork ships as
`packages/ui/src/assets/illustrations/striped-wallet.svg` (downloaded in Issue #39).

Striped line-art wallet decoration.

### Rendering approach

Rather than inlining the ~50 stripe paths into a React tree, the component paints the SVG as a CSS
`mask-image` over a `currentColor` background:

- The illustration is colored via `currentColor`, which lets the `tone` prop swap the fill between
  the primary-ink (`primary`) and muted-ink (`muted`) tokens without duplicating SVG paths.
- The artwork preserves its intrinsic **313.672 × 200** aspect ratio (~1.5684 : 1) at any rendered
  width.

### Sizing

Callers control the rendered width via the `width` prop — a number becomes a pixel value, a string
passes through untouched (`"100%"`, `"20rem"`, …). Height scales proportionally via
`aspect-ratio`. Default width is the Figma intrinsic width of 314 (rounded from 313.672).

### Tones and reuse points

- `primary` — strokes in the primary ink token (`--color-pipeline-ink`). Used by the Connect
  Wallet promo card (large).
- `muted` — strokes in the neutral muted ink token (`--color-pipeline-ink-muted`). Used by the
  Recent activity empty state (smaller).

### Accessibility

Purely decorative — always renders with `aria-hidden="true"`; meaning is conveyed by the
surrounding card (Connect Wallet promo) or empty-state copy (Recent activity).

## WalletPill

**Source:** `packages/ui/src/components/WalletPill/WalletPill.tsx`.
**Figma:** node `1498:100168` ("button" in the header "Buttons" group). **Consumer:** the top-right
connected-wallet chip in the header.

Renders a small `CoinIcon` at the `sm` size (20 px) alongside a pre-formatted balance string
(e.g. `"$10,000.00"`) inside a rounded white pill with a subtle border. Supported tokens:
`"usdc"`, `"plusd"`, `"splusd"`.

This is a purely visual element (`<div>`); interactive behaviour (click to open the wallet menu)
was deferred to a later issue — desktop `AccountDropdown` behavior is described in
`docs/FRONTEND.md` → Responsive behavior.

### Layout and tokens

- Pill: `--color-pipeline-surface` white fill, `--radius-pipeline-pill` full-round ends, border
  `rgba(56 55 53 / 0.18)` (border-test/secondary). Height 48 px / `px-3` — the same bar height as
  the other header buttons.
- Balance label: Body Emphasized — Graphik LC Semi Bold 16 / 22 (`--font-body`,
  `--font-weight-emphasized`), primary ink (`--color-pipeline-ink`), `whitespace-nowrap`, `px-2`
  gap around the text.
