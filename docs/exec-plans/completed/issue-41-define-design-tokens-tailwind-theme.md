# Issue #41: Define design tokens in Tailwind v4 @theme

Source: https://github.com/eq-lab/pipeline/issues/41

## Scope

Extend `packages/ui/src/styles/theme.css` with a Tailwind v4 `@theme` block that
declares every design token surfaced by the Figma frame `1497-94556` as CSS
custom properties. After this issue, downstream component code can render the
home page using Tailwind utilities (`bg-pipeline-paper`, `text-pipeline-ink`,
`rounded-pipeline-card`, `font-display`, etc.) and never inline a raw hex code.

Tokens come from the Figma variable dump (`get_variable_defs` on node
`1497-94556`) and from the inspected node fills/strokes/radii. The plan covers:

- **Color** — background (`#f8f7f6`), card surface (`#ffffff`), pale-yellow
  promo (`rgba(211,235,117,0.16)` on white), navy/cobalt brand (`#000080`),
  black CTA / ink (`#262524`), neutral ink and border alphas
  (`rgba(56,55,53,*)`), white text on dark.
- **Typography** — `font-display` (Besley) and `font-body` (Graphik LC) family
  vars already exist; this issue layers in the Figma type ramp as
  `--text-*` tokens (size + line-height pairs) and Tailwind v4 `--font-weight-*`
  tokens (semantic alias → numeric weight).
- **Spacing scale** — Figma `size-{0,4,8,12,16,32,48,64,128}` mapped onto the
  Tailwind v4 default 4px scale plus named `--spacing-*` aliases (`size-s`,
  `gap-s`, `gap-l`, etc.) where the Figma frame uses them by name.
- **Radii** — `radius-s` = 4 (the only radius the home frame uses today, plus
  the round `128px` staking button which is `rounded-full`).
- **Comments** — every token line carries a one-line comment naming the Figma
  variable or the Figma node id where the value first appears (e.g. `// fill/brand — 1497:94689 Convert button`).

Out of scope:

