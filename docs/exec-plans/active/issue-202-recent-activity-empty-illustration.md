# Issue #202: Home: Recent activity empty-state illustration reuses the striped-wallet asset; Figma uses a different 240×240 SVG

Source: https://github.com/eq-lab/pipeline/issues/202

## Scope

The Recent activity card's empty state currently reuses `WalletIllustration` (the 313.672 × 200 landscape striped-wallet asset shipped in Issue #39 / #48), tinted muted. Figma node `1497:94570` is a distinct **240 × 240 square** striped illustration — not the wallet-with-coin-slot. This plan replaces the empty-state illustration in `RecentActivityCard` with the correct Figma asset while keeping `ConnectWalletPromoCard` untouched (it correctly uses the landscape striped-wallet).

In scope:

- Add the new 240 × 240 striped-square SVG to `packages/ui/src/assets/illustrations/` (kebab-case filename, committed locally — no external Figma CDN URLs, per the #39 convention).
- Introduce a new exported UI primitive — `ActivityEmptyIllustration` — in `@pipeline/ui` that mounts the new asset via the same CSS-mask + `currentColor` technique used by `WalletIllustration`, with a `1 / 1` aspect ratio and a default width of 240.
- Update `packages/frontend/src/components/RecentActivityCard.tsx` to render `ActivityEmptyIllustration` instead of `WalletIllustration` (the muted ink colour is achieved via the new primitive's `tone="muted"` prop or by hardcoding the muted-ink token — see Implementation Steps).
- Add a Storybook story for the new component covering its single default tone (muted) on the white card surface.
- Update `EmptyState.stories.tsx` only if its preview captures the wallet-tone variant that no longer matches what the dashboard renders. Inspect the file; if it merely uses a placeholder it can stay as-is.

Out of scope:

- Visual / structural changes to `EmptyState` itself.
- Any changes to `WalletIllustration`, `ConnectWalletPromoCard`, or other consumers of the landscape striped-wallet.
- Tone API rework. The new component only needs the muted variant in production today; we'll still expose `tone: "primary" | "muted"` for parity with `WalletIllustration` so future surfaces (e.g. a primary-ink variant of the same square) don't require a refactor.

## Assumptions and Risks

- **Asset access.** The Figma MCP asset URL in the Issue body (`https://www.figma.com/api/mcp/asset/875ee187-8daa-4a3d-a118-ea476cc3b39f`) expires within ~7 days, so the implementer must re-fetch the SVG via Figma MCP (`get_design_context` on node `1497:94570`, file `A43rjYYjSwdTmiwwf5cx5n`) at implementation time rather than relying on the URL pasted in the Issue.
- **Asset transparency in mask rendering.** `WalletIllustration` uses `mask-image` on a `<span>` with `background-color: currentColor`, which paints `currentColor` *only* through the SVG's opaque pixels. The Figma SVG declares `stroke-opacity="0.3"` to achieve the muted appearance; under a CSS mask, that 0.3 alpha is preserved by the mask compositing, so applying `tone="muted"` (which sets `color: var(--color-pipeline-ink-muted)`) on top of the 0.3 stroke alpha would compound the dimming. **Mitigation:** strip `stroke-opacity="0.3"` from the SVG before committing it (so the mask carries full alpha) and let the `--color-pipeline-ink-muted` token alone drive the muted appearance. This matches how `WalletIllustration` derives its tone today and keeps a single source of truth for muted-ink darkness. If a side-by-side Storybook comparison shows the new asset reads as too dark vs. Figma even at `muted`, fall back to keeping `stroke-opacity` in the SVG and use the `primary` tone token instead.
- **Path stroke vs. fill.** The Figma asset is built from `<path>` elements with `fill` (not `stroke`) per the snippet in the Issue body — i.e. the "strokes" are actually filled paths. This is good news for the mask approach: `fill` produces opaque silhouettes that mask cleanly. Verify on download — if the asset actually uses `<path stroke="…" />`, the mask still works as long as the strokes are not `fill="none"` with opacity issues.
- **Aspect-ratio change.** The wallet asset was rendered at `aspectRatio: 313.672 / 200`. The new asset must render at `1 / 1`. If the card layout had any width assumptions tied to the old aspect ratio, the empty state may shift vertically. Mitigation: the existing `RecentActivityCard.tsx` already pins `width={240}` and the card body is centred via `EmptyState`'s flex container, so a 240 × 240 footprint should land in the same visual spot or higher (the new asset is taller than the previous 240-wide × ~153-tall render). Verify in the screenshot test.
- **Naming.** The Issue suggests `striped-activity-empty.svg` and `ActivityEmptyIllustration`. Sticking to these names matches the established `<descriptor>-<context>.svg` / `<Subject>Illustration` patterns and avoids a bike-shed.
- **No spec / docs file describes empty-state illustration sources today.** The change is small enough not to warrant a spec doc, but the component JSDoc must be accurate (see Docs to Update).

## Open Questions

_None_

## Implementation Steps

1. **Download the Figma asset.**
   - Use Figma MCP `get_design_context` with `fileKey=A43rjYYjSwdTmiwwf5cx5n`, `nodeId=1497:94570` to retrieve the fresh asset URL, then download the SVG to `/Users/dima/git/pipeline/packages/ui/src/assets/illustrations/striped-activity-empty.svg`.
   - Open the SVG and confirm: `viewBox="0 0 240 240"`, width/height attributes are 240 (or omitted in favour of the viewBox), and the artwork is composed of `<path>` elements (per the Issue body description). Replace any hard-coded `fill="#383735"` / `stroke="#383735"` with `fill="currentColor"` / `stroke="currentColor"` so the asset is colour-agnostic when rendered inline (the mask approach below does not strictly require this, but it keeps the SVG drop-in-friendly for future direct `<img>` or inline `<svg>` use). Remove `stroke-opacity="0.3"` if present (see Assumptions).

2. **Create the `ActivityEmptyIllustration` primitive in `@pipeline/ui`.**
   - New directory: `/Users/dima/git/pipeline/packages/ui/src/components/ActivityEmptyIllustration/`.
   - Files:
     - `ActivityEmptyIllustration.tsx` — mirrors `WalletIllustration.tsx` structurally:
       - Import the SVG as a URL: `import stripedActivityEmptyUrl from "../../assets/illustrations/striped-activity-empty.svg";`
       - Export `ActivityEmptyIllustrationTone = "primary" | "muted"` (default `"muted"`).
       - Export `ActivityEmptyIllustrationProps` (same shape as `WalletIllustrationProps` minus the wallet-specific docstring; `width` defaults to `240`, `tone` defaults to `"muted"`).
       - Compose styles: `aspect-ratio: 1 / 1`, `backgroundColor: currentColor`, `WebkitMaskImage`/`maskImage` pointing at the new SVG URL, `maskSize: "contain"`, `maskRepeat: "no-repeat"`, `maskPosition: "center"`. Map tones identically to `WalletIllustration` (`primary` → `var(--color-pipeline-ink)`, `muted` → `var(--color-pipeline-ink-muted)`).
       - Render a `<span>` with `aria-hidden="true"`, `data-tone={tone}`, forwarded ref (`React.forwardRef<HTMLSpanElement, ActivityEmptyIllustrationProps>`).
       - JSDoc must reference Figma node `1497:94570`, the 240 × 240 intrinsic size, and call out that this is the Recent-activity empty-state silhouette (distinct from `WalletIllustration`).
     - `ActivityEmptyIllustration.stories.tsx` — single Storybook meta with two stories (`Muted` and `Primary`) inside a 320 × 320 white-card decorator (mirroring the `SmallMuted` story decorator in `WalletIllustration.stories.tsx`). The `Muted` story uses `tone="muted"`, `width=240`; the `Primary` story uses `tone="primary"`, same width — both for visual regression / design review.
     - `index.ts` — re-export `ActivityEmptyIllustration`, default, and the type aliases (same pattern as `WalletIllustration/index.ts`).

3. **Wire the new component into the `@pipeline/ui` barrel.**
   - Edit `/Users/dima/git/pipeline/packages/ui/src/index.ts` and append exports next to the existing `WalletIllustration` exports:
     ```ts
     export { ActivityEmptyIllustration } from "./components/ActivityEmptyIllustration";
     export type {
       ActivityEmptyIllustrationProps,
       ActivityEmptyIllustrationTone,
     } from "./components/ActivityEmptyIllustration";
     ```
   - Keep the `WalletIllustration` exports unchanged.

4. **Update `RecentActivityCard.tsx` to consume the new primitive.**
   - File: `/Users/dima/git/pipeline/packages/frontend/src/components/RecentActivityCard.tsx`.
   - Change the import line from `import { Card, EmptyState, WalletIllustration } from "@pipeline/ui";` to `import { ActivityEmptyIllustration, Card, EmptyState } from "@pipeline/ui";`.
   - Replace the `<WalletIllustration tone="muted" width={ILLUSTRATION_WIDTH} data-node-id="1497:94570" />` instance with `<ActivityEmptyIllustration tone="muted" width={ILLUSTRATION_WIDTH} data-node-id="1497:94570" />`.
   - Update the in-file JSDoc / ASCII diagram to describe the striped-square silhouette rather than the wallet-with-coin-slot. Specifically the "Composition" bullet referring to `WalletIllustration` and the diagram (the `◯` coin glyph next to the stripes) must change. Keep the `1497:94570` node reference; that's the same Figma node, just the correct asset now.
   - `ILLUSTRATION_WIDTH` (240) is unchanged.

5. **Audit `EmptyState.stories.tsx` for stale references.**
   - File: `/Users/dima/git/pipeline/packages/ui/src/components/EmptyState/EmptyState.stories.tsx`.
   - The story uses a local `WalletIllustrationPlaceholder` component to avoid a real dependency, and only references "WalletIllustration" in docstrings as a forward note. Decision: leave this file untouched unless the implementer determines that swapping the placeholder for a real `ActivityEmptyIllustration` import would meaningfully improve the Storybook preview. If they make that swap, do so in a single isolated commit so it can be reverted independently.

6. **Update `EmptyState.tsx` docstring (light touch).**
   - File: `/Users/dima/git/pipeline/packages/ui/src/components/EmptyState/EmptyState.tsx`.
   - The doc comment on `illustration` references "the 240×240 `WalletIllustration` from `@pipeline/ui`" — that's now misleading (the 240 × 240 case is `ActivityEmptyIllustration`; `WalletIllustration` is 313 × 200). Reword to "the 240×240 `ActivityEmptyIllustration` from `@pipeline/ui`" or generalise to "a sized illustration primitive from `@pipeline/ui`". No behaviour change.

7. **Run lint + storybook build.**
   - `npx tsx scripts/lint-docs.ts` (per `AGENTS.md` TypeScript rule).
   - `pnpm --filter @pipeline/ui lint` (or workspace-equivalent) to confirm ESLint / Prettier are clean.
   - `pnpm --filter @pipeline/ui build-storybook` (or `storybook dev` smoke-check) to confirm the new story compiles and the SVG asset import resolves.

## Test Strategy

This is a styling/asset swap with no business-logic changes; verification is visual + structural.

1. **Unit / static checks.**
   - ESLint + Prettier on the new component, story, and updated card.
   - TypeScript compile of `@pipeline/ui` and `@pipeline/frontend` (the barrel-export change must not break either downstream).
   - `npx tsx scripts/lint-docs.ts` — required by `AGENTS.md` for any TypeScript change.

2. **Storybook visual check.**
   - Run `pnpm --filter @pipeline/ui storybook` and open the new `Components/ActivityEmptyIllustration` entries. Confirm:
     - The `Muted` story shows the striped-square silhouette in muted ink on the white card surface.
     - The `Primary` story shows the same silhouette in primary ink (sanity check that `tone` toggles correctly).
     - The artwork is square (240 × 240) and reads as the abstract striped silhouette described in the Issue — no coin-slot circle, no landscape wallet shape.
   - Confirm `Components/WalletIllustration` stories still render the landscape striped-wallet unchanged.

3. **Frontend regression — manual.**
   - `pnpm --filter @pipeline/frontend dev` and open `http://localhost:5173/` in the disconnected (no wallet) state.
   - Confirm the Recent activity card right column now shows the 240 × 240 striped-square silhouette (muted ink) above the "You will see all transactions here" caption.
   - Confirm the Connect Wallet promo card still shows the landscape striped-wallet with the visible coin-slot circle and the primary ink tone — unchanged.

4. **Figma-driven verification (required by planner skill since the Issue carries a Figma link).**
   - Use Chrome DevTools MCP (`take_screenshot`) on the running frontend and place it side-by-side with `get_screenshot` on Figma node `1497:94567` (the parent `Section` containing the Recent activity card). The empty-state region must match the Figma reference: square silhouette, muted ink, centred above caption. The `ux-tester` skill is the right tool for this once the implementation lands.

5. **Edge cases.**
   - Verify the empty state stays vertically centred when the card grows beyond `min-h-[564px]`.
   - Verify the SVG mask renders correctly under dark-mode / high-contrast media queries if the project supports them (the `--color-pipeline-ink-muted` token should already adapt). If no theme variants exist yet, this is a no-op.
   - Confirm no broken-image fallback shows during dev-server hot reload (Vite's SVG-as-URL transform is already used by `WalletIllustration`, so this should be a non-issue, but worth a sanity check on first load).

## Docs to Update

- **`packages/ui/src/components/EmptyState/EmptyState.tsx`** — update the `illustration` prop JSDoc to reference `ActivityEmptyIllustration` (or generalise) instead of "the 240×240 `WalletIllustration`".
- **`packages/frontend/src/components/RecentActivityCard.tsx`** — update the file-level JSDoc / ASCII diagram and the "Composition" bullet that mentions `WalletIllustration` `tone="muted"`. Replace with the striped-square silhouette description.
- **New JSDoc** on `ActivityEmptyIllustration.tsx` covering: purpose (Recent-activity empty-state silhouette), Figma node reference (`1497:94570`), intrinsic size (240 × 240, `aspect-ratio: 1 / 1`), tone prop semantics, decorative-only / `aria-hidden` contract, and reuse points.
- **No product spec change required.** This is a fix bug (`bug` label on the Issue) restoring visual fidelity to an existing Figma-spec'd surface; no user-facing behaviour or feature scope changes. `docs/product-specs/` and `docs/design-docs/` do not need updates.
- **No `known-bugs.md` / `tech-debt-tracker.md` entries** unless the implementer discovers an unrelated regression while in the file (per `AGENTS.md`).
