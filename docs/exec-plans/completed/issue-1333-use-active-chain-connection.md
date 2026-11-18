# Issue #1333: Extract useActiveChainConnection() to deduplicate active-chain isConnected derivation

Source: https://github.com/eq-lab/pipeline/issues/1333 (epic #2029, Frontend tech debt; tracker entry TD-22)

## Scope

Add one hook, `useActiveChainConnection()`, in `packages/frontend/src/wallet/`. It returns
`{ kind, address, isConnected, chainId }` for the namespace `useWalletView().kind` reports. Replace
every inline copy of the derivation with it. This is a refactor only: rendered output, query keys,
`enabled` gates and request URLs stay exactly as they are.

Sites verified in `packages/frontend/src` (six, not three). The issue names `useRequests.ts`, but the
derivation there lives in `useActiveRequestsScope()` in `api/activityRefresh.ts`, which `useRequests`
calls.

| # | File | Current derivation | Replace with hook? |
|---|------|--------------------|--------------------|
| 1 | `components/RecentActivityCard.tsx:35-39` | `useWalletView` + `useEvmWallet`/`useStellarWallet` → `kind === "stellar" ? isStellarConnected : isEvmConnected` | Yes (`isConnected` only; `kind` is not used elsewhere in the file, so drop the `useWalletView` import if nothing else needs it) |
| 2 | `api/activityRefresh.ts:126-135` (`useActiveRequestsScope`) | `kind`, `address`, `isConnected`, `chainId` | Yes. Delete `useActiveRequestsScope`. Its two callers (`useRequests` in `api/useRequests.ts:78` and `useActionConfirmedRefresh` in `api/activityRefresh.ts:153`) call `useActiveChainConnection()` instead |
| 3 | `routes/transactions.tsx:46-51` | `kind` + `isConnected` | Yes. `kind` is still used, so take it from the hook too |
| 4 | `api/usePositionsHistory.ts:136-144` | `isStellar ? …` → `address`, `isConnected`, `chainId` | Yes |
| 5 | `api/usePnl.ts:63-71` | same as 4 | Yes |
| 6 | `routes/index.tsx:77-83` | `evm`/`stellar` objects + `useWalletView().kind` → `isConnected` (`evm`/`stellar` are used only on line 83; `kind` is also used at line 138) | Yes. Take `kind` and `isConnected` from the hook and remove the now-unused `useEvmWallet`/`useStellarWallet`/`useWalletView` calls and imports |

Site 6 is not in the issue or the manager's grep. It has the same derivation with different variable
names (`stellar.isConnected : evm.isConnected`). It is in scope because the issue asks that no copy be
left behind.

**Hook semantics. They must match the inline code exactly.**

- `kind = useWalletView().kind`. Do **not** use `useActiveChain().kind`. `useActiveChain` defaults to
  `stellar` when no wallet is connected, while `useWalletView` defaults to `evm`. Building on it would
  change the query keys and the `chain_id` of disconnected visitors.
- `address = kind === "stellar" ? stellar.address : evm.address`. Use the raw address and do **not**
  set it to `undefined` when disconnected the way `useActiveWalletAccount` does.
  `useActionConfirmedRefresh` checks only `if (address)`, and the query keys contain `address`.
- `isConnected = kind === "stellar" ? stellar.isConnected : evm.isConnected`.
- `chainId = kind === "stellar" ? ENV.STELLAR_CHAIN_ID : ENV.EVM_CHAIN_ID`. Sites 2, 4 and 5 need it.
  The issue's shape (`{ kind, isConnected, address }`) is a subset of this one.

**Out of scope**

- `useActiveWalletAccount` (`wallet/useActiveWalletAccount.ts`). It has its own derivation with a
  `kind === "evm"` branch and the address masking described above. Changing it to use the new hook
  would change the masked address, and it also reads balances. Leave it as it is.
- `useDepositFlow` / `useStakeFlow`. They branch per chain throughout and do not have the single
  `isConnected` ternary.
- `useActiveChain()` and its consumers. That is a different rule (protocol reads) and stays unchanged.
- Any change to what is rendered or which requests are sent.

## Assumptions and Risks

- **Test mocks (the main risk).** The consumer tests replace `@/wallet` exports:
  `components/RecentActivityCard.test.tsx`, `routes/-transactions.test.tsx` and
  `routes/-activity-refresh.test.tsx` spread `importOriginal`, while `api/usePnl.test.tsx`,
  `api/usePositionsHistory.test.tsx` and `api/activityRefresh.test.tsx` use a full factory with no
  original. The new hook imports `./evm/useEvmWallet`, `./stellar/useStellarWallet` and
  `./WalletViewContext` by relative path, so overriding `useEvmWallet` etc. on the `@/wallet` barrel
  will **not** reach it. The full-factory mocks will also have no `useActiveChainConnection` at all.
  Each of these tests must be updated (see Test Strategy). `api/useRequests.test.tsx` has no
  `@/wallet` mock, so check how it gets its wallet state and update it the same way if needed.
  `routes/-index.test.tsx` mocks `wagmi` and the stellar config at a lower level, so the real hook
  runs and the test should pass unchanged.
