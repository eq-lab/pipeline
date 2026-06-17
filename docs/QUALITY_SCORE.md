# QUALITY SCORE

MVP quality bars. All targets must be met before mainnet launch.

## UX Testing Log

### 2026-06-17 — Epic #556 (Connect Wallet modal) — QA pass (re-run) via `qa` issue #557

- **Scope:** Second pass on `qa` #557 after the right-pane fixes (#579, #580) merged and two new story docs (`579-connect-hero-asset`, `580-connect-modal-headline`) were added. All five user-stories docs under `docs/user-stories/epic-556/` executed against the local Pipeline frontend at `http://localhost:3000/`, disconnected wallet (`pipeline.mock.wallet.isConnected=false`). Desktop 1440×727 + mobile 402/500 (below lg=1024). Chrome DevTools MCP. `qa` #557 claimed from `blocked` (human-invoked directly).
- **Docs run:** 5 (`558`, `563`, `564`, `579`, `580`)
- **Stories executed:** 34 — 558 (17), 563 (8), 564 (4), 579 (3), 580 (1), plus regression checks on open bugs #572/#573/#575
- **Passes:** 29
- **Failures:** 0
- **Blocked:** 5 (558 Stories 6/7/8/9/10/11 wallet-connection — no extensions; terms gate intercepts before connector/new-tab behavior; environment limitation, verified via Story 17)
- **Bugs filed:** none
- **Figma frames compared:** `2858-57637` (Connect Wallet modal, 1728×916)
- **Score: 9/10**
  - Prior pass's two right-pane defects are resolved and verified live: right-pane headline = 48px Besley white anchored near the top below the wordmark (y=104, logo y=48); overlaid Logo SVG = pure white (`rgb(255,255,255)`); hero asset = bare text-free aerial container-ship photo (`connect-hero-ship.webp`, 98KB <300KB, `absolute inset-0 size-full object-cover`).
  - The three still-open epic sub-issues all **appear fixed** in the rendered app: **#572** (modal heading 48px Besley, `--text-pipeline-heading-l` resolves to 48px), **#573** (no vertical jump on tab switch — heading/tablist/first-row top positions identical across EVM/Soroban, deltas all 0), **#575** (headline top-anchored under wordmark). Recommended the manager verify and close #572/#573/#575.
  - Functional behavior solid: EVM tab = MetaMask/Coinbase/WalletConnect/Trust (no Phantom, no Show More); Soroban = 5 + Show More → 6 (adds Rabet) → resets on tab switch; dismiss via Escape and × but NOT outside/right-pane click (per #563 fullscreen design); full-viewport on desktop (dialog 1440×727, parent position:fixed, border-radius 0) and mobile (single column, right pane display:none + aria-hidden); terms gate intercepts on wallet click.
  - Intentional deviations (not bugs): Figma labels tabs All/Ethereum/Stellar and lists Phantom; epic body redefined to EVM/Soroban with no Phantom. Photo asset is a different aerial-container-ship crop than the Figma export — acceptable, same design intent.
  - Only benign console warnings (Lit dev-mode, Reown font preload). No errors.
  - **Outcome:** all testable stories pass; no new defects. Wallet-connection stories (6–11) remain BLOCKED by the environment, not by app defects. The three remaining open epic sub-issues are still open Issues (the manager owns closing them), so this pass does not close `qa` #557 — returned to `blocked`. Held 1 point only for the connection stories not exercisable end-to-end locally and the still-open (though verified-fixed) sub-issues; the modal itself is green functionally and visually.

### 2026-06-16 — Epic #531 (Stake/unstake page) — FINAL QA pass (re-run) via `qa` issue #532 (epic closed)

- **Scope:** Final-pass re-run on `qa` #532. All 6 non-`qa` sub-issues (#533/#534/#535/#540/#541/#542) closed; `qa` #532 claimed from `blocked` (human-invoked directly). All 6 user-stories docs under `docs/user-stories/epic-531/` re-executed against `origin/main`-equivalent code — branch `fix/579-hero-asset` has **zero diff vs origin/main** for the `/stake` surface (epic-531 work fully merged). `http://localhost:3000/stake`, Vite dev. Desktop 1280×800 + 1728-wide for Figma alignment. Chrome DevTools MCP. States: disconnected (cleared mock keys) and connected via `/test` "Connected, ready to stake (approved)" + "Connected, ready to unstake" fixtures; network-fee mock keys JSON-encoded.
- **Docs run:** 6
- **Stories executed:** 17
- **Passes:** 16
- **Failures:** 0
- **Blocked:** 1 (#541 Story 4 — unstake output preview; env/fixture address mismatch, not an app defect)
- **Bugs filed:** none
- **Figma frames compared:** 1498-101158 (desktop Stake/approved, 1728×916), section-by-section at matched viewport
- **Score: 9/10**
  - Confirms the prior 2026-06-16 first pass — no regressions, no new defects. #533 (disconnected banner, tab-agnostic, Connect→terms gate, post-connect StepsCard), #534/#535 (distinct vector PLUSD/sPLUSD icons), #540 (single combined conversion card 480×386 containing tabs→input→output→rate→fee, with a separate steps card below), #541 (rate "1 PLUSD = 0.9596 sPLUSD" / "1 sPLUSD = 1.0421 PLUSD", Stake preview 10→9.60), #542 (Stake "~0.00042 ETH", Unstake "~0.00038 ETH", default ~0.00023 ETH, disconnected "—") all verified.
  - **#541 Story 4 BLOCKED (not a defect):** sPLUSD balance reads 0.00 even under the "Connected, ready to unstake" fixture — mock seeds balance at placeholder `0x5555…0005` while `splusdToken` (`useEvmToken({ token: ENV.STAKED_PLUSD_ADDRESS })`) reads the real Hoodi ENV address via RPC, so `amountBig` parses to `0n` and the preview stays 0.00. Same caveat as #310/#322. The unstake preview path is identical to the verified Stake-tab Story 3 (10→9.60), and the unstake rate row (1.0421) proves the conversion math.
  - **Figma:** Frame 1498-101158 matches structurally and in order (TopBar, hero, single conversion card, separate steps card) with no absences. Accepted deviations (not filed): network fee "~$1.20" (Figma USD) vs "~0.00042 ETH" (app, no USD price source per #506/#542); steps copy "Allow contract to use PLUSD" (Figma) vs "Allow Pipeline to use PLUSD" (app convention).
  - Zero error-level console messages across all states.
  - **Outcome:** green; all sibling sub-issues closed; one env-only block with no bug. `qa` #532 closed, then epic #531 closed per ISSUE_PROTOCOL §2/§5.3. Held 1 point only for the single story not exercisable end-to-end locally (env/fixture, not a code gap).

### 2026-06-16 — Epic #556 (Connect Wallet modal) — QA pass via `qa` issue #557

- **Scope:** First pass on `qa` issue #557 (final-pass scenario — all three non-`qa` sub-issues #558/#563/#564 closed; human-invoked directly). All three user-stories docs under `docs/user-stories/epic-556/` executed against the local Vite dev server at `http://localhost:5173/`, disconnected wallet state (set `pipeline.mock.wallet.isConnected=false`, removed `.address`). Desktop 1440 + mobile (Chrome ~500px floor, below the lg=1024 breakpoint). Driven with Chrome DevTools MCP.
- **Docs run:** 3 (`558-connect-wallet-modal`, `563-connect-modal-fullscreen`, `564-connect-modal-hero-image`)
- **Stories executed:** 29 total — 558 (17), 563 (8), 564 (4)
- **Passes:** 22 (558: 11 PASS + 1 partial-pass; 563: 8 PASS; 564: 2 PASS)
- **Failures:** 2 (564 S1 wordmark, 564 S3 headline)
- **Blocked:** 5 (558 Stories 6/7/8/9/10 — real wallet connector dispatch not reproducible without installed wallet extensions; terms-gate intercept verified instead via Story 17)
- **Bugs filed:** #579 (high), #580 (medium, `trivial`) — both sub-issues of #556
- **Figma frames compared:** `2858-57637` (Connect Wallet modal, 1728×916, two 864px panes)
- **Score: 7/10**
  - Functional behavior is solid: EVM tab shows exactly MetaMask / Coinbase Wallet / WalletConnect / Trust Wallet (no Phantom, no Show More); Soroban tab shows 5 wallets + Show More, expands to 6 (adds Rabet), and resets on tab switch; modal dismisses via Escape and × but NOT on right-pane/outside click (per the #563 fullscreen decision); mobile renders single-column full-viewport with the right pane `display:none` + `aria-hidden`; clicking any wallet routes through the "Before you continue" terms gate first (Story 17).
  - Intentional deviations (not bugs): Figma still labels tabs All/Ethereum/Stellar and lists Phantom; the epic body explicitly redefined this to EVM/Soroban with no Phantom. Left pane (heading "Connect Wallet" Besley, tabs, 56px wallet rows) matches Figma.
  - **#579 (high, 564 S1/S2 FAIL):** the hero asset `packages/frontend/src/assets/connect-hero-ship.webp` is a full export of the Figma right pane — it has the white "Pipeline" wordmark AND the "Access real-world / yield on-chain" headline baked into the photo. The component overlays its own wordmark SVG (rendering navy `rgb(0,0,128)`, illegible on the dark photo) and its own headline `<p>`, producing a duplicated wordmark and duplicated headline. The asset should be the bare photograph only.
  - **#580 (medium, 564 S3 FAIL):** the overlay headline `<p>` renders at 16px and is bottom-anchored (flex `justify-between`), vs Figma Heading-L (48px Besley) near the top below the wordmark. Currently masked by the baked-in headline in the asset (#579); surfaces once the asset is replaced.
  - Deducted 3 points: the desktop right-pane visual composition (the headline deliverable of #564) is wrong on the primary surface — duplicated/illegible wordmark and mis-sized/mis-positioned headline. Everything functional and the mobile/dismissal/terms behavior passes. `qa` #557 returned to `blocked`; epic #556 cannot close until #579/#580 are fixed and a follow-up pass is green.

### 2026-06-16 — Epic #531 (Stake/unstake page) — QA pass via `qa` issue #532

- **Scope:** First pass on `qa` issue #532. All 6 user-stories docs under `docs/user-stories/epic-531/` (#533, #534, #535, #540, #541, #542) executed against `main`-equivalent code (HEAD `d770c8d`, contains all 6 epic-531 merges) at `http://localhost:3000/stake`. Desktop 1280×800. Chrome DevTools MCP. Mock states via `/test` scenario loader + direct localStorage seeding (network-fee mock keys must be JSON-encoded per `useNetworkFeeEstimate`'s `parseJson<string>`).
- **Docs run:** 6
- **Stories executed:** 17
- **Passes:** 16
- **Failures:** 0
- **Blocked:** 1 (#541 Story 4 — unstake output preview, env/fixture address mismatch; not an app defect)
- **Bugs filed:** none
- **Figma frames compared:** 1498-101158 (desktop Stake/approved combined card), 1994-7280 (disconnected, via story #533)
- **Score: 9/10**
  - **#533 verified (4 stories):** disconnected /stake shows the lime/warning banner "Connect your wallet first" + dark "Connect" button on both Stake and Unstake tabs (tab-agnostic), no step buttons, input + output cards still rendered; clicking "Connect" opens the "Before you continue" terms gate (gated AppKit flow, same as home CTA); the post-connect StepsCard render verified via the mock-connected approved scenario.
  - **#534 verified:** PLUSD = dark-navy circle/white glyph, sPLUSD = light-gray circle/navy glyph, both `data:image/svg+xml` vectors, visually distinct, flip correctly on tab switch.
  - **#535 verified:** PLUSD icon is vector SVG (no base64 PNG), crisp at 40px, consistent with USDC/sPLUSD.
  - **#540 verified (4 stories):** single white conversion card (tabs → PLUSD input → sPLUSD output → exchange rate → network fee); steps card is a separate container below; no layout shift on tab switch; confirmed against Figma 1498-101158.
  - **#541 verified (Stories 1–3):** Stake rate "1 PLUSD = 0.9596 sPLUSD", Unstake rate "1 sPLUSD = 1.0421 PLUSD" (both exact, no 1e12 inflation); typing 10 PLUSD → 9.60 sPLUSD output preview. **Story 4 BLOCKED:** unstake output preview cannot be exercised locally — `splusdToken` reads balance/decimals from the configured Hoodi `STAKED_PLUSD_ADDRESS` via real RPC, but the fixture seeds sPLUSD balance under the placeholder `0x5555…0005`, so the balance reads 0 and `amountBig` parses to `0n` (preview disabled). Same fixture/address caveat as #310/#322 — not a regression: the unstake preview path is identical to the verified Stake-tab preview, and the unstake rate row proves the conversion math. No bug filed.
  - **#542 verified (3 stories):** Stake fee "~0.00042 ETH" and Unstake fee "~0.00038 ETH" render from JSON-encoded mock keys (not "—"); a default computed ETH estimate (~0.00024 ETH) renders when no mock key is set; disconnected shows "—".
  - **Figma:** Frame 1498-101158 matches structurally (header, hero, combined card, separate steps card) and in copy/values, except: (a) network fee Figma shows "−$1.20" USD vs app "~0.00042 ETH" — accepted #506/#542 product deviation (no USD price source); (b) steps copy "Allow contract to use PLUSD" (Figma) vs "Allow Pipeline to use PLUSD" (app) — minor wording variance, app-wide convention. Neither filed.
  - Zero error-level console messages across disconnected, connected/approved, and unstake states.
  - **Outcome:** 16/17 green; the single blocked story is an env/fixture limitation, not a defect, with no bug to file. All 6 sibling sub-issues closed. `qa` #532 returned to `blocked` pending the maintainer's call on the env-only block — the epic is closeable if the env block is accepted. Deducted 1 point only for the one story not exercisable end-to-end locally; everything else passes functionally and visually.

### 2026-06-16 — Epic #522 (Activity page) — final QA pass (re-run) via `qa` issue #525

- **Scope:** Final pass. All non-`qa` sub-issues of #522 closed (#523, #524, #530, #576). Re-verified the one prior FAIL (523 Story 1, blocked on #576) now that #576 is merged, and re-ran the full suite. All 3 docs under `docs/user-stories/epic-522/` (#523, #524, #530) executed.
- **Environment:** `http://localhost:3333/transactions` served from `/Users/dima/git/pipeline` (main worktree; PR #582 = `278442c` for #576 is an ancestor of HEAD, so the running app contains the fix). Chrome DevTools MCP, mobile (~500px Chrome floor, `matchMedia('(min-width:768px)')`=false → mobile layout) + desktop 1440. State seeded via `pipeline.mock.wallet.*` + `pipeline.mock.api.GET./v1/requests`.
- **Coverage:** 3 docs / 9 stories — **9 PASS / 0 FAIL / 0 blocked.**
- **Bugs filed:** none. Prior #576 (only open defect) fixed and verified.
- **Figma frames compared:** `1993-9592` (mobile with-data — now matches, no hero circle at mobile), `1497-94912` (desktop — icon centered above centered heading), `1993-9958` (mobile empty — illustration + caption).
- **Score: 9/10**
  - #576 verified fixed live: at mobile width no 72×72 arrow-clock hero circle renders (`circles72=[]`); "Activity" heading is left-aligned (Besley 400, 28/36), single `<h2>`, 8px page margin, max-w-480 column. At desktop ≥768px the hero circle is visible with the glyph optically centered (offsetX/Y=0, mask-size:contain, mask-position 50% 50% — #530 regression intact).
  - Rows render without overflow at mobile: Buy Completed `+100.00 USDC`, Buy PendingClaim `+25.00 USDC`/"Pending", Stake two-line `−1,000.00 PLUSD`/`+999.50 sPLUSD`. Tabs Buy/Sell/Stake/Unstake, Buy default, no "All" tab (accepted deviation per doc).
  - Empty state verified for all three causes (disconnected, zero rows, filter-empty) — identical illustration + "You will see all transactions here" caption; top-anchored at mobile (`padding-top:32px`), vertically centered at desktop (`min-height:400px`/`justify-content:center`).
  - Zero error-level console messages across all states/viewports.
  - Held 1 point from 10 because this was a targeted final re-run (the previously-failing surface re-executed live; the rest of the suite re-run end-to-end this pass with no intervening surface changes). No outstanding defects. `qa` #525 and epic #522 closed.

### 2026-06-16 — Epic #522 (Activity page) — first QA pass via `qa` issue #525

- **Scope:** First QA pass on `qa` #525. All 3 user-stories docs under `docs/user-stories/epic-522/` executed: `523` (mobile with-data, 5 stories), `524` (mobile empty state, 3 stories), `530` (header icon centering, 1 story). Human-invoked directly; `qa` #525 claimed from `blocked`.
- **Environment:** `http://localhost:5173/transactions` (yarn front:dev, vite). Chrome DevTools MCP, mobile (`matchMedia('(min-width:768px)')`=false; Chrome ~500px window floor) + desktop 1440. State seeded via `pipeline.mock.wallet.*` + `pipeline.mock.api.GET./v1/requests` localStorage keys (mirrors `/test` scenarios history-mixed / single-Buy / disconnected). Zero error-level console messages.
- **Coverage:** 3 docs / 9 stories — **8 PASS / 1 FAIL / 0 blocked.**
- **Figma frames compared:** `1993-9592` (mobile with-data) + child `1993-9808` (heading) → header mismatch; `1497-94912` (desktop) → matches; `1993-9958` (mobile empty) → matches.
- **Bugs filed:** **#576** (medium, `trivial`, sub-issue of #522) — mobile arrow-clock hero circle renders when it should be hidden.
- **Score: 8/10**
  - Strong functional + visual coverage: all four request types (Deposit/Withdraw/Stake/Unstake) render correct icons, labels, timestamps, and amount formatting (`+100.00 USDC`, `+999.50 sPLUSD`, two-line stake/unstake) with no horizontal overflow at mobile width; Buy default, no "All" tab (accepted deviation from Figma per doc). Empty state correct for all three causes (disconnected, connected-zero, tab-filter-empty) — single consistent illustration + caption, top-anchored on mobile, vertically centered on desktop. Single semantic `<h2>` at all viewports. #530 verified: arrow-clock glyph optically centered (offset 0/0, mask-size contain).
  - **#576 (FAIL — #523 Story 1):** at mobile width the 72×72 arrow-clock hero circle still renders above the "Activity" heading (`display:flex`, 72×72) — the `inline-flex` base on `HeroIcon` beats the `hidden md:block` override passed by `ActivityHeader`, so the responsive mobile hide never applies. Mobile Figma `1993-9592` has no hero circle there. Same class of regression as the closed #547. Desktop header is correct.
  - **Outcome:** not green. `qa` #525 returned to `blocked`; epic #522 cannot close until #576 is fixed and a follow-up pass is green. Deducted 2 points for the one medium mobile-fidelity defect on the primary new surface; everything else passes.

### 2026-06-10 — Epic #498 (Deposit/withdraw page) — final QA pass (re-run) via `qa` issue #499

- **Scope:** Re-run of the final QA pass after the only first-pass failure (#547) was fixed and merged to `main` (`ca5e34d`). Targeted the previously-failing doc `501-deposit-header-mobile` (incl. its new Story 4 #547 regression guard) plus the `CoinIcon` surfaces the fix touches; the other 6 docs were first-pass green with no intervening merged changes to their surfaces. All 8 non-`qa` sub-issues (#501–#507, #520, #547) closed.
- **Environment:** `http://localhost:3000` served from `/Users/dima/git/pipeline`, fast-forwarded `a79ac6f → origin/main ca5e34d` so the running app actually contains the #547 fix (the prior served code did not). Chrome DevTools MCP, mobile (~500px floor, `matchMedia('(min-width:768px)')`=false) + desktop (1280). Connected state via `connected-allowance-zero` mock scenario.
- **Docs re-verified:** `501` (4 stories). **Carried-forward green** (first pass 2026-06-10, surfaces unchanged): `502` (4), `503` (4), `504` (2), `505` (3), `507` (2), `520` (4).
- **Cumulative coverage:** 7 docs / 22 stories — **22 PASS / 0 FAIL / 0 blocked.**
- **Bugs filed:** none.
- **Figma frames compared:** 1993:7701 (mobile init — header now matches, no coin icon above heading), 1498:100130 (desktop init — coin icon centered above heading, matches).
- **Score: 9/10**
  - The #547 regression is fixed and verified live: at mobile width the header `CoinIcon` (`className="block hidden md:block"`, inline `flex-shrink: 0;` only, no inline `display`) computes `display: none` and is not visible; the left-aligned "1:1 Conversion" heading (Besley 400, 28/36, left edge 8px) and single `<h2>` match the mobile Figma. At desktop ≥768px the same icon computes `display: block` and is visible/centered above the centered heading. In-card USDC/PLUSD `CoinIcon`s keep `display: block` on mobile — fix did not regress non-responsive usages. `CoinIcon.test.tsx` 16/16 pass incl. the Issue-#547 group.
  - Network-fee row remains ETH-only (no `($1.20)` USD) — #506, closed working-as-intended (no price source); not a defect.
  - One benign pre-existing 404 console entry; zero deposit-behavior error-level messages.
  - Held 1 point back from 10 only because this was a targeted re-run (one doc fully re-executed live; the other 6 carried forward from the prior green pass rather than re-run end-to-end). No outstanding defects. `qa` #499 and epic #498 closed.

### 2026-06-10 — Epic #498 (Deposit/withdraw page) — QA pass via `qa` issue #499 (final-pass attempt)

- **Scope:** First pass on `qa` issue #499. All 7 user-stories docs under `docs/user-stories/epic-498/` (#501, #502, #503, #504, #505, #507, #520) executed against `main`-equivalent code at http://localhost:3000 (branch `chore/qa-epic-463`, which contains all 8 merged epic-498 fixes #501–#507, #520). Desktop (1280/1440) + mobile (Chrome non-headless ~500px floor; `matchMedia('(min-width:768px)')` = false confirms the mobile/`md` layout was exercised). Mock states seeded via the `/test` scenario keys (`connected-allowance-zero`, `connected-below-min`, `connected-allowance-ok`, disconnected).
- **Docs run:** 7
- **Stories executed:** 22
- **Passes:** 21
- **Failures:** 1 (#501 Story 1 — mobile coin icon)
- **Blocked:** 0
- **Bugs filed:** #547 (medium, `trivial`) — sub-issue of #498
- **Figma frames compared:** 1993:7701 (mobile init, heading node 1993:7911), 1498:100130 (desktop init)
- **Score: 8/10**
  - #502 fully verified: Min chip `$1,000 (Min)` / `$250 (Min)` / `$1,000.50 (Min)` (whole-dollar drops `.00`, cents retained when fractional); all four chips fit the mobile viewport without overflow; Min chip fills input `1000.00`.
  - #503 verified: below-min banner title is Graphik LC 16px (not Besley serif/20px); subtitle "Minimum amount — 1,000 USDC" (no `$`, comma separator); Copy Address is `white-space:nowrap` single line; banner ~98px (vs doc's ~92px, within tolerance); Copy Address writes the full wallet address to clipboard.
  - #504 verified: input card is full opacity (no `.opacity-30`) in the below-min state; correctly carries `opacity:0.3` only in the approved/step-2-live state.
  - #505 verified: step labels wrap with no ellipsis (`white-space:normal`, no `truncate`); action buttons render 88×32 (`!h-8 w-22`); StepRow root is `flex items-start` so badge + button top-align with a wrapping label.
  - #507 verified: mobile `<main>` padding = 8px (content flush at x=8); desktop padding = 16px.
  - #520 verified: disconnected deposit + withdraw both show the "Connect your wallet first" yellow banner with a "Connect" button and no step buttons; clicking Connect opens the "Before you continue" terms gate (then AppKit, per #385); connecting + sufficient balance hides the banner and renders the 3-step card.
  - **#547 (medium, FAIL #501 Story 1):** mobile /deposit still renders the PLUSD coin icon above the "1:1 Conversion" heading; Figma mobile frame 1993:7701 has no coin icon there. Root cause: `CoinIcon` hard-codes inline `style={{display:"block"}}`, which beats `DepositHeader`'s `className="hidden md:block"` so the responsive hide never applies (confirmed: clearing the inline display lets the class resolve to `display:none`). Desktop is correct (icon should be visible there). Mechanical fix → labeled `trivial`.
  - **Network-fee USD conversion (not a defect):** Figma 1993:7701 shows `~$0.00053 ETH ($1.20)`; the app shows ETH-only. #506 was closed working-as-intended — no ETH→USD price source exists and the human decision was to show only the ETH amount. Accepted deviation, no bug filed.
  - Zero error-level console messages across all states/viewports.
  - **Outcome:** not green — #547 is an open Figma-fidelity regression on the primary mobile surface. `qa` issue #499 returned to `blocked`; epic #498 cannot close until #547 is fixed and a follow-up pass is green. Deducted 2 points for the one medium mobile-fidelity regression; everything else (4 fixes × multiple stories, plus the disconnected and below-min flows) passes functionally and visually.

### 2026-06-10 — Epic #463 (Home page) — FINAL QA pass via `qa` issue #464 (epic closed)

- **Scope:** Final QA pass for Epic #463. Second pass on `qa` issue #464, focused on the two bugs that blocked the 2026-06-05 pass — **#508** (mobile Portfolio period-tabs placement) and **#509** (StartHereCard "$X USDC" sub-line) — both now CLOSED/merged with their own user-stories docs. Tested against `main` served at http://localhost:3000/ (from `/Users/dima/git/pipeline/packages/frontend`). Surrounding mobile states (A/B/C, disconnected, desktop) re-exercised for regression; the rest of the docs were green on 2026-06-05 against unchanged code.
- **Docs run this pass:** 4 directly driven (`508`, `509`, plus `466` and `476` regression spot-checks)
- **Stories executed:** 9 — #508 ×2, #509 ×5, #466 State A/B/C re-verify, #476 Story 2 re-verify
- **Passes:** 9
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Figma frames compared:** 1987:7990 (mobile period-tabs), 1984:6501 (State B), 1886:46777 (State C)
- **Score: 10/10**
  - **#508 verified:** mobile Portfolio header row computes `flex-direction: column`; balance block (`Total Balance / value / earning / CTA`) at `y=182..278, x=33`, tablist (`7D 1M 3M 1Y All`) at `y=294, x=33` — stacked below and left-aligned. Desktop (1440px) header row is `flex-direction: row` with the tablist top-right (`x=599` vs balance `x=210`, both `y=299`) — no regression. Matches Figma 1987:7990.
  - **#509 verified:** State B `[data-testid="plusd-in-usdc"]` present, `"$1,000.00 USDC"`, muted ink `rgba(56,55,53,0.6)`, 12px caption. State C zero-PLUSD shows `"$0.00 USDC"` (not hidden). Disconnected / State A / desktop show no subline. Eyebrow "PLUSD Balance", PLUSD coin icon + value, Buy/Sell enabled in B/C.
  - **State C totals:** visible mobile Portfolio Total Balance `$2,042.80` (1000 PLUSD + 1042.80 sPLUSD-in-PLUSD @ convertToAssets 1.0428), earning caption `—`, no CTA link — per spec. (A transient `$0.00` reading was traced to the hidden desktop-duplicate card instance, not a regression.)
  - **#476 regression intact:** State A Sell button `disabled` + `opacity 0.32`; Buy enabled.
  - Zero error-level console messages across all states/viewports.
  - **Outcome:** fully green; both blocking bugs fixed and verified; no new defects; all sibling sub-issues closed. `qa` issue #464 closed, then Epic #463 closed per ISSUE_PROTOCOL §2/§5.3.
  - Seeding-doc gap from the prior pass still applies (#466/#509 State B/C omit the `.decimals` mock key needed for `formattedBalance`); worked around by seeding `.decimals="18"`. Worth a doc fix but not an app bug.

### 2026-06-05 — Epic #463 (Home page) — QA pass via `qa` issue #464

- **Scope:** Full QA pass for Epic #463 (home page). 8 user-stories docs under `docs/user-stories/epic-463/` executed against `main` @ ff8840d (http://localhost:3000/). First pass on this `qa` issue.
- **Docs run:** 8 (`465`, `466`, `476`, `478`, `247`, `250`, `372`, `389`)
- **Stories executed:** 26
- **Passes:** 24
- **Doc-stale (not a bug):** 2 (`247` Story 2 "cap at 3" — code is intentionally `MAX_ROWS=5`; `465` Story 1 Step 9 "RecentActivityCard visible disconnected" — Figma 1989:8292 has no Recent Activity, app correctly hides it)
- **Not exercised:** `389` Stories 3/4 (chart hover tooltip — synthetic SVG, low priority)
- **Blocked:** 0
- **Bugs filed:** #508 (medium), #509 (medium) — both sub-issues of #463
- **Figma frames compared:** 1989:8292 (mobile disconnected), 1988:7074 (State A), 1984:6501 (State B), 1886:46777 (State C)
- **Score: 8/10**
  - Mobile disconnected + all three connected balance states (A/B/C) render the correct sections, copy, balances, button enable/disable, and greeting ("Welcome" desktop / "Welcome back" mobile connected). `#476` Sell-dimming verified across all 5 stories (opacity 0.32 + disabled when nothing to sell; full opacity + interactive with a position). `#478` "% p.a." suffix and "From senior loan coupons and T-bills" copy present on mobile and desktop. `#250`/`#389` portfolio placeholder + 100-bar green chart + period-caption switching (7D +$42.80 → 3M +$192.80 → All +$842.80) work with no network call. `#372`/`#247` View All navigates to /transactions; empty/connected states correct. Desktop 7-col grid regression intact at 1440px and at the inclusive 768px breakpoint.
  - **#508 (medium):** mobile Portfolio period tabs render top-right (desktop arrangement) instead of left-aligned below the balance/CTA as the mobile Figma frames specify (1987:7995 @ x=0,y=84). Desktop placement is correct.
  - **#509 (medium):** mobile connected StartHereCard omits the "$X USDC" sub-line under the PLUSD balance that the Figma frames show (SubtitleCont 1984:6771/6772).
  - **Seeding-doc gap (not an app bug):** `466-mobile-home-balance-states.md` State B/C seeding omits the `pipeline.mock.wallet.contract.<token>.decimals` key; without it `useEvmToken.formattedBalance` is undefined and StartHereCard shows `$0.00` despite a non-zero balance (the portfolio Total Balance, which formats the raw bigint, shows the correct value). Adding `.decimals = "18"` for the PLUSD and sPLUSD mock addresses makes balances render correctly.
  - Zero error-level console messages across all states/viewports.
  - Note: mobile tested at Chrome's ~500px minimum window width (the 402px Figma frame width is unreachable in non-headless Chrome); still below the `md` 768px breakpoint, so the mobile layout was exercised. Pixel-exact width comparisons account for the ~98px delta.
  - Deducted 2 points: two medium Figma-fidelity deviations (#508, #509) on the primary mobile surface; everything functional/structural otherwise passes. `qa` issue #464 returned to `blocked` — epic cannot close until #508/#509 are fixed and a follow-up pass is green.

### 2026-06-01 — Issue #450 (Stellar UI wiring: dropdown toggle, TopBar pill, connect chooser modal)

- **Scope:** Issue #450 acceptance criteria (TC-450-1 through TC-450-10)
- **Cases executed:** 10
- **Passes:** 9
- **Failures:** 1 (TC-450-7 — pill shows cross-namespace fallback instead of "—")
- **Blocked:** 0
- **Bugs filed:** #456 (medium)
- **Score: 8/10**
  - PASS TC-450-1 (ConnectChooserModal opens from TopBar "Connect Wallet"): Dialog `role="dialog" aria-modal="true"` renders with heading "Connect a wallet", description "Choose which wallet to connect. You can connect both.", buttons "Connect EVM" and "Connect Stellar". Dimensions: `width=380px`, `borderRadius=32px`, `backgroundColor=rgb(248,247,246)`, `padding=24px`. A11y correct. Close (×) button present and focused on open.
  - PASS TC-450-2 (ConnectChooserModal dismissal): All three paths tested — Escape closes the modal; scrim click (dispatched to `data-testid="connect-chooser-modal-scrim"`) closes; × button closes. "Connect Wallet" restores in header after all paths.
  - PASS TC-450-3 (EVM connected — WalletPill + AccountDropdown): With mock EVM wallet (1,500 USDC), WalletPill shows `$1,500.00` reactively without page reload. Clicking pill opens AccountDropdown (`role="menu" aria-label="Account"`). Segmented control `role="tablist" aria-label="Wallet namespace"` with EVM tab `aria-selected="true"`. Address row shows `0x1234…5678`. Balance row shows `$1,500.00`. Disconnect button present. Screenshot: `docs/screenshots/issue-450-account-dropdown-evm.png`.
  - PASS TC-450-4 (Stellar tab — not connected shows connect affordance): Clicking Stellar tab switches `aria-selected` correctly. Panel shows "Stellar wallet not connected" caption + "Connect Stellar" button. Disconnect button is hidden. No address/balance rows shown.
  - PASS TC-450-5 (toggle is view-only — EVM not disconnected): Switching Stellar tab then back to EVM restores `0x1234…5678` address and `$1,500.00` balance. EVM mock keys persist in localStorage (toggle is view-only).
  - PASS TC-450-6 (both namespaces connected — toggle switches pill and panel): With Stellar also mocked (750 USDC, address `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`), switching to Stellar tab updates WalletPill to `$750.00` and panel shows Stellar address `GBBD47…FLA5` + $750.00 balance + Disconnect button. Switching back to EVM restores EVM data. Neither namespace is disconnected by the toggle. Screenshot: `docs/screenshots/issue-450-account-dropdown-stellar-connected.png`.
  - FAIL TC-450-7 (pill balance when active namespace disconnected): With EVM-only connected and Stellar tab selected, WalletPill shows `$1,500.00` (EVM balance via cross-namespace fallback) instead of `"—"`. The `pillBalance` computation in `TopBar.tsx` lines 105-111 falls back to the other namespace's balance rather than showing `"—"` as specified in the plan. Bug #456 filed (medium).
  - PASS TC-450-8 (dropdown dismissal — outside click, Escape, route change): Outside click on page body closes dropdown (mousedown capture handler confirmed). Escape closes dropdown. Clicking "Convert" nav navigates to `/deposit?direction=deposit` and dropdown closes. WalletPill persists after each dismiss.
  - PASS TC-450-9 (ConnectChooserModal focus trap): Tab cycles among Close (×), Connect EVM, Connect Stellar — 3 focusable elements. Shift+Tab from Close wraps to Connect Stellar. Trap confirmed via keyboard navigation.
  - PASS TC-450-10 (Stellar address truncation): Stellar 56-char strkey `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` correctly truncates to `GBBD47…FLA5` (6+4 chars, same formula as EVM). `truncateAddress()` in `useAccountDropdown.ts` is address-format agnostic.
  - Unit tests: 701/701 tests pass across 42 test files. `WalletViewContext.test.tsx` (5 tests), `AccountDropdown.test.tsx` (13 tests), `ConnectChooserModal.test.tsx` (7 tests), `TopBar.test.tsx` (16 tests) — all green.
  - Console errors: zero error-level messages throughout all test cases. Pre-existing Reown font preload warning only.
  - Figma coverage note: Figma node `1506:104728` (dropdown) is the plan reference. No Figma frame was confirmed for the segmented control or the ConnectChooserModal — components were built from theme tokens (no raw hex per FRONTEND rules, except the chooser's border-radius hardcoded at `32px` via inline style and button hover `color-mix` value which are minor deviations).
  - Deducted 2 points: TC-450-7 pill fallback is a plan spec violation — confusing UX where the pill shows a different namespace's balance than the one the user selected. Medium severity. Does not block the primary happy path (both wallets connected correctly, pill switches correctly when both are connected).


### 2026-05-25 — Issue #395 (/deposit: USDC half missing outer white card — 16px radius)

- **Scope:** Issue #395 acceptance criteria (TC-395-1 through TC-395-4, plus swap button regression)
- **Cases executed:** 5
- **Passes:** 5
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-395-1 (Card A white outer card — disconnected): Card A wrapper on `fix/395-deposit-usdc-outer-card` branch at `http://localhost:5176/deposit?direction=deposit`. `className` = `"relative pt-4 pr-4 pb-6 pl-4 bg-[var(--color-pipeline-surface)] rounded-[var(--radius-pipeline-card-lg)]"`. `backgroundColor: rgb(255, 255, 255)` (white). `borderRadius: 16px`. Padding: `16px / 16px / 24px / 16px` (top/right/bottom/left). No border on outer card. `--radius-pipeline-card-lg` token resolves to `16px` on `:root`. All match Figma node `1498:100136` spec exactly.
  - PASS TC-395-2 (Swap button straddles seam): Gap between Card A bottom and Card B top = 2px. Swap button center Y = 401, gap midpoint = 402 — deviation = 1px (within 1px tolerance). `borderRadius: 4px`. Size: 40×40px. All correct.
  - PASS TC-395-3 (Paper background visible; Card B unaffected): Card A white (`rgb(255,255,255)`) contrasts against `#f8f7f6` paper. Card B `backgroundColor: rgb(255,255,255)`, `borderRadius: 4px` — unchanged (PLUSD radius delta tracked by #382). No border on Card A.
  - PASS TC-395-4 (Withdraw direction — same layout): `/deposit?direction=withdraw` Card A has `bg: rgb(255,255,255)`, `borderRadius: 16px`, `pt: 16px / pb: 24px`. Withdraw content correct (PLUSD input, 25/50/75/Max chips, "1 PLUSD = 1 USDC", "Allow Pipeline to use PLUSD"). Layout stable.
  - PASS TC-395-5 (Connected wallet — Card A stable): Mock wallet connected (5,000.00 USDC). Card A white outer card unchanged; USDC balance shows in inner gray panel; swap button enabled and functional; clicking swap navigates to `/deposit?direction=withdraw` with Card A layout preserved. No console errors throughout.
  - Inner gray panel (TokenInput) correctly nested inside Card A: `backgroundColor: rgba(191, 189, 187, 0.12)` = `--color-pipeline-fill-muted`; `borderRadius: 8px`; 4 quick-amount chips rendered. Inner panel is untouched — outer card chrome is an additional wrapping layer only.
  - Note: tested on port 5176 (`pipeline-background` worktree, `fix/395-deposit-usdc-outer-card` branch). Ports 5174 and others serve different repos/branches — always verify the correct port before testing against a fix branch.
  - Note: pre-existing issue — Card B (PLUSD half) still has `borderRadius: 4px` (not 16px). This is the expected asymmetry tracked by #382 and explicitly accepted in the issue scope.
  - No new GitHub Issues filed.

### 2026-05-25 — Issue #385 (First-connection terms acknowledgement modal gates wallet connect)

- **Scope:** Issue #385 acceptance criteria (TC-385-1 through TC-385-8)
- **Cases executed:** 8
- **Passes:** 8
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-385-1 (gate fires on first connect): With clean localStorage on `feat/385-first-connection-modal` branch (port 5378), clicking "Connect Wallet" in the TopBar shows the "Before you continue" modal. AppKit does NOT open. Modal heading correct; toggle OFF; Continue disabled; `role="dialog" aria-modal="true"` on the panel; focus on the toggle switch on open.
  - PASS TC-385-2 (Continue disabled until toggle on): Continue button is `disabled` and not clickable when toggle is off — confirmed via interaction failure (element not interactive) and script inspection (`disabled: true`).
  - PASS TC-385-3 (toggle on enables Continue): Clicking toggle → `aria-checked="true"`, track background `rgb(32, 128, 0)` = `#208000` (spec). Continue `disabled: false`, `backgroundColor: rgb(38, 37, 36)` = `#262524` (spec), `opacity: 1`. Both colors match Figma spec exactly.
  - PASS TC-385-4 (Continue with toggle on — ack persisted + AppKit opens): Clicking Continue closes the modal and opens AppKit "Connect Wallet" picker. `pipeline.wallet.termsAcknowledged.pending` = `"true"` set in localStorage (pending key used before address resolution, per implementation design).
  - PASS TC-385-5 (dismiss paths — no ack persisted): All four dismiss paths tested independently:
    - Disconnect button: dialog gone, no ack key, focus returned to "Connect Wallet" button.
    - X close button: dialog gone, no ack key, focus returned to "Connect Wallet" button.
    - Scrim click (dispatched click on overlay parent at top-left coords): dialog gone, no ack key.
    - Escape key: dialog gone, no ack key, focus returned to "Connect Wallet" button.
    - AppKit did NOT open on any dismiss path.
  - PASS TC-385-6 (second connect skips gate): With `pipeline.wallet.termsAcknowledged.pending = "true"` in localStorage, clicking "Connect Wallet" opens AppKit directly — no "Before you continue" modal.
  - PASS TC-385-7 (clearing localStorage restores gate): Removing all `termsAcknowledged` keys then clicking Connect shows the modal again.
  - PASS TC-385-8 (keyboard navigation): Tab cycles among 4 focusable elements inside the dialog (Close button, toggle switch, Disconnect, Terms of Service link). Continue is excluded from tab order when disabled (correct). Focusing Continue and pressing Enter (when enabled) triggers modal close + AppKit open. Escape closes modal and returns focus to originating Connect button.
  - Visual specs verified: width=420px (spec), bg=rgb(248,247,246)=#f8f7f6 (spec), padding=24px (spec), borderRadius=4px (spec), scrim=rgba(56,55,53,0.6) (spec), maxHeight=~80vh (spec). All match Figma init state node 1572:123328 and checked state node 1582:69059.
  - Gate also fires from the promo card "Connect" button (entry point regression confirmed).
  - Unit tests: 32/32 pass across `useTermsAcknowledgement.test.tsx` and `FirstConnectionModal.test.tsx`. 9/9 `useWallet.test.tsx` tests pass including gated and acknowledged paths.
  - Console errors: only pre-existing Reown/WalletConnect font preload and AppKit warnings — none related to #385.
  - Note: tested against port 5378 (pipeline-background-2 worktree, `feat/385-first-connection-modal` branch). Port 3000 (main worktree, `fix/379-deposit-quick-amount-chips`) does NOT have this feature — always verify the correct worktree/port before testing.
  - No new GitHub Issues filed.

### 2026-05-22 — Issue #372 (Home: Recent activity "View All" button affordance)

- **Scope:** Issue #372 acceptance criteria (TC-372-1 through TC-372-3)
- **Cases executed:** 3
- **Passes:** 3
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-372-1 ("View All" renders as button-sized control): `a[href="/transactions"]` on the `fix/372-view-all-button` branch at `http://localhost:5177/`. `height=48px` (h-12), `paddingLeft=12px` / `paddingRight=12px` (px-3), `borderRadius=8px` (rounded-lg), `fontWeight=600` (--font-weight-emphasized), `color=rgba(56,55,53,0.6)` (--color-pipeline-ink-muted). `innerHTML` contains an SVG `<svg>` chevron-right icon — not the literal `→` character. All Figma spec properties match.
  - PASS TC-372-2 ("View All" navigates to /transactions): Clicking the link navigated to `http://localhost:5177/transactions`; Chrome DevTools MCP confirmed `Page navigated to http://localhost:5177/transactions.`
  - PASS TC-372-3 ("View All" absent when disconnected): With no mock wallet keys, the "Recent activity" card showed only the empty-state illustration and caption; no `a[href="/transactions"]` element present in DOM.
  - Unit tests: 21 tests in `RecentActivityCard.test.tsx` all pass (confirmed via `yarn workspace @pipeline/frontend test --run src/components/RecentActivityCard`).
  - Visual: screenshot confirms "View All ›" label with muted color and chevron icon, right-aligned at the bottom of the activity list. Matches Figma spec (48px hit target, 12px padding, 8px radius, muted ink, right-chevron).
  - Note: dev server for this branch runs at port 5177 (started separately since main worktree at :5173 served the old main-branch code without the fix). Always verify the correct worktree/port before testing.
  - Console errors: only pre-existing Reown/WalletConnect font preload and 403/400 warnings — none related to #372.
  - No new GitHub Issues filed.

### 2026-05-22 — Issue #359 (Merge /deposit and /withdraw into one route with direction param + swap button)

- **Scope:** Issue #359 acceptance criteria (TC-359-1 through TC-359-10) plus TC-186-4 two-card layout regression
- **Cases executed:** 11
- **Passes:** 11
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-359-1 (`/withdraw` → `/deposit?direction=withdraw` redirect): Address bar updates to `/deposit?direction=withdraw`. Back button does not return to `/withdraw` (`replace: true` confirmed by history.length staying constant at 13 pre/post swap). Page correctly shows withdraw direction content.
  - PASS TC-359-2 (`/deposit` shows deposit direction): URL normalizes to `/deposit?direction=deposit`. USDC input, Min/$5k/$10k/Max chips, "1 USDC = 1 PLUSD", "Allow Pipeline to use USDC" / "Confirm USDC transfer" / "Claim your PLUSD". TopBar Convert active. Swap button visible.
  - PASS TC-359-3 (`/deposit?direction=withdraw` shows withdraw direction): PLUSD input, 25/50/75/Max chips, "1 PLUSD = 1 USDC", "Allow Pipeline to use PLUSD" / "Confirm PLUSD burn" / "Claim your USDC". Switch direction button present in a11y tree (disabled when disconnected). TopBar Convert active.
  - PASS TC-359-4 (garbage param → falls back to deposit): `/deposit?direction=hodor` normalizes to `/deposit?direction=deposit`. USDC input and Min chips shown.
  - PASS TC-359-5 (swap deposit→withdraw): With mock wallet ($5,000 USDC), "2000" typed, clicking "Switch direction" navigates to `/deposit?direction=withdraw`. Amount input cleared. Chips flip to 25/50/75/Max. Exchange rate flips to "1 PLUSD = 1 USDC". Step labels flip. `history.length` unchanged (replace:true).
  - PASS TC-359-6 (swap withdraw→deposit): Clicking swap again returns to `/deposit?direction=deposit`. Amount cleared. Chips flip back to Min/$5k/$10k/Max. Step labels revert to deposit copy.
  - PASS TC-359-7 (swap disabled mid-tx): With PendingVerification request seeded, amount input is locked to "2000.00" and "Switch direction" button has `disabled` attribute. Cannot fire.
  - PASS TC-359-8 (TopBar Convert active on both directions): `aria-pressed="true"`, `data-active="true"` on Convert button for both `/deposit?direction=deposit` and `/deposit?direction=withdraw`. Direction param does not affect nav highlight.
  - PASS TC-359-9 (`/withdraw?foo=bar` preserves params): Redirects to `/deposit?foo=bar&direction=withdraw`. Extra search params survive the redirect hop.
  - PASS TC-359-10 (all routes regression): `/` → Home active; `/deposit?direction=deposit` → Convert; `/deposit?direction=withdraw` → Convert; `/stake` → Earn; `/transactions` → Activity. All correct, no bleed.
  - PASS TC-186-4 regression (two-card layout on `/deposit?direction=withdraw`): `rowGap: 2px` confirmed. Card A has PLUSD input (correct for withdraw). Swap button present between cards. Visual gap = 2px.
  - Console errors: zero error-level messages throughout all test cases. Only pre-existing Lit dev-mode and Reown font preload warnings.
  - Note: dev server for feature branch must be started separately at a dedicated port (port 4359 used here — `yarn workspace @pipeline/frontend dev --port 4359` from the `pipeline-background-2` worktree). The main worktrees at ports 3000 and 3333 serve main/fix branches and do not reflect the #359 changes.
  - Note: `TC-354` withdraw regression on port 4359 shows Approve button gated (pre-existing mock keying issue #357 around spender address discovery for WQ direction) — not a regression introduced by #359.

### 2026-05-21 — Issue #354 (/withdraw: PLUSD balance not shown and amount input is uninteractable)

- **Scope:** Issue #354 acceptance criteria (TC-354-1 through TC-354-6)
- **Cases executed:** 6
- **Passes:** 5
- **Failures:** 0
- **Blocked:** 1 (TC-354-6 — banner visible in DOM but invisible to user due to CSS specificity bug #357)
- **Bugs filed:** #357 (high)
- **Score: 7/10**
  - PASS TC-354-1 (connected — PLUSD balance shown, input enabled): With mock `withdrawalQueue.plusd` and `withdrawalQueue.usdc` keys set (lowercase addresses for `useToken` balance/decimals/allowance keys), PLUSD balance shows "500.00". Input is enabled. Chips are interactive. All step buttons disabled (no amount entered). Root bug described in #354 is fixed.
  - PASS TC-354-2 (amount entry enables Approve; chips work): Typing "100" enables the Approve button; Confirm/Claim remain disabled; USDC output shows "+100". Max chip → "500.00"; 25% chip → "125.00" (500 × 0.25). Exchange rate "1 PLUSD = 1 USDC". All correct.
  - PASS TC-354-3 (approved state — step 1 Done, Confirm enabled): With allowance=1000 PLUSD and amount=125, step 1 renders "Approve complete" Done badge (green check). Step 2 Confirm is enabled. Claim remains disabled.
  - PASS TC-354-4 (Confirm fires requestWithdrawal, toast shown): Clicking Confirm fires the mock requestWithdrawal; a "Withdrawal submitted" toast appears (`role="status"`, `aria-live="polite"`). Confirm button becomes disabled. Input locks to the submitted amount (faded, chips disabled).
  - PASS TC-354-5 (disconnected — "—" balance, input disabled, no banner): No mock keys → "Connect Wallet" in header; PLUSD balance "—"; input disabled; all three step buttons disabled; no banner rendered. Correct.
  - PASS (partial) TC-354-6 (unreachable-contract banner):
    - Console surfacing: `[useWithdrawalQueueAddresses] fromToken() read failed: ContractFunctionExecutionError` and `intoToken() read failed` appear in the browser console. This is the new `console.error` behavior from the fix. PASS.
    - Banner in DOM: `data-testid="wq-unreachable-banner"` is present and the a11y tree contains "WithdrawalQueue not reachable. Check VITE_WITHDRAWAL_QUEUE_ADDRESS and RPC connectivity." PASS.
    - Banner visibility: BLOCKED — banner is invisible (white text on white background). `getComputedStyle(bannerEl).backgroundColor = rgb(255, 255, 255)` instead of the expected `rgb(192, 57, 43)` (`--color-pipeline-danger`). Root cause: `Card` default variant applies `bg-[var(--color-pipeline-surface)]`; caller's `className` adds `bg-[var(--color-pipeline-danger)]`; Tailwind v4 generates equal-specificity rules and surface wins. Bug #357 filed (high).
  - Note: mock key casing matters — `useToken` lowercases token addresses when building localStorage keys (`pipeline.mock.wallet.balance.${token.toLowerCase()}`). Using mixed-case PLUSD address in mock keys causes balance reads to miss. Correct keys use all-lowercase: `pipeline.mock.wallet.balance.0x18d6ccaf8d363309a6c283eea8b2c68d107016b7`.
  - Unit tests: 165 tests across 4 new test files all pass (`-withdraw.test.tsx`, `-deposit.test.tsx`, `useWithdrawalQueue.test.tsx`, `useDepositManager.test.tsx`). Pre-existing `TopBar.test.tsx` failures (8 tests looking for nav button "Deposit" which was renamed to "Convert") also fail on `main` branch — not a regression from #354.
  - Console errors on normal flow: only pre-existing Reown/WalletConnect font preload warnings — none from #354 changes.
  - Deducted 3 points: the unreachable-contract banner — a key diagnostic deliverable of this issue — is invisible to the user due to #357. The functional behaviour (balance shown, input enabled, steps wired) works correctly.

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

### 2026-05-20 — Issue #328 (Activity hero icon renders as black square on /transactions)

- **Scope:** Issue #328 acceptance criteria for `/transactions` against Figma node `1497:94912`, focused on the Activity hero badge glyph.
- **Cases executed:** 4
- **Passes:** 4
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-328-1 (desktop visual match): Compared Figma node `1497:94912` with `http://127.0.0.1:5177/transactions`. The 72×72 muted circular Activity badge now contains the arrow-clock glyph; no solid black 36×36 square is visible. Screenshot evidence: `/Users/dima/.codex/issue-328-activity-hero-viewport.png`.
  - PASS TC-328-2 (runtime mask styles): Browser inspection on `/transactions` found the outer badge at 72×72 (`backgroundColor: rgba(56, 55, 53, 0.12)`, `borderRadius: 9999px`) and the inner glyph at 36×36 with `maskImage` / `webkitMaskImage` resolving to a quoted SVG data URL, `maskRepeat: no-repeat`, and `maskSize: contain`. This directly covers the previous `maskImage: none` / filled-square failure mode.
  - PASS TC-328-3 (interaction/layout regression): Clicking the Sell tab kept the Activity header centered and unchanged; the tab state updated correctly and the empty-state body still rendered below the segmented control.
  - PASS TC-328-4 (mobile visual regression): Resized to 390×844 and verified the Activity badge still renders the arrow-clock glyph above the heading with no overlap or filled-square artifact. Screenshot evidence: `/Users/dima/.codex/issue-328-activity-hero-mobile.png`.
  - Focused regression test: `yarn workspace @pipeline/frontend test src/components/HeroIcon.test.tsx` passed (1 file, 15 tests).
  - Console errors: only pre-existing favicon 404, Reown/WalletConnect 403/400, Lit dev-mode warning, and Reown font preload warnings — none related to #328.
  - No new GitHub Issues filed.

### 2026-05-20 — Issue #315 (Add hover tooltips to header nav icons)

- **Scope:** Issue #315 acceptance criteria (TC-315-1 through TC-315-8)
- **Cases executed:** 8
- **Passes:** 8
- **Failures:** 0
- **Blocked:** 0
- **Bugs filed:** none
- **Score: 10/10**
  - PASS TC-315-1 (tooltip DOM present and hidden at rest): All four nav buttons (Home, Deposit, Stats, History) have a second `span[aria-hidden="true"]` child containing the label text. At rest: `opacity: 0`, `position: absolute`, `pointer-events: none`. Button is `position: relative`. No visual tooltip at rest. Verified on feat/315-icon-button-tooltips branch at `http://localhost:4315/`.
  - PASS TC-315-2 (tooltip appears on hover — all four buttons): Hovered each nav button. Screenshot confirmed dark tooltip pill visible below each icon. Computed `opacity: 1` on hovered button tooltip; siblings remain `opacity: 0`. No layout shift observed. Text matches labels: Home / Deposit / Stats / History. Gap between button bottom and tooltip top = 8px (mt-2 = 8px, confirmed via getBoundingClientRect). Verified on `/`, `/deposit`, `/transactions`.
  - PASS TC-315-3 (tooltip appears on keyboard focus-visible): Tabbed into the header nav using keyboard. Focused button (Deposit) showed tooltip at `opacity: 1`. The `group-focus-visible:opacity-100` class is present on the tooltip span; programmatic `.focus()` correctly does not trigger it (only real keyboard input does).
  - PASS TC-315-4 (styling uses design tokens, no hardcoded colors): Token values — `--color-pipeline-ink: #262524`, `--color-pipeline-on-dark: #ffffff`, `--text-pipeline-caption: 12px`, `--radius-pipeline-button: 4px`. Tooltip computed values — `backgroundColor: rgb(38, 37, 36)`, `color: rgb(255, 255, 255)`, `fontSize: 12px`, `borderRadius: 4px`. All match. No hardcoded hex in class string.
  - PASS TC-315-5 (no tooltip on logo or Connect Wallet button): Connect Wallet button has 0 tooltip spans (it is not an `IconButton`). Logo is an `<img>`, no tooltip.
  - PASS TC-315-6 (horizontal centering): `btnCenterX = 196`, `tooltipCenterX = 196` — within 0px. Tooltip is exactly centred below the button via `left-1/2 -translate-x-1/2`.
  - PASS TC-315-7 (no layout shift — 40×40 dimensions): All four buttons are exactly 40×40px. Tooltip (absolutely positioned) does not affect button dimensions or sibling positions.
  - PASS TC-315-8 (active nav state regression): On `/transactions`, History = `rgb(0, 0, 128)` brand navy, `aria-pressed="true"`. Home/Deposit/Stats = `rgba(56, 55, 53, 0.6)` muted. Unchanged from pre-tooltip behaviour.
  - Console errors: only pre-existing Reown/WalletConnect 403/400, Lit dev-mode, font preload warnings — none related to #315.
  - No new GitHub Issues filed.

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
