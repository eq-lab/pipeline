# Issue #558: Connect page: network tabs (EVM / Soroban) with styled wallet lists, desktop + mobile

Source: https://github.com/eq-lab/pipeline/issues/558

Part of Epic #556 (Connect page).

## Scope

Build a new Connect page at a new route in `packages/frontend`:

- A heading ("Connect Wallet"), a segmented tab control to filter wallets by network, a styled vertical list of wallet rows (name + icon, optional "Recent" subtitle, bottom border), and a "Show More" affordance.
- Desktop layout: two columns — the connect content on the left (centered, ~400 px container) and a full-height right "picture" section (background image + "Pipeline" logo + "Access real-world yield on-chain" headline). A top-right close (×) button.
- Mobile layout: the same connect content, with the **right picture section removed**.
- Each wallet row is wired to the EXISTING wallet-connection stack: Reown AppKit / WalletConnect v2 (wagmi/viem) for EVM, `@creit.tech/stellar-wallets-kit` for Soroban.

**Out of scope:** new networks, new wallet integrations beyond those already bundled, KYC/terms changes (the existing chain-agnostic terms gate is reused unchanged), and changing the TopBar connect entry point (it may optionally link to this page — see Open Questions, but no behavior change is in scope here).

### Design source

- Desktop Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=2858-57637&m=dev
  - Node `2858:57637` ("Connect Wallet"). Tabs render as **`All` / `Ethereum` / `Stellar`** (3 tabs, not the 2 "EVM/Soroban" tabs named in the issue text — see Open Questions).
  - Wallet rows shown in the frame: **MetaMask** (with "Recent" subtitle), **Trust Wallet**, **Coinbase Wallet**, **WalletConnect**, **Phantom**, then a **Show More** button. (Phantom is shown in the design but is not in the issue's wallet list — see Open Questions.)
  - Row anatomy: 56 px tall, name in Body Emphasized (Graphik LC Semi Bold 16/22, ink primary), optional caption subtitle (Graphik LC Regular 12/16, ink secondary), trailing 24 px wallet icon, bottom border `rgba(56,55,53,0.18)`.
  - Tabs: muted-fill track (`rgba(191,189,187,0.12)`), 2 px padding, radius 6 px; active tab white, radius 4 px, 32 px tall; Caption Emphasized (Graphik LC Medium 12/16). This matches the existing `SegmentedTabs` `track` variant.
  - Heading: Besley Regular 48/56 (Heading L), ink primary.
  - Right image panel: background photo + 2880 px texture rectangle + Pipeline logo + white Besley 48/56 headline "Access real-world / yield on-chain".

## Assumptions and Risks

- **Per-wallet connect is NOT exposed today.** The existing public hooks only open generic modals:
  - `useEvmWallet().connect()` (`packages/frontend/src/wallet/evm/useEvmWallet.ts`) calls `useAppKit().open()` — the AppKit modal where the user picks the wallet. There is no per-connector entry point exposed.
  - `useStellarWallet().connect()` (`packages/frontend/src/wallet/stellar/useStellarWallet.ts`) calls `StellarWalletsKit.authModal()` — the kit's own wallet-picker modal.
  The issue wants individual wallet buttons (MetaMask, Trust, …) that go straight into a specific wallet's flow. Wiring those buttons to **specific** wallets requires new per-wallet connect functions:
  - EVM: wagmi `useConnect()` + selecting a connector by id/name from `wagmiConfig.connectors` (the AppKit/wagmi adapter auto-registers injected/MetaMask, Coinbase, WalletConnect connectors).
  - Soroban: `StellarWalletsKit.setWallet(id)` then `getAddress()` / `fetchAddress()`, using the exported module-id constants (`LOBSTR_ID`, `FREIGHTER_ID`, `XBULL_ID`, `HANA_ID`, `ALBEDO_ID`, `RABET_ID` from `@creit.tech/stellar-wallets-kit`).
  This is a thin layer over existing plumbing (same kit, same wagmi config, same terms gate), but it IS new code in the wallet module. The issue says "no new connection logic"; the most faithful reading is "reuse the existing kit/AppKit/terms stack, do not add a new wallet provider or a new chain" — the per-wallet selector functions are the minimal glue needed to satisfy the per-wallet-button design. Flagged in Open Questions so the manager can confirm before the human gate.
- **Import boundary:** ESLint `no-restricted-imports` forbids importing `wagmi`, `@reown/appkit`, `viem`, or `@creit.tech/stellar-wallets-kit` outside `src/wallet/evm/` and `src/wallet/stellar/`. Therefore any per-wallet connect glue MUST live inside those directories and be re-exported through the `@/wallet` barrel (`packages/frontend/src/wallet/index.ts`). The Connect page itself must only import from `@/wallet` and `@pipeline/ui`.
- **Terms gate must be preserved.** Both existing `connect()` paths route through `useWalletGate()` / `readTermsAcknowledged()` before opening any wallet. New per-wallet functions MUST route through the same gate (open the gate, then run the per-wallet connect as the `onProceed` callback) to avoid regressing the jurisdiction attestation.
- **Mock layer must be preserved.** Both hooks short-circuit when `pipeline.mock.wallet.*` keys are set. New per-wallet functions should keep the same mock short-circuit so dev/test affordances and existing tests are not broken.
- **`routeTree.gen.ts` is generated** by `@tanstack/router-plugin` on dev/build; the coder must run a build/dev once so the new route is registered (the file is committed).
- **Fallback risk:** if a named wallet is not installed/available, the per-wallet connect may reject. The page should degrade gracefully (e.g. surface the kit/wagmi error, or fall back to the existing modal). Exact UX for unavailable wallets is a question (see Open Questions).
- Wallet brand icons (MetaMask, Trust, Coinbase, WalletConnect, Phantom, and Soroban wallets) are not confirmed to exist as `@pipeline/ui` assets; they may need to be added as SVG assets. The Figma exposes them as image refs only.

## Open Questions

- Tabs: the issue says **EVM / Soroban** (2 tabs) but the Figma shows **All / Ethereum / Stellar** (3 tabs, with an "All" default). Which is authoritative — follow Figma (All/Ethereum/Stellar) or the issue text (EVM/Soroban)? This drives whether there is an "All" combined list.
- Wallet set: the Figma frame shows **Phantom** (not in the issue's wallet list) and does not visibly enumerate all six Soroban wallets (they presumably appear under "Show More" / the Stellar tab). Confirm the exact per-tab wallet sets to render: EVM = MetaMask, Trust, Coinbase, WalletConnect (+ Phantom?); Soroban = LOBSTR, Freighter, xBull, Hana, Albedo, Rabet. What does "Show More" reveal, and how many rows are shown before it?
- "No new connection logic" vs. per-wallet buttons: confirm it is acceptable to add minimal per-wallet connect functions inside `src/wallet/` (wagmi `useConnect` by connector; kit `setWallet(id)` + `getAddress`). If NOT acceptable, the only alternative is that each button opens the existing generic AppKit / kit `authModal` (i.e. all EVM buttons open the same AppKit modal, all Soroban buttons open the same kit picker) — confirm which behavior is wanted.
- Route + entry point: what path should the page live at (`/connect`?), and should the TopBar "Connect Wallet" button / `ConnectChooserModal` be repointed to this page, or does the page coexist with the existing modal flow? The close (×) button in the design implies a modal-like dismissal — is this a full page (route) or a modal overlay? (The issue says "page/route".)
- Behavior for unavailable/uninstalled wallets (e.g. MetaMask not installed): show install prompt, error toast, or fall back to the generic modal?

## Implementation Steps

1. **Confirm scope from Open Questions** (manager/human gate) — specifically tabs (2 vs 3), the per-tab wallet set, and whether per-wallet connect glue is allowed. The steps below assume: follow Figma tabs (`All` / `Ethereum` / `Stellar`), render the issue's wallet sets per network, and add minimal per-wallet connect glue inside `src/wallet/`. Adjust if the gate decides otherwise.

2. **EVM per-wallet connect glue** — in `packages/frontend/src/wallet/evm/`:
   - Add a function/hook (e.g. extend `useEvmWallet` with `connectWallet(walletId)` or add a sibling `useEvmConnectors()`), built on wagmi `useConnect()` and `wagmiConfig.connectors` (from `evm/config.ts`). Map the design's wallet names to connector ids/names (MetaMask/injected, Coinbase, WalletConnect). For "Trust", determine whether it resolves to a dedicated connector or the injected/WalletConnect path.
   - Preserve the existing terms-gate routing (`useWalletGate().openGate(() => …)`) and the mock short-circuit (`pipeline.mock.wallet.*`).
   - Re-export through `packages/frontend/src/wallet/index.ts`.

3. **Soroban per-wallet connect glue** — in `packages/frontend/src/wallet/stellar/`:
   - Add a function/hook (e.g. extend `useStellarWallet` with `connectWallet(walletId)`) that calls `StellarWalletsKit.setWallet(id)` then `getAddress()`/`fetchAddress()` and stores the address, using the module-id constants imported only inside this directory: `LOBSTR_ID`, `FREIGHTER_ID`, `XBULL_ID`, `HANA_ID`, `ALBEDO_ID`, `RABET_ID`.
   - Preserve the terms-gate routing and mock short-circuit, mirroring the existing `runConnect`/`connect` structure in `useStellarWallet.ts`.
   - Optionally use `StellarWalletsKit.refreshSupportedWallets()` to detect availability for graceful fallback.
   - Re-export through the barrel.

4. **Wallet metadata module** (page-side, in `src/components/` or a new `src/connect/`): a small static catalog mapping each wallet → `{ id, label, subtitle?, network: "evm" | "stellar", icon }`, plus the connect action to call. No restricted imports here — actions reference the barrel-exported per-wallet connect functions.

5. **Wallet icons** — add the brand SVGs (MetaMask, Trust, Coinbase, WalletConnect, Phantom, LOBSTR, Freighter, xBull, Hana, Albedo, Rabet) as assets/components, either under `packages/ui` (if treated as shared) or local to the page. Match the 24 px sizing in the design.

6. **WalletRow component** — a presentational row: leading text block (name in Body Emphasized + optional caption subtitle), trailing 24 px icon, 56 px height, bottom border `var(--color-pipeline-line)` (or equivalent token), hover/focus states, `<button>` semantics with an accessible label. Use design tokens only (no raw hex).

7. **Connect page route** — new file `packages/frontend/src/routes/connect.tsx` using `createFileRoute("/connect")`:
   - Compose: heading, `SegmentedTabs` (`track` variant) from `@pipeline/ui` with the agreed tabs, the filtered wallet list (`WalletRow` per wallet), a "Show More" button toggling the full list.
   - Manage active-tab state and "show more" state locally (pattern matches `stake.tsx`).
   - Wire each row's `onClick` to the appropriate per-wallet connect action from `@/wallet`.
   - Right picture panel as a sibling column, hidden on mobile (Tailwind responsive: e.g. `hidden lg:flex`); reuse existing image/logo assets if available (`Logo` from `@pipeline/ui`).
   - Close (×) button top-right — clarify destination (back/navigate home) per Open Questions; default to navigating to `/`.
   - Run a dev/build pass so `routeTree.gen.ts` regenerates and includes `/connect`.

8. **Responsive layout** — desktop two-column (left content centered ~400 px; right image full height); mobile single column with the image panel removed and content padding adjusted. Verify both with the existing Tailwind breakpoints.

9. **Docs** — update `docs/frontend/hooks.md` (the wallet hooks rows for `useEvmWallet` / `useStellarWallet`) to document the new per-wallet connect surface, and add the Connect page to any page inventory in `docs/FRONTEND.md` / `docs/frontend/index.md` if such an inventory exists.

10. **Lint** — run `npx tsx scripts/lint-docs.ts` and the frontend lint/typecheck; ensure no `no-restricted-imports` violations (verify the page imports only `@/wallet` and `@pipeline/ui`).

## Test Strategy

Follow the existing route-test pattern (`packages/frontend/src/routes/-stake.test.tsx`, `-index.test.tsx`) using the `pipeline.mock.wallet.*` layer and Testing Library.

Add `packages/frontend/src/routes/-connect.test.tsx` covering:
- Renders heading, the agreed tabs, and the wallet rows for the default tab.
- Tab switching filters the wallet list (EVM tab shows EVM wallets; Stellar tab shows Soroban wallets; All shows both if applicable).
- "Show More" reveals the remaining wallets.
- Clicking a wallet row invokes the correct per-wallet connect action (mock the `@/wallet` per-wallet connect functions and assert the right one is called with the right wallet id).
- Terms gate is respected: when terms are not acknowledged, clicking a wallet opens the gate rather than connecting directly (assert via the mock/gate seam).
- Mobile layout: the right picture panel is not rendered at the mobile breakpoint (assert the panel element is absent / hidden).
- Accessibility: rows are focusable buttons with accessible names; close button has an `aria-label`.

Unit-test the new per-wallet connect glue at the wallet-module level if feasible (mock `wagmi`/`useConnect` and the `StellarWalletsKit` singleton, mirroring existing `evm`/`stellar` tests), asserting connector/`setWallet(id)` selection and the terms-gate + mock short-circuits.

Figma verification: compare the rendered `/connect` page (desktop + mobile) against node `2858:57637` — tab styling, row spacing/borders, typography tokens, and the right image panel. This is also covered later by the epic's QA pass (ux-tester) against the epic Figma references.

## Docs to Update

- `docs/frontend/hooks.md` — `useEvmWallet` / `useStellarWallet` rows: document the new per-wallet connect surface.
- `docs/FRONTEND.md` and/or `docs/frontend/index.md` — add the Connect page if a page inventory exists.
- No product-spec change required unless the gate decides the Connect page introduces user-facing behavior worth a spec entry (this is a UI surface over existing connection behavior); confirm during the gate.
