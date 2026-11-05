# Issue #1847: LP app: move wagmi useSignMessage out of the shared useEvmWallet into a dedicated useEvmSignMessage

Source: https://github.com/eq-lab/pipeline/issues/1847

Epic #1247. Branch `chore/1847-evm-sign-message-hook` (cut from `main`, includes #1825, #1849, #1848), PR #1852 to `main`.
Follow-up from the automated review of PR #1846 (#1825), item 5. Refactor only: no UI change, no Figma reference.

## Scope

**In scope (LP app, `packages/frontend`):**

- New hook `useEvmSignMessage()` in `packages/frontend/src/wallet/evm/useEvmSignMessage.ts`, exported from
  `@/wallet`. It returns `{ signMessage(message, address?) }` with the exact contract `useEvmWallet().signMessage` has
  today: EIP-191 `personal_sign` through wagmi `useSignMessage().signMessageAsync({ message, account? })`, `account`
  pinned only when an address is given, and a rejection with
  `[wallet mock] signMessage is not mockable; connect a real wallet` when `pipeline.mock.wallet.address` is set (no wagmi
  call on that path).
- `useEvmWallet` loses `useSignMessage` and its `signMessage` function; `WalletState` loses `signMessage`. After this
  `useEvmWallet` mounts no wagmi mutation hook (only `useAccount`, `useDisconnect`, plus AppKit / gate / mock hooks).
- `useSettlementAddressLink` (the only consumer) signs EVM challenges through `useEvmSignMessage()` and Stellar
  challenges through `useStellarWallet().signMessage` as before.
- Remove the `useSignMessage: vi.fn(() => ({ signMessageAsync: vi.fn() }))` stub from the 13 test files that partially
  mock wagmi (list in step 6). Move the three EVM `signMessage` tests from `useEvmWallet.test.tsx` to a new
  `useEvmSignMessage.test.tsx`.
- Add `useEvmSignMessage` to the three `vi.mock("@/wallet", …)` factories that mount the real `AuthFlowProvider`
  (which owns `useSettlementAddressLink`), and to the settlement hook's own test mock.
- Docs: wallet README, `docs/frontend/hooks.md`, `docs/frontend/account-page.md#settlement-address`, user-stories doc +
  index row.

