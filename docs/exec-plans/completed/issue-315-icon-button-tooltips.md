# Issue #315: Add hover tooltips to header nav icons

Source: https://github.com/eq-lab/pipeline/issues/315

## Scope

Extend the shared `IconButton` UI primitive so it renders a small dark tooltip on hover and on `:focus-visible`, naming the destination of the icon. Apply automatically to the four header nav buttons in `TopBar` (Home / Deposit / Stats / History) via their existing `label` prop — no changes required at the `TopBar` call site. Update the `IconButton` Storybook stories so the hover state is demonstrable.

In scope:

- New tooltip layer rendered inside `IconButton`, positioned below the button, only when the user hovers or keyboard-focuses the button.
- Tooltip text comes from the existing `label` prop. Visible tooltip is decorative (`aria-hidden="true"`); `aria-label` on the button continues to provide the accessible name (no double announcement for screen-reader users).
- Tokenised styling — no hardcoded colors, sizes, or font families. Tokens: `--color-pipeline-ink` (bg), `--color-pipeline-on-dark` (text), `--text-pipeline-caption` (12px / 16px line-height), `--radius-pipeline-button` (4px — closest existing radius token; matches Figma `radius-xs` 4px exactly).
- Tooltip must not affect layout — absolutely positioned within the existing button's positioning context.
- Storybook update: add a story (or `parameters.pseudo`) that surfaces the hover state, so the design can be reviewed without driving the live app.

Explicitly out of scope:

- Renaming Deposit → Convert, Stats → Earn, History → Activity (separate change, see Issue body).
- Tooltips on the Logo or `Connect Wallet` button — Figma shows none.
- A general-purpose `<Tooltip>` primitive. The Figma usage is button-internal and trivial; introducing a generic primitive (with portal, collision detection, ARIA-described-by wiring, delay timers, etc.) is over-engineering for this slot. If a richer tooltip is needed elsewhere later, that's a separate Issue.
- Touch / pointer:coarse behaviour. Hover tooltips have no analogue on touch — the design relies on icon recognition + the `aria-label` that screen readers already announce. We do not need to expose tooltips on tap.

## Assumptions and Risks

- The four header nav buttons are the only consumers of `IconButton` today (`grep` confirms only `TopBar.tsx`). Activating the tooltip unconditionally inside `IconButton` is safe for the current call-sites, but a `showTooltip` prop (default `true`) is added so future consumers can opt out without a breaking change.
- The button needs to be a positioning context for its absolutely positioned tooltip. The current `IconButton` root has no `relative`; we will add it. No layout regression is expected because the button stays `inline-flex` 40 × 40.
- The Figma reference uses two positioning patterns (`top-[48px]` for slots 1–2 and `bottom-[-32px]` for slots 3–4) but visually both place the tooltip ~8px below the button. We will use a single rule (`top-full mt-2`) for all four slots — the issue body explicitly authorises this normalisation.
- Tooltip caption text could wrap on extreme zoom levels. We will keep `whitespace-nowrap` (matches Figma) and cap `max-w-60` (240px) so unusually long labels still wrap rather than overflow the viewport.
- The tooltip sits inside the button element. Because `aria-hidden="true"` strips it from the a11y tree, it will not cause screen readers to re-announce the label.
- Storybook v9 / Vite is the configured Storybook. There is no `@storybook/addon-pseudo-states` in `package.json` (confirmed by inspection). To demonstrate the hover state without that addon, add a dedicated story that forces visibility via a `data-force-tooltip` attribute / className escape hatch, OR simpler: render two adjacent `IconButton`s and instruct the reviewer to hover. The cleanest approach is a story whose render fn applies `style={{ '--force-tooltip': '1' }}` and the component reads that via `data-testid` — but the simplest is to rely on real hover in the story (no special wiring) and add a "Hover Showcase" story with `parameters.docs.story.height` so the tooltip is not clipped.
- No tests will be regression-breaking; the existing storybook stories continue to work because the tooltip is decorative.

## Open Questions

_None_

## Implementation Steps

1. Update `packages/ui/src/components/IconButton/IconButton.tsx`:
   - Add a new optional prop `showTooltip?: boolean` (default `true`) to `IconButtonProps`. Document it in the JSDoc block.
   - Wrap the existing chrome so the `<button>` becomes its own positioning context. Concretely: add `relative` to `baseClasses` (or, if it would conflict with the focus-ring offset, wrap the `<button>` in a `relative inline-flex` `<span>` and keep the button as the child — but `relative` on the button itself is the simpler choice and does not affect the focus ring).
   - Inside the `<button>`, after the icon `<span>`, render a tooltip element when `showTooltip && label`:
     ```tsx
     <span
       aria-hidden="true"
       data-tooltip
       className={tooltipClasses}
     >
       {label}
     </span>
     ```
   - `tooltipClasses` should encode (token-only, no hardcoded colors):
     - Position: `pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 z-10`.
     - Visibility: hidden by default, visible on `:hover` / `:focus-visible` of the button. Use group-style selectors:
       - Add `group` to the button's class list.
       - Tooltip: `opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150`.
     - Box: `inline-flex items-center justify-center p-1 min-w-12 max-w-60 rounded-[var(--radius-pipeline-button)] bg-[var(--color-pipeline-ink)] text-[color:var(--color-pipeline-on-dark)]`.
     - Type: `text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] font-[family-name:var(--font-body)] whitespace-nowrap`.
   - Keep `aria-label={label}` on the `<button>`. The visible tooltip is decorative.
   - Do not render the tooltip span when `label` is empty or `showTooltip === false`. (Edge case: `IconButton` requires `label`, so the empty-string guard is a belt-and-suspenders check.)

