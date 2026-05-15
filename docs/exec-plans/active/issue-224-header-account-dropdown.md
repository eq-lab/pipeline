# Issue #224: Wire up header connected state — open Account dropdown on WalletPill click

Source: https://github.com/eq-lab/pipeline/issues/224

## Scope

In scope:

1. **Move `TopBar` into the root layout** (`packages/frontend/src/routes/__root.tsx`) so every current and future page renders the header without opting in.
2. **Remove per-route `<TopBar … />` calls** from `index.tsx`, `deposit.tsx`, `withdraw.tsx`, `stake.tsx`, `transactions.tsx`, and `test.tsx` — every route that currently mounts a `TopBar` drops it.
3. **Make `TopBar` self-contained.** It reads wallet state internally via `useWallet()` and reads the USDC balance via `useToken({ token: usdc })` where `usdc` comes from `useDepositManagerAddresses()` (the same pattern already used by `index.tsx`, `deposit.tsx`, and `withdraw.tsx`). The `wallet`, `onConnectWallet`, and `activeNav` props are removed from the public interface — `activeNav` is already derived from the URL today, so no route relies on the explicit override at runtime (only `stake.tsx`/`transactions.tsx`/`withdraw.tsx` pass it, and the URL-derived value matches in every case).
4. **New `AccountDropdown` component** (`packages/frontend/src/components/AccountDropdown.tsx`, composed inside `TopBar`, not exported from `@pipeline/ui`). Matches Figma node `1506:104728` inside the `Header / Connected` frame (`1497:94752`):
   - **Heading row** — `Account` title in display font (matches Figma `Heading M`).
   - **Wallet row** — wallet glyph (the Figma node serves it as a localhost SVG; use that asset directly per Figma asset rules), truncated address (`0xXXXX…XXXX`, 6+4 chars), copy button that calls `navigator.clipboard.writeText(address)` and surfaces a brief 1.5s `Copied` affordance.
   - **USDC balance row** — `CoinIcon token="usdc"` at size `md` (40px to match Figma), `USDC balance` caption above `formattedBalance ?? "—"`.
   - **Disconnect row** — full-width row at the bottom; on click calls `useWallet().disconnect()` then closes the dropdown.
   - **Surface tokens** — dark surface (`--fill-test/primary` ≈ `--color-pipeline-ink`) with `--content-test/primary-on-invert` text; **no hardcoded colors** — pull from the existing dark-surface tokens already in `packages/ui/src/styles/theme.css`. Anchored under the `WalletPill`, right-aligned (`absolute right-4 top-[72px] w-[360px]`), `rounded-[var(--radius/radius-l,…)]`, 8px internal gap, dividers between content blocks.
5. **Trigger wiring on `WalletPill`.** `TopBar` wraps the `WalletPill` in a `<button type="button" aria-haspopup="menu" aria-expanded={open}>` that toggles the dropdown. `WalletPill` itself stays presentational (no API change in `@pipeline/ui`).
6. **Dismissal & a11y**:
   - Outside-click closes the dropdown (capture on `mousedown` on `document`, ignore clicks inside the dropdown or on the trigger).
   - `Escape` closes and returns focus to the trigger.
   - Route change closes it (subscribe to `useRouterState({ select: s => s.location.pathname })` and close on change).
   - `role="menu"` on the panel, `role="menuitem"` (or `<button>` with appropriate `aria-label`) on the copy and disconnect rows. The wallet/balance rows are read-only — they should be `role="group"` with a labelled inner structure rather than menuitems.
   - Focus is moved into the dropdown on open (first focusable element). Full focus-trap is out of scope (no nested modals); `Tab` cycling stays within the panel by virtue of the elements present.

Out of scope (per Issue body, restated):

