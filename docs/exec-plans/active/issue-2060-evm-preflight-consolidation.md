# Issue #2060: Trustee + wallet-connect: consolidate duplicated EVM preflight and helpers (from #1574 review)

Source: https://github.com/eq-lab/pipeline/issues/2060

Parent epic: #1937 (EVM parity). Review origin: PR #2055 comment https://github.com/eq-lab/pipeline/pull/2055#issuecomment-7003725198 (non-blocking item 7). Branch `chore/2060-evm-preflight-consolidation`, draft PR #2065.

## Scope

A pure refactor with no behaviour change. Every thrown message, guard order, query key, stage and on-chain call stays the same. It has four parts.

1. [x] **One EVM preflight helper in `packages/trustee`.** Add `packages/trustee/src/lib/evmPreflight.ts` next to `lib/chainWallet.ts`. The EVM arm of each of these hooks calls it:
   - `useRollover`, `useUpdateLifecycle`, `useCloseLoan`, `useRecordPayment` and `useDisburse` (the five named in the issue).
   - `useDrawLoan`, a sixth copy from #1573/TD-151 with the same sequence under `drawChainReason`.
   - `useRiskCouncilRelay` and `usePendingOperationExecute` (`useRiskCouncil.ts:579`), both in `api/useRiskCouncil.ts` from #1942 (PR #2036) and #1943 (PR #2039). These are the seventh and eighth copies.

   The helper runs chain gate, then config check, then wallet check, and returns `{ config, caller, chainId: ENV.EVM_CHAIN_ID }`. The chain switch itself already lives in one place, `sendEvmContractCall` in `packages/wallet-connect/src/evm/contracts/write.ts`, which calls `switchChain` when `connection.chainId !== chainId`. So the helper's part of the "chain switch" step is handing out the single target `chainId`. The switch code does not move.
2. [x] **One `requireAddress` in wallet-connect.** Add `packages/wallet-connect/src/evm/contracts/args.ts` with `requireAddress(who, name, value): Address`. It keeps `minter.ts`'s argument order, which matches the `"<who>: …"` message order and the existing `requireAddresses(who, …)` and `requireCalldata(who, …)` helpers. It replaces:
   - the two private copies in `minter.ts:623` and `loanRegistry.ts:192`;
   - `requireEvmRegistry` in `riskCouncil.ts:442`, a third private variant with arguments `(registry, who)`;
   - three inline copies that produce exactly the same messages: `readEvmMinterRepayment` (`minter.ts:398`), `readEvmDeal` (`dealTokenFactory.ts:60`) and `readEvmSecurityInspectors` (`securityRegistry.ts:444`).
3. [x] **One chain-reason predicate in `packages/trustee/src/lib/targetChains.ts`.** `riskCouncilChainReason` and `loanActionChainReason` return the same value for every input, because `stellarOnlyActionReason` already returns `null` on Stellar. Keep `loanActionChainReason` as the only implementation and make `riskCouncilChainReason` delegate to it, as the issue allows. Both names stay, so the ~25 call sites and the pinned tests do not change. `drawChainReason` uses the same open-chain predicate through a private `isSignableChain`, and its own copy stays.
4. [x] **One decimals-parameterised unit module.** `packages/trustee/src/utils/stellarSacUnits.ts` becomes the only home for raw/decimal conversion:
   - `rawToDecimal(raw, decimals)` moves there from `lib/disburse.ts`.
   - `lib/wireOut.ts`'s `rawToDecimal7` becomes a one-line wrapper, `rawToDecimal(raw, SAC_DECIMALS)`. Its byte-identical 7-dp output is pinned by `lib/-wireOut.test.ts`.
   - `parseDisburseAmount` moves there as `parseExactAmount(input, decimals)`: strict, with no truncation and no `$`/`,` stripping.
   - It shares a private scaling core with `usdInputToSacBaseUnits`, which stays lenient: it strips `$`/`,`/spaces, truncates extra decimals and accepts `.5`.

