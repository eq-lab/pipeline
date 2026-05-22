# Issue #365: WithdrawalQueue ABI mismatch: drop fromToken()/intoToken(), source plusd from DepositManager

Source: https://github.com/eq-lab/pipeline/issues/365

## Scope

Stop calling `fromToken()` / `intoToken()` on the deployed WithdrawalQueue — those view functions do not exist on the live impl (`0xdfe25e865f333267a940d3596c77afb7f5aef2cd`) and the reads revert, producing a false "WithdrawalQueue not reachable" banner on `/deposit?direction=withdraw`.

In scope:

- Remove `fromToken` / `intoToken` from the frontend WithdrawalQueue ABI.
- Delete `useWithdrawalQueueAddresses()` and all of its mock-key plumbing (named-alias + generic per-address keys, console.error effects).
- Update `/deposit` route to source `plusd` and `usdc` solely from `useDepositManagerAddresses()` (already in use for the deposit direction).
- Drop the queue-specific reachability banner (`wq-unreachable-banner`); rely on the existing DepositManager reachability banner — both directions now share the same source of truth.
- Update tests: remove `useWithdrawalQueueAddresses` suites and the queue-token mock-key fixtures; update `deposit.test.tsx` and `-scenarios.ts` accordingly.
- Update wallet README and the deposit.tsx file-header JSDoc.

Out of scope:

- Adding new `WithdrawalQueue` view-function probes (e.g., `nextRequestId()` / `authority()`) for a separate reachability signal. Out of scope per "drop the queue-specific banner entirely" decision; the DepositManager-unreachable banner already covers the failure case for both directions.
- Changing the write hooks (`useRequestWithdrawal`, `useClaimWithdrawal`) or their mock keys.
- Backend or contract changes.

## Assumptions and Risks

- Assumption: PLUSD and USDC addresses returned by `DepositManager.plUsd()` / `DepositManager.usdc()` are authoritative for the withdraw direction. The issue body verifies these match the values the WithdrawalQueue would have returned (`0x18d6...16b7` and `0xe198...4597`).
- Assumption: `useToken({ token: plusdAddr, spender: ENV.WITHDRAWAL_QUEUE_ADDRESS })` continues to function correctly when `plusdAddr` is derived from the manager hook instead of the queue hook — same address, same allowance semantics.
- Risk: removing the queue-specific banner means a misconfigured `VITE_WITHDRAWAL_QUEUE_ADDRESS` will only surface at write time (request/claim simulation failure) rather than at page load. Mitigated by the existing simulate-or-fail pre-flight in the write hooks and the zero-address short-circuit (`"WithdrawalQueue not configured"`).
- Risk: existing mock-keyed scenarios (e.g., `routes/test/-scenarios.ts`) that set `pipeline.mock.wallet.contract.withdrawalQueue.plusd` / `usdc` will be no-ops after the hook is removed. Tests that depend on these need to either set the equivalent DepositManager mock keys or rely on the existing manager-keyed mocks already present.

## Open Questions

_None_

## Implementation Steps

1. **ABI** — `packages/frontend/src/wallet/abis/withdrawalQueue.ts`:
   - Remove the `fromToken` and `intoToken` function entries.
   - Keep `requestWithdrawal`, `claimWithdrawal`, and all custom-error entries unchanged.
   - Update the file-header comment that says "on-chain names are generic … holds PLUSD / USDC at those slots" — replace with a one-line note that PLUSD / USDC are sourced from the DepositManager.

2. **Hook** — `packages/frontend/src/wallet/useWithdrawalQueue.ts`:
   - Delete `useWithdrawalQueueAddresses()` entirely (lines ~98–221), along with the `WithdrawalQueueAddressesResult` interface.
   - Delete the named-alias mock keys `plusdAlias` / `usdcAlias` and the generic per-address mock-key builders `contractFromToken` / `contractIntoToken` from the `MOCK_KEYS` map.
   - Remove now-unused imports (`useReadContract`, `useEffect`, `parseAddress` if no longer referenced, `CACHE_FOREVER` if no longer referenced — verify each).
   - Update the top-of-file JSDoc: drop the bullet that lists `useWithdrawalQueueAddresses` and the "named-alias mock keys" line about `fromToken` / `intoToken`. Keep the rest of the mock-key precedence doc accurate for the two write hooks.

3. **Wallet barrel** — `packages/frontend/src/wallet/index.ts`:
   - Remove the `useWithdrawalQueueAddresses` re-export (line ~29).

4. **Route** — `packages/frontend/src/routes/deposit.tsx`:
   - Remove the `useWithdrawalQueueAddresses` import (line 17).
   - Delete the withdraw-direction addresses block (lines 154–158): `plusdFromQueue`, `usdcFromQueue`, `isQueueLoading`.
   - Replace `plusdFromQueue` usage at `plusdAddr = (plusdFromQueue ?? ZERO_ADDRESS)` with `plusdFromManager`.
   - Delete the `isQueueUnreachable` derivation and the `wq-unreachable-banner` JSX block (search the file for `wq-unreachable-banner` and `isQueueUnreachable` and remove both).
   - Update the file-header JSDoc bullet that mentions `useWithdrawalQueueAddresses()` (line 84) — drop it; the hook is gone.

