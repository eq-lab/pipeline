# Issue #644: Activity page + home: shows empty state AND other-chain transactions — should show only the active chain's list

Source: https://github.com/eq-lab/pipeline/issues/644

## Scope

Bug fix in the frontend. Two render sites currently key their connected/empty
logic on the EVM-specific wallet (`useEvmWallet().isConnected`) while
`useRequests()` already selects data by the active wallet view
(`useWalletView().kind`). With EVM disconnected and Stellar connected+active,
the Activity page renders the empty state AND the Stellar rows simultaneously.

In scope:

- `packages/frontend/src/routes/transactions.tsx`
  - Gate connection/empty on the **active chain's** wallet connection (EVM view → EVM `isConnected`; Stellar view → Stellar `isConnected`), mirroring `useRequests`.
  - Make the empty state and the rows list **mutually exclusive** (`shouldRenderEmpty ? <EmptyState/> : rows`).
- `packages/frontend/src/components/RecentActivityCard.tsx`
  - Same active-chain gating for `showList`.
- Update the two affected test files to cover the active-chain gating and the mutual-exclusivity invariant.

Out of scope:

- Any change to `useRequests.ts` — it is already correct (#552).
- TopBar chain pill / `WalletViewProvider` behaviour — unchanged; we only consume `useWalletView().kind`.
- Visual/layout changes; the empty-state markup and row rendering stay as-is.

## Assumptions and Risks

- Assumption: the correct active-chain connection signal is exactly the one
  `useRequests` already computes:
  `isConnected = kind === "stellar" ? isStellarConnected : isEvmConnected`
  (`packages/frontend/src/api/useRequests.ts:110-117`). The fix replicates this
  derivation at the two render sites rather than inventing a new rule.
- Risk (duplicated logic): the active-chain `isConnected` derivation would now
  exist in three places (`useRequests`, `transactions.tsx`, `RecentActivityCard.tsx`).
  Mitigation options for the coder: either (a) replicate the three-line
  derivation inline at each site (lowest risk, matches existing patterns), or
  (b) extract a tiny shared hook (e.g. `useActiveChainConnection()` in
  `packages/frontend/src/wallet/`) that returns `{ kind, isConnected, address }`
  and have all three consume it. Preference: option (a) for this bug-fix to keep
  the change minimal and low-risk; note (b) in the tech-debt tracker if the
  coder agrees it is worth a follow-up. See Open Questions.
- Risk: existing tests mock only `useEvmWallet` (`mockUseWallet`) and rely on
  the `useWalletView` no-op fallback (`kind: "evm"`). After the change, EVM-view
  scenarios still pass because the fallback kind is `"evm"`, so the gate reads
  EVM connection — behaviour preserved. New Stellar-view scenarios must
  additionally mock `useStellarWallet` and `useWalletView`. Coder must extend
  the `vi.mock("@/wallet", …)` blocks in both test files accordingly.
- Low risk overall: change is localized to two presentational route/components;
  no API, type, or routing changes.

## Open Questions

- Inline replication (option a) vs. a small shared `useActiveChainConnection`
  hook (option b)? The plan defaults to inline (a) to keep the bug fix minimal,
  but a reviewer may prefer the shared hook to eliminate the third copy of the
  derivation. Coder may pick (a) and log (b) as tech debt unless the manager
  prefers (b) now.

## Implementation Steps

1. `packages/frontend/src/routes/transactions.tsx`
   - Replace the import `import { useEvmWallet } from "@/wallet";` with the
     active-chain trio: `import { useEvmWallet, useStellarWallet, useWalletView } from "@/wallet";`.
   - Replace `const { isConnected } = useEvmWallet();` (line 79) with the
     active-chain derivation mirroring `useRequests`:
     ```ts
     const { kind } = useWalletView();
     const { isConnected: isEvmConnected } = useEvmWallet();
     const { isConnected: isStellarConnected } = useStellarWallet();
     const isConnected = kind === "stellar" ? isStellarConnected : isEvmConnected;
     ```
   - Keep `shouldRenderEmpty` (line 85) as is logically
     (`!isLoading && !error && (!isConnected || filtered.length === 0)`), now
     driven by the active-chain `isConnected`.
   - Make rows mutually exclusive with the empty state: change the rows guard
     (line 156) from `filtered.length > 0 && …` to render only when NOT empty —
     e.g. wrap as `!shouldRenderEmpty && filtered.length > 0 && filtered.map(...)`,
     or restructure to `shouldRenderEmpty ? <EmptyState/> : (rows)`. The loading
     and error branches must remain mutually exclusive with both (they already
     gate on `!isLoading && !error` inside `shouldRenderEmpty`; ensure rows do
     not render while loading/error with no data). Net invariant: at most one of
     {loading, error, empty-state, rows} is visible at a time.
   - Update the file's top-of-file doc comment (the "Empty-state behaviour"
     paragraph) to state that connection is keyed off the active chain
     (`useWalletView().kind`), not EVM unconditionally, and that empty-state and
     rows are mutually exclusive.