Out of scope:
- The Stellar arms. Their code, order and copy stay unchanged; they only get a shorter import list where an import is no longer needed.
- `useRepaymentRecovery`'s reverse-repay mutation (`api/useRepaymentRecovery.ts:300`). It does **not** match the pattern: it has no chain gate, and its config check (`recoveryConfig`) covers both chains and runs before the arm split. Routing it through the helper would add a gate, which is a behaviour change for an EVM chain id other than `ENV.EVM_CHAIN_ID`.
- `useRiskCouncilAccess`'s query (`useRiskCouncil.ts:318`). It is a read, and it checks only `address` without `isConnected`.
- `accessManager.ts`'s `requireAddresses`. It reports every empty field before any invalid one, so sequential `requireAddress` calls would change which error wins.
- `readEvmRecoveryRepayments` (`minter.ts:497`), which has its own `VITE_EVM_MINTER_ADDRESS` copy.
- `sacBaseUnitsToUsdDecimal`. Its output is fixed-width (padded fraction), unlike `rawToDecimal`'s trimmed output, and the record-coupon and record-repayment forms depend on that.
- Review item 7's other duplicates (`failField`, `MAX_RATE_BPS`, `RATE_SCALE`). The issue does not list them.
- Renaming `stellarSacUnits.ts`. Renaming it would touch 9 importers for no behavioural gain.
- Any UI, copy or design change. This is a code-only refactor and needs no Figma.

## Assumptions and Risks

- **Error precedence.** Every hook's first failing check must still win.
  - The four lifecycle and payment hooks and `useDrawLoan` keep the order pick, then (EVM arm only) gate, config and wallet. The helper runs the same three steps in the same order.
  - `useDisburse` and the risk-council execute mutation keep their existing leading gate. In the disburse case the configured check also stays, because both are cross-chain and the execute mutation also has the target-mismatch and paused checks between them. In their EVM arms the helper repeats the gate and config check, which are pure and cannot fail a second time, before the wallet check. Each step 3 verifies precedence with the existing tests.
- **`ENV` must be read at call time.** The hook tests mock `@/lib/env` with mutable objects (`envMock`) and blank fields per test. `evmLoanRegistryConfig()` and every `config` argument must read `ENV` inside the call, never into a module-level constant.
- **Existing mocks still apply.** Tests mock `@pipeline/wallet-connect` wholesale. The new `evmPreflight.ts` imports only `@/lib/env`, `@/lib/targetChains` and the `ChainWallet` type, so those mocks keep working. `args.ts` is internal to wallet-connect and is not re-exported from `src/index.ts`, so the trustee mocks need no new key.
- **`requireAddress` message order.** `loanRegistry.ts`'s copy defaults `who = "drawEvmLoan"`. `drawEvmLoan`'s three calls must pass `"drawEvmLoan"` explicitly, or the "drawEvmLoan: … must not be empty" messages pinned in `loanRegistry.test.ts:282-287` change. Every argument is a `string`, so a swapped call still type-checks. The wallet-connect tests that pin the messages are what catch it.
- **Lint baseline.** `scripts/lint-comments.baseline.json` lists `packages/trustee/src/utils/stellarSacUnits.ts` (`header: 5`). AGENTS.md requires shrinking the baseline for every touched file it lists, so the 5-line JSDoc header becomes a one-line spec pointer.
- **Branch base.** The branch is cut from `main` after #2055 merged (`9c16c176`). Main now includes the `evm-deal-token` key fix (review finding 1, doc row 28). There are no open dependencies.

## Open Questions

_None_

## Implementation Steps

1. [x] **`lib/targetChains.ts` (item 3).**
   - Add a private `function isSignableChain(chainId): boolean { return isStellarTarget(chainId) || chainId === ENV.EVM_CHAIN_ID; }`.
   - `loanActionChainReason` becomes `isSignableChain(chainId) ? null : stellarOnlyActionReason(chainId)`.
   - `riskCouncilChainReason` becomes `return loanActionChainReason(chainId);`. Keep it as an exported `function` so call sites, the `-targetChains.test.ts` imports and spec references still resolve.
   - `drawChainReason` uses `isSignableChain`, and its copy is unchanged.