- Multi-token balance lines (no plUSD row yet).
- Network/chain switcher inside the dropdown.
- Mobile-collapsed header variant.
- Disconnect-with-confirmation modal.
- Per-route opt-out for layouts that should hide the header (not needed today; revisit only when a future route needs it).
- Repositioning logic when the viewport is narrower than ~400px (the dropdown is `w-[360px]` and anchored to the right edge with `right-4`, which works at all current breakpoints since the desktop scope is ≥1280px).

## Assumptions and Risks

- **Wallet hooks under `__root.tsx`.** `WalletProvider` already wraps `RouterProvider` in `main.tsx` (per `wallet/README.md`); calling `useWallet()` and `useToken()` from the root route component is supported.
- **USDC balance source.** Pattern matches `routes/deposit.tsx:27-30`, `withdraw.tsx:27-31`, `index.tsx:46-50` — `useDepositManagerAddresses().usdc` falls back to `ZERO_ADDRESS` while loading, and `useToken` short-circuits cleanly on zero-address. No new hook needed. (Note: the Issue body mentions `useUsdcBalance`, which was removed in #220 — the up-to-date contract is `useToken`.)
- **`activeNav` removal is safe.** `stake.tsx:38` passes `activeNav="stats"` and `transactions.tsx:99` passes `activeNav="history"`. The current URL-derived logic in `TopBar.tsx:108-116` would map `/stake` to `"home"` (the default) and `/transactions` to `"history"`. **The `/stake` URL → `stats` mapping needs to be added to the URL-derivation logic** so dropping `activeNav` from `stake.tsx` does not regress the active-nav highlight. Add a `pathname === "/stake" ? "stats"` branch.
- **`activeNav` test coverage.** One existing test in `TopBar.test.tsx:130-144` exercises the `activeNav` prop override. With the prop gone, that test should be replaced by a route-driven equivalent (`/stake` → `Stats` active).
- **Dark-surface tokens already exist.** Verify the dark-on-light tokens in `packages/ui/src/styles/theme.css` cover the dropdown surface, ink-on-invert, caption-on-invert, and divider. If not, the plan adds them; the Figma uses `--fill-test/primary` (dark) and `--content-test/primary-on-invert` (white) — these have analogues already (`--color-pipeline-ink` is the dark token used for primary buttons today). If a token is missing, add it next to its siblings in `theme.css` rather than introducing a raw colour.
- **Clipboard API in tests.** `navigator.clipboard.writeText` is not available in jsdom by default; tests will stub `Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn() } })`.
- **Mock-wallet disconnect.** `useWallet().disconnect()` logs a warning when a mock address is set and does NOT clear the keys (see `useWallet.ts:67-77`). The dropdown still closes after click. This is the documented mock-layer behaviour and is acceptable — manual QA via localStorage is the supported flow.
- **`__root.tsx` and the existing tests for routes.** Several route tests render their route in isolation and do not mount the `WalletProvider`. The route view files no longer render `<TopBar />` themselves, so this is fine. The `TopBar.test.tsx` already builds its own minimal router; rewrite it to wrap with a test `WalletProvider` (or use the mock-key localStorage layer to drive connected/disconnected state without provider mocking — preferred, since it's the documented pattern).
- **Risk: visual regression on routes that previously relied on `activeNav`.** Mitigated by the test added for `/stake` route-derived state and an `ux-tester` pass once implemented.
- **Risk: outside-click handler binding.** Bind with `useEffect` + `addEventListener("mousedown", …, true)` (capture phase) and clean up on unmount, gated by `open`. Use a `useRef` on the dropdown root to detect inside vs outside.

## Open Questions

_None_

## Implementation Steps

1. ✅ **Update `__root.tsx`** to mount `<TopBar />` above `<Outlet />`. File: `packages/frontend/src/routes/__root.tsx`.

   ```tsx
   import { createRootRoute, Outlet } from "@tanstack/react-router";
   import { TopBar } from "@/components/TopBar";

   export const Route = createRootRoute({
     component: () => (
       <>
         <TopBar />
         <Outlet />
       </>
     ),
   });
   ```

2. ✅ **Rewrite `packages/frontend/src/components/TopBar.tsx`** to:
   - Remove `TopBarProps` fields `wallet`, `onConnectWallet`, `activeNav` (drop the public surface entirely; keep only `className` + standard `HTMLAttributes<HTMLElement>` so route-level styling overrides still work if needed).
   - Read state internally:
     ```ts
     const { address, isConnected, connect, disconnect } = useWallet();
     const { usdc } = useDepositManagerAddresses();
     const { formattedBalance } = useToken({
       token: usdc ?? ("0x0000000000000000000000000000000000000000" as `0x${string}`),
     });
     ```
   - Add `const [open, setOpen] = useState(false)` for the Account dropdown.
   - Extend the URL-derivation switch to map `/stake` → `"stats"` (line ~110).
   - When `isConnected && address`: render
     ```tsx
     <button
       type="button"
       aria-haspopup="menu"
       aria-expanded={open}
       onClick={() => setOpen((o) => !o)}
       className="…focus-visible:outline reset"
     >
       <WalletPill token="usdc" balance={formattedBalance ?? "—"} data-node-id="1498:100168" />
     </button>
     {open && <AccountDropdown address={address} formattedBalance={formattedBalance ?? "—"} onClose={() => setOpen(false)} onDisconnect={() => { disconnect(); setOpen(false); }} />}
     ```
     The dropdown is rendered as a sibling inside the right slot so absolute-positioning anchors it cleanly under the pill.
   - When disconnected: render the existing "Connect Wallet" `<Button>` with `onClick={connect}`.
   - Keep `data-node-id` attributes for traceability.

3. ✅ **Create `packages/frontend/src/components/AccountDropdown.tsx`**.

   File responsibilities (one component per file, view + co-located hook per `docs/FRONTEND.md` rule 2):

   - `AccountDropdown.tsx` — JSX only. Anchored panel with three sections (heading, content rows, disconnect). Accepts props:
     ```ts
     interface AccountDropdownProps {
       address: `0x${string}`;
       formattedBalance: string;
       onClose: () => void;
       onDisconnect: () => void;
     }
     ```
   - `useAccountDropdown.ts` (co-located) — owns:
     - `truncate(address)` helper (kept inline if used nowhere else; otherwise extract per rule 3).
     - `copy()` async handler that writes to `navigator.clipboard` and toggles a `copied` boolean (`true` for 1500ms).
     - `useEffect` for outside-click (`document.addEventListener("mousedown", …, true)`), Escape (`keydown`), and pathname-change close. Returns `{ rootRef, copied, copy, truncated }`.

   Visual mapping to Figma node `1506:104728`:
   - Outer panel: `absolute right-4 top-[72px] w-[360px] rounded-[var(--radius-pipeline-…)]` on a dark surface token; 8px internal padding; 8px gap between children.
   - Heading: `<p>Account</p>` in display font (Besley) at heading-m size — use the existing `font-[family-name:var(--font-display)]` token (verify exact var name in `theme.css`; do NOT hardcode).
   - Divider: 1px line at `rgba(white,…)`. Use existing divider token if present; otherwise add one in `theme.css`.
   - Wallet row: 40×40 avatar tile (square with `--radius-s`), wallet glyph fetched from the Figma asset URL and committed as an SVG under `packages/ui/src/assets/icons/wallet-account.svg` (or kept local to `packages/frontend/src/assets/`). `Wallet` caption above `0x8493…3b92`. Right-side copy `<button aria-label="Copy wallet address">` with a 22×22 copy SVG (commit to `packages/frontend/src/assets/copy.svg` and import as `?react`). The `copied` flag swaps the icon for a "check" glyph (or shows a `Copied` text label next to the button) for 1.5s.
   - USDC balance row: `<CoinIcon token="usdc" size="md" />` (40px), caption `USDC balance`, value `formattedBalance`.
   - Divider.
   - Disconnect row: `<button type="button" role="menuitem" onClick={onDisconnect}>` rendering `Disconnect` text full-width.

   A11y:
   - Panel: `role="menu" aria-label="Account"`.
   - Copy button + Disconnect: `role="menuitem"`.
   - `tabIndex={-1}` on the panel; focus moves to the copy button on open (first interactive element) via `useEffect`.

4. ✅ **Drop the per-route `<TopBar … />` mounts.** Edit each of these files to remove the `<TopBar … />` JSX line and the now-unused `TopBar` / wallet imports, and verify the top-padding comments still read correctly:
   - `packages/frontend/src/routes/index.tsx` — drop `<TopBar … />` (line ~54) and the `useWallet`/`useToken`/`useDepositManagerAddresses` calls + imports that fed the prop. The page then has no header dependency.
   - `packages/frontend/src/routes/deposit.tsx` — drop `<TopBar … activeNav="deposit" />` (lines 34-38) and the wallet hooks (the page no longer needs them; this is fine).
   - `packages/frontend/src/routes/withdraw.tsx` — same as deposit, dropping `activeNav="deposit"`.
   - `packages/frontend/src/routes/stake.tsx` — drop `<TopBar wallet={{ balance: "$10,000.00" }} activeNav="stats" />` (line 38). The hardcoded `$10,000.00` disappears with the prop, fixing the "looks connected when disconnected" bug.
   - `packages/frontend/src/routes/transactions.tsx` — drop `<TopBar wallet={{ balance: "$10,000.00" }} activeNav="history" />` (line 99). Same fix.
   - `packages/frontend/src/routes/test.tsx` — drop the `<TopBar onConnectWallet={…} wallet={…} />` block (lines 242-247). The page still owns its `useWallet`/`useToken` calls for its diagnostic body.

   Each route file keeps its outer `<div className="min-h-screen …">` wrapper around `<main>`; the wrapper is the page background, separate from the header (which now lives in `__root.tsx`).

5. ✅ **Rewrite `TopBar.test.tsx`** under `packages/frontend/src/components/`:
   - Drop tests that exercise the removed `wallet`/`onConnectWallet`/`activeNav` props.
   - Keep route-derived active-nav tests; add a new case for `/stake` → `Stats` active (replacing the deleted `activeNav` override test).
   - Add a connected-state test: set the `pipeline.mock.wallet.address` + `pipeline.mock.wallet.isConnected` + `pipeline.mock.wallet.balance.<usdc>` keys in `beforeEach`, set `pipeline.mock.wallet.contract.depositManager.usdc` to a dummy address, mock decimals/symbol via `pipeline.mock.wallet.contract.<usdc>.decimals`/`…symbol`, and assert the `WalletPill` renders with the formatted balance. Clean up in `afterEach`.
   - Add a disconnected-state test: no mock keys → assert `Connect Wallet` button visible.
   - The test will need to wrap the in-memory router with `<WalletProvider>`. Pattern: build the router as today, render with `<WalletProvider><RouterProvider router={…} /></WalletProvider>`.

6. ✅ **Create `AccountDropdown.test.tsx`** covering:
   - Open on pill click; close on outside click; close on `Escape`; close on route change.
   - Address rendered truncated (`0x1234…cdef`); clicking the copy button calls a mocked `navigator.clipboard.writeText` with the full address and shows the `Copied` affordance for ≥1s (assert text appears, then assert it disappears after the timer via `vi.useFakeTimers()`).
   - Disconnect button calls `useWallet().disconnect()` (mocked via the mock-layer localStorage keys) and closes the dropdown.
   - Panel has `role="menu"`, copy/disconnect have `role="menuitem"`, trigger has `aria-expanded` toggling.

7. ✅ **Smoke test that header renders on non-`/` routes.** Add a single test in `TopBar.test.tsx` (or a new `__root.test.tsx`) that mounts a memory router through `__root.tsx` at `/deposit` and asserts the `Pipeline` logo / nav buttons are present. This is the regression guard for "future routes no longer have to remember to mount the header."

8. ✅ **Update `docs/frontend/index.md` if needed.** `AccountDropdown` is a single-owner component (used only by `TopBar`), so it stays out of `docs/frontend/hooks.md`. `useAccountDropdown` is component-local (rule 2 — co-located hook) and is also excluded from the catalogue. No catalogue updates required.

9. ✅ **Run the standard pre-commit gauntlet**:
   ```bash
   yarn workspace @pipeline/frontend test
   yarn workspace @pipeline/frontend lint
   yarn workspace @pipeline/frontend build
   npx tsx scripts/lint-docs.ts
   ```

## Test Strategy

- **Unit tests (Vitest + RTL).**
  - `TopBar.test.tsx` — route-derived active-nav for `/`, `/deposit`, `/withdraw`, `/stake`, `/transactions`; navigation on click; disconnected state shows Connect Wallet; connected state (via mock localStorage) shows `WalletPill` with formatted USDC balance; clicking the pill toggles `aria-expanded` and renders the `AccountDropdown` panel.
  - `AccountDropdown.test.tsx` — open, dismiss (outside, Escape, route change), truncate, copy (with mocked `navigator.clipboard`, fake timers for the "Copied" affordance), disconnect.
  - `__root.test.tsx` (smoke) — header renders on `/deposit`.
- **Mock layer.** All wallet state is driven via `pipeline.mock.wallet.*` localStorage keys (no provider mocking) — matches the documented testing pattern in `wallet/README.md`.
- **Manual / UX test plan (post-implementation, run via `ux-tester`).** Figma reference: [`Header / Connected` (node 1497:94752)](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-94752&m=dev).
  1. Disconnected on `/`, `/deposit`, `/withdraw`, `/stake`, `/transactions`, `/test` — every page renders the `TopBar` with the `Connect Wallet` CTA (no hardcoded `$10,000.00`).
  2. Set the mock connected-wallet keys; refresh every page — the `WalletPill` shows the USDC balance from `useToken`, identical on every route.
  3. Click the pill — Account dropdown opens, anchored right-aligned under the pill, matching the Figma frame. Click outside, press Escape, navigate to another route — each dismisses the dropdown.
  4. Copy button writes the full address to the clipboard and shows the `Copied` affordance for ~1.5s. Verify the clipboard contents in browser DevTools (`await navigator.clipboard.readText()`).
  5. Disconnect button (real wagmi flow) disconnects the wallet and reverts the header to the disconnected state. Confirm the mock-wallet warning when a mock key is set, as documented.
  6. Keyboard: focus the pill, press Enter to open, Tab through Copy → Disconnect, Escape to close — focus returns to the pill.
- **Edge cases.**
  - `useDepositManagerAddresses` still loading → `usdc` is `undefined` → `useToken({ token: ZERO_ADDRESS })` → `formattedBalance` is `undefined` → `WalletPill` shows `"—"`.
  - Wallet disconnected → header shows Connect Wallet, no dropdown trigger.
  - Long balance (`"1,234,567.89"`) does not overflow the pill (existing `whitespace-nowrap` covers it).
  - Address copy in a non-secure-context browser (`navigator.clipboard` undefined) — guard the call and silently no-op the `Copied` affordance; do not crash.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — no change. (No new wallet-module export is introduced; `useToken` is already documented.)
- `docs/frontend/hooks.md` — no change (no new shared hook; `useAccountDropdown` is component-local per rule 2).
- `docs/frontend/utils.md` — no change unless the address-truncation helper is reused by another component during implementation (it is not, today). If you decide to extract it, list it in this file in the same commit per rule 4.
- `docs/STORIES.md` — add a user story line if absent: "User can open the Account dropdown from the header and copy their wallet address or disconnect." Check the file before adding to avoid duplicates.
- No product-spec change required: behaviour is a UI/UX refinement on top of the existing connect/disconnect flow already specified in product docs; the only user-visible new affordance is the dropdown, which is implementation of an existing connect-state requirement.
