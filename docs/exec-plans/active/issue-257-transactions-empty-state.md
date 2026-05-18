# Issue #257: Show striped-clock empty state on /transactions when there are no requests

Source: https://github.com/eq-lab/pipeline/issues/257

## Scope

Replace the bare `"No activity yet"` text branch on `/transactions` with the same illustration-driven empty state used by `RecentActivityCard`: `ActivityEmptyIllustration` (tone `muted`) + caption `"You will see all transactions here"`, centred in the body region below the SegmentedTabs. Figma reference: [1993:9144](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1993-9144&m=dev).

Two distinct "empty" cases are explicitly disambiguated:

1. **Wallet-level empty** — API returned zero rows OR the wallet is disconnected (so the hook is disabled and `data` is `undefined`). Render the full illustration + caption empty state.
2. **Tab-level empty** — `data` exists with rows but the active tab filter yields zero. Render a lighter muted line: `"No {tab.label} activity yet"`.

The loading branch and the error/Retry branch are unchanged.

Files in scope:

- `packages/frontend/src/routes/transactions.tsx`
- `packages/frontend/src/routes/-transactions.test.tsx`

Out of scope: `RecentActivityCard` (already correct), retry CTA on empty, caption copy changes, removal of "All" tab (already done in #229).

## Assumptions and Risks

- `@pipeline/ui` exports both `ActivityEmptyIllustration` and `EmptyState` (verified in `packages/ui/src/index.ts`). `RecentActivityCard.tsx` already composes them the same way — the new code mirrors that pattern.
- `useWallet()` from `@/wallet` exposes `isConnected` (verified via `RecentActivityCard.tsx:74`). Importing `useWallet` into `transactions.tsx` is consistent with existing usage.
- `useRequests()` is disabled when the wallet is disconnected — so disconnected is observable as `!isConnected || data === undefined` once loading and error are excluded. Treating disconnected as "wallet-level empty" matches the Issue requirement.
- Risk: the disconnected branch in the existing test (`describe("Transactions page — disconnected wallet (no data)")`) currently asserts that **no** "No activity yet" text renders. After this change, the disconnected case must render the new empty state — that assertion has to be inverted in the same patch.
- Risk: `useWallet()` in the test environment may need mocking. The existing test file already side-steps wagmi by mocking `@/api`; we must add a `vi.mock("@/wallet", ...)` so importing `useWallet` from `transactions.tsx` does not pull in wagmi/AppKit. Pattern is straightforward and unlocks the disconnected-empty assertion.
- Figma height for the empty region: the Issue notes the design has substantial top padding, not full-viewport centering. Use `min-h-[400px]` initially and verify against Figma during ux-tester pass.

## Open Questions

_None_

## Implementation Steps

1. **Update `packages/frontend/src/routes/transactions.tsx`:**
   - Add imports: `ActivityEmptyIllustration`, `EmptyState` to the existing `@pipeline/ui` import; add `import { useWallet } from "@/wallet";`.
   - Inside `Transactions()`, after `const { data, isLoading, error, refetch } = useRequests();` add `const { isConnected } = useWallet();`.
   - Compute the two empty conditions:
     ```ts
     const shouldRenderWalletEmpty =
       !isLoading && !error && (!isConnected || data?.requests.length === 0);
     const shouldRenderTabEmpty =
       !!data && data.requests.length > 0 && filtered.length === 0;
     const activeTabLabel = TABS.find((t) => t.id === activeTab)?.label ?? "";
     ```
   - Replace the `{data && filtered.length === 0 && (...)}` block (lines 90–94) with two branches:
     - **Wallet-level empty:** wrap `EmptyState` in a flex column with `min-h-[400px] items-center justify-center` so it centres below the tabs.
       ```tsx
       {shouldRenderWalletEmpty && (
         <div className="flex min-h-[400px] flex-col items-center justify-center">
           <EmptyState
             illustration={<ActivityEmptyIllustration tone="muted" width={240} />}
             caption="You will see all transactions here"
           />
         </div>
       )}
       ```
     - **Tab-level empty:** keep the existing muted-text style:
       ```tsx
       {shouldRenderTabEmpty && (
         <div className="text-[color:var(--color-pipeline-ink-muted)]">
           No {activeTabLabel} activity yet
         </div>
       )}
       ```
   - Keep the `filtered.length > 0` branch that maps rows, unchanged.
   - Update the file's leading JSDoc block to document the two empty cases.

2. **Update `packages/frontend/src/routes/-transactions.test.tsx`:**
   - Add a `vi.mock("@/wallet", ...)` factory with a `mockUseWallet` that returns `{ isConnected: true }` by default, so existing tests keep passing.
   - Rewrite the `"Transactions page — empty state"` describe: assert the illustration caption `"You will see all transactions here"` is rendered, and `"No activity yet"` is **not** rendered. Use `getByText("You will see all transactions here")` for the assertion.
   - Add a new describe `"Transactions page — tab-level empty"` that mocks one Deposit row, switches to the Sell tab, and asserts `"No Sell activity yet"` renders while the illustration caption does **not**.
   - Update `"Transactions page — disconnected wallet"`: set `mockUseWallet` to `{ isConnected: false }`, keep `data: undefined`, and invert the assertion — the illustration caption MUST render; loading / error / muted "No activity" must NOT render.
   - Ensure the existing default-Buy-tab, tab-switching, loading, error, and formatting describes still pass; they need `mockUseWallet` to default to connected.

3. **Run validations** (per `AGENTS.md`):
   - `yarn workspace @pipeline/frontend test -- -t transactions` (or the project's test-fast equivalent) green.
   - `npx tsx scripts/lint-docs.ts` passes after the JSDoc edit.
   - Manual / ux-tester pass against Figma 1993:9144 for the centring and illustration width (240 px feels right at the 480 px content width; tune if Figma disagrees).

## Test Strategy

Vitest coverage in `-transactions.test.tsx`:

- **Wallet-level empty (connected, zero rows):** mock `useRequests` → `{ requests: [] }`, `useWallet` → `{ isConnected: true }`. Expect caption present, "No activity yet" absent.
- **Wallet-level empty (disconnected):** mock `useRequests` → `data: undefined`, `useWallet` → `{ isConnected: false }`. Expect caption present.
- **Tab-level empty:** mock `useRequests` → one Deposit row, switch to Sell tab. Expect `"No Sell activity yet"` present and the illustration caption absent.
- **Regression — connected with data:** existing default Buy / tab-switching / formatting tests continue to pass (no empty state at all).
- **Loading state:** unchanged — no empty state is rendered while `isLoading && !data`.
- **Error state:** unchanged — Retry button still works; empty state is suppressed.

Edge cases to keep in mind in assertions:

- The illustration is decorative — assert on the caption text rather than alt/role of the SVG.
- Tab-level empty must NOT fire when the wallet is disconnected (we have no `data` then).
- Wallet-level empty must NOT fire while loading or while an error is on screen.

ux-tester pass (Figma-driven): verify the rendered empty state on `/transactions` matches node 1993:9144 (illustration size, caption, vertical spacing below SegmentedTabs).

## Docs to Update

No product-spec update required — this is a visual polish that aligns one page with an existing design language already documented for `RecentActivityCard`. The route file's own JSDoc gets a small note about the two empty cases. No entries in `docs/product-specs/` or `docs/design-docs/` need to change.
