# Issue #474: Mobile home: cards use 24px padding vs Figma 16px (promo) / 8px (small cards)

Source: https://github.com/eq-lab/pipeline/issues/474

## Scope

On the mobile home layout (below the Tailwind `md` breakpoint, validated at 402px viewport, wallet disconnected — Figma frame `1989:8292`), all four home cards render the shared `Card` primitive's hardcoded `p-6` (24px) interior padding. Figma's mobile spec is denser:

| Card | Figma node | Figma mobile padding | App today | Target (Tailwind) |
|---|---|---|---|---|
| `ConnectWalletPromoCard` (promo) | `1989:9173` | **16px** (`--size-16`) | 24px | `p-4` |
| `StartHereCard` | `1989:9008` | **8px** (`--size-8`) | 24px | `p-2` |
| `EarnedCard` | `1989:9023` | **8px** (`--size-8`) | 24px | `p-2` |
| `StakeCard` | `1989:9032` | **8px** (`--size-8`) | 24px | `p-2` |

Padding values verified directly against the Figma design context for node `1989-8292` (promo card = `p-[var(--size-16,16px)]`; all three small cards = `p-[var(--size-8,8px)]`).

**In scope:** step the four home cards' interior padding down on mobile only — 16px for the promo card, 8px for the three small cards — while preserving the existing desktop (`md+`) 24px padding. The same component instances render in both the mobile `md:hidden` block and the desktop `hidden md:block` block of `packages/frontend/src/routes/index.tsx`, so the fix must be responsive (base = mobile value, `md:` = 24px) and must not regress desktop.