- Touching individual components or the home page composition (those are
  separate issues — `enhancement` cards #58/#59/#60 ride on top of this).
- Removing the existing `:root { --font-display, --font-body }` block; it
  remains for backward compatibility and is mirrored by the `@theme` block.
- Italics, additional weights, additional radii or colors not present in the
  Figma frame `1497-94556`.
- Wiring tokens into `tailwind.config.*` — Tailwind v4 is config-less and
  reads `@theme` directly from the imported CSS.
- Fixing the open Graphik w600 font asset (`#68`) — that is a precondition
  reported separately. This plan assumes the w600 file lands before or in
  parallel; if it is still missing when this issue is implemented, the coder
  declares the `--font-weight-emphasized: 600` token anyway and notes the
  dependency in the PR description.

## Assumptions and Risks

- **Tailwind v4 `@theme` semantics.** In Tailwind v4, design tokens are
  declared as CSS variables inside an `@theme { ... }` at-rule and Tailwind
  generates utilities from variable names that match its conventions
  (`--color-*` → `bg-*`/`text-*`/`border-*`, `--font-*` → `font-*`,
  `--text-*` → `text-*` size, `--radius-*` → `rounded-*`, `--spacing-*` →
  `p-*`/`m-*`/`gap-*`, `--font-weight-*` → `font-*-weight`). Token names in
  this plan follow that convention so utilities are generated automatically.
- **`@theme` and `@font-face` coexistence.** `theme.css` already contains
  `@font-face` blocks for self-hosted fonts. `@theme` is added after those
  blocks. The existing `:root { --font-display, --font-body }` is kept and
  the equivalent `@theme` entries (`--font-display`, `--font-body`) take
  precedence within the Tailwind layer; downstream consumers should prefer
  the `font-display` / `font-body` utilities.
- **Color naming risk.** The Figma frame uses `content-test/*` and
  `border-test/*` namespaces, which look like sandbox-only token names. We
  do not mirror that prefix; instead we adopt a stable `pipeline-*` namespace
  (`text-pipeline-ink`, `text-pipeline-ink-muted`, `border-pipeline-line`,
  `bg-pipeline-paper`, `bg-pipeline-promo`, `bg-pipeline-cta`,
  `bg-pipeline-brand`, `text-pipeline-on-dark`). If/when Figma promotes the
  `*-test` tokens to a stable namespace we revisit, but the values are
  expected to remain.
- **Alpha vs solid.** Figma exposes muted ink as `rgba(56,55,53,0.6)` (not as
  an opacity utility on the primary ink). We expose it as a discrete color
  token to preserve fidelity and to avoid forcing every consumer to layer
  opacity utilities.
- **Frontend rebuild risk.** `packages/frontend/src/index.css` already
  `@import`s `@pipeline/ui/styles/theme.css`; adding `@theme` to the imported
  file means Tailwind in `packages/frontend` regenerates utilities. There is
  a small risk that existing `text-pipeline-*` / `bg-pipeline-*` utilities
  (if any) clash. We mitigate by `grep`ping for any current `pipeline-*`
  class usage before naming tokens (initial inspection: none in `packages/`).
- **Dependency on Issue #68 (Graphik w600).** The `--font-weight-emphasized:
  600` token is correct per design even if no `.woff2` is loaded; the browser
  will fall back to synthetic bolding or to weight 500. Tokens describing the
  design intent are correct independent of asset coverage.
- **Storybook visibility.** We do not add a new tokens story in this issue —
  Issue #40's Typography story already renders the type ramp via the existing
  `--font-display`/`--font-body` vars. Adding a richer "Foundation/Tokens"
  story is logged as a follow-up tech-debt item rather than expanded here, to
  keep this issue tightly scoped to the `@theme` declaration the unblocking
  acceptance criteria call out. Verification happens via a code-only check
  plus a one-off Storybook spot-check (see Test Strategy).

## Open Questions

- **Color namespace name.** Plan defaults to `pipeline-*` (e.g.
  `bg-pipeline-paper`, `text-pipeline-ink`). The Issue body suggests
  `bg-pipeline-yellow` / `text-pipeline-ink` as exemplars, which matches.
  Open question for the human reviewer: do we prefer literal-color names
  (`pipeline-yellow`, `pipeline-navy`, `pipeline-black`, `pipeline-off-white`)
  or role-based names (`pipeline-promo`, `pipeline-brand`, `pipeline-cta`,
  `pipeline-paper`)? Role names age better when palette shifts; literal names
  are easier to read in component code. **Default chosen: role-based.** Flag
  to the human in case they want literal names instead.
- **Should muted ink be a token (`--color-pipeline-ink-muted:
  rgba(56,55,53,0.6)`) or always expressed as `text-pipeline-ink/60`?** The
  plan uses an explicit token because the alpha value comes straight from the
  Figma variable; trying to express it as a utility opacity decouples it from
  the design source. Confirm with the human.
- **Spacing aliases.** Figma exposes both `size-N` (numeric) and named
  (`gap-s`, `gap-xs`, `gap-l`). Tailwind v4's default 4px scale already
  yields `p-1` (4px), `p-2` (8px), `p-4` (16px), `p-8` (32px), `p-16` (64px),
  `p-32` (128px) for the values we need. Should we add `--spacing-gap-s: 1rem`
  (16px), `--spacing-gap-l: 2rem` (32px) aliases on top of the numeric scale,
  or only use the numeric scale? **Default chosen: numeric scale only.** Flag
  to the human in case they want the semantic aliases.

## Implementation Steps

1. **Confirm baseline.** Read `packages/ui/src/styles/theme.css` and confirm
   the existing `:root { --font-display, --font-body }` block. Read
   `packages/frontend/src/index.css` and confirm the `@import
   "@pipeline/ui/styles/theme.css";` line precedes any `@source` directive.
2. **Extend `packages/ui/src/styles/theme.css`** by appending a single
   `@theme { ... }` block after the existing `:root { ... }` block. Inside
   the block, declare the following groups (in this order; each declaration
   ends with a one-line `/* ... */` comment naming the Figma source):

   - **Colors (`--color-*`)**

     - `--color-pipeline-paper: #f8f7f6;` /* bg/primary — node 1497:94556 */
     - `--color-pipeline-surface: #ffffff;` /* fill-test/on-primary — node 1497:94565 */
     - `--color-pipeline-promo: rgb(211 235 117 / 0.16);` /* fill/warning-secondary — node 1497:94566 */
     - `--color-pipeline-brand: #000080;` /* fill/brand — node 1497:94689 */
     - `--color-pipeline-cta: #262524;` /* fill-test/primary — node 1497:94725 */
     - `--color-pipeline-ink: #262524;` /* content-test/primary — node 1497:94685 */
     - `--color-pipeline-ink-muted: rgb(56 55 53 / 0.6);` /* content-test/secondary — node I1497:94561 */
     - `--color-pipeline-ink-subtle: rgb(56 55 53 / 0.3);` /* content-test/tertiary — Welcome heading I1497:94559;6539:2322 */
     - `--color-pipeline-on-dark: #ffffff;` /* content-test/primary-on-invert / fill-test/on-primary — button label I1497:94566;1360:49021;6307:51 */
     - `--color-pipeline-line: rgb(56 55 53 / 0.18);` /* border-test/secondary — node 1497:94562 left border */

   - **Typography — families (`--font-*`)**

     - `--font-display: "Besley", ui-serif, Georgia, serif;` /* font/title-font-family */
     - `--font-body: "Graphik LC", ui-sans-serif, system-ui, sans-serif;` /* font/text-font-family */

     These mirror the `:root` declarations to register the families with the
     Tailwind layer so `font-display` / `font-body` utilities exist.

   - **Typography — type ramp (`--text-*` paired with line heights)**

     Each `--text-<n>` declares the font-size; the matching
     `--text-<n>--line-height` declares the line-height (Tailwind v4 picks
     these up automatically and emits `text-pipeline-title { font-size: …; line-height: …; }`):

     - `--text-pipeline-title: 64px;` /* font/font-size/title — Welcome heading */
     - `--text-pipeline-title--line-height: 64px;` /* font/line-height/title */
     - `--text-pipeline-heading-m: 28px;` /* font/font-size/heading-m — Connect Wallet */
     - `--text-pipeline-heading-m--line-height: 36px;` /* font/line-height/heading-m */
     - `--text-pipeline-heading-s: 20px;` /* Heading 20 — Get PLUSD card titles */
     - `--text-pipeline-heading-s--line-height: 28px;` /* Heading 20 line-height */
     - `--text-pipeline-body: 16px;` /* font/font-size/body */
     - `--text-pipeline-body--line-height: 22px;` /* font/line-height/body */
     - `--text-pipeline-caption: 12px;` /* font/font-size/caption */
     - `--text-pipeline-caption--line-height: 16px;` /* font/line-height/caption */

   - **Typography — weights and tracking**

     - `--font-weight-regular: 400;` /* font/title-font-weight — Welcome/Body */
     - `--font-weight-medium: 500;` /* Label — Questions & Answers */
     - `--font-weight-emphasized: 600;` /* Body Emphasized — Connect button (Semi Bold) */
     - `--font-weight-bold: 700;` /* Title/Heading M */
     - `--tracking-pipeline-label: 7px;` /* Label letterSpacing — node I1497:94667;6539:2336 (0.84px on 12px text ≈ 7px in the Figma variable) */

   - **Radii (`--radius-*`)**

     - `--radius-pipeline-card: 4px;` /* radius/radius-xxl, radius/radius-3xl, radius/radius-s — card outer */
     - `--radius-pipeline-button: 4px;` /* radius/radius-s — button radius */
     - `--radius-pipeline-pill: 9999px;` /* round Staking Button — node 1497:94713 */

   - **Spacing (`--spacing-*`)**

     - Do **not** redefine the numeric scale (Tailwind v4 default already
       yields 4/8/12/16/32/48/64/128 at multiples of `0.25rem`). Per the Open
       Question default we add **no** semantic spacing aliases in this issue.

3. **Verify `:root` block stays intact** at the top of the file (for
   non-Tailwind consumers and for the existing typography story). No changes
   to `@font-face` blocks in this issue.
4. **Grep guard.** Run `grep -rn "pipeline-paper\|pipeline-ink\|pipeline-brand\|pipeline-cta\|pipeline-promo\|pipeline-line\|pipeline-on-dark" packages/` and confirm zero pre-existing collisions. If any exist, surface and stop.
5. **Update `docs/FRONTEND.md`.** Add a short "Design tokens" subsection
   under "Visual direction" naming the token groups
   (color/typography/spacing/radius), the file they live in, and the rule
   that components must not inline raw hex codes — they consume tokens via
   Tailwind utilities. Keep to ~10 lines. If Issue #69's "Typography" section
   has already landed, add the new "Design tokens" subsection directly after
   it; otherwise create both subsections in this PR (so #69 is satisfied
   incidentally).
6. **No frontend route changes** — the home page wiring lives in #58/#59/#60
   and consumes the tokens declared here.
7. **Run validations:**
   - `yarn workspace @pipeline/ui lint`
   - `yarn workspace @pipeline/ui build-storybook` — must succeed; the
     existing Typography story must still render unchanged.
   - `yarn workspace @pipeline/frontend build` — must succeed; the `@theme`
     block must compile through Tailwind v4 without warnings.
   - `npx tsx scripts/lint-docs.ts` (per AGENTS.md TS rule).
8. **Manual visual spot-check.** Launch Storybook, open the existing
   Foundation/Typography story, open Chrome DevTools → Elements →
   Computed, and verify that the `getComputedStyle(documentElement)` exposes
   each of the new `--color-pipeline-*`, `--text-pipeline-*`,
   `--font-weight-*`, `--radius-pipeline-*`, and `--font-*` variables. No
   visual change is expected; the assertion is "tokens exist and resolve to
   the spec'd values".
9. **PR description must include** a token-by-token mapping table linking
   each token to its Figma variable name (e.g. `--color-pipeline-brand →
   fill/brand → #000080`).

## Test Strategy

- **Automated:**
  - `yarn workspace @pipeline/ui lint` and `npx tsx scripts/lint-docs.ts`
    must remain green.
  - `yarn workspace @pipeline/ui build-storybook` must succeed (asserts the
    `@theme` block parses).
  - `yarn workspace @pipeline/frontend build` must succeed (asserts Tailwind
    v4 in the frontend picks up the tokens from the imported CSS).
  - Optional micro-assertion: add a one-paragraph note to the PR description
    confirming that
    `getComputedStyle(document.documentElement).getPropertyValue('--color-pipeline-brand')`
    returns `#000080` when run in the Storybook devtools console. No new
    automated test file is added — these are visual / CSS-variable assertions
    and the project does not yet have a CSS-variable assertion harness.

- **Manual / Storybook:**
  - Open the Foundation/Typography story and confirm headings still render
    in Besley and body in Graphik LC (no regression from #40).
  - In Chrome DevTools → Console, evaluate each token via
    `getComputedStyle(document.documentElement).getPropertyValue('<token>')`
    and confirm the value matches the spec table from step 9.
  - Visually confirm there are no parse warnings in the Vite/Storybook
    console.

- **Figma verification:**
  - Side-by-side: open Figma frame `1497-94556` and inspect the variables on
    a couple of nodes (e.g. the Connect Wallet button, the FAQ heading, the
    Welcome title). Confirm each variable value in Figma equals the value of
    the matching `--*` token (e.g. Figma `fill/brand: #000080` ↔
    `--color-pipeline-brand: #000080`).

- **Edge cases:**
  - The pale-yellow promo color is alpha-on-white. Verify the token resolves
    to the same blended color when laid over `--color-pipeline-surface` as it
    does in Figma (`rgba(211,235,117,0.16)` over `#ffffff`).
  - The muted ink alpha (`0.6`) and subtle ink alpha (`0.3`) are exposed as
    discrete tokens, not as opacity utilities — verify components in #58/#60
    can consume them directly without `text-opacity-*`.
  - Tailwind v4 generates `font-bold` (700), `font-medium` (500), `font-regular`
    (400), and a custom `font-emphasized` (600) utility from the
    `--font-weight-*` tokens. Confirm in a quick Storybook test that
    `<p className="font-emphasized">…</p>` resolves to `font-weight: 600` in
    Computed.

## Docs to Update

- `docs/FRONTEND.md` — add a "Design tokens" subsection under "Visual
  direction". (May also incidentally satisfy Issue #69 if the "Typography"
  subsection is still missing; if so, add both subsections.)
- `docs/exec-plans/tech-debt-tracker.md` — append a one-line entry: "Add a
  Foundation/Tokens Storybook story that previews every `--color-pipeline-*`,
  `--text-pipeline-*`, `--radius-pipeline-*` token so reviewers can compare
  to Figma visually" with today's date. This story is deferred to keep #41
  small.
- No product-spec change — tokens are a visual / styling concern, not
  behavior.
