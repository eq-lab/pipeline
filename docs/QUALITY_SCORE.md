# QUALITY SCORE

MVP quality bars. All targets must be met before mainnet launch.

## UX Testing Log

### 2026-05-20 — Issue #310 (Wire up /stake — Stake and Unstake flows via sPLUSD vault)

- **Scope:** Issue #310 acceptance criteria (TC-310-1 through TC-310-9)
- **Cases executed:** 9 (TC-310-8 and TC-310-9 blocked)
- **Passes:** 7
- **Failures:** 0
- **Blocked:** 2 (TC-310-8, TC-310-9 — exchange rate and preview rows blocked by bug #322)
- **Bugs filed:** #322 (medium)
- **Score: 8/10**
  - PASS TC-310-1 (allowance=0, Approve enabled, Stake disabled): With mock PLUSD balance=100, allowance=0, amount="50" entered — Approve button enabled, Stake disabled. No Done badge on step 1.
  - PASS TC-310-2 (allowance≥amount — step 1 Done, Stake enabled → click → Done): With allowance=1000 PLUSD, amount="50" — step 1 shows "Approve complete" Done badge; step 2 Stake is enabled. Clicking Stake fires the mock; "Stake complete" Done badge appears on step 2. Both steps Done simultaneously.
  - PASS TC-310-3 (Unstake — sPLUSD balance=50, amount=25, click Unstake → Done): Unstake tab shows single "Confirm and unstake sPLUSD" StepRow (no approval step). "Unstake" enabled with amount=25. Clicking fires mock; "Unstake complete" Done badge appears.
  - PASS TC-310-4 (tab switch resets input, no stale Done bleed): After stake success (both Done badges), switching to Unstake tab — input cleared, no Stake/Approve Done badges visible, single Unstake step with no stale state. Switching back to Stake — input cleared, step 1 Approve disabled (no amount), no stale Done badges.
  - PASS TC-310-5 (quick-amount chips operate on active tab balance): PLUSD balance=100 on Stake tab — 25% chip → "25.00"; Max chip → "100.00". sPLUSD balance=50 on Unstake tab — 50% chip → "25.00". Math correct.
  - PASS TC-310-6 (disconnected — all buttons disabled, no banner): No mock keys → "Connect Wallet" in header; both balances "—"; input disabled; Approve, Stake, Unstake all disabled; no banner rendered.
  - PASS TC-310-7 (zero balance — buttons gated, no banner): Connected with PLUSD=0, sPLUSD=0 → inputs enabled; action buttons disabled (hasBalance=false); no LowBalanceBanner or any banner element in DOM.
  - BLOCKED TC-310-8 (exchange rate row): `VITE_STAKED_PLUSD_ADDRESS` not in `.env` → `ENV.STAKED_PLUSD_ADDRESS` = zero address → `isZeroAddress` guard in `useStakedPlusdConvertToShares` short-circuits before the mock path → exchange rate always "—". Bug #322 filed (medium).
  - BLOCKED TC-310-9 (preview output row): Same root cause as TC-310-8. sPLUSD preview output always shows "0" despite mock rate set. Bug #322 covers both.
  - Step copy verified: "Allow Pipeline to use PLUSD" (step 1), "Confirm and stake PLUSD" (step 2), "Confirm and unstake sPLUSD" (unstake step) — all match spec.
  - Network fee row: correctly shows "—" on feat/310 branch (a separate dev server on port 3000 from a stale branch showed "~$1.20" — not a regression from #310).
  - Header: WalletPill shows USDC balance (not PLUSD); Stats nav icon active on /stake — both correct.
  - Note on mock keying: `VITE_STAKED_PLUSD_ADDRESS` unset means app uses zero address as sPLUSD vault address; mock keys for sPLUSD balance and allowance must use `0x0000...0000` not `0x5555...0005` from the scenarios file.
  - Console errors: only pre-existing Reown/WalletConnect 403/400, Lit dev-mode, font preload warnings — none from #310.
  - No unit test regression observed (tests pass on the branch per coder confirmation).
  - Deducted 2 points: preview and exchange-rate rows non-functional in local dev due to #322; these are the key UX affordances for the staking flow.

### 2026-05-18 — Issue #261 (/transactions: show full empty state on per-tab empty results, not just text)

- **Scope:** Issue #261 acceptance criteria (TC-261-1 through TC-261-3, plus TC-257-3 regression)
- **Cases executed:** 4
- **Passes:** 4
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-261-1 (connected + data; empty tab renders illustration): Mock wallet with one Deposit row (visible on Buy tab). Clicking Sell, Stake, and Unstake tabs each render `ActivityEmptyIllustration` (`tone="muted"`, `width=240`) + "You will see all transactions here" caption inside a `min-h-[400px]` flex-centered wrapper. "No {tab} activity yet" text absent on all tabs. Returning to Buy tab correctly shows the Deposit row. Verified on port 5173 (fix/261-transactions-empty-state branch). Visual screenshot confirmed illustration renders as striped-clock SVG — not a bare text line. Note: pre-existing HeroIcon black square (#245) still visible in the ActivityHeader — not a regression from #261.
  - PASS TC-261-2 (regression — disconnected): No mock keys; header shows "Connect Wallet". Caption renders, `data-tone="muted"`, `min-h-[400px]` wrapper present. Matches previous #257 TC-257-1 PASS.
  - PASS TC-261-3 (regression — connected + zero rows): Mock wallet connected (5,000.00 WalletPill); `pipeline.mock.api.GET./v1/requests` = `{ requests: [] }`; illustration + caption render. Matches previous #257 TC-257-2 PASS.
  - PASS TC-257-3 regression flip (connected + data, active tab empty — now shows illustration): TC-257-3 previously expected muted text line; that expectation was inverted by this Issue. Verified that the per-tab text branch is gone — "No Sell activity yet" is absent; illustration renders instead. `docs/STORIES.md` TC-257-3 updated to reflect the new expected behaviour.
  - Unit tests: all 324 tests pass across 22 test files (`yarn workspace @pipeline/frontend test`). The `-transactions.test.tsx` tab-level-empty describe now asserts illustration + caption (not the old muted-text).
  - Console errors: only pre-existing Reown/WalletConnect 403/400, Lit dev-mode, and font preload warnings — none related to #261.
  - Note: initial testing was misdirected at port 3000 (main branch) which still has the old per-tab text behavior. The fix is correctly on port 5173 (fix/261-transactions-empty-state branch). No bug filed — this is a branch/port mapping issue during testing, not a product defect.
  - No new GitHub Issues filed.

### 2026-05-18 — Issue #259 (Add Toast notification system — informational and actionable variants)

- **Scope:** Issue #259 acceptance criteria (TC-259-1 through TC-259-5)
- **Cases executed:** 5 (TC-259-5 blocked)
- **Passes:** 4
- **Failures:** 0
- **Blocked:** 1 (TC-259-5 — approval toast blocked by pre-existing #230)
- **Bugs filed:** none
- **Score: 9/10**
  - PASS TC-259-1 (container renders at bottom-right): `[aria-label="Notifications"]` present in DOM on `/deposit`. `position: fixed`, `bottom: 24px`, `right: 24px`, `z-index: 50`, `flex-direction: column`, `align-items: flex-end`. Zero toasts when idle.
  - PASS TC-259-2 (deposit pending → success toast): Clicking "Confirm" emits "Sending…" pending toast (muted background, `role="status"`, `aria-live="polite"`). Toast updates in-place to "Deposit submitted" (green `rgb(58,125,68)`, `role="status"`, `aria-live="polite"`) with "View" action button. Visual matches Figma node 1497:95109. Auto-dismisses after 5 s.
  - PASS TC-259-3 (claim pending → success toast): MutationObserver log confirmed "Claiming…" added first, then "PLUSD claimed" updated in-place. No race condition — `show()` and `update()` execute in separate renders. Screenshot shows green pill "PLUSD claimed" bottom-right. All 3 steps show "Done".
  - PASS TC-259-4 (a11y): `Toast.dom.test.tsx` — 16 tests pass. `danger` → `role="alert"` + `aria-live="assertive"`. All other tones → `role="status"` + `aria-live="polite"`. `useToast.test.tsx` — 7 tests pass (auto-dismiss, pending sticky, update, dismiss, stack cap, upsert, outside-provider error).
  - BLOCKED TC-259-5 (approval toast): Approval step bypassed in local dev when VITE_DEPOSIT_MANAGER_ADDRESS is unset — pre-existing bug #230. Toast path exists in code but cannot be triggered without the env var.
  - Race condition investigation: Confirmed no race. `prevClaimIsPending` / `prevClaimIsSuccess` refs track state across renders; `show()` and `update()` cannot both fire in the same effect call for a mock that resolves synchronously, because the `isPending → true` render and `isSuccess → true` render are separate.
  - Visual comparison against Figma 1497:95187 (informational) and 1497:95109 (actionable): pill shape, green success background, white text, check-circle icon, "View" action button — implementation matches.
  - Unit tests: all 344 tests pass (24 test files).
  - Console errors: only pre-existing Reown/WalletConnect 403/400, Lit dev-mode warning, font preload warnings — none related to #259.
  - Note: `packages/ui/src/components/Toast/Toast.test.tsx` specified in issue is absent; tests placed in `packages/frontend/src/lib/toast/Toast.dom.test.tsx` instead — coverage is equivalent (plan fallback path).
  - No new GitHub Issues filed.
  - Deducted 1 point: approval toast path untestable without VITE_DEPOSIT_MANAGER_ADDRESS env var; not a new regression but worth tracking.

### 2026-05-18 — Issue #257 (Show striped-clock empty state on /transactions when there are no requests)

- **Scope:** Issue #257 acceptance criteria (TC-257-1 through TC-257-3)
- **Cases executed:** 3
- **Passes:** 3
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-257-1 (disconnected — illustration + caption): No mock keys set; `/transactions` renders `ActivityEmptyIllustration` (`tone="muted"`, `width=240`) + "You will see all transactions here" caption. Wrapper has `min-h-[400px]`, `display:flex`, `align-items:center`, `justify-content:center`. "No activity yet" text absent. Pre-existing HeroIcon black square (#245) still visible — not a regression from #257.
  - PASS TC-257-2 (connected + zero rows — illustration + caption): Mock wallet connected (1,000.00 WalletPill), `pipeline.mock.api.GET./v1/requests` = `{ requests: [] }`; same illustration + caption render. `data-tone="muted"`, `illustrationWidth=240px`. Caption present, no bare "No activity yet" text.
  - PASS TC-257-3 (data exists, Sell tab empty — muted line, not illustration): Mock with 2 Deposit rows. Buy tab shows 2 rows. Clicking Sell tab renders "No Sell activity yet" muted text; `[data-tone]` element absent; "You will see all transactions here" caption absent. Illustration correctly withheld for tab-level empty state.
  - Unit tests: all 22 tests pass in `-transactions.test.tsx` (wallet-level empty, tab-level empty, disconnected, formatting, renderRequestRow contract, loading, error, tab switching).
  - Console errors: only pre-existing Reown/WalletConnect 403/400 errors — none related to #257.
  - No new GitHub Issues filed.

### 2026-05-18 — Issue #250 (Home Connect-Wallet section: wire Connect button + Portfolio placeholder when connected)

- **Scope:** Issue #250 acceptance criteria (TC-250-1 through TC-250-4)
- **Cases executed:** 4
- **Passes:** 4
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-250-1 (disconnected — Connect button opens AppKit modal): Clicking the promo card "Connect" button opens the Reown AppKit "Connect Wallet" modal (WalletConnect + Search Wallet options). No page navigation. Header "Connect Wallet" button is absent (modal covers the page). Note: testing was done against `http://localhost:3000/` — a second dev server on port 5173 was running stale code from a previous branch; all testing against port 3000. Fiber inspection confirmed `onConnect` is wired as a function on port 3000.
  - PASS TC-250-2 (connected state — Portfolio placeholder): With mock wallet set, the PortfolioPlaceholderCard renders in the top-left slot. "Total Balance" eyebrow, "$0.00" heading, "Get PLUSD to start" link (→ /deposit confirmed), 5 tabs (7D|1M|3M|1Y|All) with "7D" selected, muted bar-chart silhouette all present. `min-h-[274px]` class confirmed on card (actual height 314px). ConnectWalletPromoCard absent. WalletPill in header shows "0.00".
  - PASS TC-250-3 (tab switching — no network call): Clicking "1M" tab sets `aria-selected="true"` on 1M and `aria-selected="false"` on 7D. No new data fetch requests in DevTools Network (only pre-existing Coinbase metrics beacon). Chart and balance unchanged.
  - PASS TC-250-4 (disconnect reverts to promo card): Removing mock localStorage keys and reloading restores ConnectWalletPromoCard. Portfolio placeholder gone. Grid layout unchanged.
  - Unit tests: all 294 tests pass (21 test files), including new `-index.test.tsx` (home route integration) and `PortfolioPlaceholderCard.test.tsx`.
  - Console errors: only pre-existing Reown font preload warning and WalletConnect 400/403 errors. None related to #250.
  - Minor observation: "Get PLUSD to start" link wraps to two lines at 1200px viewport width — cosmetic, not filed as a bug (the text is correct and functional; Figma layout at narrower widths may differ).

### 2026-05-18 — Issue #247 (Show recent requests on home RecentActivityCard when wallet is connected)

- **Scope:** Issue #247 acceptance criteria (TC-247-1 through TC-247-4)
- **Cases executed:** 4
- **Passes:** 4
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-247-4 (disconnected state — unchanged): No mock keys set; header shows "Connect Wallet" button; `region "Recent activity"` contains only "You will see all transactions here" caption; no "View All →" link. Empty state behavior unchanged.
  - PASS TC-247-3 (connected + empty list — empty state): Mock wallet connected (5,000.00 WalletPill), `pipeline.mock.api.GET./v1/requests` = `{ requests: [] }`; Recent activity shows `ActivityEmptyIllustration` + caption; no "View All →" link. Correct.
  - PASS TC-247-1 (connected + 3 rows + View All link): Three `ActivityRow` entries rendered. Row 1: "Buy", "15 May, 3:00 pm", "+1,000.00 USDC" AmountPill (completed Deposit). Row 2: "Sell", "14 May, 12:30 pm", "−2,000.00 USDC" / "Pending" TwoLineAmount (PendingClaim Withdraw). Row 3: "Stake", "13 May, 9:00 pm", "−1,000.00 PLUSD" / "+999.50 sPLUSD" TwoLineAmount (Stake). "View All →" link present, URL = `/transactions`. No empty-state caption. Card height = 602px (above min-h 564px, grows with content — does not collapse).
  - PASS TC-247-2 (connected + 5 rows — cap at 3): With 5-row mock, exactly 3 `<li>` elements rendered (DOM-verified: `listItemCount=3`); rows 4 and 5 not shown; "View All →" still present.
  - PASS (bonus): "View All →" click confirmed navigates to `/transactions` (History nav icon activates). The shared `renderRequestRow` helper renders the same row visuals on the transactions page (5 rows visible, filtered by "Buy" tab showing 2 completed deposits).
  - Pre-existing HeroIcon black square (#245) still visible on `/transactions` — not a regression from #247.
  - Console errors: only pre-existing Reown/WalletConnect 403/400, Lit dev-mode warning, font preload warnings — none related to #247.

### 2026-05-18 — Issue #246 (USDC CoinIcon is a stale base64 PNG — replace with authoritative Figma asset)

- **Scope:** Issue #246 acceptance criteria (TC-246-1 through TC-246-6)
- **Cases executed:** 6
- **Passes:** 6
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-246-1 (USDC ConversionCard row is SVG): `img` at index 1 on /deposit has `src` starting with `data:image/svg+xml,` — pure vector, not `data:image/png;base64`. Confirmed on /deposit.
  - PASS TC-246-2 (WalletPill 20px icon is SVG): With mock wallet connected, the 20px `<img>` in the WalletPill header has `src` `data:image/svg+xml,…` — vector SVG rendering confirmed.
  - PASS TC-246-3 (visual crispness at all sizes): Screenshots on /deposit and /withdraw confirm the USDC icon at 40px renders as a clean deep-blue circle with a crisp dollar mark — no aliasing or rasterisation artefacts. The WalletPill 20px icon in the header is equally sharp. DepositHeader hero uses PLUSD (not USDC) as expected per source code — that PNG remains out of scope.
  - PASS TC-246-4 (USDC on /withdraw Card B is SVG): The USDC output row icon on /withdraw is `SVG-data-uri`, `width=40`. Visually matches /deposit.
  - PASS TC-246-5 (PLUSD/sPLUSD icons unchanged): PLUSD icons on both /deposit and /withdraw still render as `PNG-b64` at `width=40` — no regression on the out-of-scope tokens. No visual degradation observed.
  - PASS TC-246-6 (coin-usdc.svg is pure vector): `grep -c "data:image/png" packages/ui/src/assets/icons/coin-usdc.svg` → `0`. SVG file (1490 bytes) is pure vector geometry — no embedded raster.
  - Unit tests: all 240 tests pass, including the new CoinIcon regression tests in `packages/frontend/src/components/CoinIcon.test.tsx`.
  - Console errors: only pre-existing WalletConnect/Reown 403/400, Lit dev-mode, font preload warnings — none related to #246.
  - Incidental finding (not filed as bug, logged in known-bugs.md): `packages/ui/src/assets/icons/swap-vertical.svg` is an SVG wrapper around a base64 PNG — same pattern as the old stale `coin-usdc.svg`. Not introduced by #246 (pre-existing). Filed in known-bugs.md for follow-up.
  - No new GitHub Issues filed for #246.

### 2026-05-18 — Issue #238 (ActivityHeader hero icon renders as black square on /transactions)

- **Scope:** Issue #238 acceptance criteria (TC-238-1 through TC-238-4)
- **Cases executed:** 3 (TC-238-4 blocked — /stake HeroIcon not yet wired)
- **Passes:** 0
- **Failures:** 2
- **Blocked:** 1
- **Bugs filed:** #245 (high)
- **Score: 2/10**
  - FAIL TC-238-1 (glyph renders): Black square still visible in browser screenshot. The `?url` fix was applied to the SVG import, but the mask CSS is not reaching the DOM.
  - FAIL TC-238-2 (mask-image resolves): `getComputedStyle(...).maskImage` = `"none"`. Mask is not applied.
  - FAIL TC-238-3 (mask present in inline style): `element.style.maskImage` = `""`. React is silently dropping both `WebkitMask` and `mask` shorthand properties from the inline style object when serialising to DOM. The React fiber `pendingProps.style` contains the correct `WebkitMask` and `mask` values with a valid data-URI, but neither appears in the rendered DOM attribute.
  - BLOCKED TC-238-4 (/stake chart icon): /stake route exists but does not use a `chart` HeroIcon in the current implementation — blocked pending that route's hero implementation.
  - Root cause confirmed: `HeroIcon.tsx` uses `WebkitMask`/`mask` shorthand properties which React does not apply to the DOM. Other masked-icon components (`ActivityEmptyIllustration`, `WalletIllustration`) correctly use the longhand `maskImage`/`WebkitMaskImage` properties and render fine (confirmed on home page).
  - Fix required: replace shorthand with longhands — `maskImage`, `WebkitMaskImage`, `WebkitMaskRepeat`, `WebkitMaskPosition`, `WebkitMaskSize`. Filed as bug #245 (high).
  - Console errors: only pre-existing WalletConnect/Reown 403/400, Lit dev-mode, font preload warnings. None related to #238.
  - Deducted 8 points: the primary acceptance criterion (the icon renders as the clock glyph) is completely unmet. The fix shipped in the PR addresses the wrong layer (URL resolution was fine; shorthand vs. longhand is the blocker).

### 2026-05-15 — Issue #227 (Wire up /deposit logic — amount input, approval gating, low-balance banner)

- **Scope:** Issue #227 acceptance criteria (TC-227-1 through TC-227-10)
- **Cases executed:** 10
- **Passes:** 8
- **Failures:** 1
- **Blocked:** 1
- **Bugs filed:** #230 (high)
- **Score: 6/10**
  - PASS TC-227-5 (disconnected state): "Connect Wallet" in header; balance shows "—"; USDC input disabled; both Approve and Convert buttons disabled; no banner. No relevant console errors.
  - PASS TC-227-6 (insufficient balance banner): When balance (500 USDC) < minDeposit (1000 USDC), StepsCard replaced by banner: "Add funds to your USDC balance" heading, "Minimum amount — $1,000.00 USDC" subtitle, "Copy Address" button. Header balance pill updated reactively to "500.00".
  - PASS TC-227-7 (Copy Address): Button text changes to "Copied" immediately on click. Clipboard receives full wallet address `0x1234000000000000000000000000000000005678`. Button reverts to "Copy Address" after ~1.5s. Confirmed via stubbed `navigator.clipboard.writeText`.
  - PASS TC-227-8 (Min chip label and action): Label shows "$1,000.00 (Min)" matching mocked minDeposit of 1000 USDC. Clicking sets input to "1000.00" and PLUSD output mirrors.
  - PASS TC-227-9 (Max chip uses live balance): With balance=5000 USDC, "Max" sets input to "5000.00" and PLUSD output to "5000.00".
  - PASS TC-227-10 (PLUSD mirrors USDC 1:1): Input "10000" → PLUSD output "10000". Exchange rate "1 USDC = 1 PLUSD". Network fee "—".
  - PASS TC-227-3 (Approved state renders correctly): With mock allowance ≥ amount (10000 USDC), step 1 shows green check badge + "Done", step 2 Convert enabled. Visual matches Figma 1497:95272.
  - PASS TC-227-4 (Convert click transitions to loading): Click triggers `aria-busy="true"` + disabled for ~14ms (mock resolves immediately). No console errors.
  - FAIL TC-227-1 (Approve-needed state): **Bug #230 (high).** When `VITE_DEPOSIT_MANAGER_ADDRESS` is unset, the zero-address spender causes the `needsApproval` check to return `false` on first render (allowance appears `undefined` despite mock key being set to `"0"`). Step 1 immediately shows "Done" and Convert is enabled even with allowance=0. The approve-needed Figma state (1498:99874) cannot be validated in the local env without the env var configured.
  - BLOCKED TC-227-2 (Approve click fires): Cannot test because the Approve button never becomes enabled — blocked by bug #230.
  - Console errors: only pre-existing Reown/WalletConnect 403/400 errors, Lit dev-mode warning, font preload warning. None related to #227.
  - Deducted 4 points: the approve gate — the most critical user-safety control on the deposit flow — is bypassed in the default local dev environment. TC-227-1 and TC-227-2 could not be verified. The three other states (disconnected, approved, insufficient-balance) all work correctly.

### 2026-05-15 — Issue #224 (Wire up header connected state — Account dropdown)

- **Scope:** Issue #224 acceptance criteria (TC-224-1 through TC-224-7)
- **Cases executed:** 7
- **Passes:** 7
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-224-1 (header on every page): Snapshot-verified on `/`, `/deposit`, `/withdraw`, `/stake`, `/transactions`. Header banner with Pipeline logo, nav icons, and Connect Wallet button present on all five routes. No hardcoded `$10,000.00` balance in the header anywhere.
  - PASS TC-224-2 (connected state shows WalletPill): Set mock wallet via `pipeline.mock.wallet.contract.depositManager.usdc` + per-token balance key. WalletPill shows `1,000.00` on all routes; Connect Wallet button absent. Updated TC-181-2 in STORIES.md — old `pipeline.mock.wallet.balance.usdc` key was removed from the schema; balance is now keyed by token address.
  - PASS TC-224-3 (Account dropdown opens on WalletPill click): Dropdown opens below pill, right-aligned, dark surface. Contains: "Wallet" row with `0x1234…5678` truncated address + copy button; "USDC balance" row showing `1,000.00`; "Disconnect" button. `role="menu"`, rows are `role="menuitem"`, `aria-expanded="true"` on trigger. Screenshot confirmed matching Figma layout.
  - PASS TC-224-4 (dismissal — outside click, Escape, route change): Outside click (clicking page content) closes menu; Escape key closes menu; navigating via nav bar closes menu. All three dismissal paths confirmed.
  - PASS TC-224-5 (copy writes full address to clipboard): Intercepted `navigator.clipboard.writeText` call — receives full `0x1234567890abcdef1234567890abcdef12345678`. "Copied" sr-only affordance transitions but elapses within ~1s. Console warning `msgid=149` confirms disconnect call path also works.
  - PASS TC-224-6 (active nav from URL): `/stake` → Stats icon `pressed`; `/deposit` → Deposit icon `pressed`; `/transactions` → History icon `pressed`; `/` → Home icon `pressed`. All correct.
  - PASS TC-224-7 (Disconnect reverts to disconnected state): With mock wallet, Disconnect closes the dropdown and fires `console.warn` instructing user to clear localStorage keys (intentional design — mock disconnect is a no-op per `useWallet.ts` line 67–75). Wagmi real-wallet disconnect path not testable in this environment but wired correctly (`wagmiDisconnect()` called for non-mock case).
  - Console errors: only pre-existing Reown/WalletConnect 403/400 errors, Lit dev-mode warning, font preload warning. None related to #224.
  - No new bugs filed.

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
