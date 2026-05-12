# Issue #40: Self-host the Figma typefaces in packages/ui

Source: https://github.com/eq-lab/pipeline/issues/40

## Scope

Wire the two typefaces used in the Figma frame into `@pipeline/ui` as self-hosted `.woff2` files, with `@font-face` declarations exposed through a new `packages/ui/src/styles/theme.css`. The Storybook preview is updated to import that stylesheet so all story renders pick up the design typefaces.

From the Figma variables on the source frame (`1497-94556`):

- **Display serif** — `font/title-font-family = Besley`, used by `Title` (64/64, w700), `Heading M` (28/36, w700), `Heading 20` (20/28, w400).
- **Body sans** — `font/text-font-family = Graphik LC`, used by `Body` (16/22, w400), `Body Emphasized` (16/22, w600), `Caption` (12/16, w400), `Label` (12/16, w500, letter-spacing 7).

Required weights to ship as `.woff2`:

- Besley: 400 (regular), 700 (bold). Italics out of scope until a Figma frame uses them.
- Graphik LC (or its approved substitute — see Open Questions): 400, 500, 600.

In scope:

- Add `.woff2` files under `packages/ui/src/assets/fonts/`.
- Add `packages/ui/src/styles/theme.css` with `@font-face` rules (`font-display: swap`, local fallback `local("…")`, correct `font-weight` and `font-style`, and a `:root` block that maps the two families to CSS custom properties for downstream Tailwind v4 token use).
- Enable the `theme.css` import in `packages/ui/.storybook/preview.ts` (replace the `TODO(#future-theme-issue)` comment).
- Update `packages/frontend/src/index.css` to import the same stylesheet via `@import "@pipeline/ui/styles/theme.css";` so the running app uses the same fonts.
- Add `packages/ui/src/assets/fonts/LICENSE.md` capturing the license text for each typeface plus a one-line provenance note (download source + date).
- Add a minimal Storybook story under `packages/ui/src/stories/Typography.stories.tsx` (or equivalent name following existing story conventions) that previews each text token in both families and weights so reviewers can visually verify rendering. If the project does not yet have any stories file convention, create the file under `packages/ui/src/typography/Typography.stories.tsx`.

Out of scope:

- Defining Tailwind v4 `@theme` tokens that fully replace existing utility classes — that is a follow-up issue; this plan only exposes CSS custom properties so a later issue can bind them.
- Italic weights for either family.
- Variable fonts. Static weights only, to keep payload predictable.
- Any change to non-frontend packages.

## Assumptions and Risks

- **Besley is OFL-licensed.** It is published by Indestructible Type and distributed via Google Fonts under the SIL Open Font License 1.1, which permits redistribution including self-hosting. We will download `.woff2` files from Google Webfonts Helper (`gwfh.mranftl.com`) or the upstream GitHub repo (`https://github.com/Fonts-Indestructible/Besley`), whichever yields the matching weights. We must include the OFL.txt verbatim in `LICENSE.md` per the OFL terms.
- **Graphik LC is proprietary** — Commercial Type's "Graphik LC" (Latin/Cyrillic) is a paid license; we cannot legally self-host without a license file from Commercial Type or a written license proof. This is the primary risk and is captured under Open Questions. Until the license question is resolved, the coder cannot legally add Graphik LC `.woff2` files to the repo.
- File size risk: each weight is typically 30–80 KB as `.woff2`; three Graphik weights + two Besley weights ≈ ~250–400 KB total. Acceptable for a desktop-first dashboard but worth verifying with `ls -lah` in the PR description.
- `prettier --check .` runs on the UI package; ensure binary `.woff2` assets are excluded from prettier (already handled by `.prettierignore` which excludes `*.woff2` via globs — verify). If not excluded, add the pattern.
- `font-display: swap` causes a FOUT, which is acceptable per acceptance criteria. Confirm Storybook preview tolerates this — it does, since `theme.css` is imported at preview-config load time and Storybook waits for stylesheets before rendering.
- Risk of name collision: if a developer later relies on the system font fallback (e.g. macOS rendering "Besley" because of an installed local copy), `local("Besley")` in the `@font-face` `src` is fine. Order the `src:` list as `local()` first, then `url(...woff2)`.

## Open Questions

- **License for Graphik LC.** Has the team purchased a self-host license from Commercial Type, and if so, where are the licensed `.woff2` files? If no license is in place, do we substitute a similar open-source sans (likely candidates: Inter, IBM Plex Sans, Söhne alternatives like `Söhne` → `Inter`)? The planner cannot pick a substitute without confirmation that the design is OK with the change, because the substitute will subtly shift visual rhythm in every component. **The manager should pause for human input on this question before the coder begins.**
- Once the body family is decided, should `font/title-font-family` also be re-evaluated, or do we keep Besley regardless of the body-font decision? Default assumption: keep Besley either way.
- Should `theme.css` be imported by `packages/frontend/src/index.css`, or should we instead make the frontend `main.tsx` import it explicitly so the import graph is more discoverable? Default plan: import from `index.css`, but flag for review.

## Implementation Steps

