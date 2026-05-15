# QUALITY SCORE

MVP quality bars. All targets must be met before mainnet launch.

## UX Testing Log

### 2026-05-15 — Issue #202 (Recent activity empty-state illustration)

- **Scope:** Issue #202 acceptance criteria (TC-202-1 through TC-202-4)
- **Cases executed:** 4
- **Passes:** 4
- **Failures:** 0
- **Blocked:** 1 (TC-202-4 Storybook — pre-existing Tailwind v4/Storybook CSS issue; component DOM verified correct)
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-202-1 (no WalletIllustration in RecentActivityCard): `document.querySelector('[data-node-id="1497:94567"] img')` = null; `data-tone` = `"muted"`; zero `<img>` elements inside the card.
  - PASS TC-202-2 (240×240 square, correct SVG mask): `aspectRatio = "1 / 1"`, `width = "240px"`, `maskImage` contains `striped-activity-empty.svg`. Color resolves to `rgba(56, 55, 53, 0.6)` = `--color-pipeline-ink-muted`.
  - PASS TC-202-3 (ConnectWalletPromoCard unchanged): Promo card span has `maskImage` = `striped-wallet.svg`, `aspectRatio = "313.672 / 200"`, `tone = "primary"`. The landscape wallet illustration is untouched.
  - PASS TC-202-4 (Storybook stories exist): `ActivityEmptyIllustration.stories.tsx` has `Muted` and `Primary` story exports; story metadata is correct. Visual rendering in Storybook blocked by pre-existing Tailwind v4 CSS issue (tokens not applied in Storybook context) — not a regression from #202.
  - SVG asset `striped-activity-empty.svg` confirmed 240×240 viewBox with ~94 stroke paths using `currentColor` + no fixed w/h attributes.
  - Console errors: only pre-existing WalletConnect/Reown 403/400 errors, Lit dev-mode warning, font preload warning — none related to #202.
  - No new bugs filed.

### 2026-05-14 — Issue #198 (ActivityIcon tonal tile colours)

- **Scope:** Issue #198 acceptance criteria (TC-198-1 through TC-198-5)
- **Cases executed:** 5
- **Passes:** 4
- **Failures:** 0
- **Blocked:** 1
- **Bugs filed:** none
- **Score: 9/10**
  - PASS TC-198-1 (success tile — green, white glyph): Tile 0 `backgroundColor = rgb(58, 125, 68)` = `--color-pipeline-success`; `img` filter = `brightness(0) invert(1)`. Visual screenshot confirms green tile with white check-circle icon.
  - PASS TC-198-2 (warning tile — amber/gold, white glyph): Tile 1 `backgroundColor = rgb(181, 138, 0)` = `--color-pipeline-warning`; `img` filter = `brightness(0) invert(1)`. Visual screenshot confirms amber tile with white clock icon.
  - PASS TC-198-3 (neutral tiles — muted gray, dark glyph): Tiles 2–4 `backgroundColor = rgba(191, 189, 187, 0.12)` = `--color-pipeline-fill-muted`; `img` filter = `brightness(0)`. All three neutral rows (Unstake, Stake, USDC → PLUSD) confirmed.
  - PASS TC-198-4 (no uniform ink tile): No tile uses `--color-pipeline-ink`. Three distinct tones visible in screenshot; original bug (all tiles dark ink) is resolved.
  - BLOCKED TC-198-5 (Storybook tones): Storybook iframe renders blank — CSS token utilities do not apply in Storybook context. The component DOM is correct (`bg-[var(--color-pipeline-success)]` class present, token `--color-pipeline-success` = `#3a7d44` resolves in the iframe) but the Tailwind utility class does not generate a CSS rule for Storybook. This is the pre-existing Storybook/Tailwind v4 CSS issue, not a regression from #198.
  - Console errors: only pre-existing WalletConnect/Reown 403/400 errors and favicon 404; none related to this issue.
  - Deducted 1 point: Storybook visual verification blocked by pre-existing CSS issue.

### 2026-05-14 — Issue #186 (Deposit: ConversionCard two-card layout)

