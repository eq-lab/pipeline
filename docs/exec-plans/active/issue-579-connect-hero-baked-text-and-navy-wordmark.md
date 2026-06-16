# Issue #579: Connect modal right pane: hero asset has baked-in wordmark+headline, duplicating the overlay (and overlay wordmark renders navy, illegible)

Source: https://github.com/eq-lab/pipeline/issues/579

Epic: #556 (Connect page). Source story: `docs/user-stories/epic-556/564-connect-modal-hero-image.md` (S1, S2, S3).
Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=2858-57637

## Scope

Fix the two defects in the desktop right pane of `ConnectWalletModal`:

1. **Baked-in text in the hero asset.** Replace `packages/frontend/src/assets/connect-hero-ship.webp` (currently a full pre-composited Figma pane export containing the white "Pipeline" wordmark and the "Access real-world / yield on-chain" headline) with a bare, text-free aerial container-ship photograph. The DOM already overlays its own `Logo` and headline `<p>`, so the baked-in copies must be removed at the asset level.
2. **Overlay wordmark renders navy, illegible.** The overlaid `<Logo>` in `RightImagePanel` renders `rgb(0,0,128)` (the brand-navy token) instead of white, despite `className="text-white"`. Root cause is in the `Logo` component: it sets `color` via an inline `style`, which beats the Tailwind `text-white` class. Fix so the caller can force white.

Out of scope:
- Mobile layout (S4) — already hidden below `lg`; no change.
- Left pane / wallet list behavior.
- Any change to the gradient scrim other than confirming it still keeps the white text legible (S3).
- Restyling the `Logo` default color (must remain brand navy for all other call sites).

## Assumptions and Risks

- **Confirmed: a clean asset is obtainable from Figma — no human/design input required.** The Figma "Image" slot (node `0:123`) is layered: a single raw image fill (the bare photo) plus *separate* sibling layers `project-logo` (`0:126`) and `Header Title` text (`0:128`). The raw image fill downloaded from the subtree (`download_assets` on `0:123`, the only `rawImages` entry) is a clean 480x480 text-free aerial container-ship photo. The current committed `.webp` was mistakenly exported from the full composited pane instead of from the bare photo layer.
- The clean source fill is square (480x480); the pane is portrait. The `<img>` already uses `object-cover absolute inset-0`, so cropping is handled — no aspect-ratio code change needed. Risk: a 480px-wide source may look soft on a half-screen (~864px) desktop pane. Prefer exporting the photo layer at a higher scale (2x) to mitigate. See Open Questions.
- Root cause of the navy wordmark is verified in `packages/ui/src/components/Logo/Logo.tsx`: `composedStyle = { color: "var(--color-pipeline-brand)", ...style }` is applied via the `style` attribute. Inline `style.color` always wins over the `text-white` utility class, so `<Logo className="text-white" />` has no effect. Tokens: `--color-pipeline-brand: #000080` (navy = rgb(0,0,128)); `--color-pipeline-paper: #f8f7f6` (off-white, NOT pure white). S1 requires white paths, so use pure white, not the paper token.
- `Logo` is a shared UI component; changing its color-composition logic must not regress the default navy rendering used elsewhere. Keep the default; only make the override reachable.

## Open Questions

- Asset export resolution/format: the bare Figma photo fill is 480x480 PNG. Should the coder export the photo layer at 2x for a crisp half-screen desktop pane, and what target file size/format is acceptable for the replacement `.webp` (current committed asset is ~335 KB)? Defaulting to "export at 2x, re-encode to `.webp`, keep under ~300 KB" unless design says otherwise.

## Implementation Steps

1. **[DONE] Produce a clean, text-free hero photo and replace the asset.**
   - Exported the bare container-ship photo from Figma node `0:123` rawImages fill (480x480 PNG). Converted to WebP (96 KB, under 300 KB limit). Overwrote `packages/frontend/src/assets/connect-hero-ship.webp`.

2. **[DONE] Fix the `Logo` color override so the overlaid wordmark renders white.**
   - Chose Option B: `RightImagePanel` passes `style={{ color: "#fff" }}` to `<Logo>`. The existing `...style` spread in `composedStyle` lets caller color win. No change to `Logo.tsx` itself. Default navy preserved for all other call sites.

3. **[DONE] Update the `RightImagePanel` overlay wordmark to render white.**
   - Changed `<Logo width={116} className="text-white" />` to `<Logo width={116} style={{ color: "#fff" }} />` in `ConnectWalletModal.tsx`.

4. **[DONE] Confirm the scrim still satisfies S3.** Scrim unchanged (`linear-gradient(160deg, rgba(0,0,0,0.45) …)`). No legibility regression expected; visual verification deferred to ux-tester.

## Test Strategy

- **Unit / component tests** (`packages/frontend/src/components/ConnectWalletModal.test.tsx`):
  - Keep/strengthen the existing assertions: right panel renders the real `Logo` SVG (`aria-label="Pipeline"`), the hero `<img alt="">` has `object-cover`, and the `?url` import resolves to a non-empty string.
  - Add an assertion that the overlaid `Logo` SVG renders white — assert the computed/declared color is `#fff`/`rgb(255,255,255)` (or that the `text-white` class / `style.color: #fff` is present and effective), guarding against regression of the navy bug. Note jsdom does not resolve CSS-variable cascade, so prefer asserting the explicit white style/class on the element rather than a computed token value.
- **`Logo` unit test** (`packages/ui/src/components/Logo/`): add a test that a caller-supplied white color override (className or style, matching the chosen fix) actually produces white, and that the default (no override) remains brand navy. This locks in the fix at the component boundary.
- **Lint/build:** `npx tsx scripts/lint-docs.ts` after the doc/plan changes; run the frontend unit suite and type-check/build.
- **Figma-based visual verification** (manual, per S1–S3): open the modal on a desktop viewport (1440x900), confirm exactly ONE white "Pipeline" wordmark (top-left) and ONE white headline, both legible, over a text-free container-ship photo, matching Figma node `2858:57637`.

## Docs to Update

- This exec plan (active).
- No product-spec change: pure `fix/` work, no new user- or agent-facing behavior beyond what story #564 already specifies. The story doc `docs/user-stories/epic-556/564-connect-modal-hero-image.md` already describes the intended end state (S1–S3) and needs no edit.
- If the chosen `Logo` fix changes the documented theming contract in `Logo.tsx`'s JSDoc (color override mechanism), update that JSDoc accordingly.