2. Update `packages/ui/src/components/IconButton/IconButton.stories.tsx`:
   - Existing `Active`, `Inactive`, `ActiveAndInactive` stories continue to work — hover-to-see-tooltip is now part of the demo.
   - Update the `meta.parameters.docs.description.component` text to mention the hover tooltip.
   - Increase the `ActiveAndInactive` render container so the tooltip is not clipped: bump the wrapper `padding` from 32 → 64 (vertical) and the `minHeight` if needed, so the tooltip below the buttons remains visible inside the story canvas.
   - Add a new story `HoverShowcase` that intentionally renders extra vertical padding and a hint string ("hover or focus each icon to see the tooltip") so the design can be reviewed without launching the app.

3. No changes to `packages/frontend/src/components/TopBar.tsx`. The fix is automatic via the existing `label` prop. Verify by reading the file — confirmed: `<IconButton label={item.label} … />`.

4. Lint and typecheck:
   - `yarn workspace @pipeline/ui lint` (or equivalent project-wide command).
   - `yarn workspace @pipeline/ui typecheck` if present, else `tsc -p packages/ui/tsconfig.json --noEmit`.
   - `npx tsx scripts/lint-docs.ts` (required by AGENTS.md after any TS change).

5. Storybook smoke check:
   - `yarn workspace @pipeline/ui storybook` (or repo-level Storybook command).
   - Open Components / IconButton / Hover Showcase, confirm tooltips appear on hover and on Tab-focus.

## Test Strategy

This is a pure-presentational change with no business logic. There are no existing unit tests for `IconButton` (confirmed — no `*.test.*` files in `packages/ui/src/components/`), and the repo's convention for UI primitives is visual review via Storybook + manual ux-tester on the live app. We will not introduce a one-off unit test suite for this primitive.

Verification:

1. **Storybook (visual / manual)** — required.
   - `Components / IconButton / Active`, `Inactive`, `ActiveAndInactive`, `HoverShowcase`.
   - Hover each button: tooltip fades in (150 ms) centred below the icon.
   - Tab-focus each button: tooltip appears via `:focus-visible`; clicking with the mouse and then Esc does not trigger the focus tooltip.
   - Confirm tokens: tooltip is dark ink with white caption text. No hardcoded colors visible in DevTools.
   - Confirm layout: hovering does not shift sibling buttons (absolute positioning).
2. **Frontend integration (manual)** — required.
   - Run the frontend (`yarn workspace @pipeline/frontend dev` or the project's standard command).
   - Hover each of the four header nav icons in the live TopBar: tooltip should appear below the icon naming Home / Deposit / Stats / History.
   - Tab through the header: each focused icon shows its tooltip.
   - Verify the AccountDropdown trigger and Connect Wallet button do NOT get tooltips (those are not `IconButton`s).
3. **Figma fidelity (`ux-tester`)** — required because the Issue carries a Figma reference (`2074:7187` / frame "Hovers").
   - Run `ux-tester` (or the manager's frontend-flow ux-tester step) against the rendered TopBar with the Figma node.
   - Acceptance: tooltip background = `--color-pipeline-ink`, text = caption / white, position centred-below with ~8 px gap, no layout shift.
4. **A11y sanity** — required.
   - The button retains its `aria-label`.
   - The tooltip element has `aria-hidden="true"` so it does not produce a duplicate announcement.
   - With NVDA / VoiceOver (or a Chrome DevTools Accessibility tree spot-check) confirm only the button label is announced.
5. **Regression**:
   - Existing `Active` / `Inactive` / `ActiveAndInactive` stories continue to render with the active-brand and muted-ink states unchanged.
   - `TopBar` active-state derivation continues to highlight the current route — unaffected.

## Docs to Update

- No `docs/product-specs/` change required — this is a pure visual / UX refinement of an existing primitive, not a new product behaviour.
- No `docs/design-docs/` change required — Figma is the authoritative design reference and the relevant node ID is captured in the Issue and in this plan.
- `IconButton.tsx` JSDoc block updates inline (covered in step 1).
- `IconButton.stories.tsx` description text updates inline (covered in step 2).
- After implementation, move this exec plan from `docs/exec-plans/active/` to `docs/exec-plans/completed/` per the manager's archive step.
