# STORIES — Manual Test Cases

Story-based test cases for manual / UX testing. Each case maps to a GitHub Issue and (where available) a completed execution plan.

---

## S-395 — /deposit: USDC half outer white card (16px radius)

**Issue:** [#395 /deposit: USDC half missing the outer white card (16px radius); Figma wraps the gray input panel in a padded white card](https://github.com/eq-lab/pipeline/issues/395)
**Plan:** `docs/exec-plans/active/issue-395-deposit-usdc-outer-white-card.md`

### TC-395-1: Card A (USDC half) renders inside a white outer card with 16px radius and correct padding

- **Actor:** User / QA
- **Preconditions:** Dev server running at `http://localhost:5176` (fix/395-deposit-usdc-outer-card branch)
- **Steps:**
  1. Navigate to `http://localhost:5176/deposit?direction=deposit`
  2. In DevTools Console: find the `gap-[2px]` wrapper and inspect its first child (Card A):
     ```js
     const gapWrapper = Array.from(document.querySelectorAll('.flex.flex-col')).find(d => getComputedStyle(d).gap === '2px');
     const cardA = gapWrapper.children[0];
     const cs = getComputedStyle(cardA);
     [cardA.className, cs.backgroundColor, cs.borderRadius, cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]
     ```
- **Expected:**
  - `className` includes `relative pt-4 pr-4 pb-6 pl-4 bg-[var(--color-pipeline-surface)] rounded-[var(--radius-pipeline-card-lg)]`
  - `backgroundColor` = `rgb(255, 255, 255)` (white surface)
  - `borderRadius` = `16px`
  - Padding: top=16px, right=16px, bottom=24px, left=16px
  - No border class on Card A outer wrapper
  - `--radius-pipeline-card-lg` token resolves to `16px` on `:root`

### TC-395-2: Swap button still straddles the 2px seam between Card A and Card B

- **Actor:** User / QA
- **Preconditions:** Same as TC-395-1
- **Steps:**
  1. Inspect the swap button (aria-label="Switch direction") bounding rect vs. Card A bottom / Card B top
- **Expected:**
  - Gap between Card A bottom and Card B top = 2px
  - Swap button center Y within 1px of gap midpoint
  - Swap button `borderRadius: 4px`, size 40×40px

### TC-395-3: Paper background visible around Card A; Card B unaffected

- **Actor:** User / QA
- **Preconditions:** Same as TC-395-1
- **Steps:**
  1. Visually confirm the warm off-white paper (`#f8f7f6`) is visible around the white card edges
  2. Confirm Card B (PLUSD half) still renders as a white card with `borderRadius: 4px` (unchanged per #382)
- **Expected:**
  - Card A `backgroundColor: rgb(255, 255, 255)` (white) — visible contrast with paper background
  - Card B `backgroundColor: rgb(255, 255, 255)`, `borderRadius: 4px` — unchanged
  - No border on Card A outer wrapper

### TC-395-4: Withdraw direction — same Card A white outer card layout holds

- **Actor:** User / QA
- **Preconditions:** Same as TC-395-1
- **Steps:**
  1. Navigate to `http://localhost:5176/deposit?direction=withdraw`
  2. Inspect Card A (now PLUSD input half) with same checks as TC-395-1
- **Expected:**
  - Card A `backgroundColor: rgb(255, 255, 255)`, `borderRadius: 16px`, correct padding — same as deposit direction
  - Withdraw-specific content: PLUSD input, 25%/50%/75%/Max chips, "1 PLUSD = 1 USDC", "Allow Pipeline to use PLUSD" step copy

---

## S-372 Home: Recent activity "View All" button affordance

Moved to [`docs/user-stories/epic-463/372-recent-activity-view-all.md`](./user-stories/epic-463/372-recent-activity-view-all.md) (home page stories live with epic #463).

---
## S-259 Toast notification system

**Issue:** [#259 Add Toast notification system — informational and actionable variants](https://github.com/eq-lab/pipeline/issues/259)

### TC-259-1: Toast container renders at bottom-right

- **Actor:** End-user (on any page)
- **Preconditions:** Dev server running; mock wallet connected
- **Steps:**
  1. Navigate to `/deposit`
  2. Inspect the DOM for `[aria-label="Notifications"]`
- **Expected:** Container is `position: fixed`, `bottom: 24px`, `right: 24px`, `z-index: 50`, `display: flex`, `flex-direction: column`, `align-items: flex-end`. Zero toasts when idle.

### TC-259-2: Deposit pending → success toast fires

- **Actor:** End-user
- **Preconditions:** Mock wallet connected (5 000 USDC balance); allowance=approved; amount=1 000 USDC entered
- **Steps:**
  1. Click "Confirm" on step 2
  2. Observe bottom-right toast
- **Expected:** "Sending…" pending toast appears first (muted background, `role="status"`, `aria-live="polite"`). It then transitions in place to "Deposit submitted" success toast (green `rgb(58,125,68)` background) with a "View" action button. Toast auto-dismisses after 5 s.

### TC-259-3: Claim pending → success toast fires

- **Actor:** End-user
- **Preconditions:** Mock wallet; PendingClaim request in API mock; voucher mock set; Claim button enabled
- **Steps:**
  1. Click "Claim"
  2. Observe bottom-right toast
- **Expected:** "Claiming…" pending toast appears; transitions to "PLUSD claimed" success toast; both `role="status"`, `aria-live="polite"`. No race condition — update() runs in a subsequent render after show() has committed state.

### TC-259-4: A11y attributes per tone

- **Actor:** QA
- **Preconditions:** Unit tests
- **Steps:**
  1. Run `yarn workspace @pipeline/frontend test --run src/lib/toast`
- **Expected:** All 16 toast tests pass. `danger` tone → `role="alert"`, `aria-live="assertive"`. All other tones → `role="status"`, `aria-live="polite"`.

### TC-259-5: Approval toast (blocked by #230)

- **Actor:** End-user
- **Preconditions:** VITE_DEPOSIT_MANAGER_ADDRESS env set; allowance=0; amount entered
- **Steps:**
  1. Click "Approve"
  2. Observe bottom-right toast
- **Expected:** "Approving USDC…" pending toast; transitions to "Approval confirmed" success toast. BLOCKED — approval step bypassed in local dev when VITE_DEPOSIT_MANAGER_ADDRESS is unset (pre-existing bug #230).

---

## S-38 Bootstrap TanStack Router file-based routes

**Issue:** [#38 Bootstrap TanStack Router file-based routes in frontend](https://github.com/eq-lab/pipeline/issues/38)
**Plan:** `docs/exec-plans/completed/` (feat/38 branch)

### TC-38-1: Build succeeds without ENOENT warning

- **Actor:** Developer
- **Preconditions:** Clean checkout on the feat/37-ui-workspace-dep branch (or later)
- **Steps:**
  1. Run `yarn workspace @pipeline/frontend build`
- **Expected:** Build completes with exit code 0; no ENOENT warning in stdout/stderr; `dist/` folder produced.

### TC-38-2: Dev server serves "Pipeline" at `/`

- **Actor:** Developer / end-user (local)
- **Preconditions:** Dev server started via `yarn workspace @pipeline/frontend dev`
- **Steps:**
  1. Navigate browser to `http://localhost:3000/`
- **Expected:** Page renders the text "Pipeline" with no JS console errors (favicon 404 is acceptable).

### TC-38-3: Route tree generated by plugin

- **Actor:** Developer
- **Preconditions:** Dev server has been started at least once after checkout
- **Steps:**
  1. Check that `packages/frontend/src/routeTree.gen.ts` exists and is non-empty.
- **Expected:** File exists and contains generated route tree code.

---

## S-39 Download Figma assets into packages/ui/src/assets/

**Issue:** [#39 Download Figma assets into packages/ui/src/assets/](https://github.com/eq-lab/pipeline/issues/39)
**Plan:** `docs/exec-plans/active/issue-39-figma-assets-download.md`

### TC-39-1: All required asset files are present

- **Actor:** Developer
- **Preconditions:** Checked out on the feat/39 branch (or later)
- **Steps:**
  1. Run `find packages/ui/src/assets -name "*.svg" | sort`
- **Expected:** Exactly 7 files are listed matching: `logo.svg`, `icons/nav-home.svg`, `icons/nav-dollar.svg`, `icons/nav-stats.svg`, `icons/nav-history.svg`, `icons/arrow-up-right.svg`, `illustrations/striped-wallet.svg`; all filenames are kebab-case.

### TC-39-2: All assets are valid SVG (not binary)

- **Actor:** Developer
- **Preconditions:** Files from TC-39-1 exist
- **Steps:**
  1. Run the asset check script: `for f in packages/ui/src/assets/logo.svg ... ; do head -c 200 "$f" | grep -qE '<\?xml|<svg' || echo "INVALID: $f"; done`
- **Expected:** All 7 files pass the SVG header check; none print "INVALID".

### TC-39-3: No Figma CDN URLs remain in source

- **Actor:** Developer
- **Preconditions:** Full checkout
- **Steps:**
  1. Run `grep -rn "figma\.com\|mcp/asset/" packages --include="*.ts" --include="*.tsx" --include="*.svg" --include="*.css"`
- **Expected:** Zero hits in source files (hits in docs/ are acceptable).

### TC-39-4: Icons use currentColor; logo and illustration retain brand fills

- **Actor:** Developer
- **Preconditions:** Files from TC-39-1 exist
- **Steps:**
  1. Open each `icons/*.svg` and confirm `fill="currentColor"` is present on glyph paths.
  2. Open `logo.svg` and `illustrations/striped-wallet.svg` and confirm literal fill colors (not `currentColor`).
- **Expected:** Nav icons and arrow-up-right use `currentColor`; logo and illustration have literal hex fills.

### TC-39-5: SVG root elements have no fixed width/height (viewBox only)

- **Actor:** Developer
- **Preconditions:** Files from TC-39-1 exist
- **Steps:**
  1. Check the opening `<svg>` tag of each file for `width=` or `height=` attributes.
- **Expected:** No fixed `width`/`height` on any root `<svg>`; all have `viewBox`.

### TC-39-6: Visual rendering of logo

- **Actor:** Developer / QA
- **Preconditions:** Asset static server running (or open file directly in browser)
- **Steps:**
  1. Open `logo.svg` in a browser.
- **Expected:** "Pipeline" wordmark with brand icon renders correctly.

### TC-39-7: Visual rendering of all nav icons

- **Actor:** Developer / QA
- **Preconditions:** Asset static server running
- **Steps:**
  1. Open each `icons/nav-*.svg` in a browser.
  2. Open `icons/arrow-up-right.svg`.
- **Expected:** `nav-home.svg` → house shape; `nav-dollar.svg` → dollar coin; `nav-stats.svg` → bar chart; `nav-history.svg` → arrow-clock; `arrow-up-right.svg` → diagonal up-right arrow.

### TC-39-8: Visual rendering of striped-wallet illustration

- **Actor:** Developer / QA
- **Preconditions:** Asset static server running
- **Steps:**
  1. Open `illustrations/striped-wallet.svg` in a browser.
- **Expected:** Striped wallet illustration renders as horizontal line-pattern artwork.

---

## S-40 Self-host the Figma typefaces in packages/ui

**Issue:** [#40 Self-host the Figma typefaces in packages/ui](https://github.com/eq-lab/pipeline/issues/40)
**Plan:** `docs/exec-plans/active/issue-40-self-host-figma-typefaces.md`

### TC-40-1: All required font files are present

- **Actor:** Developer
- **Preconditions:** Checked out on the feat/40 branch (or later)
- **Steps:**
  1. Run `ls packages/ui/src/assets/fonts/`
- **Expected:** The following files exist: `besley-regular.woff2`, `besley-bold.woff2`, `graphik-regular.woff2`, `graphik-medium.woff2`, `graphik-semibold.woff2`, `LICENSE.md`. All filenames are lowercase kebab-case.

### TC-40-2: Font weights match Figma spec

- **Actor:** Developer
- **Preconditions:** Storybook started (`yarn workspace @pipeline/ui storybook`)
- **Steps:**
  1. Open `http://localhost:6006/?path=/story/foundation-typography--scale`
  2. Inspect computed styles on each row via DevTools
- **Expected:** Title row: Besley w700 64px; Heading M: Besley w700 28px; Heading 20: Besley w400 20px; Body: Graphik LC w400 16px; Body Emphasized: Graphik LC w600 16px; Caption: Graphik LC w400 12px; Label: Graphik LC w500 12px.

### TC-40-3: No Google Fonts CDN imports

- **Actor:** Developer
- **Preconditions:** Full checkout
- **Steps:**
  1. Run `grep -rn "fonts.googleapis.com\|fonts.gstatic.com" packages/`
- **Expected:** Zero matches.

### TC-40-4: Font files load from same origin in Storybook and frontend

- **Actor:** Developer / QA
- **Preconditions:** Storybook and/or dev server running
- **Steps:**
  1. Open DevTools Network tab filtered to "Font"
  2. Navigate to the Typography story in Storybook
- **Expected:** All `.woff2` requests are served from `localhost` with HTTP 200; zero requests to `fonts.googleapis.com` or `fonts.gstatic.com`.

### TC-40-5: CSS custom properties resolve in browser

- **Actor:** Developer
- **Preconditions:** Storybook or frontend dev server running
- **Steps:**
  1. Open DevTools Console and run: `getComputedStyle(document.documentElement).getPropertyValue('--font-display')`
  2. Repeat for `--font-body`
- **Expected:** `--font-display` resolves to `"Besley", ui-serif, Georgia, serif`; `--font-body` resolves to `"Graphik LC", ui-sans-serif, system-ui, sans-serif`.

### TC-40-6: Storybook build succeeds

- **Actor:** Developer
- **Preconditions:** Clean repo state on feat/40 branch
- **Steps:**
  1. Run `yarn workspace @pipeline/ui build-storybook`
- **Expected:** Build completes with exit code 0; `storybook-static/` directory is produced; no font-related errors in output.

### TC-40-7: Frontend build emits font assets

- **Actor:** Developer
- **Preconditions:** feat/40 branch
- **Steps:**
  1. Run `yarn workspace @pipeline/frontend build`
  2. Check `packages/frontend/dist/assets/` for `.woff2` files
- **Expected:** Build succeeds (exit 0); `dist/assets/` contains hashed `.woff2` files for all 5 fonts.

### TC-40-8: font-display: swap is set on all @font-face blocks

- **Actor:** Developer
- **Preconditions:** `packages/ui/src/styles/theme.css` exists
- **Steps:**
  1. Open `packages/ui/src/styles/theme.css`
  2. Count `font-display: swap` occurrences vs number of `@font-face` blocks
- **Expected:** Every `@font-face` block includes `font-display: swap`.

### TC-40-9: LICENSE.md present and covers both families

- **Actor:** Developer
- **Preconditions:** feat/40 branch
- **Steps:**
  1. Open `packages/ui/src/assets/fonts/LICENSE.md`
- **Expected:** File contains a section for Besley (SIL OFL 1.1 with copyright) and a section for Graphik LC (commercial license provenance note with order number).

### TC-40-10: FRONTEND.md has Typography section

- **Actor:** Developer
- **Preconditions:** feat/40 branch
- **Steps:**
  1. Open `docs/FRONTEND.md` and search for "Typography"
- **Expected:** A short "Typography" section exists under "Visual direction" naming Besley (display) and Graphik LC (body), the location of `.woff2` files, and how to add a new weight.

---

## S-41 Define design tokens in Tailwind v4 @theme

**Issue:** [#41 Define design tokens in Tailwind v4 @theme](https://github.com/eq-lab/pipeline/issues/41)
**Plan:** `docs/exec-plans/active/issue-41-define-design-tokens-tailwind-theme.md`

### TC-41-1: @theme block declared in theme.css

- **Actor:** Developer
- **Preconditions:** Checked out on the feat/41 branch (or later)
- **Steps:**
  1. Open `packages/ui/src/styles/theme.css` and confirm `@theme { ... }` block is present after `:root { ... }`.
- **Expected:** A single `@theme` block exists containing `--color-pipeline-*`, `--text-pipeline-*`, `--font-weight-*`, `--radius-pipeline-*`, and `--tracking-pipeline-*` tokens, each with a one-line Figma node comment.

### TC-41-2: No raw hex codes outside theme.css

- **Actor:** Developer
- **Preconditions:** Full checkout
- **Steps:**
  1. Run `grep -rn "#[0-9a-fA-F]\{3,6\}" packages/ --include="*.ts" --include="*.tsx" --include="*.css" | grep -v theme.css`
- **Expected:** Zero matches (no raw hex codes in any source file outside `theme.css`).

### TC-41-3: Tailwind utilities reachable in frontend build

- **Actor:** Developer / QA
- **Preconditions:** `yarn workspace @pipeline/frontend build` has completed
- **Steps:**
  1. Inspect `packages/frontend/dist/assets/index-*.css`
  2. Search for `--color-pipeline-paper`, `--color-pipeline-brand`, `--font-weight-emphasized`, `--radius-pipeline-card`
- **Expected:** All pipeline token variables appear inside the `@layer theme { :root { … } }` block in the built CSS.

### TC-41-4: CSS custom properties resolve in browser (Storybook)

- **Actor:** Developer / QA
- **Preconditions:** Storybook dev server running (`http://localhost:6006`)
- **Steps:**
  1. Navigate to `http://localhost:6006/iframe.html?id=foundation-typography--scale`
  2. Open DevTools Console and run: `getComputedStyle(document.documentElement).getPropertyValue('--color-pipeline-paper')`
  3. Repeat for `--color-pipeline-brand`, `--font-weight-emphasized`, `--radius-pipeline-card`, `--text-pipeline-title`
- **Expected:** Each token resolves to its specified value: `#f8f7f6`, `#000080`, `600`, `4px`, `64px`.

### TC-41-5: CSS custom properties resolve in browser (frontend dev server)

- **Actor:** Developer / QA
- **Preconditions:** Frontend dev server running (`http://localhost:3000`)
- **Steps:**
  1. Open DevTools Console and run: `getComputedStyle(document.documentElement).getPropertyValue('--color-pipeline-paper')`
  2. Repeat for all 10 color, 10 type-ramp, 4 weight, 3 radius, and 1 tracking tokens
- **Expected:** All tokens resolve to their specified values (non-empty strings).

### TC-41-6: Tailwind utility classes apply correct styles

- **Actor:** Developer / QA
- **Preconditions:** Storybook or frontend dev server running
- **Steps:**
  1. In DevTools Console: `const d = document.createElement('div'); d.className = 'bg-pipeline-paper'; document.body.appendChild(d); getComputedStyle(d).backgroundColor`
  2. Repeat for `text-pipeline-ink`, `rounded-pipeline-card`, `font-display`, `font-body`
- **Expected:** `bg-pipeline-paper` → `rgb(248, 247, 246)`; `text-pipeline-ink` → `rgb(38, 37, 36)`; `rounded-pipeline-card` → `4px`; `font-display` → Besley family; `font-body` → Graphik LC family.

### TC-41-7: theme.css exported from @pipeline/ui

- **Actor:** Developer
- **Preconditions:** Full checkout
- **Steps:**
  1. Check `packages/ui/package.json` `exports` field for `"./styles/*"` entry.
  2. Confirm `packages/frontend/src/index.css` imports `@pipeline/ui/styles/theme.css`.
- **Expected:** Export entry `"./styles/*": "./src/styles/*"` exists; `index.css` has `@import "@pipeline/ui/styles/theme.css"`.

### TC-41-8: All tokens have Figma node comments

- **Actor:** Developer
- **Preconditions:** `packages/ui/src/styles/theme.css` exists
- **Steps:**
  1. Count token lines in `@theme` block.
  2. Count lines with `/* ... — node ... */` comments.
- **Expected:** Every token declaration line has a trailing comment naming the Figma variable or node ID.

### TC-41-9: FRONTEND.md has Design tokens section

- **Actor:** Developer
- **Preconditions:** Full checkout
- **Steps:**
  1. Open `docs/FRONTEND.md` and search for "Design tokens"
- **Expected:** A "Design tokens" subsection exists under "Visual direction" listing the token groups, file location, and no-raw-hex rule.

---

## S-50 Wire @pipeline/ui theme.css into frontend

**Issue:** [#50 Wire @pipeline/ui theme.css into frontend](https://github.com/eq-lab/pipeline/issues/50)
**Plan:** `docs/exec-plans/completed/` (feat/41-design-tokens branch)

### TC-50-1: Frontend build succeeds and bundles theme CSS

- **Actor:** Developer
- **Preconditions:** Checked out on the feat/41-design-tokens branch (or later)
- **Steps:**
  1. Run `yarn workspace @pipeline/frontend build`
- **Expected:** Build completes exit code 0; `dist/assets/index-*.css` exists and contains pipeline token variable names (`pipeline-paper`, `pipeline-brand`, `radius-pipeline`, `font-display`, `font-body`).

### TC-50-2: Dev server renders token-styled probe page with no console errors

- **Actor:** Developer / QA
- **Preconditions:** Dev server running at `http://localhost:3000`
- **Steps:**
  1. Navigate to `http://localhost:3000/`
  2. Check browser console for errors and warnings
- **Expected:** Page renders "Pipeline" heading in Besley serif on a warm off-white background with a bordered card; zero console errors or warnings (favicon 404 is acceptable).

### TC-50-3: All pipeline CSS custom properties resolve in dev server

- **Actor:** Developer / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Open DevTools Console and evaluate: `getComputedStyle(document.documentElement).getPropertyValue('--color-pipeline-paper')`
  2. Repeat for `--color-pipeline-brand`, `--color-pipeline-ink`, `--color-pipeline-ink-muted`, `--color-pipeline-surface`, `--color-pipeline-line`, `--font-display`, `--font-body`, `--radius-pipeline-card`, `--tracking-pipeline-label`, `--text-pipeline-title`, `--text-pipeline-body`, `--text-pipeline-caption`
- **Expected:** All return non-empty strings matching their spec values.

### TC-50-4: Tailwind utility classes apply correct token-driven styles

- **Actor:** Developer / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. In DevTools Console: create a div with class `bg-pipeline-paper text-pipeline-ink rounded-pipeline-card font-display`, append to body, check computed styles
- **Expected:** `backgroundColor` = `rgb(248, 247, 246)`; `color` = `rgb(38, 37, 36)`; `borderRadius` = `4px`; `fontFamily` starts with `Besley`.

### TC-50-5: Fonts load from same origin (no CDN)

- **Actor:** Developer / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Open DevTools Network tab filtered to font requests
- **Expected:** Font files are served from `localhost`; zero requests to `fonts.googleapis.com` or `fonts.gstatic.com`.

### TC-50-6: No duplicate Tailwind config — UI package is single token source

- **Actor:** Developer
- **Preconditions:** Full checkout
- **Steps:**
  1. Confirm `packages/frontend` has no separate `tailwind.config.*` file
  2. Confirm `packages/frontend/src/index.css` imports `@pipeline/ui/styles/theme.css` and adds `@source` for the UI workspace
- **Expected:** No `tailwind.config.*` in frontend; `index.css` has both the import and `@source "../../ui/src/**/*.{ts,tsx}"`.

### TC-50-7: main.tsx does NOT directly import theme.css (uses index.css instead)

- **Actor:** Developer
- **Preconditions:** Full checkout
- **Steps:**
  1. Open `packages/frontend/src/main.tsx` and search for `theme.css`
- **Expected:** `main.tsx` imports `./index.css` (not `@pipeline/ui/styles/theme.css` directly); theme is pulled in transitively via `index.css`.


## S-117 — /transactions route scaffold

**Issue:** [#117 Add /transactions file-based route in frontend](https://github.com/eq-lab/pipeline/issues/117)
**Plan:** `docs/exec-plans/active/issue-117-transactions-route.md`

### TC-117-1: History icon navigates to /transactions

- **Actor:** User / QA
- **Preconditions:** Dev server running, browser at `http://localhost:5173/`
- **Steps:**
  1. Observe the TopBar nav icons
  2. Click the history (clock) icon
- **Expected:** URL changes to `/transactions`; TopBar is visible with the history icon highlighted in brand colour; page body is blank below the bar; no console errors.

### TC-117-2: History icon active on /transactions

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:5173/transactions`
- **Expected:** History icon is active (brand colour); all other nav icons are muted.

### TC-117-3: Existing routes unaffected

- **Actor:** User / QA
- **Preconditions:** Dev server running; currently on `/transactions`
- **Steps:**
  1. Click the Home icon — URL becomes `/`; home icon active, history icon muted.
  2. Click the Convert (dollar) icon — URL becomes `/deposit`; convert icon active.
  3. Navigate back to `/transactions` — history icon active again.
- **Expected:** All three routes render correctly with the correct icon highlighted; no console errors at any step.

---

## Issue #101 — Deposit nav

### TC-101-1: Dollar icon navigates to /deposit

- **Actor:** User / QA
- **Preconditions:** Dev server running, browser at `http://localhost:5173/`
- **Steps:**
  1. Observe the TopBar nav icons
  2. Click the dollar (Convert) icon
- **Expected:** URL changes to `/deposit`; page body shows "Deposit"; dollar icon is highlighted with the brand colour; home icon is muted.

### TC-101-2: Home icon active on /

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:5173/`
- **Expected:** Home icon is active (brand colour); Convert icon is muted.

### TC-101-3: Back navigation restores home active state

- **Actor:** User / QA
- **Preconditions:** Dev server running; currently on `/deposit`
- **Steps:**
  1. Click browser Back button (or navigate to `/`)
- **Expected:** URL is `/`; home icon is active; dollar icon is muted.

---

## S-181 — EVM wallet connection with localStorage mock layer

**Issue:** [#181 EVM wallet connection with WalletConnect and localStorage mock layer](https://github.com/eq-lab/pipeline/issues/181)
**Plan:** `docs/exec-plans/active/issue-181-evm-wallet-connection.md`

### TC-181-1: Real connect against Hoodi

- **Actor:** User / QA
- **Preconditions:** Dev server running with a valid `VITE_WALLETCONNECT_PROJECT_ID` set in `.env`, `VITE_EVM_CHAIN_ID=560048`.
- **Steps:**
  1. Navigate to `http://localhost:3000/`.
  2. Click the "Connect Wallet" button in the TopBar.
  3. In the AppKit modal, choose a mobile wallet via WalletConnect and scan the QR code.
  4. Approve the connection in the mobile wallet app.
- **Expected:** AppKit modal opens; after approval the TopBar switches from the "Connect Wallet" button to the `WalletPill` showing the wallet's USDC balance (or "—" if `VITE_DEPOSIT_MANAGER_ADDRESS` is unset / the manager's `usdc()` view has not yet resolved). No console errors.

### TC-181-2: localStorage mock connect (zero RPC calls)

- **Actor:** Developer / QA
- **Preconditions:** Dev server running; NO real wallet connected.
- **Steps:**
  1. Open DevTools Console and run:
     ```js
     const usdcAddress = "0x2222000000000000000000000000000000000002";
     localStorage.setItem("pipeline.mock.wallet.address", "0x1234000000000000000000000000000000000000");
     localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
     localStorage.setItem("pipeline.mock.wallet.contract.depositManager.usdc", usdcAddress);
     localStorage.setItem(`pipeline.mock.wallet.contract.${usdcAddress}.decimals`, "6");
     localStorage.setItem(`pipeline.mock.wallet.contract.${usdcAddress}.symbol`, "USDC");
     localStorage.setItem(`pipeline.mock.wallet.balance.${usdcAddress}`, "1000000000");
     ```
  2. Observe the TopBar (no page reload needed).
  3. Open DevTools Network panel; confirm zero WebSocket / HTTP requests to a wallet relay or RPC endpoint.
- **Expected:** TopBar updates to the connected `WalletPill` showing `1,000.00` without a page reload. DevTools Network panel shows no new wallet-relay or RPC traffic.
- **Note:** `pipeline.mock.wallet.balance.usdc` was removed; balance is now keyed by token address. See `packages/frontend/src/wallet/README.md`.

### TC-181-3: Mock contract-read override

- **Actor:** Developer / QA
- **Preconditions:** Dev server running.
- **Steps:**
  1. In DevTools Console:
     ```js
     localStorage.setItem(
       "pipeline.mock.wallet.contract.0xabc123.balanceOf",
       JSON.stringify("42")
     );
     ```
  2. In any component that calls `useContractRead({ address: "0xabc123", abi, functionName: "balanceOf" })`, observe the returned `data` value.
- **Expected:** The hook returns `data === "42"` (the JSON-parsed mock) without issuing a real contract call.

---

## S-186 — ConversionCard two-card layout

**Issue:** [#186 Deposit: USDC + PLUSD inputs render as one outer card; Figma has two separate cards with 2px gap](https://github.com/eq-lab/pipeline/issues/186)
**Plan:** `docs/exec-plans/active/issue-186-conversion-card-two-cards.md`

### TC-186-1: Two separate cards with 2px gap on /deposit

- **Actor:** User / QA
- **Preconditions:** Dev server running at `http://localhost:3000`
- **Steps:**
  1. Navigate to `http://localhost:3000/deposit`
  2. Inspect the ConversionCard area between the DepositHeader and StepsCard
- **Expected:** Two visually distinct white rounded cards separated by a 2px gap; Card A contains USDC token row + quick-amount chips; Card B contains PLUSD token row + Exchange rate / Network fee rows; no single outer bordered card wrapping both.

### TC-186-2: Swap button straddles the 2px seam

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:3000/deposit`
  2. Observe the swap-arrows button (up/down arrows icon) between the two cards
- **Expected:** Swap button is horizontally centered; its vertical center aligns with the 2px gap between the two cards (within 1px tolerance); button has `rounded-[4px]` corners (not a full pill), white-to-paper gradient background, and hairline border.

### TC-186-3: Exchange rate and Network fee are inside Card B

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:3000/deposit`
  2. In DevTools Console: confirm `document.querySelector('.flex.flex-col.gap-[2px]').children[1].textContent` contains "Exchange rate" and "Network fee"
- **Expected:** Both info rows are contained within the second (PLUSD) card, not between or outside the two cards.

### TC-186-4: Same two-card layout on /deposit?direction=withdraw

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:3000/deposit?direction=withdraw`
- **Expected:** Same two-card structure as on /deposit (Card A = PLUSD input, Card B = USDC output + Exchange rate / Network fee); 2px gap; swap button straddling the seam.

### TC-186-5: Swap button toggles direction and clears the amount input

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:3000/deposit`
  2. Enter "500" in the amount input
  3. Click the swap button (swap-vertical icon between the two cards)
- **Expected:** URL changes to `/deposit?direction=withdraw`; amount input is cleared to empty; token labels flip (PLUSD → input, USDC → output); quick-amount chips switch from `Min / $5k / $10k / Max` to `25% / 50% / 75% / Max`; exchange-rate copy reads "1 PLUSD = 1 USDC". Clicking the swap button again returns to `/deposit` with the same label/chip reversal.

---

## S-198 — ActivityIcon tonal tile colours

**Issue:** [#198 Transactions: ActivityIcon renders every tile as solid ink; Figma uses success-green / warning-yellow / muted-neutral tones](https://github.com/eq-lab/pipeline/issues/198)
**Plan:** `docs/exec-plans/completed/issue-198-activity-icon-tones.md`

### TC-198-1: Success tile renders green with white glyph

- **Actor:** User / QA
- **Preconditions:** Dev server running at `http://localhost:5173`
- **Steps:**
  1. Navigate to `http://localhost:5173/transactions`
  2. Inspect the first row (PLUSD → USDC, completed)
  3. In DevTools Console: `getComputedStyle(document.querySelectorAll('.size-10.shrink-0')[0]).backgroundColor`
- **Expected:** Background is green (resolves to `--color-pipeline-success`, approx `rgb(58, 125, 68)`); glyph filter is `brightness(0) invert(1)` (white).

### TC-198-2: Warning tile renders amber/gold with white glyph

- **Actor:** User / QA
- **Preconditions:** Dev server running at `http://localhost:5173`
- **Steps:**
  1. Navigate to `http://localhost:5173/transactions`
  2. Inspect the second row (PLUSD → USDC, pending)
  3. In DevTools Console: `getComputedStyle(document.querySelectorAll('.size-10.shrink-0')[1]).backgroundColor`
- **Expected:** Background is amber/gold (resolves to `--color-pipeline-warning`, approx `rgb(181, 138, 0)`); glyph filter is `brightness(0) invert(1)` (white).

### TC-198-3: Neutral tiles render muted gray with dark glyph

- **Actor:** User / QA
- **Preconditions:** Dev server running at `http://localhost:5173`
- **Steps:**
  1. Navigate to `http://localhost:5173/transactions`
  2. Inspect rows 3–5 (Unstake, Stake, USDC → PLUSD)
  3. In DevTools Console: check `.size-10.shrink-0` elements at indices 2–4
- **Expected:** Each tile background resolves to `--color-pipeline-fill-muted` (transparent muted gray, approx `rgba(191, 189, 187, 0.12)`); glyph filter is `brightness(0)` (dark, no inversion).

### TC-198-4: No single uniform ink tile across all rows

- **Actor:** User / QA
- **Preconditions:** Dev server running at `http://localhost:5173`
- **Steps:**
  1. Navigate to `http://localhost:5173/transactions`
  2. Visually confirm five rows show three distinct tile colours
- **Expected:** Row 1 = green, Row 2 = amber/gold, Rows 3–5 = muted gray; no row uses `--color-pipeline-ink` (dark ink) as tile background.

### TC-198-5: ActivityIcon Storybook stories render all three tones

- **Actor:** Developer / QA
- **Preconditions:** Storybook running at `http://localhost:6006`
- **Steps:**
  1. Navigate to `ActivityIcon > Tone: success (completed)` story
  2. Navigate to `ActivityIcon > Tone: warning (pending)` story
  3. Navigate to `ActivityIcon > Tone: neutral (exchange)` story
- **Expected:** Each story renders the correct tile colour for its tone; success = green, warning = amber, neutral = muted gray.

---

## S-202 — Recent activity empty-state uses distinct 240×240 SVG

Moved to [`docs/user-stories/epic-463/202-recent-activity-empty-state.md`](./user-stories/epic-463/202-recent-activity-empty-state.md) (home page stories live with epic #463).

---
## S-224 Wire up header connected state — Account dropdown on WalletPill click

**Issue:** [#224 Wire up header connected state — open Account dropdown on WalletPill click](https://github.com/eq-lab/pipeline/issues/224)
**Plan:** `docs/exec-plans/active/issue-224-header-account-dropdown.md`

### TC-224-1: Header renders on every page (root layout)

- **Actor:** User / QA
- **Preconditions:** Dev server running; wallet disconnected (no mock keys)
- **Steps:**
  1. Navigate to `/`, `/deposit`, `/deposit?direction=withdraw`, `/stake`, `/transactions`
- **Expected:** The header (Pipeline logo + nav icons + Connect Wallet button) is visible on every page. No hardcoded `$10,000.00` balance appears anywhere.

### TC-224-2: Connected state shows WalletPill with USDC balance

- **Actor:** User / QA
- **Preconditions:** Dev server running; mock wallet set via DevTools console (see `wallet/README.md` quick-start snippet)
- **Steps:**
  1. Set the mock connected-wallet keys in DevTools console.
  2. Navigate to `/`, `/deposit`, `/deposit?direction=withdraw`, `/stake`, `/transactions`.
- **Expected:** The WalletPill with the USDC balance is identical on every route. The Connect Wallet button is absent.

### TC-224-3: Account dropdown opens on WalletPill click

- **Actor:** User / QA
- **Preconditions:** Dev server running; mock wallet connected
- **Steps:**
  1. Click the WalletPill in the header.
- **Expected:** An "Account" panel opens anchored below the pill, right-aligned. It contains: a truncated wallet address (`0xXXXX…XXXX`), the USDC balance, and a Disconnect button.

### TC-224-4: Dropdown dismissal — outside click, Escape, route change

- **Actor:** User / QA
- **Preconditions:** Account dropdown open
- **Steps:**
  1. Click outside the dropdown.
  2. Reopen; press Escape.
  3. Reopen; navigate to another page via the nav bar.
- **Expected:** Each action closes the dropdown.

### TC-224-5: Copy button writes full address to clipboard

- **Actor:** User / QA
- **Preconditions:** Account dropdown open
- **Steps:**
  1. Click the copy button next to the truncated address.
  2. Verify clipboard: `await navigator.clipboard.readText()` in DevTools console.
- **Expected:** Clipboard contains the full `0x…` address. A "Copied" affordance appears for ~1.5 s.

### TC-224-6: Active nav derived from URL (including /stake → Stats)

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `/stake`.
- **Expected:** The Stats nav icon is highlighted (active state). No `activeNav` prop is needed.

### TC-224-7: Disconnect button reverts to disconnected state

- **Actor:** User / QA
- **Preconditions:** Real wagmi wallet connected (not mock)
- **Steps:**
  1. Open the Account dropdown.
  2. Click Disconnect.
- **Expected:** Dropdown closes; header reverts to showing the Connect Wallet button.

---

## S-227 — Wire up /deposit logic — amount input, approval gating, low-balance banner

**Issue:** [#227 Wire up /deposit logic — amount input, approval gating, low-balance banner](https://github.com/eq-lab/pipeline/issues/227)
**Plan:** `docs/exec-plans/active/issue-227-wire-deposit-logic.md`

Mock setup reference (all examples use `VITE_DEPOSIT_MANAGER_ADDRESS` set to a real address in `.env`; when unset the spender defaults to the zero address — see bug #230):

```js
const usdc = "0x2222000000000000000000000000000000000002";
const dm   = "0x<DEPOSIT_MANAGER_ADDRESS>"; // must match VITE_DEPOSIT_MANAGER_ADDRESS
localStorage.setItem("pipeline.mock.wallet.address", "0x1234000000000000000000000000000000005678");
localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
localStorage.setItem("pipeline.mock.wallet.contract.depositManager.usdc", usdc);
localStorage.setItem("pipeline.mock.wallet.contract.depositManager.plusd", "0x3333000000000000000000000000000000000003");
localStorage.setItem("pipeline.mock.wallet.contract.depositManager.minDeposit", "1000000000"); // 1000 USDC at 6 dp
localStorage.setItem(`pipeline.mock.wallet.contract.${usdc}.decimals`, "6");
localStorage.setItem(`pipeline.mock.wallet.contract.${usdc}.symbol`, "USDC");
```

### TC-227-1: Approve-needed state — step 1 enabled, step 2 disabled

- **Actor:** User / QA
- **Preconditions:** Dev server running with `VITE_DEPOSIT_MANAGER_ADDRESS` set. Mock wallet connected with balance ≥ minDeposit and allowance = 0.
  ```js
  localStorage.setItem(`pipeline.mock.wallet.balance.${usdc}`, "5000000000");  // 5000 USDC
  localStorage.setItem(`pipeline.mock.wallet.allowance.${usdc}.${dm}`, "0");
  localStorage.setItem(`pipeline.mock.wallet.contract.${usdc}.approve`, JSON.stringify({ hash: "0xapprove" }));
  ```
- **Steps:**
  1. Navigate to `/deposit`.
  2. Type "2000" in the USDC input.
- **Expected:** Step 1 shows enabled "Approve" button. Step 2 Convert button is disabled. No success badge on step 1.

### TC-227-2: Approve click fires with correct amount

- **Actor:** User / QA
- **Preconditions:** TC-227-1 setup; DevTools console spy on `navigator.clipboard` or a console.log observer.
- **Steps:**
  1. With "2000" typed, click "Approve".
- **Expected:** Button briefly shows loading spinner (disabled + `aria-busy="true"`). After the mock resolves, step 1 transitions to the success badge ("Done") and step 2 Convert becomes enabled.

### TC-227-3: Approved state — step 1 success badge, step 2 enabled

- **Actor:** User / QA
- **Preconditions:** Dev server running with `VITE_DEPOSIT_MANAGER_ADDRESS` set. Mock wallet with balance ≥ amount and allowance ≥ amount.
  ```js
  localStorage.setItem(`pipeline.mock.wallet.balance.${usdc}`, "5000000000");
  localStorage.setItem(`pipeline.mock.wallet.allowance.${usdc}.${dm}`, "10000000000");  // 10000 USDC
  localStorage.setItem("pipeline.mock.wallet.contract.depositManager.requestDeposit", JSON.stringify({ hash: "0xdeposit", requestId: "42" }));
  ```
- **Steps:**
  1. Navigate to `/deposit`.
  2. Type "2000" in the USDC input.
- **Expected:** Step 1 shows green check badge + "Done". Step 2 Convert button is enabled. PLUSD output shows "2000" (1:1 ratio).

### TC-227-4: Convert click fires and transitions to loading

- **Actor:** User / QA
- **Preconditions:** TC-227-3 setup.
- **Steps:**
  1. With "2000" typed and step 1 in success state, click "Convert".
- **Expected:** Convert button briefly shows loading (disabled + `aria-busy="true"`). After mock resolves, button returns to enabled state. No console errors.

### TC-227-5: Disconnected — both step buttons disabled, no banner

- **Actor:** User / QA
- **Preconditions:** Dev server running; no mock wallet keys set.
- **Steps:**
  1. Navigate to `/deposit`.
- **Expected:** "Connect Wallet" button in header. USDC balance shows "—". Input is disabled. Both "Approve" and "Convert" buttons are disabled. No banner shown.

### TC-227-6: Insufficient balance — low-balance banner replaces StepsCard

- **Actor:** User / QA
- **Preconditions:** Mock wallet connected with balance < minDeposit.
  ```js
  localStorage.setItem(`pipeline.mock.wallet.balance.${usdc}`, "500000000");  // 500 USDC < 1000 min
  ```
- **Steps:**
  1. Navigate to `/deposit` (or trigger balance update via `window.dispatchEvent(new CustomEvent('pipeline-mock:wallet'))`).
- **Expected:** StepsCard is gone. Banner appears with: heading "Add funds to your USDC balance"; subtitle "Minimum amount — $1,000.00 USDC"; "Copy Address" button.

### TC-227-7: Copy Address — writes full address to clipboard, shows "Copied" affordance

- **Actor:** User / QA
- **Preconditions:** Insufficient-balance banner visible (TC-227-6 setup).
- **Steps:**
  1. Click "Copy Address".
  2. Check clipboard via `await navigator.clipboard.readText()` in DevTools.
- **Expected:** Button text changes to "Copied" immediately. Clipboard contains the full `0x…` wallet address. After ~1.5s the button reverts to "Copy Address".

### TC-227-8: Min quick-amount chip uses live minDeposit

- **Actor:** User / QA
- **Preconditions:** Mock wallet connected with minDeposit = 1000000000 (1000 USDC).
- **Steps:**
  1. Navigate to `/deposit`.
  2. Observe the first quick-amount chip label.
  3. Click the chip.
- **Expected:** Chip label is "$1,000.00 (Min)". Clicking it sets the USDC input to "1000.00" and PLUSD output mirrors the same value.

### TC-227-9: Max quick-amount chip uses live balance

- **Actor:** User / QA
- **Preconditions:** Mock wallet with balance = 5000000000 (5000 USDC).
- **Steps:**
  1. Navigate to `/deposit`.
  2. Click "Max".
- **Expected:** Input is set to "5000.00"; PLUSD output is "5000.00".

### TC-227-10: PLUSD output mirrors USDC input (1:1 exchange)

- **Actor:** User / QA
- **Preconditions:** Mock wallet connected.
- **Steps:**
  1. Navigate to `/deposit`.
  2. Type "3000" in the USDC input.
- **Expected:** PLUSD output area shows "3000". Exchange rate row shows "1 USDC = 1 PLUSD". Network fee shows "—".

---

## S-405 — /deposit: network fee shows live ETH estimate

**Issue:** [#405 /deposit: estimate network fee for representative 1000 USDC / 1000 PLUSD, refreshed once a minute](https://github.com/eq-lab/pipeline/issues/405)
**Plan:** `docs/exec-plans/active/issue-405-deposit-network-fee-estimate.md`

### TC-405-1: Network fee renders ETH amount for deposit direction

- **Actor:** User / QA
- **Preconditions:** Mock wallet connected; mock fee key set: `localStorage.setItem("pipeline.mock.wallet.networkFeeEstimate.deposit", '"0.00053"')`.
- **Steps:**
  1. Navigate to `http://localhost:5173/deposit?direction=deposit`.
  2. Observe the "Network fee" row in the Details section.
- **Expected:** Network fee row shows `~0.00053 ETH` (not `—`).

### TC-405-2: Network fee renders ETH amount for withdraw direction

- **Actor:** User / QA
- **Preconditions:** Mock wallet connected; mock fee key set: `localStorage.setItem("pipeline.mock.wallet.networkFeeEstimate.withdraw", '"0.00042"')`.
- **Steps:**
  1. Navigate to `http://localhost:5173/deposit?direction=withdraw`.
  2. Observe the "Network fee" row in the Details section.
- **Expected:** Network fee row shows `~0.00042 ETH`.

### TC-405-3: Network fee is decoupled from amount input

- **Actor:** User / QA
- **Preconditions:** Mock fee key set for deposit direction (TC-405-1).
- **Steps:**
  1. Navigate to `/deposit?direction=deposit`.
  2. Note the displayed fee.
  3. Type "500" in the USDC input.
  4. Clear and type "5000".
- **Expected:** Fee value does NOT change when the amount input changes (it is decoupled from the typed amount).

### TC-405-4: Network fee shows `—` when not configured

- **Actor:** User / QA
- **Preconditions:** No mock fee key set; `VITE_DEPOSIT_MANAGER_ADDRESS` is the zero address (or wallet disconnected).
- **Steps:**
  1. Navigate to `/deposit`.
  2. Observe the "Network fee" row.
- **Expected:** Network fee row shows `—`.

---

## S-238 — ActivityHeader HeroIcon glyph on /transactions

**Issue:** [#238 ActivityHeader hero icon renders as a black square on /transactions](https://github.com/eq-lab/pipeline/issues/238)
**Plan:** `docs/exec-plans/active/issue-238-heroicon-mask-url.md`

### TC-238-1: HeroIcon renders arrow-clock glyph (not black square)

- **Actor:** User / QA
- **Preconditions:** Dev server running at `http://localhost:3000`
- **Steps:**
  1. Navigate to `http://localhost:3000/transactions`
  2. Observe the 72×72 muted circle above the "Activity" heading
- **Expected:** The circle contains the arrow-clock glyph (clock face with circular arrow), rendered in ink color. No solid black square is visible.

### TC-238-2: HeroIcon mask-image resolves to a non-empty URL

- **Actor:** Developer / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:3000/transactions`
  2. In DevTools Console: `getComputedStyle(document.querySelector('div[style*="width: 72"] span')).maskImage`
- **Expected:** Returns a non-empty string starting with `url(` — not `"none"`.

### TC-238-3: HeroIcon mask properties present in DOM inline style

- **Actor:** Developer / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:3000/transactions`
  2. In DevTools Console: `document.querySelector('div[style*="width: 72"] span').style.maskImage`
- **Expected:** Returns a non-empty URL string (not empty string). The `maskImage` longhand property is present in the element's inline style.

### TC-238-4: chart (nav-stats) icon also renders correctly on /stake

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:3000/stake` (or whichever route uses the `chart` HeroIcon variant)
  2. Observe the HeroIcon above the page heading
- **Expected:** The bar-chart glyph is visible; no solid black square.

---

## S-247 — RecentActivityCard connected state shows recent requests

Moved to [`docs/user-stories/epic-463/247-recent-activity-connected.md`](./user-stories/epic-463/247-recent-activity-connected.md) (home page stories live with epic #463).

---
## S-246 — USDC CoinIcon replaces stale base64 PNG with authoritative SVG

**Issue:** [#246 USDC CoinIcon is a stale base64 PNG — replace with authoritative Figma asset](https://github.com/eq-lab/pipeline/issues/246)
**Plan:** `docs/exec-plans/completed/issue-246-usdc-coinicon-svg.md`

### TC-246-1: USDC icon in ConversionCard input row renders as SVG (not PNG)

- **Actor:** User / QA
- **Preconditions:** Dev server running at `http://localhost:5173`
- **Steps:**
  1. Navigate to `http://localhost:5173/deposit`
  2. In DevTools Console: `document.querySelectorAll('img')[1].src.slice(0, 20)`
- **Expected:** Returns `"data:image/svg+xml,"` (SVG data URI) — not `"data:image/png;base64"`. The USDC icon in the ConversionCard row is rendered from the new vector SVG.

### TC-246-2: USDC icon in WalletPill header renders as SVG

- **Actor:** User / QA
- **Preconditions:** Dev server running; mock wallet connected (see TC-181-2 setup)
- **Steps:**
  1. Navigate to any page (e.g., `http://localhost:5173/deposit`)
  2. In DevTools Console: `Array.from(document.querySelectorAll('img')).find(img => img.getAttribute('width') === '20')?.src?.slice(0, 20)`
- **Expected:** Returns `"data:image/svg+xml,"` — the WalletPill 20px USDC icon is an SVG, not a PNG.

### TC-246-3: USDC icon renders crisply at all three sizes — visual check on /deposit

- **Actor:** User / QA
- **Preconditions:** Dev server running; mock wallet connected
- **Steps:**
  1. Navigate to `http://localhost:5173/deposit`
  2. Visually inspect: (a) WalletPill header icon (20px), (b) ConversionCard USDC row icon (40px), (c) DepositHeader hero icon (note: this is PLUSD, not USDC — expected to remain PNG until #159 or a PLUSD follow-up)
- **Expected:** USDC icons at 20px and 40px display as a crisp blue circle with dollar mark — no aliasing, no pixelation, no blurry rasterisation artefacts.

### TC-246-4: USDC icon renders correctly on /withdraw output row

- **Actor:** User / QA
- **Preconditions:** Dev server running; mock wallet connected
- **Steps:**
  1. Navigate to `http://localhost:5173/withdraw`
  2. Inspect the Card B USDC output row icon
  3. In DevTools Console: `Array.from(document.querySelectorAll('img')).find(img => img.closest('div')?.textContent?.includes('USDC') && img.getAttribute('width') === '40')?.src?.slice(0, 20)`
- **Expected:** Returns `"data:image/svg+xml,"`. USDC output icon on withdraw is also crisp vector SVG.

### TC-246-5: PLUSD and sPLUSD icons are visually unchanged

- **Actor:** User / QA
- **Preconditions:** Dev server running; mock wallet connected
- **Steps:**
  1. Navigate to `http://localhost:5173/deposit`
  2. Inspect the PLUSD row icon (Card B) — should still be a base64 PNG (out-of-scope tokens)
  3. Navigate to `http://localhost:5173/`; inspect any PLUSD icon
- **Expected:** PLUSD and sPLUSD icons still render (may appear slightly blurry vs. USDC, which is expected and pre-existing). No regression — they were PNG before and remain PNG after this change.

### TC-246-6: coin-usdc.svg is pure vector — no embedded raster

- **Actor:** Developer
- **Preconditions:** Repo checkout on fix/246 branch or later
- **Steps:**
  1. Run `grep -c "data:image/png" packages/ui/src/assets/icons/coin-usdc.svg`
- **Expected:** Output is `0` — the SVG file contains no embedded PNG data URI.

---

## S-257 — /transactions striped-clock empty state

**Issue:** [#257 Show striped-clock empty state on /transactions when there are no requests](https://github.com/eq-lab/pipeline/issues/257)
**Figma:** [1993:9144](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1993-9144&m=dev)

### TC-257-1: Disconnected wallet shows illustration + caption

- **Actor:** User / QA
- **Preconditions:** Dev server running; no mock wallet keys in localStorage
- **Steps:**
  1. Navigate to `http://localhost:3000/transactions`
- **Expected:** `ActivityEmptyIllustration` (striped-clock SVG, `tone="muted"`, `width=240`) and caption "You will see all transactions here" render in the body region below the SegmentedTabs. The bare "No activity yet" text is absent. Wrapper has `min-h-[400px]` with flex centering.

### TC-257-2: Connected + zero API rows shows illustration + caption

- **Actor:** User / QA
- **Preconditions:** Dev server running; mock wallet connected; `pipeline.mock.api.GET./v1/requests` = `{ requests: [] }`
- **Steps:**
  1. Set mock: `localStorage.setItem('pipeline.mock.api.GET./v1/requests', JSON.stringify({ requests: [] }))`
  2. Navigate to `http://localhost:3000/transactions`
- **Expected:** Same illustration + caption as TC-257-1. WalletPill shows balance. No rows rendered. No "No activity yet" text.

### TC-257-3: Connected + data; active tab empty shows full illustration (not muted text)

- **Actor:** User / QA
- **Preconditions:** Dev server running; mock connected; API returns only Deposit rows; Sell tab active
- **Steps:**
  1. Set mock with only `Deposit` rows.
  2. Navigate to `/transactions`. Default "Buy" tab shows rows.
  3. Click "Sell" tab (which has zero rows).
- **Expected:** The full `ActivityEmptyIllustration` (`tone="muted"`, `width=240`) and "You will see all transactions here" caption render — same as the disconnected / zero-rows case. The muted text "No Sell activity yet" is absent. (Deliberate reversal of original #257 design — see #261.)

---

## S-250 — Home Connect-Wallet section: wired Connect + Portfolio placeholder when connected

Moved to [`docs/user-stories/epic-463/250-home-connect-portfolio-placeholder.md`](./user-stories/epic-463/250-home-connect-portfolio-placeholder.md) (home page stories live with epic #463).

---
## S-389 — Home Portfolio chart: stacked-bars monotonic-growth + hover tooltip

Moved to [`docs/user-stories/epic-463/389-portfolio-stacked-bars-chart.md`](./user-stories/epic-463/389-portfolio-stacked-bars-chart.md) (home page stories live with epic #463).

---
## S-261 — /transactions: full empty state on per-tab empty results

**Issue:** [#261 /transactions: show full empty state on per-tab empty results, not just text](https://github.com/eq-lab/pipeline/issues/261)
**Plan:** `docs/exec-plans/active/issue-261-transactions-tab-empty-illustration.md`
**Figma:** [1993:9144](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1993-9144&m=dev)

### TC-261-1: Connected + data; empty tab renders illustration + caption (not text)

- **Actor:** User / QA
- **Preconditions:** Dev server running; mock wallet connected with one Deposit row in `/v1/requests`
  ```js
  const usdc = "0x2222000000000000000000000000000000000002";
  localStorage.setItem("pipeline.mock.wallet.address", "0x1234000000000000000000000000000000000000");
  localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
  localStorage.setItem("pipeline.mock.wallet.contract.depositManager.usdc", usdc);
  localStorage.setItem(`pipeline.mock.wallet.contract.${usdc}.decimals`, "6");
  localStorage.setItem(`pipeline.mock.wallet.contract.${usdc}.symbol`, "USDC");
  localStorage.setItem(`pipeline.mock.wallet.balance.${usdc}`, "5000000000");
  localStorage.setItem("pipeline.mock.api.GET./v1/requests", JSON.stringify({
    requests: [{ type: "Deposit", amount: "1000000000", request_id: "1", status: "Completed", created_at: "2026-05-15T12:00:00Z" }]
  }));
  ```
- **Steps:**
  1. Navigate to `http://localhost:5173/transactions`
  2. Confirm Buy tab shows the one Deposit row
  3. Click the "Sell" tab
  4. Click the "Stake" tab
  5. Click the "Unstake" tab
- **Expected:**
  - On each empty tab (Sell, Stake, Unstake): `ActivityEmptyIllustration` (`tone="muted"`, `width=240`) + "You will see all transactions here" caption render inside a `min-h-[400px]` flex-centered wrapper.
  - "No Sell/Stake/Unstake activity yet" text is absent on every tab.
  - Switching back to "Buy" still shows the Deposit row.

### TC-261-2: Regression — disconnected wallet still shows illustration + caption

- **Actor:** User / QA
- **Preconditions:** Dev server running; no `pipeline.mock.*` keys in localStorage
- **Steps:**
  1. Navigate to `http://localhost:5173/transactions`
- **Expected:** `ActivityEmptyIllustration` (`tone="muted"`) + "You will see all transactions here" caption render. "Connect Wallet" button in header.

### TC-261-3: Regression — connected + zero API rows still shows illustration + caption

- **Actor:** User / QA
- **Preconditions:** Dev server running; mock wallet connected; `pipeline.mock.api.GET./v1/requests` = `{ requests: [] }`
- **Steps:**
  1. Navigate to `http://localhost:5173/transactions`
- **Expected:** Same illustration + caption as TC-261-2. WalletPill shows balance.

---

## S-310 — Wire up /stake — Stake (Approve → Stake) and Unstake flows via sPLUSD vault

**Issue:** [#310 Wire up /stake — Stake and Unstake flows via sPLUSD vault](https://github.com/eq-lab/pipeline/issues/310)
**Plan:** `docs/exec-plans/active/issue-310-stake-unstake-wiring.md`

Mock setup — add these keys in DevTools Console before navigating to `/stake`. Because `VITE_STAKED_PLUSD_ADDRESS` is unset in the default `.env`, the app uses the zero address (`0x0000...0000`) as `splusdAddr`. Mock keys must use this address for sPLUSD balance and allowance:

```js
const PLUSD = "0x3333000000000000000000000000000000000003";
const ZERO  = "0x0000000000000000000000000000000000000000"; // splusdAddr in local dev
const USDC  = "0x2222000000000000000000000000000000000002";
localStorage.setItem("pipeline.mock.wallet.address", "0x1234000000000000000000000000000000000000");
localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
localStorage.setItem("pipeline.mock.wallet.contract.depositManager.usdc", USDC);
localStorage.setItem(`pipeline.mock.wallet.contract.${USDC}.decimals`, "6");
localStorage.setItem(`pipeline.mock.wallet.contract.${USDC}.symbol`, "USDC");
localStorage.setItem(`pipeline.mock.wallet.balance.${USDC}`, "5000000000");
localStorage.setItem("pipeline.mock.wallet.contract.stakedPlusd.asset", PLUSD);
localStorage.setItem(`pipeline.mock.wallet.contract.${PLUSD}.decimals`, "18");
localStorage.setItem(`pipeline.mock.wallet.contract.${PLUSD}.symbol`, "PLUSD");
localStorage.setItem(`pipeline.mock.wallet.contract.${ZERO}.decimals`, "18");
localStorage.setItem(`pipeline.mock.wallet.contract.${ZERO}.symbol`, "sPLUSD");
localStorage.setItem("pipeline.mock.wallet.contract.stakedPlusd.convertToShares", "959600000000000000");
localStorage.setItem("pipeline.mock.wallet.contract.stakedPlusd.convertToAssets", "1042100000000000000");
```

### TC-310-1: Stake tab — allowance=0, Approve enabled, Stake disabled

- **Actor:** User / QA
- **Preconditions:** Dev server running; mock wallet connected (see setup above); PLUSD balance ≥ amount; allowance = 0.
  ```js
  localStorage.setItem(`pipeline.mock.wallet.balance.${PLUSD}`, "100000000000000000000"); // 100 PLUSD
  localStorage.setItem(`pipeline.mock.wallet.balance.${ZERO}`, "0");
  localStorage.setItem(`pipeline.mock.wallet.allowance.${PLUSD}.${ZERO}`, "0");
  localStorage.setItem(`pipeline.mock.wallet.contract.${PLUSD}.approve`, JSON.stringify({ hash: "0xapprove111" }));
  ```
- **Steps:**
  1. Navigate to `http://localhost:<port>/stake`.
  2. Type "50" in the PLUSD input.
- **Expected:** Step 1 "Allow Pipeline to use PLUSD" → Approve button is enabled. Step 2 "Confirm and stake PLUSD" → Stake button is disabled. No Done badge on step 1.

### TC-310-2: Stake tab — allowance≥amount, step 1 Done, Stake enabled → click → Done

- **Actor:** User / QA
- **Preconditions:** Mock wallet; PLUSD balance 100; allowance = 1000 PLUSD (covers any amount ≤ 100).
  ```js
  localStorage.setItem(`pipeline.mock.wallet.balance.${PLUSD}`, "100000000000000000000");
  localStorage.setItem(`pipeline.mock.wallet.balance.${ZERO}`, "0");
  localStorage.setItem(`pipeline.mock.wallet.allowance.${PLUSD}.${ZERO}`, "1000000000000000000000");
  localStorage.setItem("pipeline.mock.wallet.contract.stakedPlusd.stake", JSON.stringify({ hash: "0xabc1", shares: "9596000000000000000" }));
  ```
- **Steps:**
  1. Navigate to `/stake`; type "50" in the PLUSD input.
  2. Observe step states.
  3. Click "Stake".
- **Expected:**
  - Before click: step 1 shows "Approve complete" (Done badge); step 2 "Stake" is enabled.
  - After click: step 2 shows "Stake complete" (Done badge). Stake button becomes disabled.

### TC-310-3: Unstake tab — sPLUSD balance present, Unstake enabled → click → Done

- **Actor:** User / QA
- **Preconditions:** Mock wallet; sPLUSD balance = 50; PLUSD balance = 100.
  ```js
  localStorage.setItem(`pipeline.mock.wallet.balance.${PLUSD}`, "100000000000000000000");
  localStorage.setItem(`pipeline.mock.wallet.balance.${ZERO}`, "50000000000000000000"); // 50 sPLUSD
  localStorage.setItem(`pipeline.mock.wallet.allowance.${PLUSD}.${ZERO}`, "0");
  localStorage.setItem("pipeline.mock.wallet.contract.stakedPlusd.unstake", JSON.stringify({ hash: "0xde11", assets: "52105000000000000000" }));
  ```
- **Steps:**
  1. Navigate to `/stake`; click the "Unstake" tab.
  2. Type "25" in the sPLUSD input.
  3. Click "Unstake".
- **Expected:** Step shows "Unstake complete" Done badge. No approval step visible on Unstake tab.

### TC-310-4: Tab switch resets input and clears Done badges (no stale state bleed)

- **Actor:** User / QA
- **Preconditions:** TC-310-2 completed (stake success state visible).
- **Steps:**
  1. With "Stake complete" badge on step 2, click the "Unstake" tab.
  2. Observe the Unstake tab content.
  3. Click back to "Stake" tab.
- **Expected:**
  - On Unstake tab: amount input is empty; only the single "Unstake" step is visible; no "Stake complete" or "Approve complete" badge from the Stake tab.
  - On Stake tab: amount input is empty; step 1 Approve is disabled (no amount); no stale Done badges.

### TC-310-5: Quick-amount chips operate on active input token balance

- **Actor:** User / QA
- **Preconditions:** Mock wallet; PLUSD balance = 100 (Stake tab active).
- **Steps:**
  1. On Stake tab: click "25%" chip → note input value.
  2. Click "Max" chip → note input value.
  3. Switch to Unstake tab (sPLUSD balance = 50): click "50%" chip → note input value.
- **Expected:** 25% on Stake → "25.00". Max on Stake → "100.00". 50% on Unstake → "25.00".

### TC-310-6: Disconnected wallet — all action buttons disabled on both tabs

- **Actor:** User / QA
- **Preconditions:** Dev server running; no mock wallet keys in localStorage.
- **Steps:**
  1. Navigate to `/stake`.
  2. Observe Stake tab; then switch to Unstake tab.
- **Expected:** Header shows "Connect Wallet". Both balances show "—". Input disabled on both tabs. Approve and Stake disabled on Stake tab. Unstake disabled on Unstake tab. No LowBalanceBanner or other banner rendered.

### TC-310-7: Zero balance — buttons gated, no banner rendered

- **Actor:** User / QA
- **Preconditions:** Mock wallet connected; PLUSD balance = 0; sPLUSD balance = 0.
- **Steps:**
  1. Navigate to `/stake`.
  2. Enter any amount in the Stake tab input.
  3. Switch to Unstake tab; enter any amount.
- **Expected:** Approve and Stake remain disabled (hasBalance = false). Unstake remains disabled. No LowBalanceBanner or any banner element rendered. The StepsCard chrome is present but buttons are gated.

### TC-310-8: Exchange rate row (BLOCKED by #322 in local dev without VITE_STAKED_PLUSD_ADDRESS)

- **Actor:** User / QA
- **Preconditions:** `VITE_STAKED_PLUSD_ADDRESS` set to a valid address in `.env`; mock `convertToShares` rate = `959600000000000000`.
- **Steps:**
  1. Navigate to `/stake`; Stake tab active.
  2. Observe "Exchange rate" info row.
- **Expected:** "1 PLUSD = 0.9596 sPLUSD".
- **Note:** BLOCKED in default local dev env — `isZeroAddress` guard in `useStakedPlusdConvertToShares` short-circuits before the mock path when `VITE_STAKED_PLUSD_ADDRESS` is unset. See bug #322.

### TC-310-9: Preview output row (BLOCKED by #322 in local dev without VITE_STAKED_PLUSD_ADDRESS)

- **Actor:** User / QA
- **Preconditions:** Same as TC-310-8.
- **Steps:**
  1. Navigate to `/stake`; type "50" in the PLUSD input.
  2. Observe the sPLUSD output card value.
- **Expected:** sPLUSD output shows "47.9800" (50 × 0.9596).
- **Note:** BLOCKED by same root cause as TC-310-8 (#322).

---

## S-315 — Header nav icon hover tooltips

**Issue:** [#315 Add hover tooltips to header nav icons](https://github.com/eq-lab/pipeline/issues/315)
**Plan:** `docs/exec-plans/active/issue-315-icon-button-tooltips.md`
**Figma:** [2074:7187 — frame "Hovers"](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=2074-7187&m=dev)

### TC-315-1: Tooltip DOM present and hidden at rest

- **Actor:** User / QA
- **Preconditions:** Dev server running at `http://localhost:3000`; no hover active
- **Steps:**
  1. Navigate to `http://localhost:3000/`
  2. In DevTools Console: inspect each nav button for a second `span[aria-hidden="true"]`
  3. Check computed `opacity` of each tooltip span at rest
- **Expected:** Each of the four nav buttons (Home, Deposit, Stats, History) has a `<span aria-hidden="true">` tooltip child with the button's label text. At rest: `opacity: 0`, `position: absolute`, `pointer-events: none`. Button is `position: relative` (positioning context). No visual tooltip visible.

### TC-315-2: Tooltip appears on hover — all four nav buttons

- **Actor:** User / QA
- **Preconditions:** Dev server running; navigate to `/`
- **Steps:**
  1. Hover over the Home nav button
  2. Observe tooltip below the button; check computed `opacity`
  3. Repeat for Deposit, Stats, History
- **Expected:**
  - Each hovered button shows its tooltip (`opacity: 1`) centred directly below the icon (~8px gap = `mt-2`).
  - Tooltip text matches the button label (Home / Deposit / Stats / History).
  - Only the hovered button's tooltip is visible; siblings remain at `opacity: 0`.
  - No layout shift — sibling buttons do not move.

### TC-315-3: Tooltip appears on keyboard focus-visible

- **Actor:** User / QA (keyboard user)
- **Preconditions:** Dev server running; Tab through the header
- **Steps:**
  1. Tab into the header nav (past any focusable elements before it)
  2. Observe the focused nav button
- **Expected:** The focused button's tooltip becomes visible (`opacity: 1`) via `:focus-visible`. Non-focused buttons remain hidden.

### TC-315-4: Tooltip styling matches design tokens (no hardcoded colors)

- **Actor:** Developer / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. In DevTools Console: check `--color-pipeline-ink`, `--color-pipeline-on-dark`, `--text-pipeline-caption`, `--radius-pipeline-button`
  2. Verify tooltip computed `backgroundColor`, `color`, `fontSize`, `borderRadius` match those token values
- **Expected:**
  - `backgroundColor` = `--color-pipeline-ink` = `#262524` → `rgb(38, 37, 36)`
  - `color` = `--color-pipeline-on-dark` = `#ffffff` → `rgb(255, 255, 255)`
  - `fontSize` = `--text-pipeline-caption` = `12px`
  - `borderRadius` = `--radius-pipeline-button` = `4px`
  - No hardcoded hex colors in the tooltip class string.

### TC-315-5: Tooltip does not appear on logo or Connect Wallet button

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Hover over the Pipeline logo
  2. Hover over the "Connect Wallet" header button
  3. Inspect those elements for tooltip spans
- **Expected:** Neither the logo nor the Connect Wallet button has a tooltip span child (`querySelectorAll('span[aria-hidden="true"]').length` = 0 for Connect Wallet; logo is an `<img>` not an `IconButton`).

### TC-315-6: Tooltip position is centred below the button (horizontal alignment)

- **Actor:** Developer / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. In DevTools Console: compare `getBoundingClientRect()` center X of the button vs. the tooltip span for any nav button
- **Expected:** Horizontal center of tooltip aligns with horizontal center of button within ±2px.

### TC-315-7: No layout shift — button dimensions unchanged

- **Actor:** Developer / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. In DevTools Console: `getBoundingClientRect()` on each nav button
- **Expected:** Each button is exactly 40×40px. Tooltip (absolutely positioned) does not affect button or sibling dimensions.

### TC-315-8: Active nav state unchanged (regression)

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `/transactions`
  2. Inspect computed `color` on the History button and the other three nav buttons
- **Expected:** History button `color` = `rgb(0, 0, 128)` (`--color-pipeline-brand`), `aria-pressed="true"`. Other three buttons `color` = `rgba(56, 55, 53, 0.6)` (`--color-pipeline-ink-muted`). Active-state derivation is unaffected by the tooltip addition.

---

## S-354 — /withdraw: PLUSD balance shown and input interactable

**Issue:** [#354 /withdraw: PLUSD balance not shown and amount input is uninteractable](https://github.com/eq-lab/pipeline/issues/354)
**Plan:** `docs/exec-plans/active/issue-354-withdraw-uninteractable.md`

Mock setup for all TC-354 cases (run in DevTools Console, all addresses lowercase):

```js
const PLUSD = "0x18d6ccaf8d363309a6c283eea8b2c68d107016b7";
const USDC  = "0x2222000000000000000000000000000000000002";
const WQ    = "0xb9f148312a85ec1d3f4512ff04de6b21a4d12c58";
localStorage.setItem("pipeline.mock.wallet.address", "0x1234000000000000000000000000000000000000");
localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
localStorage.setItem("pipeline.mock.wallet.contract.withdrawalQueue.plusd", "0x18D6cCaF8D363309A6C283eEA8b2C68D107016b7");
localStorage.setItem("pipeline.mock.wallet.contract.withdrawalQueue.usdc", "0x2222000000000000000000000000000000000002");
localStorage.setItem(`pipeline.mock.wallet.contract.${PLUSD}.decimals`, "18");
localStorage.setItem(`pipeline.mock.wallet.contract.${PLUSD}.symbol`, "PLUSD");
localStorage.setItem(`pipeline.mock.wallet.balance.${PLUSD}`, "500000000000000000000"); // 500 PLUSD
localStorage.setItem(`pipeline.mock.wallet.allowance.${PLUSD}.${WQ}`, "0");
localStorage.setItem(`pipeline.mock.wallet.contract.${PLUSD}.approve`, JSON.stringify({ hash: "0xapprove111" }));
```

### TC-354-1: Connected — balance shown and input enabled

- **Actor:** User / QA
- **Preconditions:** Dev server running; mock wallet set per setup above (allowance=0).
- **Steps:**
  1. Navigate to `/withdraw`.
  2. Observe PLUSD balance label and the amount input.
- **Expected:** PLUSD balance shows "500.00" (not "—"). The amount input is enabled (not disabled). The four chips (25%, 50%, 75%, Max) are interactive. All three step buttons (Approve, Confirm, Claim) are disabled (no amount entered yet).

### TC-354-2: Amount entry enables Approve; chips set correct amounts

- **Actor:** User / QA
- **Preconditions:** TC-354-1 setup; dev server running.
- **Steps:**
  1. Type "100" in the PLUSD amount input.
  2. Observe step buttons; note USDC output.
  3. Click Max chip; observe input value.
  4. Click 25% chip; observe input value.
- **Expected:**
  - After typing "100": Approve button is enabled; Confirm and Claim remain disabled. USDC output shows "+100".
  - Max chip: input becomes "500.00"; USDC output "+500.00".
  - 25% chip: input becomes "125.00" (500 × 0.25); USDC output "+125.00".
  - Exchange rate shows "1 PLUSD = 1 USDC".

### TC-354-3: Approved state — step 1 Done, Confirm enabled

- **Actor:** User / QA
- **Preconditions:** Mock wallet; allowance set to 1000 PLUSD (covers any amount ≤ 500).
  ```js
  const PLUSD = "0x18d6ccaf8d363309a6c283eea8b2c68d107016b7";
  const WQ    = "0xb9f148312a85ec1d3f4512ff04de6b21a4d12c58";
  localStorage.setItem(`pipeline.mock.wallet.allowance.${PLUSD}.${WQ}`, "1000000000000000000000");
  localStorage.setItem("pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal", JSON.stringify({ hash: "0xrequest111", requestId: "42" }));
  ```
- **Steps:**
  1. Navigate to `/withdraw`; type "125" in the input.
  2. Observe step 1 state and step 2 button.
- **Expected:** Step 1 shows "Approve complete" Done badge (green check). Step 2 "Confirm PLUSD burn" button is enabled. Claim remains disabled.

### TC-354-4: Confirm click fires requestWithdrawal and shows toast

- **Actor:** User / QA
- **Preconditions:** TC-354-3 setup with allowance ≥ amount.
- **Steps:**
  1. With amount "125" entered and step 1 in Done state, click "Confirm".
- **Expected:** A "Withdrawal submitted" success toast appears at bottom-right (`role="status"`, `aria-live="polite"`). Confirm button becomes disabled after submission.

### TC-354-5: Disconnected — balance "—", input disabled, all buttons disabled, no banner

- **Actor:** User / QA
- **Preconditions:** Dev server running; no mock wallet keys in localStorage.
- **Steps:**
  1. Navigate to `/withdraw`.
- **Expected:** "Connect Wallet" button in header. PLUSD balance shows "—". Input is disabled. Approve, Confirm, Claim all disabled. No "WithdrawalQueue not reachable" banner visible (queue not yet queried without connection).

---

## S-359 — Merge /deposit and /withdraw into one route with direction param and swap button

**Issue:** [#359 /deposit ↔ /withdraw — merge into one route, switch via URL param + the swap button between inputs](https://github.com/eq-lab/pipeline/issues/359)
**Plan:** `docs/exec-plans/active/issue-359-merge-deposit-withdraw-routes.md`

All tests run against the feature branch dev server (port 4359). App URL: `http://localhost:4359`.

### TC-359-1: /withdraw redirects to /deposit?direction=withdraw (address bar updates)

- **Actor:** User / QA
- **Preconditions:** Dev server running; navigate directly to `/withdraw` (external bookmark simulation)
- **Steps:**
  1. Navigate to `http://localhost:4359/withdraw`
  2. Observe the address bar immediately after navigation
  3. Press browser back button
- **Expected:**
  - Address bar updates to `/deposit?direction=withdraw` — not `/withdraw`
  - Page shows withdraw direction (PLUSD input, 25/50/75/Max chips, "Allow Pipeline to use PLUSD", "Confirm PLUSD burn", "Claim your USDC")
  - Back button returns to the previous page (NOT to `/withdraw`) — confirming `replace: true`

### TC-359-2: Direct nav to /deposit shows deposit direction

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:4359/deposit`
  2. Observe the address bar and page content
- **Expected:**
  - Address bar normalizes to `/deposit?direction=deposit`
  - Page shows deposit direction: USDC input, Min/$5k/$10k/Max chips, "1 USDC = 1 PLUSD", "Allow Pipeline to use USDC", "Confirm USDC transfer", "Claim your PLUSD"
  - TopBar Convert icon is active (`aria-pressed="true"`)

### TC-359-3: Direct nav to /deposit?direction=withdraw shows withdraw direction

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:4359/deposit?direction=withdraw`
  2. Observe page content
- **Expected:**
  - Address bar stays at `/deposit?direction=withdraw`
  - Page shows withdraw direction: PLUSD input, 25/50/75/Max chips, "1 PLUSD = 1 USDC", "Allow Pipeline to use PLUSD", "Confirm PLUSD burn", "Claim your USDC"
  - "Switch direction" button is present in the ConversionCard (disabled when wallet disconnected)
  - TopBar Convert icon is active

### TC-359-4: Garbage direction param falls back to deposit

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:4359/deposit?direction=hodor`
  2. Observe address bar and page content
- **Expected:**
  - Address bar normalizes to `/deposit?direction=deposit`
  - Page shows deposit direction (USDC input, Min chips)

### TC-359-5: Swap button click — deposit → withdraw; amount clears; chips/labels flip

- **Actor:** User / QA
- **Preconditions:** Dev server running; mock wallet connected (USDC balance ≥ 5000)
  ```js
  const usdc = "0x2222000000000000000000000000000000000002";
  localStorage.setItem("pipeline.mock.wallet.address", "0x1234000000000000000000000000000000005678");
  localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
  localStorage.setItem("pipeline.mock.wallet.contract.depositManager.usdc", usdc);
  localStorage.setItem("pipeline.mock.wallet.contract.depositManager.plusd", "0x5555000000000000000000000000000000000005");
  localStorage.setItem("pipeline.mock.wallet.contract.depositManager.minDeposit", "1000000000");
  localStorage.setItem(`pipeline.mock.wallet.contract.${usdc}.decimals`, "6");
  localStorage.setItem(`pipeline.mock.wallet.contract.${usdc}.symbol`, "USDC");
  localStorage.setItem(`pipeline.mock.wallet.balance.${usdc}`, "5000000000");
  ```
- **Steps:**
  1. Navigate to `http://localhost:4359/deposit?direction=deposit`
  2. Type "2000" in the USDC input
  3. Click the "Switch direction" button between the two cards
  4. Observe address bar, input, chips, exchange-rate copy, step labels
- **Expected:**
  - Address bar changes to `/deposit?direction=withdraw`
  - Amount input is cleared to empty
  - Input token flips to PLUSD; output shows USDC
  - Chips switch to 25% / 50% / 75% / Max
  - Exchange rate reads "1 PLUSD = 1 USDC"
  - Step 1: "Allow Pipeline to use PLUSD"; Step 2: "Confirm PLUSD burn"; Step 3: "Claim your USDC"
  - History length is unchanged (swap uses `replace: true`)

### TC-359-6: Swap back — withdraw → deposit; mirrors TC-359-5 in reverse

- **Actor:** User / QA
- **Preconditions:** TC-359-5 completed; currently on `/deposit?direction=withdraw`
- **Steps:**
  1. Click the "Switch direction" button again
- **Expected:**
  - Address bar changes to `/deposit?direction=deposit`
  - Amount input is cleared
  - Chips switch back to Min / $5k / $10k / Max
  - Exchange rate reads "1 USDC = 1 PLUSD"
  - Step labels revert to deposit copy
  - History length unchanged (replace: true)

### TC-359-7: Swap button disabled when any tx is in-flight

- **Actor:** User / QA
- **Preconditions:** Mock wallet connected; PendingVerification request seeded via mock API
  ```js
  localStorage.setItem("pipeline.mock.api.GET./v1/requests", JSON.stringify({ requests: [{
    type: "Deposit", amount: "2000000000", request_id: "42",
    status: "PendingVerification", created_at: "2026-05-22T10:00:00Z"
  }] }));
  localStorage.setItem("pipeline.mock.wallet.contract.depositManager.requestDeposit", JSON.stringify({ hash: "0xabc123", requestId: "42" }));
  ```
- **Steps:**
  1. Navigate to `http://localhost:4359/deposit?direction=deposit`
  2. Reload (so mock request is loaded)
  3. Observe the "Switch direction" button
- **Expected:**
  - The amount input is locked to "2000.00" (in-flight state)
  - The "Switch direction" button has `disabled` attribute
  - Clicking the button does nothing / cannot navigate

### TC-359-8: TopBar Convert icon stays active on both deposit and withdraw direction

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:4359/deposit?direction=deposit`
  2. Inspect Convert button: `document.querySelector('[aria-label="Convert"]').getAttribute('aria-pressed')`
  3. Navigate to `http://localhost:4359/deposit?direction=withdraw`
  4. Inspect Convert button again
- **Expected:** `aria-pressed="true"` on both. `data-active="true"` on both. The `direction` param does not affect the active nav icon derivation (only the pathname `/deposit` matters).

### TC-359-9: Regression — /withdraw?foo=bar preserves extra params in redirect

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `http://localhost:4359/withdraw?foo=bar`
  2. Observe address bar
- **Expected:** Redirects to `/deposit?foo=bar&direction=withdraw` — the `foo=bar` param survives the redirect hop.

### TC-359-10: Regression — all routes have correct active nav after merge

- **Actor:** User / QA
- **Preconditions:** Dev server running
- **Steps:**
  1. Navigate to `/` → check Home active
  2. Navigate to `/deposit?direction=deposit` → check Convert active
  3. Navigate to `/deposit?direction=withdraw` → check Convert active
  4. Navigate to `/stake` → check Earn active
  5. Navigate to `/transactions` → check Activity active
- **Expected:** Each route highlights exactly one nav icon. No two icons are simultaneously active. The `/withdraw` route branch is removed from `derivedActive` without regression.

### TC-354-6: WithdrawalQueue unreachable banner appears after RPC failure (KNOWN BUG #357)

- **Actor:** Developer / QA
- **Preconditions:** Mock wallet connected (isConnected=true) but no withdrawalQueue mock keys set (forcing real RPC path).
- **Steps:**
  1. Navigate to `/withdraw` and wait ~4 seconds for the `fromToken()`/`intoToken()` RPC calls to fail.
  2. Check console for `[useWithdrawalQueueAddresses] fromToken() read failed` errors.
  3. Inspect the DOM for `[data-testid="wq-unreachable-banner"]`.
- **Expected:**
  - Console shows two `console.error` messages: `[useWithdrawalQueueAddresses] fromToken() read failed` and `intoToken() read failed`.
  - A "WithdrawalQueue not reachable. Check VITE_WITHDRAWAL_QUEUE_ADDRESS and RPC connectivity." banner replaces the StepsCard in the UI, rendered as a red danger card.
- **Note:** Console error surfacing PASSES. Banner DOM presence PASSES. Banner visual rendering is BLOCKED by bug #357 (banner text is white-on-white due to Tailwind specificity issue — `bg-[var(--color-pipeline-surface)]` from Card base overrides `bg-[var(--color-pipeline-danger)]` from className prop).

---

## S-385 First-connection terms acknowledgement modal

**Issue:** [#385 First-connection terms acknowledgement modal gates wallet connect](https://github.com/eq-lab/pipeline/issues/385)
**Plan:** `docs/exec-plans/active/issue-385-first-connection-terms-modal.md`

### TC-385-1: Gate fires on first connect (no prior ack)

- **Actor:** First-time visitor
- **Preconditions:** `localStorage` is clear (or `pipeline.wallet.termsAcknowledged.*` keys are absent); dev server running on `feat/385-first-connection-modal` branch (port 5378 in pipeline-background-2 worktree)
- **Steps:**
  1. Navigate to `/`
  2. Click **Connect Wallet** in the TopBar
- **Expected:**
  - "Before you continue" modal appears (scrim over page)
  - The AppKit wallet picker does NOT open
  - Modal heading: "Before you continue"
  - Toggle is OFF; Continue button is disabled (visually ~32% opacity)

### TC-385-2: Continue disabled until toggle on

- **Actor:** Same visitor
- **Preconditions:** Modal is open (TC-385-1 state)
- **Steps:**
  1. Click **Continue** while toggle is off
- **Expected:** Nothing happens; AppKit does not open

### TC-385-3: Toggle on enables Continue

- **Actor:** Same visitor
- **Preconditions:** Modal is open, toggle is off
- **Steps:**
  1. Click the toggle switch
- **Expected:**
  - Toggle becomes ON (green `#208000` track)
  - Continue button becomes enabled (solid `#262524` background, full opacity)

### TC-385-4: Continue with toggle on — ack persisted + AppKit opens

- **Actor:** Same visitor
- **Preconditions:** Modal is open, toggle is ON
- **Steps:**
  1. Click **Continue**
- **Expected:**
  - Modal closes
  - AppKit wallet picker opens
  - `localStorage` — after connecting a wallet — contains `pipeline.wallet.termsAcknowledged.<address>` = `"true"` (or `pipeline.wallet.termsAcknowledged.pending` = `"true"` before the address is resolved)

### TC-385-5: Dismiss paths — no ack persisted

- **Actor:** Visitor who changes their mind
- **Preconditions:** Modal is open, toggle is off (or on)
- **Steps (run each independently):**
  1. Click **Disconnect** button
  2. Click the **×** close button (top-right corner)
  3. Click the **scrim** (dark overlay outside the modal)
  4. Press **Escape**
- **Expected for each:**
  - Modal closes
  - AppKit does NOT open
  - `pipeline.wallet.termsAcknowledged.*` keys remain absent

### TC-385-6: Second connect skips gate

- **Actor:** Returning visitor who already acknowledged
- **Preconditions:** `pipeline.wallet.termsAcknowledged.<address>` is set to `"true"` in localStorage (simulated after a successful TC-385-4 flow or set manually)
- **Steps:**
  1. Navigate to `/`
  2. Click **Connect Wallet**
- **Expected:**
  - Modal does NOT appear
  - AppKit wallet picker opens directly

### TC-385-7: Clearing localStorage restores the gate

- **Actor:** Developer / QA
- **Preconditions:** User has previously acknowledged (TC-385-4)
- **Steps:**
  1. In DevTools console: `localStorage.removeItem('pipeline.wallet.termsAcknowledged.<address>')`
  2. Click **Connect Wallet** again
- **Expected:** Modal appears again (gate restored)

### TC-385-8: Keyboard navigation

- **Actor:** Keyboard-only user
- **Preconditions:** Modal is open
- **Steps:**
  1. Press **Tab** repeatedly
  2. Press **Shift+Tab** to cycle back
  3. Focus the toggle and press **Space**
  4. Tab to Continue and press **Enter**
  5. Reopen modal, press **Escape**
- **Expected:**
  - Tab cycles only among: toggle switch, Continue, Disconnect, Terms of Service link
  - Space on toggle flips it (Space → on, Space again → off)
  - Enter on Continue (when toggle on) calls through to AppKit
  - Escape closes the modal; focus returns to the Connect Wallet button

---

## S-450 — Stellar UI wiring: dropdown toggle, TopBar pill, connect chooser modal

**Issue:** [#450 [FE] [Stellar] UI wiring: dropdown toggle, TopBar pill, connect chooser modal](https://github.com/eq-lab/pipeline/issues/450)
**Plan:** `docs/exec-plans/active/issue-450-stellar-ui-wiring.md`
**Figma:** node families `1506:104728` (dropdown), `1497:94715` / `1498:100168` (TopBar/WalletPill)

### TC-450-1: Disconnected — "Connect Wallet" opens ConnectChooserModal

- **Actor:** User / QA
- **Preconditions:** Dev server running; no wallet mock keys in localStorage
- **Steps:**
  1. Navigate to `http://localhost:5450/`
  2. Click "Connect Wallet" in the TopBar header
- **Expected:**
  - A dialog opens with heading "Connect a wallet"
  - Body text: "Choose which wallet to connect. You can connect both."
  - Two CTA buttons: "Connect EVM" and "Connect Stellar"
  - `role="dialog"`, `aria-modal="true"`, `width=380px`, `borderRadius=32px`, `backgroundColor=rgb(248,247,246)`, `padding=24px`
  - Close (×) button present in top-right

### TC-450-2: ConnectChooserModal dismissal — Escape, scrim click, × button

- **Actor:** User / QA
- **Preconditions:** ConnectChooserModal open (TC-450-1 state)
- **Steps (run each independently):**
  1. Press **Escape**
  2. Reopen; click the scrim (overlay outside the panel)
  3. Reopen; click the **×** Close button
- **Expected for each:** Modal closes; "Connect Wallet" button returns in the TopBar; no wallet connected

### TC-450-3: EVM connected — WalletPill shows EVM balance; dropdown shows segmented control

- **Actor:** User / QA
- **Preconditions:** Dev server running; EVM wallet mocked:
  ```js
  const usdc = "0x2222000000000000000000000000000000000002";
  localStorage.setItem("pipeline.mock.wallet.address", "0x1234000000000000000000000000000000005678");
  localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
  localStorage.setItem("pipeline.mock.wallet.contract.depositManager.usdc", usdc);
  localStorage.setItem(`pipeline.mock.wallet.contract.${usdc}.decimals`, "6");
  localStorage.setItem(`pipeline.mock.wallet.contract.${usdc}.symbol`, "USDC");
  localStorage.setItem(`pipeline.mock.wallet.balance.${usdc}`, "1500000000");
  ```
- **Steps:**
  1. Observe the TopBar — "Connect Wallet" replaced by WalletPill showing `$1,500.00`
  2. Click the WalletPill
- **Expected:**
  - WalletPill shows `$1,500.00` (EVM balance)
  - AccountDropdown opens with `role="menu" aria-label="Account"`
  - Segmented control (`role="tablist" aria-label="Wallet namespace"`) with EVM tab `aria-selected="true"` and Stellar tab `aria-selected="false"`
  - Wallet address row shows `0x1234…5678` (truncated EVM address)
  - USDC balance row shows `$1,500.00`
  - Disconnect button present

### TC-450-4: Dropdown toggle — switching to Stellar (not connected) shows connect affordance, hides Disconnect

- **Actor:** User / QA
- **Preconditions:** TC-450-3 setup; AccountDropdown open
- **Steps:**
  1. Click the "Stellar" tab in the segmented control
- **Expected:**
  - Stellar tab becomes `aria-selected="true"`; EVM tab `aria-selected="false"`
  - Panel shows: "Stellar wallet not connected" caption + "Connect Stellar" button
  - Disconnect button is hidden
  - WalletPill in header still shows "$1,500.00" (EVM balance via cross-namespace fallback — see bug #456)

### TC-450-5: Dropdown toggle — EVM connected, switch Stellar, switch back — EVM not disconnected

- **Actor:** User / QA
- **Preconditions:** TC-450-3 setup
- **Steps:**
  1. Open dropdown; click Stellar tab; click EVM tab again
- **Expected:**
  - EVM panel restores: `0x1234…5678` address, `$1,500.00` balance, Disconnect button
  - EVM mock keys still in localStorage (toggle is view-only, never disconnects)

### TC-450-6: Both namespaces connected — toggle switches pill and panel

- **Actor:** User / QA
- **Preconditions:** EVM mocked (TC-450-3) + Stellar mocked:
  ```js
  localStorage.setItem("pipeline.mock.wallet.stellar.address", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
  localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
  localStorage.setItem("pipeline.mock.wallet.stellar.balance.usdc", "750.00");
  ```
- **Steps:**
  1. Observe WalletPill: EVM view → should show `$1,500.00`
  2. Click pill; click Stellar tab
  3. Observe WalletPill and panel
- **Expected:**
  - After switching to Stellar tab: WalletPill updates to `$750.00`
  - Panel shows Stellar address `GBBD47…FLA5` (6+4 truncation), `$750.00` balance, Disconnect button
  - Switching back to EVM tab: WalletPill reverts to `$1,500.00`, EVM address and balance shown

### TC-450-7: Pill balance when active namespace disconnected (known bug #456)

- **Actor:** User / QA
- **Preconditions:** Only EVM connected (TC-450-3 setup); Stellar tab selected in dropdown
- **Steps:**
  1. With Stellar tab active and Stellar not connected, close dropdown
  2. Observe WalletPill text
- **Expected (per plan spec):** `"—"` — active namespace (Stellar) has no balance
- **Actual (current implementation):** `$1,500.00` — cross-namespace fallback to EVM balance
- **Note:** Bug #456 filed (medium)

### TC-450-8: AccountDropdown dismissal — outside click, Escape, route change

- **Actor:** User / QA
- **Preconditions:** EVM mocked; AccountDropdown open
- **Steps:**
  1. Click outside the dropdown (on page body)
  2. Reopen; press Escape
  3. Reopen; click a nav button (e.g. "Convert")
- **Expected for each:** Dropdown closes; WalletPill still visible with balance

### TC-450-9: ConnectChooserModal — focus trap and tab cycling

- **Actor:** User / QA (keyboard)
- **Preconditions:** ConnectChooserModal open
- **Steps:**
  1. Tab through all focusable elements; note order
  2. Press Shift+Tab from the first element
- **Expected:**
  - Tab cycles among: Close (×), Connect EVM, Connect Stellar
  - Shift+Tab from Close wraps to Connect Stellar (last)

### TC-450-10: Stellar address truncation — 56-char G… strkey renders as 6+4 chars

- **Actor:** Developer / QA
- **Preconditions:** Both EVM and Stellar mocked (TC-450-6 setup); Stellar tab selected in dropdown
- **Steps:**
  1. In DevTools Console:
     ```js
     const walletGroup = document.querySelector('[aria-label="Wallet address"]');
     walletGroup.querySelector('.font-mono').textContent
     ```
- **Expected:** Returns `"GBBD47…FLA5"` — first 6 chars + ellipsis + last 4 chars of the 56-char Stellar strkey