- **Scope:** Issue #186 acceptance criteria (TC-186-1 through TC-186-4)
- **Cases executed:** 4
- **Passes:** 4
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-186-1 (two cards with 2px gap on /deposit): DOM confirms `flex flex-col gap-[2px]` outer wrapper; Card A (`relative` wrapper containing TokenInput with `bg-[var(--color-pipeline-surface)] border … rounded-[var(--radius-pipeline-card)]`) at y=241–391; Card B (`block rounded-[…] border … bg-[var(--color-pipeline-surface)]`) at y=393–555; CSS `rowGap` = 2px; pixel gap between card borders = 2px. No single outer bordered wrapper.
  - PASS TC-186-2 (swap button straddles seam): Swap button rect top=371 bottom=411 (center y=391); gap midpoint y=392; deviation = 1px (within 1px tolerance). Button has `borderRadius: 4px`, `backgroundImage: linear-gradient(rgb(255, 255, 255) 0%, rgb(248, 247, 246) 100%)`, `border: 1px solid rgba(56, 55, 53, 0.18)`, size 40×40px. No full-pill rounding.
  - PASS TC-186-3 (Exchange rate/Network fee inside Card B): `cardB.textContent` contains both "Exchange rate" and "Network fee". `TokenAmountDisplay` inside Card B has computed `backgroundColor: rgba(0,0,0,0)`, `borderStyle: none`, `borderRadius: 0px` — inline style override suppresses its self-styling correctly. Info rows contained in a `flex flex-col gap-2 pb-2` child of Card B.
  - PASS TC-186-4 (same layout on /withdraw): Withdraw page renders same two-card structure (Card A = PLUSD input with chips, Card B = USDC output + details); visual gap = 2px; swap button centered on seam; all gradient/border/radius checks match.
  - Console errors on both pages: only pre-existing WalletConnect/Reown 403 errors (no VITE_WALLETCONNECT_PROJECT_ID in local env), Lit dev-mode warning, and font preload warning — none related to this issue.
  - Storybook: all 3 stories (Default, WithSelectedAmount, MaxSelected) render correct two-section DOM structure. CSS tokens not applying in Storybook is a pre-existing issue unrelated to #186.

### 2026-05-13 — Issue #117 (Add /transactions file-based route in frontend)