2. [x] **New `packages/trustee/src/lib/evmPreflight.ts` (item 1).** Header: `// spec: docs/frontend/trustee-flows.md#evm-1574`, with no other comments.
   - `export const EVM_WALLET_NOT_CONNECTED = "EVM wallet not connected.";`
   - `export interface EvmPreflightInput<T> { chainId: number | null | undefined; wallet: ChainWallet; config: T | null | false; notConfigured: string; chainReason?: (chainId: number | null | undefined) => string | null; }`
   - `export interface EvmPreflight<T> { config: T; caller: string; chainId: number; }`
   - `export function evmPreflight<T>({ chainId, wallet, config, notConfigured, chainReason = loanActionChainReason }: EvmPreflightInput<T>): EvmPreflight<T>` runs:
     1. `chainReason(chainId)` and throws `new Error(blocked)` if it returns a reason;
     2. throws `new Error(notConfigured)` if `!config`;
     3. throws `new Error(EVM_WALLET_NOT_CONNECTED)` if `!wallet.isConnected || !wallet.address`;
     4. returns `{ config, caller: wallet.address, chainId: ENV.EVM_CHAIN_ID }`.
   - `export function evmLoanRegistryConfig(): { accessManager: string; registry: string } | null` returns `ENV.EVM_ACCESS_MANAGER_ADDRESS` and `ENV.EVM_LOAN_REGISTRY_ADDRESS` when both are set, otherwise `null`. It reads `ENV` at call time.

3. [x] **Route the hooks through the helper.** Only the EVM arm (`if (wallet.kind === "evm") { … }`) changes, and each keeps its own not-configured sentence verbatim. Rename the returned `chainId` to `evmChainId` when destructuring, so it does not shadow the input.
   - `api/useRollover.ts`: `evmPreflight({ chainId, wallet, config: evmLoanRegistryConfig(), notConfigured: "On-chain rollover is not configured for this environment." })`, then `rolloverEvmLoan({ accessManager: config.accessManager, registry: config.registry, caller, chainId: evmChainId, … })`. Drop the now-unused `loanActionChainReason` import.
   - `api/useUpdateLifecycle.ts`: the same, with "On-chain lifecycle updates are not configured for this environment.". `useLoanMutableState` is unchanged and still uses `loanActionChainReason`.
   - `api/useCloseLoan.ts`: the same, with "On-chain loan closing is not configured for this environment.".
   - `api/useRecordPayment.ts`: `config: ENV.EVM_MINTER_ADDRESS && ENV.EVM_LOAN_REGISTRY_ADDRESS ? { minter: ENV.EVM_MINTER_ADDRESS, registry: ENV.EVM_LOAN_REGISTRY_ADDRESS } : null` with "On-chain payment recording is not configured for this environment.". `readEvmNextRepaymentId`, `evmRepaymentRefHash` and `repayEvmLoan` use `config.registry`, `config.minter`, `caller` and `evmChainId`.
   - `api/useDrawLoan.ts`: `evmPreflight({ …, config: evmLoanRegistryConfig(), notConfigured: "On-chain minting is not configured for this environment.", chainReason: drawChainReason })`.
   - `api/useDisburse.ts`: keep the leading `pickChainWallet`, `loanActionChainReason` and `disburseConfigured` block as it is, because it covers the Stellar arm. In the EVM arm, replace the inline wallet check with `const { caller, chainId: evmChainId } = evmPreflight({ chainId, wallet, config: disburseConfigured(chainId), notConfigured: DISBURSE_NOT_CONFIGURED });` and pass `caller` and `evmChainId` to `disburseEvmLoan`. The order of the ref-hash, `readEvmRefHashSeen` and paused reads is unchanged.
   - `api/useRiskCouncil.ts`, relay (`useRiskCouncilRelay`):
     - Keep the leading `riskCouncilChainReason` check and the `pickChainWallet` call where they are, so the Stellar arm stays literally unchanged.
     - The EVM arm uses `evmPreflight({ chainId, wallet, config: evmCouncilConfig(call.fn), notConfigured: notConfiguredFor(target), chainReason: riskCouncilChainReason })` and uses the returned `config` (was `evm`) and `caller` (was `address`). The helper repeats the gate, which already passed and is pure, so behaviour is identical.
   - `api/useRiskCouncil.ts`, `usePendingOperationExecute` (line 579): leave the leading gate, the target mismatch and the paused check where they are. In the EVM arm, replace the `accessManager` and connected checks with `const { config: accessManager, caller: address } = evmPreflight({ chainId, wallet, config: ENV.EVM_ACCESS_MANAGER_ADDRESS, notConfigured: NOT_CONFIGURED, chainReason: riskCouncilChainReason });`. The `sameChainAddress(chainId, address, caller)` check that follows and the rest stay. `executeEvmScheduledOperation`'s `chainId: ENV.EVM_CHAIN_ID` may use the returned chain id.
   - Run `yarn workspace @pipeline/trustee test` after each hook. Its existing `-use*.test.tsx` suites pin the messages and their order.

