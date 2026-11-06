# Issue #1848: LP app: one source of wallet precedence — connectedWallet() duplicates WalletViewContext's EVM-then-Stellar order

Source: https://github.com/eq-lab/pipeline/issues/1848

Epic #1247. Branch `chore/1848-wallet-precedence` (cut from `main` after #1825 / #1849), PR #1851 → `main`.
Refactor only: no UI change, no Figma.

## Scope

Make one pure function the only place that decides which wallet wins when both an EVM and a
Stellar wallet report connected (#1512: EVM first, else Stellar), and have both consumers call it:

- `packages/frontend/src/wallet/WalletViewContext.tsx` — `WalletViewProvider` computes `kind`
  with an inline `evm.isConnected ? "evm" : stellar.isConnected ? "stellar" : DEFAULT_KIND`.
- `packages/frontend/src/components/account/settlementAddress.ts` — `connectedWallet(evm, stellar)`
  re-implements the same order for the settlement rows and `useSettlementAddressLink`.

**Chosen owner:** a new dependency-free module `packages/frontend/src/wallet/walletPrecedence.ts`
exporting `walletPrecedence(evm, stellar): WalletViewKind | null`. `WalletViewProvider` uses it
(`?? DEFAULT_KIND`), and `connectedWallet` delegates to it, then pairs the winning kind with that
wallet's address. `connectedWallet` and the `ConnectedWallet` type stay in `settlementAddress.ts`
(they carry settlement-specific shape and all call sites stay unchanged).

**Why not derive from `useWalletView()` in the hook:** in `packages/frontend/src/main.tsx`
`AuthFlowProvider` is mounted **above** `WalletViewProvider`
(`… > ToastProvider > AuthFlowProvider > WalletViewProvider > RouterProvider`), and
`useSettlementAddressLink` runs inside `AuthFlowProvider`. There `useWalletView()` has no provider
and always returns the fallback `{ kind: "evm" }`, so a Stellar-only LP would get `connected = null`
(or the wrong kind) and could no longer link. Reordering providers is out of scope
(`docs/frontend/auth-components.md` documents the provider above `WalletViewProvider`, and
`WalletViewProvider` runs `useSingleWalletInvariant`, whose placement is load-bearing). A pure
function has no provider dependency and works in both places.

**Why a separate file instead of exporting from `WalletViewContext.tsx`:** `settlementAddress.ts`
imports it by deep path `@/wallet/walletPrecedence` (deep `@/wallet/...` imports are already used
in production code, e.g. `HomeStatsStrip.tsx`, `formatUnits4.ts`). Five test files mock `@/wallet`
with a factory that exports only `useStellarWallet` / `useEvmWallet` / `isStellarSettlementAddress`
(`auth/AuthFlowProvider.test.tsx`, `auth/AuthFlowProvider.setup.test.tsx`,
`auth/useSettlementAddressLink.test.tsx`, `components/account/settlementAddress.test.ts`,
`components/account/SettlementAddressRow.test.tsx`); a deep import bypasses those mocks, so the real
rule runs in every test with no mock edits, and the module pulls in no wagmi / kit code.

Unchanged: `useSettlementAddressLink` keeps returning `connected` (consumed by `AuthFlowProvider`),
the `ConnectedWallet` shape `{ kind, address }`, and the stale-wallet guard
(`latest.current.connected?.kind` / `.address` comparison) — it still reads the same `connected`.

Out of scope: `useActiveChain` (`wallet/useActiveChain.ts`) has its own chain rule (default
`stellar`, `useWalletView().kind` breaks a both-connected tie); it is a different rule with a
different default and is not touched. No provider reordering. No UI, copy, or API change.

## Assumptions and Risks

- **One deliberate convergence in an unreachable-in-practice state.** Today `WalletViewProvider`
  decides on `isConnected` only, while `connectedWallet` also requires an address
  (`evm.isConnected && evm.address`). They disagree only when the EVM wallet reports
  `isConnected: true` with `address: undefined` **and** the Stellar wallet is connected with an
  address: the view says `evm`, the settlement row links Stellar. After this change both say EVM
  and `connectedWallet` returns `null` (no linkable wallet). This state needs both wallets
  connected at once (torn down by `useSingleWalletInvariant`, and the mock layer reports both
  disconnected when both mocks are set) **and** an EVM connection without an address (wagmi's
  connected status always carries an address; only the `pipeline.mock.wallet.isConnected` key
  without `pipeline.mock.wallet.address` produces it). Every reachable state keeps identical output:
  same wallet linked, same rows, same view kind. Removing exactly this divergence is the Issue's
  goal, so this is the intended result, not a regression; it gets an explicit test case.
- `WalletViewKind` (`"evm" | "stellar"`) and `SettlementKind` (`"stellar" | "evm"`) are the same
  union, so the precedence result assigns to `ConnectedWallet.kind` without a cast.
- No baseline entry in `scripts/lint-comments.baseline.json` for any touched file; the new file
  needs only the one-line spec header.
- No dependency on unmerged work: #1825 and #1849 are on `main`.

## Open Questions

_None_

## Implementation Steps

1. **Create `packages/frontend/src/wallet/walletPrecedence.ts`.** Header:
   `// spec: docs/frontend/wallet-flows.md#single-connected-wallet`. No other comments. The module has
   zero imports: move `export type WalletViewKind = "evm" | "stellar";` here from
   `WalletViewContext.tsx`, and in `WalletViewContext.tsx` import it and re-export it
   (`export type { WalletViewKind } from "./walletPrecedence";`) so every existing
   `import type { WalletViewKind } from "@/wallet"` keeps working. Export:
   ```ts
   export function walletPrecedence(
     evm: { isConnected: boolean },
     stellar: { isConnected: boolean },
   ): WalletViewKind | null {
     if (evm.isConnected) return "evm";
     if (stellar.isConnected) return "stellar";
     return null;
   }
   ```
2. **`packages/frontend/src/wallet/WalletViewContext.tsx`.** Replace the inline ternary with
   `const kind: WalletViewKind = walletPrecedence(evm, stellar) ?? DEFAULT_KIND;`. Keep
   `DEFAULT_KIND`, the fallback value, `useSingleWalletInvariant()` and the public API unchanged.
3. **`packages/frontend/src/wallet/index.ts`.** Under `// ── View selection ──`, add
   `export { walletPrecedence } from "./walletPrecedence";` (public API for future callers; the
   type re-export of `WalletViewKind` already exists via `./WalletViewContext`).
4. **`packages/frontend/src/components/account/settlementAddress.ts`.** Add
   `import { walletPrecedence } from "@/wallet/walletPrecedence";` (deep path, see Scope) and
   rewrite `connectedWallet` to delegate:
   ```ts
   export function connectedWallet(evm: WalletLike, stellar: WalletLike): ConnectedWallet | null {
     const kind = walletPrecedence(evm, stellar);
     if (kind === null) return null;
     const address = (kind === "evm" ? evm : stellar).address;
     return address ? { kind, address } : null;
   }
   ```
   Keep the `WalletLike` interface, signature and export name, so `useSettlementAddressLink.ts`
   (line ~58, `const connected = connectedWallet(evm, stellar)`) and `AuthFlowProvider.tsx` need no
   change. Do not add comments.
5. **No change** to `packages/frontend/src/auth/useSettlementAddressLink.ts`,
   `packages/frontend/src/auth/AuthFlowProvider.tsx`, or `packages/frontend/src/main.tsx`. Verify by
   reading that the hook still returns `connected` and the stale guard compares kind + address.
6. Run `cd packages/frontend && npx eslint . && npx tsc --noEmit` (or the package `lint` /
   `typecheck` scripts), `yarn test` for the frontend package, `yarn build` (no new route, so no
   routeTree regen), `npx tsx scripts/lint-docs.ts` (0 errors) and `npx tsx scripts/lint-comments.ts`.

## Test Strategy

- **New `packages/frontend/src/wallet/walletPrecedence.test.ts`** (header
  `// spec: docs/frontend/wallet-flows.md#single-connected-wallet`), `it.each` table moved from the
  precedence cases of the `connectedWallet` block in `settlementAddress.test.ts`:
  both connected → `"evm"`; Stellar only → `"stellar"`; EVM only → `"evm"`; none → `null`.
- **`packages/frontend/src/components/account/settlementAddress.test.ts`** — shrink the
  `connectedWallet` block to what `settlementAddress.ts` still owns (pairing the winner with its
  address): EVM alone → `evm(E1)`; Stellar alone → `stellar(A)`; preferred wallet connected
  without address → `null` (both the existing EVM-only case and the new case
  `{ isConnected: true, address: undefined }` + `{ isConnected: true, address: A }` → `null`,
  documenting the convergence in Assumptions and Risks).
- **One new test proving the settlement rows follow `useWalletView`** (same file, new `describe`):
  - Add hoisted wallet state and `vi.mock("@/wallet/evm/useEvmWallet", …)`,
    `vi.mock("@/wallet/stellar/useStellarWallet", …)`,
    `vi.mock("@/wallet/useSingleWalletInvariant", () => ({ useSingleWalletInvariant: () => {} }))`;
    import `WalletViewProvider` / `useWalletView` from `@/wallet/WalletViewContext` (deep path, so
    the existing `@/wallet` factory mock is untouched) and the mocked hooks from their deep paths.
  - Set EVM `{ isConnected: true, address: E1 }` and Stellar `{ isConnected: true, address: A }`.
  - `renderHook` inside the provider (wrapper via `createElement(WalletViewProvider, null, children)`
    so the file can stay `.ts`), returning `useWalletView().kind` and
    `deriveSettlementRows({ lpRead: "loaded", lp: lp(), connected: connectedWallet(useEvmWallet(), useStellarWallet()), link: IDLE })`
    with an LP that has no served addresses (reuse the file's `lp()` helper / an idle link state
    `{ kind: null, phase: "idle", mode: "wallet" }`).
  - Assert `view === "evm"`, exactly one row, `rows[0].kind === view`, `rows[0].action === "link"`.
  - Second case in the same test (or `it.each`): Stellar only → view `"stellar"` and the single row's
    kind is `"stellar"`.
- **`packages/frontend/src/wallet/WalletViewContext.test.tsx`** — existing cases must pass
  unchanged; add one case "is evm when both wallets are connected" if not already covered (it is
  not today).
- Existing suites that must pass untouched: `auth/useSettlementAddressLink.test.tsx` (including
  the stale-wallet cases), `auth/AuthFlowProvider*.test.tsx`, `SettlementAddressRow.test.tsx`,
  `AccountPage.test.tsx`, `routes/-account*.test.tsx`, `routes/-index.test.tsx`,
  `routes/-deposit.test.tsx`, `useActiveChain.test.tsx`.
- Full frontend suite, lint, typecheck and build green (Issue "Done when").

## Docs to Update

- `docs/frontend/wallet-flows.md` § Single connected wallet — add a bullet: the precedence is
  decided by `walletPrecedence(evm, stellar)` (`packages/frontend/src/wallet/walletPrecedence.ts`,
  #1848): EVM if connected, else Stellar, else `null`; `WalletViewProvider` maps `null` to the
  default `evm`, and the settlement link (`connectedWallet`) pairs the winner with that wallet's
  address. It is a pure function so `useSettlementAddressLink` can use it inside `AuthFlowProvider`,
  which is mounted above `WalletViewProvider`.
- `docs/frontend/account-page.md` § Settlement address, paragraph **Connected wallet** — replace
  "(the same order as `useWalletView().kind`)" with: decided by `walletPrecedence` (the single
  owner, see `wallet-flows.md#single-connected-wallet`); `connectedWallet` adds the winning wallet's
  address and is `null` when that wallet has no address.
- `docs/frontend/hooks.md` — `useWalletView` row: state that `kind` is
  `walletPrecedence(evm, stellar) ?? "evm"`; `useSettlementAddressLink` row: `connected` comes from
  `connectedWallet`, which delegates to `walletPrecedence`.
- `packages/frontend/src/wallet/README.md` § Public API — add `walletPrecedence` under a
  `// View selection` group (with `WalletViewProvider`, `useWalletView`) in the import block.
- **User stories (Definition of done):** new
  `docs/user-stories/epic-1247/1848-wallet-precedence.md`, same header format as
  `1849-settlement-address-signer.md` (title `# User Stories: #1848 — …`, Epic, Issue, Spec links to
  `docs/frontend/wallet-flows.md#single-connected-wallet` and
  `docs/frontend/account-page.md#settlement-address`). One story: **Both wallets connected → the
  settlement row and the wallet view agree.** Persona: signed-in LP with an LP record (not
  `Failed`), no settlement address linked. Steps: set both mock wallets
  (`pipeline.mock.wallet.address` + `pipeline.mock.wallet.stellar.address`) or restore a legacy
  both-connected session, open `/account`. Expected: while both report connected (before the
  single-wallet cleanup disconnects both), the header / wallet card show the EVM namespace and the
  only settlement row with a `Link wallet` action is the Ethereum row; after the cleanup both are
  disconnected and the generic `Settlement address` row with
  `Connect a wallet to name your settlement address.` shows; no wallet prompt opens at any point.
  Note that the mock layer reports both wallets disconnected when both mocks are set, so the
  both-connected moment is only observable with a restored real session — the automated test in
  `settlementAddress.test.ts` is the primary proof.
- `docs/user-stories/index.md` § Epic #1247 — add the row
  `| [#1848 LP app: one source of wallet precedence](https://github.com/eq-lab/pipeline/issues/1848) | [1848-wallet-precedence.md](./epic-1247/1848-wallet-precedence.md) | Initial |`
  after the #1849 row.
- No product-spec change (no behaviour change).
