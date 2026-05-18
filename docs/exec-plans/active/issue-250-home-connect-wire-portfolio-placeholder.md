# Issue #250: Home Connect-Wallet section — wire Connect button + show Portfolio placeholder when connected

Source: https://github.com/eq-lab/pipeline/issues/250

## Scope

Two changes to the top-left card on the home page (`packages/frontend/src/routes/index.tsx`, the slot currently occupied by `ConnectWalletPromoCard` at `col-span-4 row-start-1`):

1. **Wire the existing Connect CTA.** Today `ConnectWalletPromoCard` accepts an `onConnect?: () => void` prop but `routes/index.tsx` mounts it without passing one, so the button is a visual no-op. Pass `onConnect={connect}` from `useWallet()` so the home Connect button opens the same Reown AppKit modal as the header CTA wired in #224.
2. **Swap in a Portfolio placeholder when connected.** Render the `ConnectWalletPromoCard` only when `!isConnected`. When `isConnected === true`, render a new `PortfolioPlaceholderCard` matching [Figma 1497:95048](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95048&m=dev): muted "Total Balance" label, display-serif "$0.00", muted link "Get PLUSD to start" (TanStack `<Link to="/deposit">`) on the top-left; a `SegmentedTabs` (`7D · 1M · 3M · 1Y · All`, default `7D`, purely visual) on the top-right; a static muted bar-chart silhouette filling the body. Same `Card variant="yellow"` + `min-h-[274px]` envelope as the existing promo card so the grid does not reflow when the user connects.

**In scope**

- `routes/index.tsx`: bring `isConnected` and `connect` out of `useWallet()`, pass `onConnect` to the promo, branch promo ⇄ placeholder on `isConnected`.
- New file `packages/frontend/src/components/PortfolioPlaceholderCard.tsx` with the layout above and the local `useState` for the active segmented-tab id.
- Unit tests covering the wired Connect handler, the connected/disconnected branching on the home route, and a smoke + a11y test for the new card.

**Out of scope**