5. **Hook tests** — `packages/frontend/src/wallet/useWithdrawalQueue.test.tsx`:
   - Delete every `describe("useWithdrawalQueueAddresses …")` block (the five suites around lines 176–410 and the console.error suite at line ~1092).
   - Remove the `useWithdrawalQueueAddresses` import (line 6).
   - Leave the `useRequestWithdrawal` / `useClaimWithdrawal` suites untouched.

6. **Route tests** — `packages/frontend/src/routes/-deposit.test.tsx`:
   - Remove the two mock-key set calls at lines 330 and 334 (`withdrawalQueue.plusd` / `withdrawalQueue.usdc`).
   - Audit any assertion that depends on the `wq-unreachable-banner` test-id or `isQueueUnreachable` behavior; remove or rewrite to assert the DepositManager-unreachable banner instead, where applicable.

7. **Scenario fixtures** — `packages/frontend/src/routes/test/-scenarios.ts`:
   - Drop the two `withdrawalQueue.plusd` / `withdrawalQueue.usdc` entries (lines 66–67) and the surrounding comment. Verify the scenario continues to work because the DepositManager mock keys already set the same PLUSD / USDC addresses.

8. **Docs** — `packages/frontend/src/wallet/README.md`:
   - Remove the `useWithdrawalQueueAddresses` export entry (line 42).
   - Remove the four mock-key rows for `withdrawalQueue.plusd`, `withdrawalQueue.usdc`, `<address>.fromToken`, `<address>.intoToken` (lines 448–451).
   - Update the "Deposit / withdraw symmetry" paragraph (line 577) to drop `useWithdrawalQueueAddresses` from the composition list; the withdraw direction now reuses the manager addresses.
   - Update the example mock-key snippet around lines 583–616 to remove the four queue-token keys.

9. **Lint and typecheck** — run `npx tsx scripts/lint-docs.ts`, frontend lint, and the frontend test suite. Confirm no dangling references to `useWithdrawalQueueAddresses`, `plusdFromQueue`, `usdcFromQueue`, `isQueueLoading`, `isQueueUnreachable`, `wq-unreachable-banner`, `withdrawalQueue.plusd`, `withdrawalQueue.usdc`, `contractFromToken`, `contractIntoToken` remain anywhere in `packages/frontend`.

## Test Strategy

Automated:

- Delete the five `useWithdrawalQueueAddresses` suites in `useWithdrawalQueue.test.tsx`; remaining suites for `useRequestWithdrawal` / `useClaimWithdrawal` must still pass unchanged.
- Update `-deposit.test.tsx` to remove the queue-token mock-key setup. Add or adjust assertions to confirm that on the withdraw direction the PLUSD address used for `useToken` and rendered balances comes from the DepositManager mock keys.
- Add a regression test in `-deposit.test.tsx`: with `VITE_WITHDRAWAL_QUEUE_ADDRESS` set to a non-zero address and **no** WithdrawalQueue token mock keys configured, mounting `/deposit?direction=withdraw` should render without the (now-deleted) `wq-unreachable-banner` and without console errors about `intoToken()` / `fromToken()`.
- `npm run -w packages/frontend test` must be green; full `yarn test` must remain green.
- `npx tsx scripts/lint-docs.ts` must pass after README updates.

Manual (Figma not referenced; UX verification only):

- Set `VITE_WITHDRAWAL_QUEUE_ADDRESS=0xB9f148312a85Ec1d3f4512fF04de6b21a4d12c58` and `VITE_EVM_RPC_URL=https://ethereum-hoodi-rpc.publicnode.com`.
- `npm run dev`, open `http://localhost:3333/deposit?direction=withdraw`, connect wallet.
- Verify: no red `wq-unreachable-banner`, no `intoToken()` / `fromToken()` console errors, PLUSD balance loads, and the request/claim controls behave normally.
- Also verify `/withdraw` redirects to `/deposit?direction=withdraw` and shows the same clean state.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — remove `useWithdrawalQueueAddresses` and the four queue-token mock keys; adjust the deposit/withdraw symmetry paragraph and example snippet (step 8).
- `packages/frontend/src/wallet/abis/withdrawalQueue.ts` — header comment (step 1).
- `packages/frontend/src/wallet/useWithdrawalQueue.ts` — file-header JSDoc (step 2).
- `packages/frontend/src/routes/deposit.tsx` — file-header JSDoc (step 4).
- No product-spec change required: behavior remains "withdraw works against the configured WithdrawalQueue using PLUSD / USDC" — the source of those addresses is an implementation detail.