2. `packages/frontend/src/components/RecentActivityCard.tsx`
   - Replace `import { useEvmWallet } from "@/wallet";` with
     `import { useEvmWallet, useStellarWallet, useWalletView } from "@/wallet";`.
   - Replace `const { isConnected } = useEvmWallet();` (line 82) with the same
     active-chain derivation as step 1.
   - `showList` (line 85) already reads `isConnected && !isLoading && !error && requests.length > 0`
     and the JSX already does `showList ? <list> : <EmptyState>` — already mutually
     exclusive, so only the `isConnected` source changes.
   - Update the component doc comment ("**Everything else** … disconnected")
     to reflect active-chain gating.

3. Tests — `packages/frontend/src/routes/-transactions.test.tsx`
   - Extend the `vi.mock("@/wallet", …)` block to also mock `useStellarWallet`
     and `useWalletView` with configurable mock fns (default `useWalletView` →
     `{ kind: "evm" }`, `useStellarWallet` → `{ isConnected: false }`), keeping
     `mockUseWallet` for EVM.
   - Existing EVM scenarios should continue to pass unchanged (default view is
     `"evm"`).
   - Add a describe block "active chain gating (Issue #644)" covering the repro:
     - Stellar view (`useWalletView` → `{ kind: "stellar" }`), Stellar connected
       (`useStellarWallet` → `{ isConnected: true }`), EVM disconnected
       (`mockUseWallet` → `{ isConnected: false }`), `useRequests` returns
       Stellar rows → assert rows render AND the empty-state caption
       "You will see all transactions here" is NOT in the document
       (the bug: both present). Assert exactly one list state.
     - Stellar view but Stellar disconnected + zero data → empty state renders,
       no rows.
     - EVM view, EVM disconnected, Stellar connected with data → empty state
       renders (because active chain EVM is disconnected; `useRequests` is mocked
       so its `enabled` gating is not exercised here — verify the gate keys off
       EVM, the active view).

4. Tests — `packages/frontend/src/components/RecentActivityCard.test.tsx`
   - Mirror step 3: extend `vi.mock("@/wallet", …)` to mock `useStellarWallet`
     and `useWalletView`. Add a describe block asserting that in Stellar view
     with Stellar connected + data, the list renders (and the empty illustration
     caption is absent), and that EVM connection state no longer drives the card.

5. Lint/build per AGENTS.md TypeScript rule (run during the coder phase):
   `npx tsx scripts/lint-docs.ts` for docs, plus the frontend lint/test/build
   commands the coder normally runs.

## Test Strategy

Unit/integration (Vitest + Testing Library), extending the two existing test
files. No E2E (frontend flow has no testing phase; QA covers the epic).

Key cases to add (the regression that proves the fix):

- Stellar active view + Stellar connected + Stellar rows present →
  rows visible, empty-state caption absent (mutual exclusivity holds). This is
  the exact bug from the Issue.
- Stellar active view + Stellar disconnected → empty state, no rows.
- EVM active view preserves all current behaviour (regression guard) — the
  existing EVM describe blocks must remain green unchanged.
- Mutual exclusivity invariant on `/transactions`: at most one of
  {loading, error, empty-state, rows} renders for any single state combination.

Edge cases:

- `useWalletView` fallback (`kind: "evm"`) when no provider is present — existing
  tests rely on this; confirm they still pass.
- Loading/error with no data still suppress both empty-state and rows.

## Docs to Update

- No product-spec or design-doc change: this is a pure bug fix that restores the
  intended single-list behaviour; no user-facing behaviour is newly introduced.
- Update the in-file doc comments in `transactions.tsx` and
  `RecentActivityCard.tsx` to describe active-chain gating (covered in steps 1–2).
- If the coder chooses inline replication (option a) over a shared hook, log the
  duplicated active-chain `isConnected` derivation in
  `docs/exec-plans/active/../../tech-debt-tracker.md`
  (`docs/exec-plans/tech-debt-tracker.md`) as a small cleanup candidate.
- On completion, the manager moves this plan to `docs/exec-plans/completed/`.