**Decision: Stellar side stays as is (no `useStellarSignMessage`).** `useStellarWallet().signMessage` is a
`useCallback` over the `StellarWalletsKit` singleton: it mounts no observer or mutation state, so splitting it saves
nothing at runtime. It also sits next to `signTransaction` on the same hook (signing is part of the Stellar wallet
surface there), and a split would churn the five `signMessage: vi.fn()` entries in
`useStellarStakedPlusd.test.tsx` and the `AuthFlowProvider.setup.test.tsx` mock for no gain. The asymmetry is
documented in the README (the EVM hook is split only because wagmi's `useSignMessage` is a mutation hook).

**Out of scope:**

- `packages/wallet-connect/src/evm/useEvmWallet.ts` (the Trustee's shared package) also calls `useSignMessage`
  inside its wallet hook; the Trustee's auth flow is its only consumer and the LP app does not use that package
  (TD-35). Not touched here.
- Any change to the settlement flow: the pinned signer (`account: address`), the stale-wallet guard (`stale()`), the
  error matrix (`declined` / `proofFailed` / `taken` / `error` / `idle`), click-only prompting, and request shapes all
  stay identical.
- No product-spec change (pure refactor, no behaviour change).

## Assumptions and Risks

- **Missing mock exports throw.** A `vi.mock("@/wallet", () => ({ … }))` factory without `importOriginal` makes any
  unlisted export throw on access (`No "useEvmSignMessage" export is defined on the mock`). Every test that renders the
  real `useSettlementAddressLink` therefore needs `useEvmSignMessage` in its `@/wallet` mock:
  `auth/useSettlementAddressLink.test.tsx`, `auth/AuthFlowProvider.test.tsx`, `auth/AuthFlowProvider.setup.test.tsx`.
- **`routes/-root.test.tsx` spreads `importOriginal`** of `@/wallet` and renders the real `AuthFlowProvider` with no
  `WagmiProvider`. Without an override the real `useEvmSignMessage` would call wagmi `useSignMessage` → `useConfig`
  → `WagmiProviderNotFoundError`. It must override `useEvmSignMessage` too. Today it gets away without a wagmi mock
  only because it overrides `useEvmWallet`.
- **Import path.** The settlement hook imports `useEvmSignMessage` from the `@/wallet` barrel (same import line as
  `useEvmWallet` / `useStellarWallet`; the README requires consumers to use the public surface). A deep import
  (`@/wallet/evm/useEvmSignMessage`) would not avoid the test edits above: those tests would then mount the real wagmi
  hook without a provider and crash, so they would need a separate `vi.mock` of the deep path instead. The barrel is
  the simpler and consistent choice.
- **No other renderer of the settlement hook.** `grep -rl AuthFlowProvider packages/frontend/src` shows only the three
  test files above plus the provider itself; route/component tests mock `@/auth`. So no test file in the 13-stub list
  mounts `useEvmSignMessage`, and removing their stubs is safe. If a removed stub breaks a test, that test mounts
  `useSettlementAddressLink` through a path missed here: add a `useEvmSignMessage` override to its `@/wallet` mock
  (do not re-add a wagmi stub).
- **Regression guard.** `useEvmWallet.test.tsx` partially mocks wagmi with `...original` and a fragment
  `WagmiProvider`. Once its `useSignMessage` stub is removed, any reintroduction of `useSignMessage` in `useEvmWallet`
  would hit the real wagmi hook and fail that suite. That is the automated proof of "no mutation hooks".
- **Identity.** `useEvmWallet().signMessage` was re-created every render; the settlement hook reads signers from
  `latest.current`, so the new hook's function identity does not matter. Wrapping it in `useCallback` is harmless and
  matches the Stellar side.
- No dependency on unmerged work: #1825, #1849, #1848 are on `main`.

## Open Questions

_None_

## Implementation Steps

1. **Create `packages/frontend/src/wallet/evm/useEvmSignMessage.ts`.**
   - Line 1, the only comment: `// spec: packages/frontend/src/wallet/README.md#useevmsignmessage`.
   - `import { useCallback } from "react"; import { useSignMessage } from "wagmi"; import { useMock, parseAddress } from "./mock";`
   - `const MOCK_ADDRESS_KEY = "pipeline.mock.wallet.address";` (same local-constant pattern as
     `useEvmNetworkGuard.ts`).
   - `export interface EvmSignMessage { signMessage(message: string, address?: string): Promise<{ signature: string }>; }`
   - `export function useEvmSignMessage(): EvmSignMessage`:
     `const { signMessageAsync } = useSignMessage(); const mockAddress = useMock(MOCK_ADDRESS_KEY, parseAddress);`
     and a `useCallback` `signMessage(message, signer?)` whose body is exactly the current one in `useEvmWallet.ts`:
     throw `new Error("[wallet mock] signMessage is not mockable; connect a real wallet")` when
     `mockAddress !== undefined`; otherwise
     `return { signature: await signMessageAsync({ message, ...(signer ? { account: signer as \`0x${string}\` } : {}) }) }`.
     Deps `[mockAddress, signMessageAsync]`. Return `{ signMessage }`.
   - No other comments (comment-minimal rule).

2. **Strip signing from `packages/frontend/src/wallet/evm/useEvmWallet.ts`.**
   - Remove `useSignMessage` from the wagmi import.
   - Remove `signMessage(...)` from `interface WalletState`.
   - Remove `const { signMessageAsync } = useSignMessage();`, the `async function signMessage(...)` and `signMessage`
     from the returned object.
   - Leave everything else (mock precedence, `isSettled`, `connect`/`disconnect`, `useEvmConnectors`,
     `useContractRead`) unchanged. The file is not in `scripts/lint-comments.baseline.json`; add no comments.

3. **Export from the barrel `packages/frontend/src/wallet/index.ts`** (EVM namespace, right after the
   `useEvmWallet` export block):
   `export { useEvmSignMessage } from "./evm/useEvmSignMessage";`
   `export type { EvmSignMessage } from "./evm/useEvmSignMessage";`

4. **Switch the consumer `packages/frontend/src/auth/useSettlementAddressLink.ts`.**
   - Import: `import { useEvmSignMessage, useEvmWallet, useStellarWallet } from "@/wallet";`
   - In the hook body add `const evmSigner = useEvmSignMessage();` next to `const evm = useEvmWallet();`.
     `evm` stays: it still feeds `connectedWallet(evm, stellar)`.
   - In `snapshot`, replace the `evm` field with `evmSigner` (`evm` is no longer read from `latest.current`; keep
     `stellar`, which is still the Stellar signer).
   - In `run`, the signer line becomes
     `const signer = kind === "evm" ? latest.current.evmSigner : latest.current.stellar;`
     and the call stays `await signer.signMessage(message, wallet.address)`. Both sides share the
     `signMessage(message, address?) => Promise<{ signature: string }>` shape, so the union type-checks.
   - Nothing else changes: `stale()`, `finish`, `fail`, phases, toasts, request shapes.

5. **Move the EVM signing tests.**
   - New `packages/frontend/src/wallet/evm/useEvmSignMessage.test.tsx`, line 1
     `// spec: packages/frontend/src/wallet/README.md#useevmsignmessage`. Full (not partial) wagmi mock:
     `vi.mock("wagmi", () => ({ useSignMessage: vi.fn(() => ({ signMessageAsync: mockSignMessageAsync })) }))`
     with `mockSignMessageAsync` from `vi.hoisted`. `renderHook(() => useEvmSignMessage())` without a wrapper
     (the hook needs no provider once wagmi is mocked). `beforeEach`: `localStorage.clear()`,
     `mockSignMessageAsync.mockReset()`. Cases (ported from `useEvmWallet.test.tsx` "useEvmWallet — signMessage()"):
     - returns `{ signature: "0xsig" }` and calls `signMessageAsync({ message: "hello" })` (no `account` key) when no
       address is given;
     - pins `account: "0xAbC0…0001"` when an address is given;
     - mock path (`pipeline.mock.wallet.address` set): rejects with `signMessage is not mockable` and
       `signMessageAsync` is not called;
     - new: a `signMessageAsync` rejection (user declined) propagates as a rejection (the settlement hook maps it to
       `declined`).
   - In `packages/frontend/src/wallet/evm/useEvmWallet.test.tsx`: delete the `describe("useEvmWallet — signMessage()")`
     block, the `mockSignMessageAsync` constant and the `useSignMessage` line in the wagmi mock. Add one assertion to
     an existing render test (or a small new `it`): `expect(result.current).not.toHaveProperty("signMessage")`.

6. **Remove the 13 `useSignMessage` stubs** (the line
   `useSignMessage: vi.fn(() => ({ signMessageAsync: vi.fn() })),` in each wagmi partial mock; found with
   `grep -rn "useSignMessage" packages/frontend/src`):
   1. `packages/frontend/src/wallet/useStakeFlow.test.tsx`
   2. `packages/frontend/src/wallet/evm/useEvmToken.test.tsx`
   3. `packages/frontend/src/wallet/evm/useApproval.test.tsx`
   4. `packages/frontend/src/wallet/evm/useDepositManager.test.tsx`
   5. `packages/frontend/src/wallet/evm/useWithdrawalQueue.test.tsx`
   6. `packages/frontend/src/wallet/evm/useNetworkFeeEstimate.test.tsx`
   7. `packages/frontend/src/api/useRequests.test.tsx`
   8. `packages/frontend/src/api/useWithdrawalVoucher.test.tsx`
   9. `packages/frontend/src/routes/-index.test.tsx`
   10. `packages/frontend/src/routes/-dashboard.test.tsx`
   11. `packages/frontend/src/routes/-deposit.test.tsx`
   12. `packages/frontend/src/routes/-test.test.tsx`
   13. `packages/frontend/src/routes/-stake.test.tsx`

   After this, `grep -rn "useSignMessage" packages/frontend/src` must hit only
   `wallet/evm/useEvmSignMessage.ts`, `wallet/evm/useEvmSignMessage.test.tsx` and `wallet/README.md`.

7. **Update the `@/wallet` mocks that mount the settlement hook.**
   - `packages/frontend/src/auth/useSettlementAddressLink.test.tsx`: in `vi.mock("@/wallet", …)` change
     `useEvmWallet: () => ({ ...wallets.evm, signMessage: … })` to `useEvmWallet: () => ({ ...wallets.evm })` and add
     `useEvmSignMessage: () => ({ signMessage: (...args: unknown[]) => mockEvmSign(...args) })`. All existing
     assertions on `mockEvmSign` (including `toHaveBeenCalledWith("msg-1", E1)` in "passes the challenged address to
     signMessage for both kinds") stay unchanged; they now prove the EVM path goes through `useEvmSignMessage`.
   - `packages/frontend/src/auth/AuthFlowProvider.setup.test.tsx`: drop `signMessage: vi.fn()` from the
     `useEvmWallet` mock and add `useEvmSignMessage: () => ({ signMessage: vi.fn() })`.
   - `packages/frontend/src/auth/AuthFlowProvider.test.tsx`: add `useEvmSignMessage: () => ({ signMessage: vi.fn() })`.
   - `packages/frontend/src/routes/-root.test.tsx`: add `useEvmSignMessage: () => ({ signMessage: vi.fn() })` to the
     `importOriginal` override object.

8. **Docs** (see "Docs to Update" for exact text targets) and the user-stories doc + index row.

9. **Checks** (from repo root unless noted): `yarn lint:comments` (or `npx tsx scripts/lint-comments.ts`; if a
   touched baselined test file's entry now shrinks, run `--update-baseline` and keep the smaller baseline),
   `npx tsx scripts/lint-docs.ts` (0 errors), frontend lint + typecheck + build (`yarn build` in
   `packages/frontend`; no new route, so no `routeTree.gen.ts` regeneration), and the full frontend Vitest suite.

## Test Strategy

- **New unit tests** `wallet/evm/useEvmSignMessage.test.tsx`: unpinned sign, pinned `account`, mock-path rejection
  without a wagmi call, rejection propagation.
- **`wallet/evm/useEvmWallet.test.tsx`**: signing tests removed; `useSignMessage` stub removed (the suite now fails if
  `useEvmWallet` mounts `useSignMessage` again); explicit `not.toHaveProperty("signMessage")` check.
- **`auth/useSettlementAddressLink.test.tsx`**: whole suite passes unchanged except the mock shape. It already covers
  the error matrix (declined, 422 proofFailed, 409 taken / re-read, generic error with best-effort re-read), the stale
  guards (session token change, wallet switched mid-flight), StrictMode, click-only prompting, and the pinned signer
  argument for both kinds. No assertion is loosened.
- **`wallet/stellar/useStellarWallet.test.tsx`**: untouched and must pass (Stellar `signMessage` unchanged).
- **`auth/AuthFlowProvider*.test.tsx`, `routes/-root.test.tsx`**: pass with the new mock entry.
- **The 13 de-stubbed files**: pass without the stub.
- Full frontend suite, lint, typecheck, build green. No QA/user-visible change. The user story is checked by hand with
  real MetaMask on staging (mock wallets cannot sign).

## Docs to Update

- **`packages/frontend/src/wallet/README.md`**
  - `## Public API` import list: add `useEvmSignMessage` after `useEvmWallet`.
  - `### useEvmWallet()`: remove `signMessage` from the destructuring snippet and remove the `signMessage(message)`
    table row.
  - New section `### useEvmSignMessage()` right after `### useEvmWallet()` (anchor `#useevmsignmessage`, the target
    of both new files' spec pointers): snippet `const { signMessage } = useEvmSignMessage();`; one-row table
    `signMessage(message, address?)` → `(message: string, address?: string) => Promise<{ signature: string }>`:
    EIP-191 `personal_sign` through wagmi `useSignMessage`; `address` pins the signing account (`account`); rejects
    on the mock path (`[wallet mock] signMessage is not mockable`). Add one sentence: it is separate from
    `useEvmWallet` so the ~27 `useEvmWallet` consumers do not mount a wagmi mutation observer they never use (#1847);
    the only consumer is `useSettlementAddressLink`. The Stellar `signMessage` stays on `useStellarWallet` because
    the kit call carries no observer.
  - `### useStellarWallet()` table: fix the row to `signMessage(message, address?)` (it already takes the optional
    pinned address since #1825).
- **`docs/frontend/hooks.md`**
  - Add a `useEvmSignMessage` row (`@/wallet`): returns `{ signMessage(message, address?) }`, EIP-191
    `personal_sign` through wagmi `useSignMessage`, `address` pins `account`, rejects on the
    `pipeline.mock.wallet.address` mock path; split from `useEvmWallet` in #1847 so wallet-state consumers mount no
    mutation hook; sole consumer `useSettlementAddressLink`.
  - `useEvmWallet` row: append "No signing: message signing lives in `useEvmSignMessage` (#1847)."
  - `useStellarWallet` row: add `signMessage(message, address?)` (SEP-0053, rejects on the mock path) next to
    `signTransaction`, since it is currently missing there.
  - `useSettlementAddressLink` row: "wallet `signMessage`" becomes "`useEvmSignMessage` (EVM) /
    `useStellarWallet().signMessage` (Stellar)".
- **`docs/frontend/account-page.md#settlement-address`**: in **Flow (click only)**, change
  "(Stellar SEP-0053 through `useStellarWallet`, EVM EIP-191 through `useEvmWallet`; …)" to "EVM EIP-191 through
  `useEvmSignMessage`" and add a link to the README `#useevmsignmessage` anchor next to the existing
  `#usestellarwallet` one. Leave the dated review-fixes note and the rest of the section as is.
- **User stories**: new `docs/user-stories/epic-1247/1847-evm-sign-message-hook.md`, modelled on
  `1848-wallet-precedence.md` (title `# User Stories: #1847 — LP app: EVM message signing in its own hook`, Epic /
  Issue / Spec links to `account-page.md#settlement-address` and the wallet README). One-paragraph summary: refactor
  with no visible change. **Story 1: Linking an EVM wallet still signs with the connected account.** Persona: signed-in
  LP with an LP record (not `Failed`), real MetaMask connected on the staging EVM chain, no Ethereum settlement address
  linked. Steps: open `/account`, click `Link wallet` on the Ethereum row, approve the signature prompt. Expected: the
  prompt shows the challenge text and the connected account; after approval the row shows the linked address;
  rejecting instead ends on the `declined` caption; everything else on the page (wallet card, Stellar row, connect /
  disconnect) behaves as before. Note that mock wallets cannot sign, so this is checked with a real wallet; the
  automated proof is `useEvmSignMessage.test.tsx` + `useSettlementAddressLink.test.tsx`.
- **`docs/user-stories/index.md`**: add a row after the #1848 row (line 210):
  `| [#1847 LP app: move wagmi useSignMessage out of the shared useEvmWallet into a dedicated useEvmSignMessage](https://github.com/eq-lab/pipeline/issues/1847) | [1847-evm-sign-message-hook.md](./epic-1247/1847-evm-sign-message-hook.md) | Initial |`
- No product-spec, ARCHITECTURE or tech-debt change. (`packages/wallet-connect`'s own `useEvmWallet` still mounts
  `useSignMessage` for the Trustee; not filed as debt here since it has a single signing consumer.)