- **Scope:** Issue #117 acceptance criteria (TC-117-1 through TC-117-3)
- **Cases executed:** 3
- **Passes:** 3
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-117-1 (click navigation): From `/`, clicking the History icon navigates to `/transactions`; URL changes, History button has `pressed` state (brand navy), all other nav icons muted; page body is blank below the TopBar; zero console errors.
  - PASS TC-117-2 (direct navigation): Direct navigation to `http://localhost:3000/transactions` renders TopBar with History icon active (`pressed`), all other icons muted; body blank.
  - PASS TC-117-3 (existing routes unaffected): From `/transactions`, clicking Home returns to `/` with Home icon active and full page content; clicking Convert navigates to `/deposit` (pre-existing bug #131 — TopBar absent on deposit — not regression); returning to `/transactions` re-activates History icon. Hard refresh on `/transactions` resolves client-side with no 404; sole network 404 is the pre-existing `favicon.ico` (known since #38).
  - Decision recorded: human approver chose "wire it" — `history` entry in `NAV_ITEMS` has `to: "/transactions"` and `derivedActive` maps `/transactions` → `"history"`. Stories TC-117-1 through TC-117-3 in `docs/STORIES.md` correctly reflect the wired implementation.

### 2026-05-13 — Issue #101 (Add /deposit file-based route in frontend)

- **Scope:** Issue #101 acceptance criteria (TC-101-1 through TC-101-3)
- **Cases executed:** 3
- **Passes:** 2
- **Failures:** 0
- **Blocked:** 1
- **Bugs filed:** #131 (medium)
- **Score: 7/10**
  - PASS TC-101-2 (build): `yarn workspace @pipeline/frontend build` exits 0; route tree regenerated with `/deposit` entry; `routeTree.gen.ts` contains the deposit route.
  - PASS TC-101-1 (navigation): Clicking the Convert (dollar) nav button from `/` navigates to `/deposit`; page body shows "Deposit"; URL is correct.
  - PASS TC-101-3 (back navigation): Browser Back from `/deposit` returns to `/`; Home button is `pressed` (active) and Convert is muted.
  - BLOCKED TC-101-1 (active icon state): The deposit page renders only `<main>Deposit</main>` — the TopBar is absent. The dollar icon active-state highlight cannot be verified. Filed as #131 (medium). The Issue spec allows a placeholder body but `docs/STORIES.md` TC-101-1 expects the active icon to be visible; this is a story/spec gap.
  - Deducted 3 points: active-state verification blocked by missing TopBar on the placeholder deposit page (medium severity defect).

### 2026-05-12 — Issue #50 (Wire @pipeline/ui theme.css into frontend)

- **Scope:** Issue #50 acceptance criteria (TC-50-1 through TC-50-7)
- **Cases executed:** 7
- **Passes:** 7
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-50-1: `yarn workspace @pipeline/frontend build` exits 0; built CSS contains `pipeline-paper`, `pipeline-brand`, `radius-pipeline`, `font-display`, `font-body`.
  - PASS TC-50-2: Dev server at `http://localhost:3000` renders token-styled probe (Besley heading, warm paper bg, bordered card). Zero console errors or warnings.
  - PASS TC-50-3: All 13 checked CSS custom properties resolve to their correct spec values in the running dev server (`--color-pipeline-paper` = `#f8f7f6`, `--color-pipeline-brand` = `#000080`, etc.).
  - PASS TC-50-4: Tailwind utility classes `bg-pipeline-paper`, `text-pipeline-ink`, `rounded-pipeline-card`, `font-display` all produce correct computed styles.
  - PASS TC-50-5: Font files (`besley-bold.woff2`, `graphik-regular.woff2`) load from `localhost`; zero CDN requests.
  - PASS TC-50-6: No `tailwind.config.*` in `packages/frontend`; `index.css` has both `@import "@pipeline/ui/styles/theme.css"` and `@source "../../ui/src/**/*.{ts,tsx}"`.
  - PASS TC-50-7: `main.tsx` imports `./index.css` only; `theme.css` is not directly imported in `main.tsx`.

### 2026-05-12 — Issue #41 (Define design tokens in Tailwind v4 @theme)

- **Scope:** Issue #41 acceptance criteria (TC-41-1 through TC-41-9)
- **Cases executed:** 9
- **Passes:** 5
- **Failures:** 3
- **Blocked:** 1
- **Bugs filed:** #71 (critical), #72 (low)
- **Score: 3/10**
  - PASS TC-41-1: `@theme` block is present in `theme.css` with all expected token groups and Figma node comments.
  - PASS TC-41-7: `theme.css` is exported via `"./styles/*"` entry in `packages/ui/package.json`; `index.css` imports it correctly.
  - PASS TC-41-8: All token declaration lines have trailing Figma node comments.
  - PASS TC-41-9: `docs/FRONTEND.md` has a "Design tokens" subsection under "Visual direction" naming token groups and the no-raw-hex rule.
  - PASS TC-41-5 (partial — font vars only): `--font-display` and `--font-body` resolve correctly in both dev server and Storybook.
  - **FAIL TC-41-3:** Built CSS `@layer theme` contains only `--font-display` and `--font-body`. All 27 other pipeline tokens (`--color-pipeline-*`, `--text-pipeline-*`, `--font-weight-*`, `--radius-pipeline-*`, `--tracking-pipeline-*`) are completely absent from the production output. Tailwind v4 JIT prunes tokens that have no corresponding utility class usage in scanned source files. Root cause: `@theme` in an imported file without the `inline` keyword; tokens are silently dropped when no utility class references them. Filed as #71 (critical).
  - **FAIL TC-41-4:** All pipeline CSS custom properties return empty string in both Storybook and frontend dev server. `--color-pipeline-paper`, `--color-pipeline-brand`, `--font-weight-emphasized`, `--radius-pipeline-card`, `--text-pipeline-title` all empty. See #71.
  - **FAIL TC-41-6:** Tailwind utility classes `bg-pipeline-paper`, `text-pipeline-ink`, `rounded-pipeline-card`, `font-display`, `font-body` all produce no styling — no CSS is generated for them. See #71.
  - **FAIL TC-41-2:** `Typography.stories.tsx` contains raw hex codes (`#e5e7eb`, `#6b7280`, `#9ca3af`, `#374151`, `#fff`, `#f9fafb`) in inline style props. Filed as #72 (low).
  - **BLOCKED TC-41-5 (full):** Cannot test full token resolution until #71 is fixed.
  - Deducted 7 points: the core acceptance criterion ("all tokens reachable via Tailwind utilities") is completely unmet — no pipeline utility class works in any environment. This is a critical spec-contract failure.

### 2026-05-12 — Issue #40 (Self-host the Figma typefaces in packages/ui)

- **Scope:** Issue #40 acceptance criteria (TC-40-1 through TC-40-10)
- **Cases executed:** 10
- **Passes:** 8
- **Failures:** 2
- **Blocked:** 0
- **Bugs filed:** #68 (medium), #69 (low)
- **Score: 7/10**
  - All 5 font files present (besley-regular, besley-bold, graphik-regular, graphik-regular-italic, graphik-medium); LICENSE.md present with both family sections.
  - Zero Google Fonts CDN references in source (`fonts.googleapis.com`, `fonts.gstatic.com`).
  - All font requests served from localhost with HTTP 200; no CDN requests detected in DevTools Network.
  - CSS custom properties `--font-display` and `--font-body` resolve correctly in both Storybook and frontend app.
  - Storybook build succeeds; frontend build succeeds and emits all 5 `.woff2` files into `dist/assets/`.
  - All 5 `@font-face` blocks include `font-display: swap`.
  - Besley renders correctly at w400 and w700; Graphik LC renders at w400, w500, and italic w400.
  - **FAIL TC-40-1/TC-40-2:** Graphik LC semibold (w600) font file is missing — no `graphik-semibold.woff2`, no `@font-face` for w600, and the Typography story renders Body Emphasized at w500 instead of w600 (Figma spec: 16/22 w600). Filed as #68.
  - **FAIL TC-40-10:** `docs/FRONTEND.md` has no Typography section — the plan required appending one under "Visual direction". Filed as #69.
  - Deducted 3 points: missing w600 weight is a spec mismatch (medium severity); missing docs update is a plan deliverable gap (low severity).

### 2026-05-12 — Issue #39 (Download Figma assets into packages/ui/src/assets/)

- **Scope:** Issue #39 acceptance criteria (TC-39-1 through TC-39-8)
- **Cases executed:** 8
- **Passes:** 8
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - All 7 required asset files present with exact kebab-case names.
  - All files are valid SVG (start with `<svg`); no binary blobs.
  - Zero Figma CDN URLs remain in any source file.
  - Nav icons and `arrow-up-right.svg` correctly use `fill="currentColor"`; logo and illustration retain literal brand fills.
  - No fixed `width`/`height` on any root `<svg>` — all use `viewBox` only.
  - Visual rendering verified via Chrome DevTools MCP: logo wordmark correct, all four nav icons correct shapes, arrow-up-right correct, striped-wallet illustration renders as intended line-pattern artwork.
  - No JS console errors on dev server (only expected Vite HMR debug message).
  - Docs lint passes with 0 errors.

### 2026-05-12 — Issue #38 (Bootstrap TanStack Router file-based routes)

- **Scope:** Issue #38 acceptance criteria (TC-38-1, TC-38-2, TC-38-3)
- **Cases executed:** 3
- **Passes:** 3
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 9/10**
  - All three acceptance criteria pass cleanly.
  - Build produces no ENOENT warnings; `dist/` is generated.
  - Dev server renders "Pipeline" at `/` with no JS errors (only a cosmetic favicon 404).
  - `routeTree.gen.ts` is present and non-empty (1503 bytes).
  - Deducted 1 point: missing favicon causes a browser console 404 error (cosmetic, low severity — not filed as a blocking bug; can be addressed when branding assets land).

## Backing invariant

| Status | Drift threshold |
|--------|----------------|
| Green | < 0.01% |
| Amber | 0.01% – 1.0% |
| Red | > 1.0% |

Amber and red states trigger an immediate alert to the on-call channel and to the trustee. The invariant is evaluated after every deposit, yield mint, loan disbursement, repayment, and withdrawal.

## Latency targets

| Operation | Target |
|-----------|--------|
| API p50 | ≤ 100ms |
| API p95 | ≤ 500ms |
| On-chain event → bridge action | ≤ 30s |
| Reconciliation invariant publish after state change | ≤ 60s |
| LP withdrawal (within automated bounds, USDC available) | ≤ 10 min |

## Frontend performance

| Metric | Target |
|--------|--------|
| LCP | ≤ 2.5s |
| FID / INP | ≤ 100ms |
| Initial JS bundle | ≤ 250 kB gzipped |

## Availability

| Service | Target |
|---------|--------|
| API + Worker | 99.9% monthly uptime |
| Weekly yield distribution (Thursday) | Zero missed distributions |
| Price feed polling | ≥ 95% of scheduled ticks delivered |

## Test coverage

| Package | Threshold |
|---------|-----------|
| `packages/worker` (bridge logic, waterfall, CCR) | 100% line coverage for core domain logic |
| `packages/api` (endpoint handlers) | 100% for auth and fund-transfer endpoints |
| Smart contracts | 100% branch coverage via Foundry/Hardhat test suite |
| `packages/frontend` | Unit tests for all calculation utilities |

## Smart contract audit

- Tier 1 auditor (Trail of Bits, ChainSecurity, OpenZeppelin, or equivalent)
- Scope: all 5 custom contracts (~470 lines custom code)
- Zero critical or high findings unresolved at launch

## Rate limits (enforced on-chain)

| Limit | Value | Configurable by |
|-------|-------|----------------|
| Rolling 24h mint | $10M | Foundation multisig |
| Per-tx mint cap | $5M | Foundation multisig |
| Rolling 24h LP payout | $10M | Foundation multisig |
| Per-tx LP payout cap | $5M | Foundation multisig |
| Per-tx USYC swap | $5M | Foundation multisig |
| Daily aggregate USYC swap | $20M | Foundation multisig |