4. [x] **wallet-connect `requireAddress` (item 2).**
   - New `packages/wallet-connect/src/evm/contracts/args.ts`. Header: `// spec: docs/frontend/wallet-flows.md#trustee-evm-contract-client`. It contains `export function requireAddress(who: string, name: string, value: string): Address`. The body is `minter.ts:623-627` verbatim: `"<who>: <name> must not be empty"`, then `"<who>: invalid <name> <value>"` via viem `isAddress(value)`. Do not re-export it from `src/index.ts`.
   - `minter.ts`: delete the local `requireAddress` and import from `./args`. Replace the inline `readEvmMinterRepayment` check (lines 398-402) with `requireAddress("readEvmMinterRepayment", "minter", minter)`. Drop `isAddress` from the viem import if it becomes unused, but `minter.ts:497` still uses it.
   - `loanRegistry.ts`: delete the local copy. `drawEvmLoan` calls `requireAddress("drawEvmLoan", "accessManager", accessManager)`, and likewise for `"registry"` and `"caller"`. `sendLifecycle` calls `requireAddress(who, "accessManager", accessManager)`, and likewise for the other two. Remove unused `isAddress` imports.
   - `riskCouncil.ts`: delete `requireEvmRegistry` and replace its three call sites (lines 453, 499 and 520) with `requireAddress(who, "registry", registry)`. The literal `"readEvmLoanMoney"` stays where it is used now.
   - `dealTokenFactory.ts:60-63` and `securityRegistry.ts:444-450`: replace each with one `requireAddress(...)` call carrying the same `who` and `name`.
   - Run `yarn workspace @pipeline/wallet-connect test`.

5. [x] **Unit helpers (item 4).** In `packages/trustee/src/utils/stellarSacUnits.ts`:
   - Replace the 5-line JSDoc header with `// spec: docs/frontend/trustee-flows.md#disburse-1898`. Leave the existing `economicsUsdDecimal` JSDoc untouched, since it is not flagged in the baseline (`nodeIds: 0`) and this issue adds or edits no comments.
   - Add a private `scaleToRaw(whole: string, fraction: string, decimals: number): bigint`, returning `BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"))`.
   - `usdInputToSacBaseUnits` uses it on its already-sliced fraction, with the same regex, stripping and `> 0n` rule.
   - Add `export function parseExactAmount(input: string, decimals: number): bigint | null`. Its body is `lib/disburse.ts`'s `parseDisburseAmount`, with the same dynamic regex `^(\d+)(?:\.(\d{1,decimals}))?$` on `input.trim()` and the `> 0n` rule, and it uses `scaleToRaw`.
   - Add `export function rawToDecimal(raw: string, decimals: number): string`, moved verbatim from `lib/disburse.ts`.
   - `lib/disburse.ts`: delete both functions and import `parseExactAmount` and `rawToDecimal` from `@/utils/stellarSacUnits`.
   - `routes/-DisburseAction.tsx`: import from `@/utils/stellarSacUnits` and rename the call to `parseExactAmount`.
   - `lib/wireOut.ts`: `export function rawToDecimal7(raw: string): string { return rawToDecimal(raw, SAC_DECIMALS); }`. The four callers (`-ConversionsSection.tsx`, `-wire-outs.ts`, `-conversions.ts`, `lib/conversions.ts`) stay unchanged.
   - Run `npx tsx scripts/lint-comments.ts --update-baseline` so the `stellarSacUnits.ts` entry is dropped or shrunk, and commit the smaller baseline.

6. [x] **Docs (see below), then the gates.**
   - `yarn workspace @pipeline/trustee test`
   - `yarn workspace @pipeline/wallet-connect test`
   - `yarn workspace @pipeline/trustee lint`
   - `yarn workspace @pipeline/wallet-connect lint`
   - `yarn workspace @pipeline/trustee build` (tsc catches swapped or unused imports)
   - `npx tsx scripts/lint-docs.ts`
   - `npx tsx scripts/lint-comments.ts`
   - `git diff --stat` must show no change in any Stellar contract binding (`packages/wallet-connect/src/stellar/**`).

## Test Strategy