**Out of scope:**
- Card heading type scale (tracked in #473, branch `fix/473-mobile-card-heading-sizes`). This plan must NOT touch the heading `<h2>`/`<p>` typography class arrays inside the four components (see Assumptions/Risks — conflict avoidance).
- Card heights (the issue notes heights are off, but they are a *consequence* of padding + the #473 heading scale; do not hardcode new heights here). The existing `min-h-[256px]`/`min-h-[224px]` mobile floors stay as-is.
- Button sizes (#475-#477), copy (#478), cards-row overflow (#479), promo graphic (#480), heading-to-card gap (#481), header (#482).
- Desktop layout, the desktop outer wrapper `Card` (`className="hidden p-8 md:block"` in the route), and the `muted`/`danger` card consumers elsewhere in the app.

## Assumptions and Risks

- **Tailwind v4 equal-specificity hazard (primary risk).** The `Card` primitive bakes `p-6` into its `baseClasses` (`packages/ui/src/components/Card/Card.tsx`, line ~47) and appends caller `className` *after* the variant classes. Appending a *smaller* padding utility (`p-2`/`p-4`) to override `p-6` is the exact failure class documented for this repo in Issue #357 (caller-appended same-property utilities lose to baseClasses when the cascade order favors the base). Tailwind v4 orders padding utilities by their numeric scale in the generated stylesheet, so `p-6` is emitted *after* `p-2`/`p-4` and would win — silently leaving 24px. The existing `p-8` override on the desktop outer card works only because `p-8` sorts *after* `p-6`; stepping *down* is the untested, risky direction. The plan's preferred approach therefore changes the `Card` primitive rather than relying on a className override (Open Question Q1). This must be validated in the browser, not jsdom (jsdom does not evaluate Tailwind's generated CSS cascade).
- **Conflict with #473 (same four files).** #473 (planned, not yet implemented; branch `fix/473-mobile-card-heading-sizes` currently contains only its plan doc) will edit the heading typography class arrays inside `ConnectWalletPromoCard.tsx`, `StartHereCard.tsx`, `StakeCard.tsx`, `EarnedCard.tsx`. To keep the two changes mergeable, **this plan deliberately concentrates the padding change in the `Card` primitive and the route's per-instance `className`**, and—where a per-component edit is unavoidable—touches only the top-level `composed` class array (the `border-*` block), never the heading `<h2>`/`<p>` elements #473 edits. The two issues touch disjoint regions even within shared files.
- 8px / 16px map cleanly to Tailwind's default scale (`p-2` = 8px, `p-4` = 16px), so no new spacing design token is required. `docs/FRONTEND.md` mandates tokens for color/radius/typography but not spacing — Tailwind's numeric padding scale is the established idiom in this codebase.
- The promo card and StakeCard set `overflow-hidden`; reducing padding pulls the absolutely-positioned `WalletIllustration` / circular CTA slightly closer to the edges. This matches Figma (the artwork bleeds off-edge by design) but should be eyeballed during verification.
- Reducing padding will shrink card content boxes; combined with #473's smaller headings the cards approach the Figma silhouette. Exact height parity is #473+#474 together and is not a pass/fail gate for this issue in isolation.

## Open Questions

- **Q1 (mechanism — recommended path chosen, but worth a human nod):** To avoid the #357 equal-specificity hazard when stepping padding *down* from the baked-in `p-6`, the preferred implementation adds a first-class `padding` control to the `Card` primitive (a `padding?: "sm" | "md" | "lg"` prop or equivalent, default `"lg"` = current `p-6`, mapping `sm`→`p-2`, `md`→`p-4`), set in a class map like the `variant` map so there is no competing same-specificity rule from `baseClasses`. The four cards then pass a responsive padding (mobile value with a `md:` reset to `lg`). Is the Card-primitive change acceptable, or does the team prefer the lighter-touch responsive-`className` override (`p-2 md:p-6` / `p-4 md:p-6`) on each card despite the documented override-direction risk? The plan defaults to the primitive change (robust, no regression risk) and notes the className fallback. **This is the only design decision the planner could not settle alone; recommend the primitive change.**

## Implementation Steps

The exact mechanism depends on the Q1 answer. Preferred (primitive) variant is described first; the className fallback follows.

### Preferred variant — first-class `padding` on the `Card` primitive

1. `packages/ui/src/components/Card/Card.tsx`:
   - Remove `p-6` from `baseClasses` (line ~47) so padding is no longer baked into the base rule.
   - Add a `CardPadding` type (`"sm" | "md" | "lg"`) and a `paddingClasses` map: `sm: "p-2"` (8px), `md: "p-4"` (16px), `lg: "p-6"` (24px). Mirror the existing `variantClasses` pattern.
   - Add `padding?: CardPadding` to `CardProps`, default `"lg"` (preserves every current consumer's 24px padding with no other change).
   - Compose padding into the className string *before* the caller `className`, in the same array as `baseClasses`/`variantClasses`, so a caller can still override with a responsive utility if needed. Update the JSDoc comment block (lines ~38-48) which currently says "24px inner padding" to describe the new prop and its default.
   - Because the responsive step-down is per-breakpoint, the cleanest call is for consumers to pass a responsive *className* on top of the `lg` default rather than a single `padding` enum (the enum cannot express `md:`). So: keep the `padding` prop for static cases (and to remove the baked-in `p-6` from base), and have the four home cards pass a responsive className. See step 3. (If the team prefers a `responsivePadding` boolean or a richer prop API, raise it under Q1 — the plan keeps the prop minimal.)
2. Confirm no regression for existing `Card` consumers: the new default `padding="lg"` reproduces `p-6` exactly. Audit consumers that already pass a `p-*` className (the desktop outer card in `routes/index.tsx` passes `p-8`; `routes/stake.tsx` passes no padding override). With `p-6` no longer in `baseClasses`, the outer card must now read `padding="lg"`-equivalent overridden by its own `p-8` className — verify `p-8` still wins (it sorts after `p-6`, and there is no longer a base `p-6` at all, so `p-8` applies cleanly). Adjust the `p-8` site only if the audit shows a gap.
3. In `packages/frontend/src/routes/index.tsx`, the **mobile block** instances (lines ~175-214) get a responsive padding className that sets the mobile value and resets to desktop at `md:`. The **desktop block** instances (lines ~245-274) need no padding className (they inherit the `lg` default). Concretely, append to each mobile-instance `className`:
   - `ConnectWalletPromoCard` (mobile, ~182): `p-4 md:p-6` (16px → 24px).
   - `StartHereCard` (mobile, ~195): `p-2 md:p-6` (8px → 24px).
   - `EarnedCard` (mobile, ~202): `p-2 md:p-6`.
   - `StakeCard` (mobile, ~206): `p-2 md:p-6`.
   With `p-6` removed from `baseClasses`, these responsive utilities now have no same-specificity competitor in the base rule, so the override is safe in both directions. The desktop-block instances of the same components keep the `lg` default (24px) — verify they are genuinely separate DOM nodes (they are: mobile div is `md:hidden`, desktop card is `hidden md:block`).
   - Note: because the mobile and desktop instances are distinct nodes, an even simpler option is to pass the static `padding` prop on the mobile instances (`padding="sm"` / `padding="md"`) with no className and rely on `md:hidden` to never show them at desktop. This avoids responsive utilities entirely. The coder may choose this if it reads cleaner; document the choice. Either way desktop instances stay at `lg`.
4. Do **not** edit the heading typography elements inside the four card components (reserved for #473). If a card component must change at all, restrict edits to its top-level `composed` class array (the `border-*`/layout block), not the `<h2>`/`<p>` heading class arrays.

### Fallback variant — responsive className only (no primitive change)

Only if Q1 = "do not change the Card primitive": append `p-4 md:p-6` (promo) / `p-2 md:p-6` (three small cards) to each mobile-instance `className` in `routes/index.tsx`. Because `p-6` remains in `baseClasses`, the coder MUST verify in a real browser (not jsdom) that the smaller `p-2`/`p-4` actually wins over the baked-in `p-6` at the mobile breakpoint. If it does not win (the #357 cascade hazard), escalate back to the primitive change — do not paper over with `!p-2`/`!p-4` important hacks without flagging it, and if `!important` is used, log a tech-debt entry per `AGENTS.md`.

### Common closing steps

5. Run `npx tsx scripts/lint-docs.ts` (required after any TypeScript/docs change per `AGENTS.md`).
6. Type-check and run the frontend unit tests (see Test Strategy).

## Test Strategy

- **Unit / type-check:** `yarn workspace @pipeline/frontend test` and `tsc`; if the primitive changes, `yarn workspace @pipeline/ui` build/type-check too. Existing tests (`packages/frontend/src/components/Card.danger.test.tsx`, route tests) must stay green — the new `padding` prop defaults to the current behavior, so no existing assertion should change.
  - Optionally add a small unit test to `Card.danger.test.tsx` (or a new `Card.padding.test.tsx`) asserting: default Card className contains `p-6`; `padding="sm"` contains `p-2` and not `p-6`; `padding="md"` contains `p-4`. (className-presence assertions only — jsdom does not resolve the Tailwind cascade, so do not assert computed pixel padding in jsdom.)
- **Figma-driven visual verification (primary gate):** run the app, set the viewport to 402px (mobile), wallet disconnected, and compare computed `padding` against Figma frame `1989:8292`:
  - `ConnectWalletPromoCard` root → computed `padding: 16px`.
  - `StartHereCard`, `EarnedCard`, `StakeCard` roots → computed `padding: 8px`.
  - Then resize to ≥768px (`md`) and confirm all four cards restore `padding: 24px` and the desktop grid is visually unchanged.
  - Sanity-check the connected mobile states too (frames `1988:7074` empty, `1984:6501` plusd, `1886:46777` splusd) since the same instances render there — padding should be identical across states.
  - Confirm the promo `WalletIllustration` and StakeCard circular CTA still clip correctly to the rounded edge after padding shrinks (no overflow artifacts).

## Docs to Update

- No product-spec change required — pure visual `fix/`, no user- or agent-facing behavior change.
- `docs/FRONTEND.md` — if the `Card` primitive gains a `padding` prop, add a one-line note in the component/primitives section documenting the prop, its default (`lg` = 24px), and the mobile step-down for home cards. If only the route className changes (fallback path), no FRONTEND.md change is needed.
- `docs/exec-plans/tech-debt-tracker.md` — only if the fallback path resorts to `!important` overrides; otherwise no entry.
