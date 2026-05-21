# Issue #328: UX: Activity hero icon renders as black square on /transactions

Source: https://github.com/eq-lab/pipeline/issues/328

## Scope

Fix the shared `HeroIcon` rendering path so the `/transactions` Activity header
shows the arrow-clock glyph inside the 72x72 muted circular badge, matching
Figma node `1497:94912` in file `A43rjYYjSwdTmiwwf5cx5n`.

In scope:

- `packages/ui/src/components/HeroIcon/HeroIcon.tsx` - diagnose and fix the
  current mask/image rendering behavior for `icon="arrow-clock"` and preserve
  the existing `chart` variant used by `StakeHeader`.
- `packages/ui/src/components/ActivityHeader/ActivityHeader.tsx` - verify the
  header still renders `HeroIcon icon="arrow-clock"` above the `Activity`
  heading with the existing accessible/decorative behavior.
- `packages/frontend/src/components/HeroIcon.test.tsx` - strengthen the
  regression coverage beyond URL-string assertions so it catches the current
  black-square failure mode as directly as jsdom allows.
- `/transactions` manual verification against the Figma reference.

Out of scope:

- Redesigning the Activity page, transaction tabs, rows, empty state, or
  navigation.
- Replacing masked artwork globally outside `HeroIcon`.
- Changing product copy or transaction data behavior.

## Assumptions and Risks

- Figma context from MCP: node `1497:94912` shows a 72x72 muted-fill circle
  containing a 36x36 `arrow-clock` glyph above the centered `Activity` heading.
  The glyph is visible and light/muted, not a filled square.
- The current source already imports `arrow-clock.svg?url` and uses longhand
  `WebkitMaskImage` / `maskImage` properties in `HeroIcon.tsx`. That means the
  older #238/#245 fixes may be present in source while the bug remains
  reproducible in the browser, so the coder must verify runtime DOM/computed
  styles before choosing the final fix.
- If the browser still renders a solid square while longhand mask properties are
  present, the safest local fix is to render the small SVG glyph directly as an
  image or inline SVG element tinted with existing tokens, instead of relying on
  CSS mask behavior for `HeroIcon`. Keep the public `HeroIcon` API unchanged.
- `packages/ui` is source-only and consumed by `packages/frontend`; asset
  handling is resolved by the frontend Vite pipeline. Test both dev and build
  paths because stale dist output or Vite asset differences can hide this class
  of regression.
- This is frontend-only and stays within `packages/ui` plus frontend tests. It
  does not affect Rust crates, API contracts, wallets, or protocol logic.

## Open Questions

_None_

## Implementation Steps

Progress:

- [x] 1. Reproduced the issue on `/transactions` before editing.
- [x] 2. Fixed `HeroIcon` mask rendering while keeping the public API stable.
- [x] 3. Confirmed `ActivityHeader` remains a thin composition over
  `HeroIcon`.
- [x] 4. Updated focused `HeroIcon` regression coverage.
- [x] 5. Audited adjacent masked components without changing them.
- [x] 6. Manually verified the fixed page.

1. Reproduce the issue on the active branch before editing:
   - Start the frontend with `yarn front:dev`.
   - Open `http://127.0.0.1:5177/transactions` if the dev server chooses that
     port, or the actual Vite port printed by the command.
   - Inspect the inner `HeroIcon` element above `Activity`: record
     `element.style.maskImage`, `element.style.WebkitMaskImage`,
     `getComputedStyle(element).maskImage`, the rendered dimensions, and whether
     the network-loaded `arrow-clock.svg` or data URI is valid.
2. Fix `packages/ui/src/components/HeroIcon/HeroIcon.tsx` while keeping the
   exported `HeroIconName`, props, sizing, `aria-hidden` default, and
   `aria-label` behavior stable:
   - If runtime shows mask longhands are missing, repair the React style object
     so the DOM receives `WebkitMaskImage`, `maskImage`, repeat, position, and
     size longhands.
   - If runtime shows mask longhands are present but the badge still paints a
     square, replace only the inner glyph render with a deterministic SVG image
     or inline SVG path approach. Use existing `arrow-clock.svg?url` /
     `nav-stats.svg?url` assets where practical, size the glyph at 36x36, and
     keep the outer circle styles and tokens unchanged.
   - Avoid new dependencies such as SVGR unless a no-dependency path is not
     viable.
3. Confirm `ActivityHeader` remains a thin composition over `HeroIcon`:
   - `packages/ui/src/components/ActivityHeader/ActivityHeader.tsx` should still
     render a decorative `HeroIcon icon="arrow-clock"` and an `h2` with
     `Activity`.
   - Do not introduce `/transactions`-specific icon logic into
     `ActivityHeader` or the route.
4. Update regression tests in `packages/frontend/src/components/HeroIcon.test.tsx`:
   - Keep existing asset URL integrity coverage for `arrow-clock.svg?url` and
     `nav-stats.svg?url`.
   - Add assertions for whichever final rendering path is chosen: either the
     longhand mask style properties are present on the inner span, or the image
     / inline SVG element has the expected source, dimensions, decorative
     attributes, and token-driven color/filter styling.
   - Keep tests for 72x72 outer sizing, 36x36 inner glyph sizing, decorative
     default behavior, and `aria-label` promotion to `role="img"`.
5. Audit adjacent masked components for unintended changes:
   - Read `ActivityEmptyIllustration.tsx` and `WalletIllustration.tsx`; they are
     known-good examples of mask longhands and should not be changed unless the
     chosen fix intentionally extracts a local helper.
   - Verify `ActivityIcon` remains unaffected because it renders icons through
     `<img>` tiles, not `HeroIcon`.
6. Manually verify the fixed page:
   - `/transactions` shows the muted 72x72 Activity badge with the arrow-clock
     glyph visible, not a black square.
   - The badge remains centered above `Activity`, and the transaction tab/list
     layout is unchanged.
   - Compare against Figma node `1497:94912`; include a screenshot or DevTools
     evidence in the PR/hand-off notes.

## Test Strategy

- Run the focused test file:
  `yarn workspace @pipeline/frontend test packages/frontend/src/components/HeroIcon.test.tsx`
- Run the frontend test suite:
  `yarn workspace @pipeline/frontend test`
- Run frontend and UI lint after TypeScript changes:
  `yarn workspace @pipeline/frontend lint`
  `yarn workspace @pipeline/ui lint`
- Run documentation lint because the repo requires it after TypeScript work:
  `npx tsx scripts/lint-docs.ts`
- Build the frontend to exercise Vite production asset handling:
  `yarn workspace @pipeline/frontend build`
- Manual browser check on `/transactions` in the Vite dev server with DevTools
  computed-style inspection and a visual comparison against Figma node
  `1497:94912`.

## Docs to Update

_None_