- **Overlap with #1329 (PR #2030, open).** That branch adds the `## Epic #2029 — Frontend tech debt`
  section to `docs/user-stories/index.md` and edits `docs/exec-plans/tech-debt-tracker.md` (TD-6).
  Expect a trivial merge conflict in `index.md`. If #2030 is already on `main` when the coder starts,
  add a row under its section. Otherwise create the section with the same heading and table header so
  the conflict resolves to one section. The TD-22 edit is a different entry and should not conflict.
- No dependency on unmerged work.

## Open Questions

_None_

## Implementation Steps

1. **Create `packages/frontend/src/wallet/useActiveChainConnection.ts`.**
   - Header: one 2–3-line spec pointer only, e.g.
     `// spec: docs/frontend/hooks.md (useActiveChainConnection) — wallet-scoped active chain;`
     `// protocol reads use useActiveChain (docs/frontend/wallet-flows.md#active-chain-for-protocol-reads).`
     Add no other comments or JSDoc (comment-minimal rule).
   - Export `interface UseActiveChainConnectionResult { kind: WalletViewKind; address: string | undefined; isConnected: boolean; chainId: number }`
     and `function useActiveChainConnection(): UseActiveChainConnectionResult`. Build it from
     `useWalletView()`, `useEvmWallet()`, `useStellarWallet()` and `ENV` (`@/lib/env`), all imported by
     relative or alias path the way `useActiveChain.ts` does. Implement the four rules in **Hook
     semantics** above.
   - Check the type of `useEvmWallet().address` (it may be `` `0x${string}` | undefined ``). Keep
     `address` typed so the existing call sites compile unchanged (`string | undefined` is what
     `useActiveRequestsScope` returns today through inference). Use the narrowest type that still
     compiles at all six sites.
2. **Export it from `packages/frontend/src/wallet/index.ts`** next to `useActiveChain` (line ~186):
   `export { useActiveChainConnection } from "./useActiveChainConnection";` plus the result type.
3. **`api/activityRefresh.ts`:** delete `useActiveRequestsScope` and its `// ── Active wallet scope`
   divider. In `useActionConfirmedRefresh`, use
   `const { kind, address, chainId } = useActiveChainConnection();`. Remove the `useEvmWallet`,
   `useStellarWallet` and `useWalletView` imports and the `ENV` import if they become unused.
4. **`api/useRequests.ts`:** drop `useActiveRequestsScope` from the `./activityRefresh` import and
   import `useActiveChainConnection` from `@/wallet`. Line 78 becomes
   `const { kind, address, isConnected, chainId } = useActiveChainConnection();`. Check the whole
   repo for other `useActiveRequestsScope` imports (none found in `src`; check `api/index.ts` and the
   tests) and remove any re-export.
5. **`api/usePnl.ts` and `api/usePositionsHistory.ts`:** replace the `useWalletView`/`useEvmWallet`/
   `useStellarWallet` block and the `isStellar`/`address`/`isConnected`/`chainId` lines with
   `const { kind, address, isConnected, chainId } = useActiveChainConnection();`. The query keys,
   `queryFn` and `enabled` stay byte-identical. Remove unused imports (`ENV` stays only if used
   elsewhere in the file).
6. **`components/RecentActivityCard.tsx`:** replace lines 35–39 with
   `const { isConnected } = useActiveChainConnection();`. Keep `useEvmStakeDecimals`. Update the
   `@/wallet` import list.
7. **`routes/transactions.tsx`:** replace the `useWalletView`, `useEvmWallet` and `useStellarWallet`
   calls and line 51 with `const { kind, isConnected } = useActiveChainConnection();`. Keep
   `useConnectModal`, `useEvmStakeDecimals` and `useChainServed`. Update the imports.
8. **`routes/index.tsx`:** replace lines 77–83 (`evm`, `stellar`, `useWalletView`, `isConnected`)
   with `const { kind, isConnected } = useActiveChainConnection();`. Confirm with grep that `evm.` and
   `stellar.` are not used anywhere else in the file before removing them, and remove the unused
   imports.
9. **Grep check:** run
   `grep -rnE '(kind === "stellar"|isStellar) \? *(isStellarConnected|stellar\.isConnected)' packages/frontend/src`.
   The only remaining hit should be `useActiveChainConnection.ts` (plus `useActiveWalletAccount.ts`,
   which uses the `kind === "evm"` form and is out of scope).
10. **Build:** `yarn workspace` lint, typecheck and build for `packages/frontend` (see AGENTS.md /
    `/test-fast`). No route is added, so `routeTree.gen.ts` does not need regenerating.

## Test Strategy

