# Issue #1684: Add the EVM arm of useUsdcCustodyBalance so Cash Management shows a balance on EVM (TD-156)

Source: https://github.com/eq-lab/pipeline/issues/1684

## Scope

Give the trustee's custody USDC read an EVM arm so the Overview **Capital Allocation card** folds the
on-chain custody balance into its Capital Wallet row and guarded total on an EVM session, exactly as it
already does on Stellar.

Research finding that narrows the Issue: #1765 (merged 2026-11-09, `bedfcf06`) removed the Cash
Management `SwapDialog` together with `usdcBalanceValue` / `balanceNum` and the
`chainId === ENV.STELLAR_CHAIN_ID` gate in `packages/trustee/src/routes/-cash-management.ts`. That file
no longer reads `useUsdcCustodyBalance` at all, and TD-156 was marked resolved by #1765 on that basis.
The one live gate left is `packages/trustee/src/components/useCapitalAllocationCard.ts:122-124`, and the
backend `capital_wallet` bucket is still `null` (`packages/api/src/routes/capital_allocation.rs:62`,
`:454`), so an EVM session today shows `—` for Capital Wallet. This plan delivers the Issue's intent on
the surface that still exists. The SwapDialog Balance line / Max chip acceptance item is obsolete, and
the coder must not recreate a balance line in Cash Management.

In scope:

- New trustee env `VITE_EVM_USDC_ADDRESS` / `VITE_EVM_USDC_CUSTODY_ADDRESS` (empty = unconfigured),
  plumbed through `ENV`, root `.env.example`, `docker/trustee/entrypoint.sh`, and the `docs/FRONTEND.md`
  trustee table.