- Real balance data (no aggregation endpoint exists yet — see #250 "Why" section). `$0.00` is a literal.
- Time-series chart logic; tabs are decorative and never trigger a fetch.
- Replacing the placeholder silhouette with a real charting library.
- Adapting the "Get PLUSD to start" copy when the wallet already holds PLUSD (deferred per Issue).
- Any changes to `ConnectWalletPromoCard` (no new props, no styling tweaks).
- Anything in `RecentActivityCard` — orthogonal to #247, already shipped.

## Assumptions and Risks

- **`useWallet().connect()` is the correct entry point.** `useWallet` already encapsulates the AppKit `open()` call and respects the `pipeline.mock.wallet.address` short-circuit, so wiring `onConnect={connect}` on the promo is the literal mirror of what `TopBar` did in #224. No new wallet logic needed.
- **`isConnected` is the single source of truth for the branch.** The hook computes `isConnected` from mock keys first then falls back to wagmi's `useAccount().isConnected`. Both code paths must render the placeholder correctly; the mock path is what the existing route tests use (`pipeline.mock.wallet.isConnected = "true"`) and what `ux-tester` toggles manually via DevTools console.
- **`SegmentedTabs` already ships from `@pipeline/ui`** (`/packages/ui/src/components/SegmentedTabs`). It is a controlled component (`tabs`, `activeId`, `onSelect`) — the card owns the local `useState`. Reused by `/transactions` and `/stake` already, so the public API is stable.
- **Card height parity.** The placeholder MUST set `min-h-[274px]` (same as the existing promo) so the 7-column dashboard grid does not reflow at the moment the user connects. Both surfaces also use `Card variant="yellow"`, which gives both cards an identical fill + border + radius — the swap is visually frictionless.
- **TanStack `<Link to="/deposit">` works from a non-route file.** Precedent: `RecentActivityCard.tsx` (post-#247) imports `Link` from `@tanstack/react-router` and uses `<Link to="/transactions">`. Generated `routeTree.gen.ts` already declares `/deposit`, so the typed `to` prop type-checks.
- **Risk: pixel-perfect chart silhouette.** Issue allows either inline SVG or a CSS bar stack; the SVG path is preferred for fidelity at variable widths. The implementer must visually verify against the Figma node and tweak heights / spacing to land "close enough" — there is no automated assertion for the silhouette. The chart is `aria-hidden="true"`, so screen-reader output is unaffected.
- **Risk: typography token choice for `$0.00`.** Figma 1497:95048 shows a large display-serif numeric. The Pipeline theme exposes `--text-pipeline-heading-m` (28/36) and `--text-pipeline-heading-s` (20/28). The Figma node should be consulted; if a larger display token is required and missing, log it in `docs/exec-plans/tech-debt-tracker.md` and use `heading-m` as a fallback for this PR — see Open Questions.
- **Risk: the home page currently has no route-level test file.** `packages/frontend/src/routes/index.tsx` ships without `-index.test.tsx`. The issue explicitly asks to "create if missing"; the implementer must wire wagmi / AppKit / TanStack Query / Router mocks the same way `-deposit.test.tsx` and `-transactions.test.tsx` already do. Re-use the mock blocks from `-deposit.test.tsx` lines 31-95 as a template.
- **Risk: home page imports more than the wallet hook would normally test.** The route pulls `QnaSection`, `StakeCard`, `EarnedCard`, etc. The route-level test must mock or tolerate every child's dependencies (icons, illustrations from `@pipeline/ui`, the `useRequests` call inside `RecentActivityCard`). Plan: mock `@/api` to return `{ data: undefined, isLoading: false, error: null }` and let the rest render naturally — the test only asserts the top-left card.

## Open Questions

- Which exact typography token does the `$0.00` use in Figma 1497:95048? Heading-M (28/36) is the closest existing token and is the safe default; if Figma demands a larger display token, defer to the implementer to confirm against the Figma node and either widen the token system or apply `heading-m` and log tech debt.

## Implementation Steps

1. [x] **Wire the Connect button (no new component yet) — `packages/frontend/src/routes/index.tsx`.**
   - Add `import { useWallet } from "@/wallet/useWallet";` at the top of the file (next to the existing component imports).
   - Inside `function Home()`, call the hook before the JSX:
     ```ts
     const { isConnected, connect } = useWallet();
     ```
   - Pass `onConnect={connect}` onto the existing `<ConnectWalletPromoCard className="col-span-4 row-start-1" />` so the click already works before the placeholder lands. This is the entire "Part 1" deliverable.

2. [x] **Create `packages/frontend/src/components/PortfolioPlaceholderCard.tsx`.**
   - Imports:
     ```ts
     import React from "react";
     import { Card, SegmentedTabs } from "@pipeline/ui";
     import { Link } from "@tanstack/react-router";
     ```
   - Define:
     ```ts
     export interface PortfolioPlaceholderCardProps
       extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {}
     ```
   - Module-private constants:
     ```ts
     const HEADING_ID = "portfolio-placeholder-card-title";
     const TABS = [
       { id: "7d", label: "7D" },
       { id: "1m", label: "1M" },
       { id: "3m", label: "3M" },
       { id: "1y", label: "1Y" },
       { id: "all", label: "All" },
     ];
     ```
   - Component body (`React.forwardRef<HTMLDivElement, PortfolioPlaceholderCardProps>`):
     - `const [activeId, setActiveId] = React.useState("7d");`
     - Outer `<Card variant="yellow" role="region" aria-labelledby={HEADING_ID} className={composed} data-node-id="1497:95048">` with `composed = ["relative flex flex-col gap-6 min-h-[274px] w-full overflow-hidden", className].filter(Boolean).join(" ")`.
     - **Header row** — `<div className="flex items-start justify-between gap-4">`:
       - **Left stack** — `<header className="flex flex-col gap-1">` with:
         - Eyebrow `<span>` "Total Balance" — Body Caption token (`--text-pipeline-caption` + `--color-pipeline-ink-muted`, `font-body`).
         - Display value `<h2 id={HEADING_ID}>` "$0.00" — `font-display`, `--text-pipeline-heading-m` + `--text-pipeline-heading-m--line-height`, `--color-pipeline-ink`, `m-0`. (See Open Questions for token confirmation.)
         - Muted link `<Link to="/deposit">` with caption-styled muted-ink text "Get PLUSD to start", `underline-offset-2 hover:underline`.
       - **Right** — `<SegmentedTabs tabs={TABS} activeId={activeId} onSelect={setActiveId} className="w-auto" />`. The pill's natural width comes from `flex-1` per tab so wrap it in a fixed-width container (e.g. `w-[260px]`) to match the Figma layout, OR pass a `className="w-[260px]"` directly. The implementer picks whichever lines up cleaner with the Figma frame.
     - **Body silhouette** — `<div className="flex-1" aria-hidden="true" data-node-id="1497:95048-chart">…</div>`:
       - **Preferred:** an inline `<svg viewBox="0 0 480 120" preserveAspectRatio="none" className="w-full h-full">` with ~30-40 `<rect>` children at varying heights, filled with `var(--color-pipeline-surface-muted)` (or whichever muted token Figma uses for the silhouette — check the design system before introducing a new one). One short docblock above the SVG explains it is a static placeholder and links to the Figma node.
       - **Acceptable alternative:** a `<div className="flex items-end gap-0.5 h-full">` containing N narrow `<div className="flex-1 bg-[color:var(--color-pipeline-surface-muted)]" style={{ height: '...%' }} />` rows. Cheaper but more brittle.
       - Either way: NO raw hex; all colours flow through tokens.
     - All token utilities mirror existing cards (`ConnectWalletPromoCard.tsx`, `StartHereCard.tsx`). No new tokens added.
   - Add `displayName` + default export at the bottom (mirrors `ConnectWalletPromoCard.tsx`).
   - Add a top-of-file docblock that:
     - Names this as the connected-state replacement for `ConnectWalletPromoCard`.
     - States the placeholder rule: every value is a literal; no data fetch; the tabs are decorative.
     - Links Figma node `1497:95048`.
     - Notes the chart is `aria-hidden="true"`.

3. [x] **Branch promo ⇄ placeholder in `routes/index.tsx`.**
   - Add `import { PortfolioPlaceholderCard } from "@/components/PortfolioPlaceholderCard";` next to the existing component imports.
   - Replace the single line `<ConnectWalletPromoCard className="col-span-4 row-start-1" />` with the conditional:
     ```tsx
     {isConnected ? (
       <PortfolioPlaceholderCard className="col-span-4 row-start-1" />
     ) : (
       <ConnectWalletPromoCard
         className="col-span-4 row-start-1"
         onConnect={connect}
       />
     )}
     ```
   - Leave every other grid slot (`RecentActivityCard`, the `Balances` column with `StartHereCard` + `EarnedCard`, `StakeCard`, `QnaSection`) untouched.
   - Update the route-file docblock's ASCII layout comment to reflect that the top-left card swaps between Connect Wallet promo and Portfolio placeholder based on `isConnected`.

4. [x] **Lint + build.**
   - From the repo root: `yarn lint && yarn build`.
   - Fix any TS strict-null findings (e.g. ensure the `connect` reference is stable — it is, the hook returns a fresh function each render but the prop is wired through the existing `Button onClick`, so this is fine).

## Test Strategy

All tests use Vitest + `@testing-library/react`, matching the patterns already established in `routes/-deposit.test.tsx` and `routes/-transactions.test.tsx`.

1. **New file: `packages/frontend/src/routes/-index.test.tsx`** (TanStack-style `-` prefix to keep it out of the generated route tree).
   - Reuse the wagmi / AppKit / TanStack Query / Router mock blocks from `-deposit.test.tsx` lines 31-95 verbatim.
   - Add an `@/api` mock so `RecentActivityCard` (inside the route) does not blow up:
     ```ts
     vi.mock("@/api", () => ({
       useRequests: () => ({ data: undefined, isLoading: false, error: null }),
     }));
     ```
   - Use the `pipeline.mock.wallet.*` localStorage layer (already used in `-deposit.test.tsx`) to flip between connected / disconnected.
   - **TC-1: Disconnected → promo renders + click invokes `useWallet().connect()`.**
     - Set up: clear all `pipeline.mock.wallet.*` keys; wagmi mock returns `isConnected: false`.
     - Render the `/` route's `Route.options.component` inside `WalletProvider`.
     - Assert "Connect Wallet" heading is present, "Total Balance" is absent.
     - `userEvent.click` the "Connect" button → assert the `useAppKit().open` mock was called once (the same proxy `-deposit.test.tsx` already uses to gate AppKit).
   - **TC-2: Connected (via mock) → placeholder renders.**
     - Set `localStorage.setItem("pipeline.mock.wallet.isConnected", "true")` and `pipeline.mock.wallet.address` to a sentinel `0x…` value, before render.
     - Assert "Total Balance" + "$0.00" are present; "Get PLUSD to start" link has `href="/deposit"` (or, per the router mock, the `to` attribute).
     - Assert "Connect Wallet" heading is **absent** (the promo is unmounted).
   - **TC-3: SegmentedTabs default + click semantics.**
     - In the connected branch above, assert the tab with label "7D" has `aria-selected="true"` and the others are `aria-selected="false"`.
     - `userEvent.click` on "1M" → "1M" is now `aria-selected="true"`, "7D" is `aria-selected="false"`. No router navigation occurred (no `useNavigate` mock call, no `Link` href change).
   - **TC-4: Card height parity.**
     - Cheap, optional but high-value: render once disconnected and once connected, query both cards by `role="region"`, and assert they each carry the `min-h-[274px]` utility class on the outer Card div. (Tailwind utility-class assertions are common in this repo; if the implementer prefers a runtime `getBoundingClientRect()` measurement, that is acceptable but jsdom-flaky.)

2. **New file: `packages/frontend/src/components/PortfolioPlaceholderCard.test.tsx`** (smoke + a11y).
   - Render `<PortfolioPlaceholderCard />` inside a router test harness (use the same TanStack `createMemoryHistory` + `RouterProvider` pattern as the other tests, OR mock `@tanstack/react-router` to render `Link` as a passthrough `<a href={to}>`).
   - Smoke: query for "Total Balance", "$0.00", the `Get PLUSD to start` link, the `7D` tab — all present.
   - Default active tab is `7D` (`aria-selected="true"`).
   - Switch tab via `userEvent.click("1M")` and assert the active state moves; the rest of the DOM (no chart-data text leak) is unchanged.
   - Chart wrapper has `aria-hidden="true"`.
   - Optional axe pass via `@axe-core/react` if already wired (it is **not** currently a project dep — do not introduce it for this PR; the smoke + tab semantics above are sufficient).

3. **Update `docs/STORIES.md`.**
   - Add a new story slot **S-250 — Home Connect-Wallet section: wired Connect + Portfolio placeholder when connected**, with at least:
     - TC-250-1 Disconnected → Connect promo CTA opens the wallet modal.
     - TC-250-2 Connected via DevTools mock → top-left card renders the Portfolio placeholder ($0.00 + tabs + chart silhouette), the grid does not reflow, "Get PLUSD to start" navigates to `/deposit`.
     - TC-250-3 Switching tabs updates the active pill visually only; no network call is observed in DevTools.
   - This is what `ux-tester` will execute after implementation.

4. **Whole-suite gate.** From the repo root: `yarn test-fast`. New tests must be green; pre-existing tests stay green (no behavioural regressions expected — the existing `ConnectWalletPromoCard` is untouched, only its parent now passes a handler and conditionally renders it).

5. **Manual UX verification (handed off by manager to `ux-tester`).**
   - The Figma target is `1497:95048` (connected) + `1497:94566` (unchanged disconnected). The `ux-tester` skill will run the S-250 cases above. No special prep beyond setting / clearing `pipeline.mock.wallet.isConnected` is required.

## Docs to Update

- **`docs/STORIES.md`** — append the new `S-250` story (see Test Strategy §3). Keeps the docs-first invariant intact and gives `ux-tester` a documented case for the regression pass.
- **`packages/frontend/src/routes/index.tsx` docblock** — the ASCII layout comment mentions only "Portfolio (Connect Wallet)" for the top-left slot today. Update it to reflect the new dual state (Connect promo vs Portfolio placeholder) and the `isConnected` branch. Not a separate doc file, but flagged so the coder does not skip it.
- **`packages/frontend/src/components/PortfolioPlaceholderCard.tsx` docblock** — written from scratch as part of step 2; covered by Implementation Steps.
- **No product-spec change required.** The Pipeline product specs (`docs/product-specs/dashboards.md`) describe the eventual data-backed LP Dashboard. This Issue ships a literal placeholder so the home page renders coherently after connect; the spec already anticipates a richer portfolio surface, so no spec wording needs to change.
- **`docs/exec-plans/active/issue-250-home-connect-wire-portfolio-placeholder.md`** — this plan file. The `manager` archives it to `docs/exec-plans/completed/` after merge.