- **New unit test `packages/frontend/src/wallet/useActiveChainConnection.test.tsx`**, modelled on
  `useActiveChain.test.tsx` (mock `./evm/useEvmWallet`, `./stellar/useStellarWallet` and
  `./WalletViewContext`, plus `@/lib/env`). Cases:
  - view `evm`, EVM connected → `{ kind: "evm", isConnected: true, address: <evm>, chainId: EVM_CHAIN_ID }`
  - view `stellar`, Stellar connected → the Stellar address and `STELLAR_CHAIN_ID`
  - view `evm`, nothing connected (the provider default) → `kind: "evm"`, `isConnected: false`,
    `chainId: EVM_CHAIN_ID`. This pins the difference from `useActiveChain`
  - view `stellar` while only EVM reports connected → `isConnected: false` and the Stellar address
    (follows the view, not the connection flags)
  - the address is passed through raw, not masked, when the wallet reports an address but
    `isConnected: false`
- **Update the existing consumer tests so they still cover the real derivation.** Preferred: move
  the wallet mocks from the `@/wallet` barrel to the source modules (`@/wallet/evm/useEvmWallet`,
  `@/wallet/stellar/useStellarWallet`, `@/wallet/WalletViewContext`, each spreading `importOriginal`
  where other exports are needed). Then both the barrel and the new hook see the mocked state, and
  the existing assertions keep passing unchanged. Files:
  `components/RecentActivityCard.test.tsx`, `routes/-transactions.test.tsx`,
  `routes/-activity-refresh.test.tsx`, `api/usePnl.test.tsx`, `api/usePositionsHistory.test.tsx`,
  `api/activityRefresh.test.tsx`, and `api/useRequests.test.tsx` if it relies on wallet state. If
  moving a mock is impractical in one file, add `useActiveChainConnection` to that file's `@/wallet`
  factory, built from the same mock state. Do not change any assertion: the existing assertions are
  the regression check that nothing changed.
- If any test imported `useActiveRequestsScope`, point it at the new hook instead or remove that
  test (its behaviour is covered by the new unit test).
- Run the full frontend suite (`/test-fast`), not only the touched files: other `@/wallet` mocks
  (e.g. `routes/-root.test.tsx`) render `RecentActivityCard` or the routes indirectly.
- Manual smoke (no new UI): `/`, `/transactions` and the home Recent Activity card show the same
  connected and disconnected states as before for an EVM session, a Stellar session and no wallet.
  The `/v1/requests`, `/v1/pnl` and `/v1/positions/history` requests carry the same `wallet` and
  `chain_id` (Network tab).

## Docs to Update

- `docs/frontend/hooks.md`: add a `useActiveChainConnection` row to the hook table. Location
  `@/wallet`. Describe it as `{ kind, address, isConnected, chainId }` for `useWalletView().kind`,
  with the raw address and default `evm`. Name its consumers (`useRequests`,
  `useActionConfirmedRefresh`, `usePnl`, `usePositionsHistory`, `RecentActivityCard`,
  `/transactions`, `/`) and contrast it with `useActiveChain` (protocol reads, default `stellar`).
- `packages/frontend/src/wallet/README.md`: add a `### useActiveChainConnection()` section next to
  `### useActiveChain()` with the same contrast.
- `packages/frontend/src/api/README.md`: the `useRequests` and `usePnl` paragraphs ("follows
  `useWalletView().kind`, uses the active wallet address…") can now say that the wallet scope comes
  from `useActiveChainConnection()`. Keep the wording otherwise.
- `docs/frontend/dashboard-components.md` (~line 1978, `/transactions` "Active-chain gating"): say
  that the gate comes from `useActiveChainConnection().isConnected`. The behaviour wording is
  unchanged.
- `docs/exec-plans/tech-debt-tracker.md` TD-22: add `[RESOLVED 2026-11-<dd> / #1333]` to the heading
  and a `- **Resolution (…, #1333):**` line. It should say the hook exists, list the six consumers,
  say that `useActiveRequestsScope` was removed, and say that `useActiveWalletAccount` keeps its own
  derivation (masked address).
- **User stories (required):** create
  `docs/user-stories/epic-2029/1333-use-active-chain-connection.md` in the existing format (title,
  Epic #2029, Issue link, Status: Initial, Overview, Given/When/Then stories). It should have
  regression stories covering: no wallet (`/transactions` and the home Recent Activity card show the
  empty or connect state, with no `/v1/requests`, `/v1/pnl` or `/v1/positions/history` calls); EVM
  wallet (rows and P&L for the EVM address with the EVM `chain_id`); Stellar wallet (same with the
  Stellar address and `chain_id`); and a confirmed action refreshing Recent Activity. Link it from
  `docs/user-stories/index.md` under `## Epic #2029 — Frontend tech debt`. Add the row if #1329 / PR
  #2030 already created that section; otherwise create the section with the identical heading and
  `| Issue | Doc | Status |` header.
- No product-spec change: the behaviour does not change.
