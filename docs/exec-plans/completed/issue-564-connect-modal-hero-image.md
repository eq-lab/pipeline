# Issue #564: Connect Wallet modal: right pane uses a gradient placeholder instead of the Figma hero photo

Source: https://github.com/eq-lab/pipeline/issues/564

Parent: #558 · Epic: #556 (Connect page) · Flow: frontend · Type: bug

## Scope

The Connect Wallet modal's right pane (`RightImagePanel` in
`packages/frontend/src/components/ConnectWalletModal.tsx`, L347–415) currently
renders a hardcoded CSS gradient placeholder plus an inline `<text>`-based SVG
wordmark replica. Figma node `2858:57637` (Image slot `0:123`) shows a
full-bleed aerial photograph of a container ship at sea, with the white
Pipeline wordmark top-left and the white serif headline "Access real-world
yield on-chain" overlaid.

In scope:

1. Replace the inline `<text>` wordmark replica with the real Pipeline
   wordmark. The shared `Logo` component already exists and is exported from
   `@pipeline/ui` (`packages/ui/src/components/Logo/Logo.tsx`); it paints the
   real wordmark paths via `currentColor` and supports a white override. This
   half is fully unblocked.
2. Replace the gradient `<div>` with the real hero photo rendered
   `object-cover` to fill the right pane — CONDITIONAL on obtaining a usable
   image asset (see Open Questions / Assumptions and Risks).
3. Keep the white headline overlay; keep `lg:`-only visibility (the panel is
   already desktop-only and `aria-hidden`).

Out of scope:

- The fullscreen / two-column modal layout — tracked in #563.
- Any change to the left pane (wallet list, tabs, headings).
- Behavioral / wallet-connection logic.

## Assumptions and Risks

- **Asset availability is the central risk.** Confirmed during planning: the
  Figma MCP `download_assets` (asset-export) endpoint returns empty/near-empty
  PNGs for the image nodes — `0:124` (`.image`) and `0:125` (`Rectangle`)
  both return 149–3650-byte renders with no usable photo and an empty
  `rawImages` list. This matches the reviewer's "empty/transparent PNG"
  finding. The ONLY render the MCP could produce is via `get_design_context`
  on the Image slot `0:123`, which yields a 480×480, heavily dithered,
  square-cropped PNG. That is NOT production-quality for an 864×916 full-bleed
  panel (wrong aspect ratio, low resolution, visible dither noise). The
  underlying source bitmap is not extractable through the MCP — it is almost
  certainly a fill on a library/component instance whose raw bytes the MCP
  cannot reach.
- Therefore the photo half likely needs the design team to supply the
  high-resolution original (or grant access to export it from Figma directly,
  outside the MCP). Until then, only the logo half (step 1) is safely
  shippable.
- If we ship the logo fix alone, the gradient placeholder remains visible;
  acceptable as an incremental improvement, but the issue is not fully
  resolved until the photo lands.
- Asset weight: a full-bleed JPEG could be large. Prefer an optimized
  `.webp`/`.jpg` and lazy-load semantics since the panel is desktop-only.
- The headline must stay legible over the photo (the photo's upper-left is
  dark ocean, lower area is lighter ship) — a subtle dark scrim/overlay may be
  needed for contrast, matching Figma.

## Open Questions

- BLOCKER (photo asset): The real hero photograph is not obtainable at
  production quality via the Figma MCP (asset export returns empty PNGs; the
  only render is a 480×480 dithered square crop). Can the design team export
  and supply the original high-resolution photo for Image node `0:124`
  (`.image`) of frame `2858:57637`, or grant a direct (non-MCP) Figma export?
  Until this asset is delivered, step 2 (the photo) cannot be completed and
  should be parked/`blocked`. The logo half (step 1) can proceed independently
  if the manager chooses to split the work.
- Should this issue be implemented in two parts (ship the logo now, block on
  the photo), or held entirely as `blocked` until the photo asset is
  available? (Manager / human decision.)

## Implementation Steps

Step 1 — Real wordmark (unblocked):

1. In `packages/frontend/src/components/ConnectWalletModal.tsx`, import
   `Logo` from `@pipeline/ui`.
2. In `RightImagePanel` (L374–395), delete the inline `<svg><text>Pipeline`
   replica and render `<Logo width={116} className="text-white" />` (white via
   the `currentColor` override documented in `Logo.tsx`). Keep the existing
   `h-8 w-[116px] shrink-0` wrapper sizing or let `Logo`'s intrinsic 116×32
   drive it. Confirm the wordmark renders white against the panel.

Step 2 — Hero photo (CONDITIONAL on asset delivery — see Open Questions):

3. Commit the supplied high-resolution photo under
   `packages/frontend/src/assets/` (e.g. `connect-hero-ship.webp` or `.jpg`).
   Follow existing asset-import conventions (frontend uses Vite `?url` imports
   for raster/SVG assets, e.g. `@pipeline/ui/assets/icons/*.svg?url`).
4. In `RightImagePanel`, replace the gradient `<div>` (L357–362) and the
   texture overlay (L364–370) with an `<img src={heroUrl} alt=""
   className="absolute inset-0 size-full object-cover" />`. Keep the panel
   `aria-hidden`, so `alt=""` is correct.
5. If contrast requires it (per Figma), add a single subtle dark gradient
   scrim `<div>` above the image and below the content layer so the white logo
   + headline stay legible. Match Figma opacity rather than inventing one.
6. Ensure the content layer (`relative z-10`, L373) still stacks above the
   image, and the headline tokens (`--font-display`, `--text-pipeline-heading-l`)
   are unchanged.

## Test Strategy

- Frontend flow has no dedicated QA phase; rely on unit/RTL tests + lint +
  build, plus Figma-based visual verification.
- Unit/RTL (`packages/frontend`, vitest): extend or add a test for
  `ConnectWalletModal` / `RightImagePanel` asserting (a) the real `Logo` is
  rendered (e.g. `getByRole("img", { name: "Pipeline" })` is present and the
  old inline `<text>Pipeline` replica is gone); (b) when the photo lands, the
  hero `<img>` is rendered with `object-cover` and the gradient placeholder
  `<div>` is removed. Mirror the asset-import-integrity pattern in
  `CoinIcon.test.tsx` / `HeroIcon.test.tsx` to assert the `?url` import
  resolves to a real (non-empty) asset.
- `npx tsc --noEmit` / project typecheck and the frontend build must pass.
- Run `npx tsx scripts/lint-docs.ts` for doc-structure validation.
- Figma verification: compare the rendered panel against node `2858:57637`
  (Image slot `0:123`) — full-bleed ship photo, white wordmark top-left, white
  headline overlay.

## Docs to Update

- No product-spec change (pure visual `fix`, no behavior change).
- If step 2 is blocked pending the design asset, log the blocker in
  `docs/exec-plans/known-bugs.md` (date, location
  `ConnectWalletModal.RightImagePanel`, symptom: gradient placeholder instead
  of hero photo, root cause: photo asset not exportable via Figma MCP,
  workaround: gradient placeholder + real wordmark).
- On completion, archive this plan to `docs/exec-plans/completed/`.