1. **Resolve the Graphik LC question** (Open Questions item 1). If the manager has not surfaced an answer, the coder must stop and surface the question rather than guess. Once the answer is "use Graphik LC (licensed)" or "use <Substitute>", proceed with that family name in the remaining steps.
2. **Acquire `.woff2` files.**
   - Besley: download `Besley-Regular.woff2` (400) and `Besley-Bold.woff2` (700) from Google Webfonts Helper at `https://gwfh.mranftl.com/fonts/besley`. Save to `packages/ui/src/assets/fonts/besley-regular.woff2` and `packages/ui/src/assets/fonts/besley-bold.woff2`.
   - Body sans: download the three weights (400 / 500 / 600) as `.woff2` and save as `packages/ui/src/assets/fonts/<family>-regular.woff2`, `-medium.woff2`, `-semibold.woff2`. Use lowercase kebab-case filenames.
3. **Add license documentation.** Create `packages/ui/src/assets/fonts/LICENSE.md` with two sections:
   - "Besley — SIL Open Font License 1.1": paste the OFL text from the upstream Besley repo's `OFL.txt`, plus the copyright line.
   - "<Body family> — <license name>": paste the relevant license text (OFL for an open-source substitute, or a reference to the purchased license file kept outside the repo for a commercial face).
4. **Create `packages/ui/src/styles/theme.css`.**
   - Five `@font-face` blocks (one per weight). Use `font-display: swap;`, `font-style: normal;`, the correct `font-weight: <n>;`, and `src: local("<Friendly Name>"), url("../assets/fonts/<file>.woff2") format("woff2");`. Vite's CSS resolver handles the relative URL.
   - A `:root { --font-display: "Besley", ui-serif, Georgia, serif; --font-body: "<Body family>", ui-sans-serif, system-ui, sans-serif; }` block exposing the two families as CSS variables for downstream use.
5. **Wire Storybook.** Edit `packages/ui/.storybook/preview.ts`: remove the `TODO(#future-theme-issue)` comment and uncomment `import "../src/styles/theme.css";`.
6. **Wire the frontend.** Edit `packages/frontend/src/index.css`: add `@import "@pipeline/ui/styles/theme.css";` as the second line (after `@import "tailwindcss";`). Confirm `@pipeline/ui`'s `exports` map already exposes `./styles/*` (it does — see `packages/ui/package.json`).
7. **Add a typography Storybook story** at `packages/ui/src/typography/Typography.stories.tsx` rendering: H-Title (64), Heading M (28), Heading 20 (20), Body 16/400, Body Emphasized 16/600, Caption 12/400, Label 12/500 (letter-spacing 7). Apply the families inline via `style={{ fontFamily: "var(--font-display)" }}` / `var(--font-body)` so the story exercises the CSS variables.
8. **Verify `.prettierignore` covers binary assets.** If `*.woff2` is not already ignored, add it to `packages/ui/.prettierignore` and the repo-root `.prettierignore` (if present).
9. **Confirm no CDN imports remain.** Run `grep -rn "fonts.googleapis.com\|fonts.gstatic.com" packages/` and ensure zero matches.
10. **Run validations:**
    - `yarn workspace @pipeline/ui lint`
    - `yarn workspace @pipeline/ui build-storybook` (must succeed; visually inspect generated `storybook-static/index.html` if needed)
    - `yarn workspace @pipeline/frontend build` (must succeed; the new `@import` must resolve)
    - `npx tsx scripts/lint-docs.ts` (per AGENTS.md TS rule)
11. **Manual visual verification** via Storybook against the Figma frame `1497-94556`: open the Typography story and the existing stories (e.g. the LP dashboard story added in Issue #37 if present), and confirm headlines render in Besley and body text in the chosen sans. Capture a screenshot for the PR description.

## Test Strategy

- **Unit / automated:**
  - Add no new unit tests — fonts are visual. Rely on the lint + build pipeline.
  - Build assertion: the `vite build` of the frontend must emit the `.woff2` files as static assets (verify in `packages/frontend/dist/assets/`). If they are not emitted, the `@font-face` `url(...)` paths are wrong.
  - Lint assertion: `yarn workspace @pipeline/ui lint` and the docs lint script must remain green.
- **Manual:**
  - Open the Typography story in Storybook. All seven text tokens must render in the expected families and weights (FOUT is acceptable; FOIT is not — verify with throttled network: text should fall back to the generic family during the swap window).
  - DevTools → Network: filter to `font`. Confirm the two/five `.woff2` files load from the same origin and that there are zero requests to `fonts.googleapis.com` or `fonts.gstatic.com`.
  - DevTools → Computed pane on a story: `font-family` must resolve to the self-hosted family for both display and body samples.
- **Figma verification:**
  - Side-by-side the Storybook Typography story against Figma node `1497-94556`. Letter shapes for Besley capitals (`R`, `Q`, `g`) should match; body sans rendering should match the chosen family. Differences caused by a Graphik substitution must be called out in the PR description.

## Docs to Update

- `docs/FRONTEND.md` — append a short "Typography" section under "Visual direction" naming the two families, where the `.woff2` files live, and how to add a new weight. (Two or three sentences — do not duplicate the implementation plan.)
- `docs/exec-plans/tech-debt-tracker.md` — if the body family ends up as a substitute (not Graphik LC), log a tech-debt entry: "Body font is a temporary substitute; replace with licensed Graphik LC once procurement closes." Include the date.
- No product-spec changes — this is a visual / asset change, not a behavior change. The user-facing behavior (web app renders text) does not change.