- A plain async ERC-20 balance reader in `@pipeline/wallet-connect` (`src/evm/erc20Balance.ts`) on a
  read-only viem public client over the passed RPC URL. This is the package's first public client; no
  helper exists yet (checked `packages/wallet-connect/src/evm/**`; `useContractRead` is a wagmi hook
  bound to the connected wallet's config and is not usable for a protocol-level read).
- `useUsdcCustodyBalance(chainId)` selects the Stellar SAC arm or the EVM ERC-20 arm by chain id.
- Drop the Stellar-only gate in `useCapitalAllocationCard.ts`. The card passes its already-resolved
  session `chainId` (from `useCapitalAllocation`, which reads `useSessionState().chainId` with
  `ENV.STELLAR_CHAIN_ID` as the no-session fallback) into the hook, so there is one chain resolution.
- Docs: trustee-flows spec paragraph, TD-156 resolution line, user-story updates.

Out of scope:

- The LP frontend (`packages/frontend`) and its `docker/frontend/entrypoint.sh`. The new vars are
  trustee-only.
- Backend `capital_wallet` indexing.
- Any Cash Management UI. No balance is shown there any more (#1765).
- `docs/product-specs/trustee-dashboard.md` (199/200 lines). It does not describe the custody read, so
  no edit is needed.

## Assumptions and Risks

- **EVM custody = Capital Wallet source.** The 2026-10-29 Issue comment verified on Hoodi that the custody
  `0xE122330dBA9394BCAaAAcA580EFd21665b0FA8fA` is the API's `CHAIN_560048_EVM_API_CUSTODY_ADDRESSES`
  deposit custody account, the EVM counterpart of `VITE_STELLAR_USDC_CUSTODY_ID`
  (`deposit_manager.custodian`). It holds 10,000.000000 USDC (`decimals() = 6`) on token
  `0xe198F1EEF83Dd613B874FC3c2D5BAf6C8a4A4597`.
- **Single EVM chain per deployment.** The EVM arm runs only when `chainId === ENV.EVM_CHAIN_ID`. Any
  other chain id (neither configured chain) returns the unconfigured result, so a balance is never read
  for a chain the env does not describe.
- **Public RPC flakiness.** `https://ethereum-hoodi-rpc.publicnode.com` can rate-limit. The existing
  contract already covers this: a read error degrades only the Capital Wallet row (and the total's extra
  addend) and never the card's `isError`/`isLoading`. `retry: false` stays.
- **Deploy config.** Argocd values for the trustee deployment must set the two new vars. This is outside
  the repo. Until then the deployed card behaves exactly as today (`—` on EVM). Call it out in the PR body.
- **TD-156 already reads `[RESOLVED 2026-11-09 / #1765]`.** Its resolution line says nothing shows a
  custody balance any more, which is wrong for the Capital Allocation card. Amend the line; do not
  re-open the entry.
- **viem client import boundary.** viem may be imported only under `packages/wallet-connect/src/evm/**`
  (its `eslint.config.js`), and the trustee forbids viem outright, so the reader must live in
  `src/evm/` and be re-exported from `src/index.ts`.
- `scripts/check-chain-env-names.sh` scans only `CHAIN_<id>_…` spellings. `VITE_EVM_USDC_ADDRESS` /
  `VITE_EVM_USDC_CUSTODY_ADDRESS` cannot match it. Run it anyway as a sanity check.

## Open Questions

_None_

## Implementation Steps

1. **ERC-20 reader in wallet-connect.** Create `packages/wallet-connect/src/evm/erc20Balance.ts` with a
   2–3-line header (`// spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer`) and
   no other comments:
   - `export interface GetErc20BalanceParams { rpcUrl: string; tokenAddress: string; account: string }`
   - `export interface Erc20Balance { raw: bigint; decimals: number }`
   - `export async function getErc20Balance(params): Promise<Erc20Balance>`:
     - Throw `Error("getErc20Balance: tokenAddress must be a 0x address")` /
       `"…account must be a 0x address"` before any RPC when `!isAddress(x)` (viem `isAddress`). This
       mirrors `getSacBalance`'s empty-arg guards.
     - Build the client with `createPublicClient({ transport: http(rpcUrl) })`, cached in a module-level
       `Map<string, PublicClient>` keyed by `rpcUrl`. No `chain` is needed for `readContract`. Do not use
       `multicall`, because it needs a chain with a multicall3 address.
     - `Promise.all` of `readContract({ address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [account] })`
       and `readContract({ …, functionName: "decimals" })`, using viem's built-in `erc20Abi`.
     - Return `{ raw, decimals: Number(decimals) }`.
   - Export `getErc20Balance` and the two types from `packages/wallet-connect/src/index.ts`, next to the
     `evm/contracts/minter` exports. Do not add a narrative JSDoc block there.

2. **Trustee env.** In `packages/trustee/src/lib/env.ts`, add the following next to
   `EVM_CAPITAL_WALLET_ADDRESS`, with no JSDoc (comment-minimal rule; `env.ts` is in the lint-comments
   baseline, so do not grow its comment count):
   - `EVM_USDC_ADDRESS: readString("VITE_EVM_USDC_ADDRESS", "")`
   - `EVM_USDC_CUSTODY_ADDRESS: readString("VITE_EVM_USDC_CUSTODY_ADDRESS", "")`

3. **Env plumbing.**
   - Root `.env.example`: add both vars to the trustee EVM block (after `VITE_EVM_MINTER_ADDRESS`, around
     line 300) with the Hoodi testnet values from the Issue comment, plus a short trailing comment, e.g.
     `VITE_EVM_USDC_ADDRESS=0xe198F1EEF83Dd613B874FC3c2D5BAf6C8a4A4597  # USDC ERC-20 (indexer JOB_INDEXER_EVM_<id>_ASSET_ADDRESS)`
     and
     `VITE_EVM_USDC_CUSTODY_ADDRESS=0xE122330dBA9394BCAaAAcA580EFd21665b0FA8fA  # deposit custody (CHAIN_<id>_EVM_API_CUSTODY_ADDRESSES); set per deploy`.
     Mirror the Stellar pair, which carries real testnet ids.
   - `docker/trustee/entrypoint.sh`: add `--arg VITE_EVM_USDC_ADDRESS "${VITE_EVM_USDC_ADDRESS:-}"` and
     `--arg VITE_EVM_USDC_CUSTODY_ADDRESS "${VITE_EVM_USDC_CUSTODY_ADDRESS:-}"`, plus the two JSON keys
     (pass-through, no defaults), next to the `VITE_EVM_CAPITAL_WALLET_ADDRESS` lines.
   - `docs/FRONTEND.md` trustee table (around lines 249-256): add two rows with "empty (unconfigured)".
     Add one sentence below the table saying they are the USDC token and the deposit custody account,
     and that empty means the Capital Wallet on-chain read shows `—` on an EVM session.

4. **Chain-aware hook.** Rewrite `packages/trustee/src/api/useUsdcCustodyBalance.ts`. Keep the header,
   the exported `UseUsdcCustodyBalanceResult`, and the return shape:
   - Signature `useUsdcCustodyBalance(chainId: number)`.
   - `const arm = chainId === ENV.STELLAR_CHAIN_ID ? "stellar" : chainId === ENV.EVM_CHAIN_ID ? "evm" : null`.
   - `isConfigured` is `arm === "stellar"` with both Stellar ids set, or `arm === "evm"` with both EVM
     addresses set.
   - `queryKey: ["usdcCustodyBalance", chainId, <rpc url of the arm>, <token id>, <custody id>]`. The
     chain id in the key guarantees a chain switch never serves the other chain's cached value.
   - `queryFn`: the Stellar arm is unchanged (`getSacBalance` then `rawToDisplay(raw, 7)`). The EVM arm
     calls `getErc20Balance({ rpcUrl: ENV.EVM_RPC_URL, tokenAddress: ENV.EVM_USDC_ADDRESS, account: ENV.EVM_USDC_CUSTODY_ADDRESS })`
     and then `rawToDisplay(raw, decimals)`, using the on-chain `decimals()` (6 on Hoodi), not a
     hard-coded 6.
   - Rename `sacRawToDisplay` to a neutral `rawToDisplay(raw, decimals)` (same algorithm). Use
     `10n ** BigInt(decimals)`, not `BigInt(10 ** decimals)`.
   - Keep `enabled: isConfigured`, `staleTime: 30_000`, `refetchInterval: 30_000`, `retry: false`, and
     the unconfigured short-circuit `{ data: undefined, isLoading: false, error: null }`.

5. **Drop the card gate.** In `packages/trustee/src/components/useCapitalAllocationCard.ts`, call
   `useUsdcCustodyBalance(chainId)` and set `onChainCapitalWallet = custody.data`. Remove the now-unused
   `ENV` import if nothing else uses it. Leave the guarded-total / legend logic untouched.

6. **Test mocks that stub `@pipeline/wallet-connect`.** Add `getErc20Balance` to the `vi.mock` factories
   in `packages/trustee/src/routes/-index.test.tsx` (around line 96, `mockRejectedValue(new Error("not configured"))`
   like `getSacBalance`) and `packages/trustee/src/components/-CapitalAllocationCard.test.tsx`, so an
   EVM-session render never hits an undefined export.

7. **Docs** (see Docs to Update), then the user-story doc.

8. **Verify:** run `npx vitest run` inside `packages/wallet-connect` and inside `packages/trustee`. Run
   `yarn --cwd packages/wallet-connect lint`, `yarn --cwd packages/trustee lint`,
   `npx tsc --noEmit -p packages/trustee` (or the package build), `npx tsx scripts/lint-docs.ts`,
   `npx tsx scripts/lint-comments.ts`, and `bash scripts/check-chain-env-names.sh`. Do a manual check on
   the user's own dev server, with no restart and no driving their browser. Put the two vars in `.env`,
   sign in with an EVM wallet, and confirm that the Overview Capital Allocation card's Capital Wallet row
   shows about `$10K` (Hoodi custody) with the Hoodi chip, and that a Stellar session shows the Stellar
   figure. Ask the user to check the Network tab for `eth_call` to the Hoodi RPC.

## Test Strategy

- **`packages/wallet-connect/src/evm/erc20Balance.test.ts` (new).** Mock `createPublicClient` via
  `vi.mock("viem", async (orig) => ({ ...(await orig()), createPublicClient: vi.fn(() => ({ readContract })) }))`.
  Cases:
  1. Returns `{ raw, decimals }` and passes `balanceOf` with `args: [account]` and the token address.
  2. A malformed or empty token address or account throws before `createPublicClient` /
     `readContract` is called.
  3. An RPC rejection propagates.
  4. Two calls with the same `rpcUrl` build one client (cache).
- **`packages/trustee/src/api/-useUsdcCustodyBalance.test.tsx`.** Extend `ENV_CONFIGURED` with
  `EVM_USDC_ADDRESS` / `EVM_USDC_CUSTODY_ADDRESS` and the mock with `getErc20Balance`. Pass
  `99_000_001` to the existing Stellar cases. New cases:
  - EVM arm: `chainId 560048` calls `getErc20Balance` with `ENV.EVM_RPC_URL` and the two addresses, never
    calls `getSacBalance`, and `{ raw: 10_000_000_000n, decimals: 6 }` becomes `"10000.000000"`.
  - The Stellar arm never calls `getErc20Balance`.
  - Unconfigured EVM pair (either address empty): returns `{undefined,false,null}` and makes no call.
  - An unknown chain id (neither configured chain) makes no call and returns the unconfigured result.
  - EVM read error surfaces as `error`.
  - The same `QueryClient` re-rendered with a new chain id does not return the previous chain's data
    (check `rerender` with a new prop and assert data comes from the new arm's mock).
- **`packages/trustee/src/components/-useCapitalAllocationCard.test.ts`.**
  - Replace "does not fold the Stellar custody read into an EVM session's card" with "folds the EVM
    custody read into an EVM session's card". With `chainId: 560048` and a hook mock of
    `"10000.000000"`, the legend shows `$10K` and the total shows `$96,010,000`.
  - Assert the spy was called with `560048`, and with `99_000_001` in the Stellar case.
  - Keep a case where the hook returns `undefined` on EVM, so the row shows `—` and the total is
    backend-only.
- Existing `-CapitalAllocationCard.test.tsx` and `-index.test.tsx` stay green with the added mock export.

## Docs to Update

- `docs/frontend/trustee-flows.md` §"Capital Allocation card — data layer" (lines ~2268-2283): rewrite
  the "Capital Wallet on-chain fold-in" paragraph so `useUsdcCustodyBalance(chainId)` reads the session
  chain's custody account:
  - Stellar: `usdc.balance(STELLAR_USDC_CUSTODY_ID)`, 7-decimal SAC.
  - EVM: ERC-20 `balanceOf(VITE_EVM_USDC_CUSTODY_ADDRESS)` on `VITE_EVM_USDC_ADDRESS` through
    `getErc20Balance`, scaled by the token's own `decimals()`.

  Also state that the chain id is part of the query key, and that an unconfigured pair or unknown chain
  gives `—`. Replace the "Scope gate (#1601)… TD-156" sentence: the card passes its resolved chain and
  no longer gates. Edit in place, no new section.
- `docs/exec-plans/tech-debt-tracker.md` TD-156: keep the entry. Change the heading tag to
  `[RESOLVED 2026-11-16 / #1765, #1684]` and extend **Resolution** with: "#1684 added the EVM arm
  (`getErc20Balance` + `VITE_EVM_USDC_ADDRESS` / `VITE_EVM_USDC_CUSTODY_ADDRESS`) and dropped the
  Capital Allocation card's Stellar-only gate."
- `docs/FRONTEND.md` trustee runtime-env table (step 3).
- `docs/user-stories/epic-1521/1600-trustee-withdrawal-queue-chain-scope.md:39`: change the
  Capital-Wallet clause to "the Capital-Wallet balance shows the session chain's custody USDC (#1684)".
- New `docs/user-stories/epic-775/1684-trustee-evm-custody-balance.md`, matching the sibling story
  format. Stories:
  - EVM session shows the Hoodi custody balance in the Capital Wallet row and adds it to the total.
  - A Stellar session is unchanged.
  - With the EVM pair unset, the row shows `—` and the total is backend-only.
  - Switching chains never shows the other chain's figure.
- No change to `docs/product-specs/trustee-dashboard.md` (199-line cap; the read is not described
  there).