Vitest only. All existing suites stay green with **no edits to existing assertions**: they are the no-behaviour-change proof. The suites that matter most:
- `api/-useRollover.test.tsx`, `-useUpdateLifecycle.test.tsx`, `-useCloseLoan.test.tsx`, `-useRecordPayment.test.tsx`, `-useDisburse.test.tsx`, `-useDrawLoan.test.tsx` and `-useRiskCouncil.test.tsx`. They cover the guard messages and their order, the "not configured" sentences, "EVM wallet not connected.", and the args passed to the EVM writers, including `chainId`.
- `lib/-targetChains.test.ts`, which pins `loanActionChainReason`, `riskCouncilChainReason` and `drawChainReason`.
- `lib/-wireOut.test.ts` (`rawToDecimal7`, 7-dp byte-identical), `lib/-disburse.test.ts` (7- and 6-decimal form errors and bank-cash copy) and `routes/-DisburseAction.test.tsx`.
- wallet-connect `loanRegistry.test.ts`, `minter.test.ts`, `riskCouncil.test.ts`, `dealTokenFactory.test.ts` and `securityRegistry.test.ts`, which pin the `"<who>: <name> must not be empty"` and `"<who>: invalid <name> <value>"` messages.

New tests. Test files carry no comments; the file header is the only comment allowed.
- `packages/trustee/src/lib/-evmPreflight.test.ts`, with `@/lib/env` mocked:
  - the gate wins over a missing config and a disconnected wallet;
  - the config wins over the wallet;
  - `isConnected: false` with an address, and an `undefined` address, both throw `EVM_WALLET_NOT_CONNECTED`;
  - the happy path returns `{ config, caller, chainId: ENV.EVM_CHAIN_ID }`;
  - a custom `chainReason` (`drawChainReason`) is used instead of the default;
  - `evmLoanRegistryConfig()` returns `null` when either address is blank and reads `ENV` at call time.
- `packages/trustee/src/utils/-stellarSacUnits.test.ts`:
  - `rawToDecimal` at 7 dp gives the same strings as the `rawToDecimal7` cases (`"10000000"` → `"1"`, `"12345678"` → `"1.2345678"`, `"5"` → `"0.0000005"`, `"12345670"` → `"1.234567"`, `"0"` → `"0"`), plus 6-dp cases;
  - `parseExactAmount`: accepts `"1.1234567"` at 7 and rejects it at 6; rejects `"0"`, `"1."`, `".5"`, `"$1"` and `"1,000"`; accepts trimmed `" 12.5 "`;
  - `usdInputToSacBaseUnits` unchanged: `"$1,000.123456789"` truncates to 7 dp, `".5"` is accepted, `"0"` gives `null`.
- `packages/wallet-connect/src/evm/contracts/args.test.ts`: an empty value, an invalid value and a checksummed or lowercase valid value (which returns the input).

## Docs to Update

- `docs/frontend/trustee-flows.md` § [EVM (#1574)](../../frontend/trustee-flows.md#evm-1574):
  - Add one bullet saying that the EVM arm of Rollover, Update lifecycle, Close loan, Record payment, Disburse and Approve & draw, and of the Risk Council relay and execute, goes through `evmPreflight` (`lib/evmPreflight.ts`): chain gate, then config, then "EVM wallet not connected.", and it hands `ENV.EVM_CHAIN_ID` to the writer, whose `sendEvmContractCall` switches the network.
  - Row 1 stays as it is.
- `docs/frontend/trustee-flows.md` § Disburse "Units" line (~1060): `parseDisburseAmount` becomes `parseExactAmount` (`utils/stellarSacUnits.ts`), and `rawToDecimal` now also lives there.
- `docs/frontend/trustee-flows.md` Risk Council chain-gate paragraph (~2390): add that `riskCouncilChainReason` delegates to `loanActionChainReason` (one predicate).
- `docs/frontend/wallet-flows.md` § Trustee EVM contract client: add one line saying that every EVM binding validates addresses through `requireAddress(who, name, value)` (`src/evm/contracts/args.ts`), except `requireAddresses`, which checks all empty fields first.
- `docs/frontend/error-handling.md` § 2 "Trustee preflight guard": the hook list adds `useDisburse`, and the EVM arm's "wallet not connected" guard comes from `evmPreflight`. The mapping and copy are unchanged.
- No product-spec change, because behaviour does not change. No tech-debt entry is opened or closed: the review item was filed as #2060, not as a TD.
