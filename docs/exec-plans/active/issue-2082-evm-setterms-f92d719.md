# Issue #2082: Trustee + wallet-connect: EVM setTerms for the deployed f92d719 SecurityRegistry (12-field Terms)

Source: https://github.com/eq-lab/pipeline/issues/2082

Parent epic: #1937. Split out of #2070 (decision of 2026-11-19). Branch `feat/2082-evm-settterms-f92d719`, draft PR #2083.

**Binding rules.**
- Contracts and deployments are never changed. Hoodi stays on SecurityRegistry `pipeline-contracts@f92d719`, and the client adapts to it.
- EVM mirrors the Stellar approach. Fields the deployed build does not have are handled the way the Stellar `set_terms` form handles them.

## Scope

### What `f92d719` is (`git diff f92d719 150631a -- src/`, read-only in `pipeline-contracts`)

| Item | `f92d719` (Hoodi) | `150631a` (what #1942 encodes) |
|---|---|---|
| `ISecurityRegistry.Terms` | 12 fields: `advanceRatioBps, marginCallRatioBps, curePeriod, priceStaleAfter, paymentTerm, gracePeriod, defaultRate, attestationInterval, inspectionInterval, toleranceBps, gradeToleranceBps, marginCallAt` | 15 fields. Adds `defaultRatioBps` (u32, after `marginCallRatioBps`), `originatorFeeRate` (u32, after `defaultRate`) and `defaultBreachAt` (u64, last) |
| `setTerms(uint256,Terms)` selector | `0x36b14cd2` | `0x45f225f5` |
| `setTerms` validation | `marginCallRatioBps >= advanceRatioBps`, else `SecurityRegistryInvalidRatio` | also `defaultRatioBps >= marginCallRatioBps` |
| `setTerms` preserved fields | `marginCallAt` | `marginCallAt`, `defaultBreachAt` |

The 12 `f92d719` fields are the Stellar `Terms` field set (`types.rs`: the same 12 keys, `margin_call_at` included). So "mirror Stellar" means the following for `f92d719`:
- The form shows the Stellar 10 inputs and the payment-term select.
- The form applies only the Stellar ratio rule.
- The call carries no `defaultRatioBps` / `originatorFeeRate`.
- The encoder refuses either field if present. This is what `stellar/contracts/securityRegistry.ts:89-95` does (`fail("defaultRatioBps (EVM only)")`).
- `marginCallAt` is always `0`. It is the Stellar `margin_call_at = 0`, and the contract keeps its own.

The Stellar arm does not change.

### Hoodi findings (read-only, RPC `https://ethereum-hoodi-rpc.publicnode.com`, head 4 046 641, 2026-11-19)

- **Implementation.** EIP-1967 slot `0x3608…2bbc` of the SR proxy `0xB51E7f13…BE15` gives the implementation `0x502ff7b573acf4efd69414a25c45fe18c839a683`.
  - The proxy's own code (an ERC1967Proxy, 141 bytes) contains neither selector.
  - The implementation code (23 046 bytes) contains `PUSH4 0x36b14cd2` exactly once. It is byte-aligned in the dispatcher: `80 63 36b14cd2 14 61 2ea9 57`, which is `DUP1 PUSH4 EQ PUSH2 JUMPI`.
  - It contains no `0x45f225f5` anywhere.
- **AccessManager `0x3dF345BF…5992` roles.**
  - `getTargetFunctionRole(SR, 0x36b14cd2) = 16941828335757009710` (`0xeb1d771c1671a32e`). It is the same role as `resolveFlag` `0xdf84b5b3` and `releaseWithConsent` `0x115f901f`.
  - `getTargetFunctionRole(SR, 0x45f225f5) = 0`, which is unset (ADMIN).
- **The named role holder `0x96ef761f…04e4` does not hold the SR role.**
  - `hasRole(0xeb1d…, 0x96ef…) = (false, 0)`, and `canCall(0x96ef…, SR, 0x36b14cd2) = (false, 0)`.
  - It holds the LoanRegistry Risk Council role: `canCall(0x96ef…, LR, setDefault 0xe0da6b66) = (true, 0)`.
  - The only `RoleGranted` for `0xeb1d…` since block 3 955 400 is to EOA **`0xfe1748f511583f6c9349f672593e6312bedfce40`**. For that account `hasRole = (true, 0)` and `canCall(…, SR, 0x36b14cd2) = (true, 0)`. The execution delay is 0.
- **`eth_call` simulations.** Each call is `AccessManager.execute(SR, data)` with loan 1 and Terms `(6000, 7500, 259200, 86400, Dp, 432000, 20000, 604800, 2592000, 500, 200, 0)`. The `150631a` call adds `defaultRatioBps 9000` and `originatorFeeRate 10000`.

  | `from` | calldata | Revert data | Meaning |
  |---|---|---|---|
  | `0xfe17…ce40` (SR role) | `f92d719`, `0x36b14cd2…`, 420 bytes | `0xab6bb082` `LoanRegistryNonExistentLoanId()` | **Gets past the selector dispatch, the AccessManager role check and the SR `restricted` modifier.** It reverts at `_loanStatus` → `LoanRegistry.status(1)` |
  | `0xfe17…ce40` | `150631a`, `0x45f225f5…` | `0xd6bda275` `FailedCall()` | The SR has no such selector and no fallback. The empty revert is wrapped by OpenZeppelin `Address`. This is the bug today |
  | `0x96ef…04e4` | either | `0x81c6f24b` `AccessManagerUnauthorizedCall(0x96ef…, SR, selector)` | No SR role |
  | SR called directly, `from` = AM | `f92d719` | `0x068ca9d8` `AccessManagedUnauthorized(AM)` | Selector dispatched, no consumed schedule |
  | SR called directly, `from` = AM | `150631a` | `0x` (empty) | Unknown selector |

- **No loans.** `LoanRegistry 0xdF08…0231` `nextLoanId() = 0`, and `status(n)` reverts `LoanRegistryNonExistentLoanId` for n = 0, 1, 2, 3 and 5. A real `setTerms` on Hoodi needs a drawn loan first.

### Decision: build detection = bytecode selector probe

`readEvmSecurityTermsShape({ registry })` does three things:
1. Reads the EIP-1967 implementation slot of `ENV.EVM_SECURITY_REGISTRY_ADDRESS`. A zero slot means the address itself holds the code.
2. Fetches that code once.
3. Walks the opcodes and collects every `PUSH4` immediate. It skips the data of `PUSH1`..`PUSH32`, so selector bytes inside other push data never count.

The result:
- `0x45f225f5` present and `0x36b14cd2` absent → `"terms15"` (`150631a`).
- `0x36b14cd2` present and `0x45f225f5` absent → `"terms12"` (`f92d719`).
- Anything else throws `Unrecognised SecurityRegistry build at <impl>: setTerms selector neither 0x45f225f5 nor 0x36b14cd2 (or both)`.

The selectors come from the ABIs (`toFunctionSelector`) and are never hard-coded. The tests pin them.

Why this method:
- **It works today.** Hoodi has no loans and no terms, and the probe needs neither. The first `setTerms` is exactly the action that needs the shape.
- **It follows the real implementation behind the proxy.** It names what the chain will dispatch, with no heuristics on revert data.
- **The cost is two RPC reads per page session**, cached with `staleTime: Infinity`.
- **No new env key.** An env key would be an ops burden that can drift from the chain. A wrong value would revert every `setTerms` (`FailedCall`).

Rejected:
- ***A `terms()` decode shape.*** `terms(n)` reverts `SecurityRegistryNoTerms` until terms exist (#2070 findings), so it cannot pick the encoding for the first `setTerms`. That is a chicken-and-egg problem.
- ***The API-served shape (#2070).*** The API serves `terms: null` until terms exist, the same chicken-and-egg problem. #2073 is not merged (only its plan is committed). It would also tie a write path to indexer lag.
- *`AccessManager.getTargetFunctionRole` per selector.* It reports AccessManager configuration, not the build.
- *An `eth_call` dispatch probe* (empty revert versus `AccessManagedUnauthorized`). It depends on how each RPC surfaces revert data.

### In scope

- **wallet-connect** (`packages/wallet-connect/src/evm/contracts/securityRegistry.ts`, `write.ts`, `index.ts`):
  - A 12-field `setTerms` ABI.
  - A shape-aware selector and encoder.
  - The probe.
- **Trustee:**
  - Shape detection hook.
  - The set-terms form fields, validation and call per shape.
  - Threading the shape through access, schedule lookup, relay and the session bridge.
  - The pending-operations decoder and rendering of 12-key `setTerms` args.
- **Tests:** vitest only.
- **Docs:**
  - narrow edits to `docs/frontend/trustee-flows.md`, with three new rows in the security-page EVM differences table;
  - a new user-story file.

### Out of scope

- Any contract, deployment or AccessManager role change. This includes granting the SR role to `0x96ef…`; see Open Question 1.
- Backend:
  - the worker AccessManager decoder for `0x36b14cd2` and the API's absent new-only fields (both #2070 / #2073);
  - `default_breach` (TD-189).
- `minter.ts` (#2075).
- `FRONTEND.md`, `tech-debt-tracker.md` and `access-manager-events.md` (#2072).
  - `access-manager-events.md` needs no edit anyway. Its generic `args_json` rule (line 190) already yields the 12-key object.
- `docs/product-specs/loan-security-state-evm.md`, `docs/references/security-registry-events.md` and `docs/references/backend.md` (#2073).
- Error copy: `SecurityRegistryInvalidRatio` keeps "advance ≤ margin call ≤ default". On `terms12` the form blocks the only reachable ratio violation first, so the copy is unreachable there.

## Assumptions and Risks

- **#2073 has not landed.** Until it does, the worker stores an old-shape `setTerms` schedule with `function = "0x36b14cd2"` and raw args. The Trustee then shows the raw-JSON fallback, and Execute still works because the served `calldata` is sent verbatim. After #2073 the row decodes through the new 12-key path.
  - Hoodi role delays are 0, so no `setTerms` is ever scheduled there. The decoder path is exercised by fixtures only.
- **The fixture shape relies on #2070's plan, not merged code.** The planned shape is: `function = "setTerms"`, `args_json = ["<loanId>", {12 camelCase keys}]`, uint32/uint8 as numbers, uint64 as decimal strings. This follows the generic rule in `access-manager-events.md:190`. If #2073 ships a different key spelling, the 12-key fixture and decoder must follow it.
- **Probe robustness.**
  - A future implementation that uses a non-EIP-1967 proxy would make the probe read the proxy code, which has neither selector. The probe then throws, and Set terms is disabled with the error in the details. It never sends a wrong encoding.
  - A build that contains both selectors also throws.
  - Low risk: every `pipeline-contracts` SR deployment is an OZ ERC1967 proxy.
- **How a detection failure shows.** It surfaces through `useRiskCouncilAccess`, so the user sees "Failed to read this wallet's permissions." with the probe message in the details. No new copy is added. This is acceptable because it only happens on an unknown build.
- **Stage QA wallet.** `0x96ef…` holds no SR role on Hoodi, so the page shows "Setting security terms belongs to the Risk Council." for it. Only `0xfe1748f5…` can set terms. See Open Question 1.
- **Merge order on `trustee-flows.md`.**
  - #2072 appends row 20 ("Risk Council delay") to the same differences table (after line 2571), so this plan numbers its new rows **21 to 23**.
  - If this PR merges first, renumber them 20 to 22 and #2072 rebases. Either way it is a one-line conflict.
  - The other #2072 hunks (around lines 1021, 2453-2463 and 2544-2548) are not touched. The closest edit here is line 2541, which does not overlap.
- **Merge order on `docs/user-stories/index.md`.** #2073 also adds a row under epic-1937 (after line 448). That is a one-line append conflict at most.

## Open Questions

1. **Which wallet runs the EVM Set terms QA on Hoodi (#1945)?**
   - The named role holder `0x96ef761f…04e4` has no SR role. `canCall(…, SR, 0x36b14cd2) = false`, and `execute` reverts `AccessManagerUnauthorizedCall`.
   - Only `0xfe1748f511583f6c9349f672593e6312bedfce40` holds role `0xeb1d771c1671a32e` (setTerms, resolveFlag, releaseWithConsent).

   **Recommended default:** run the SR security flows with `0xfe1748f5…`, and record this in the #2082 user story. Do not grant roles from this issue, because deployments are not changed here. The app needs no change either way.
2. **Hoodi has no loans yet** (`nextLoanId() = 0`), so a live `setTerms` cannot succeed until a loan is drawn there.

   **Recommended default:** accept the `eth_call` evidence above as this PR's on-chain verification: it gets past the selector and role check and fails only on loan existence. The live round trip moves to QA #1945 after the first Hoodi loan is drawn.

## Implementation Steps

1. **wallet-connect: code reader** (`packages/wallet-connect/src/evm/contracts/write.ts`).
   - Add `export const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"`.
   - Add `export async function readEvmContractCode(address: string): Promise<Hex>`. It uses `getStorageAt` and `getBytecode` from `@wagmi/core` with `initEvmWalletConnect()`, the same config as `readEvmContract`.
     - Read the slot. Its last 20 bytes are the implementation, or `address` itself when the slot is zero.
     - Fetch the code. Empty or `0x` code throws `readEvmContractCode: no code at <addr>`.
2. **wallet-connect: 12-field ABI, shape type, selector and encoder** (`packages/wallet-connect/src/evm/contracts/securityRegistry.ts`).
   - Add `export type EvmSecurityTermsShape = "terms15" | "terms12";`.
   - Add `export const evmSecurityRegistryTerms12Abi`. It holds one `setTerms(uint256 loanId, tuple newTerms)` item with the 12 components in `f92d719` order: `advanceRatioBps u32, marginCallRatioBps u32, curePeriod u64, priceStaleAfter u64, paymentTerm u8, gracePeriod u64, defaultRate u32, attestationInterval u64, inspectionInterval u64, toleranceBps u32, gradeToleranceBps u32, marginCallAt u64`. Keep it separate from `evmSecurityRegistryAbi`, so viem never resolves an overload and the `terms` view stays as is.
   - Add `export const EVM_SET_TERMS_SELECTORS: Readonly<Record<EvmSecurityTermsShape, Hex>>`, computed with `toFunctionSelector` from the two ABI items.
   - `evmSecuritySelector(fn, termsShape?: EvmSecurityTermsShape)`:
     - for `set_terms`, `termsShape` is required and throws `evmSecuritySelector: termsShape is required for set_terms` when missing;
     - `terms12` returns the 12-field item's selector;
     - other functions ignore it.
   - `encodeEvmSecurityRegistryCalldata(call, termsShape?)` uses the same required-for-`set_terms` rule, so there is no silent default.
     - `terms15` keeps today's `encodeTerms`.
     - `terms12` uses a new `encodeTerms12(terms)`. It mirrors the Stellar `encodeTerms`:
       - it throws `invalid defaultRatioBps (absent on this SecurityRegistry build)` / `invalid originatorFeeRate (…)` when either is `!== undefined`;
       - it enforces `marginCallRatioBps >= advanceRatioBps` only;
       - it validates the same `u32Arg` / `u64Arg` and the `paymentTerm` ordinal as today;
       - it emits the 12-field object with `marginCallAt: 0n`, encoded with `evmSecurityRegistryTerms12Abi`.
     - Factor the 11 shared field conversions into one helper used by both, so they cannot drift.
   - `EvmSecurityCallParams` gains `termsShape?: EvmSecurityTermsShape`. `relayEvmSecurityRegistry` and `readEvmSecurityRegistrySchedule` pass it to the encoder.
   - Add `export function evmSecurityTermsShapeFromCode(code: Hex): EvmSecurityTermsShape`. It is pure: an opcode walk that collects `PUSH4` immediates (0x63) and skips `0x60 + n - 1` push data. Results are as in the Decision, including the throw.
   - Add `export async function readEvmSecurityTermsShape({ registry }: { registry: string }): Promise<EvmSecurityTermsShape>`. It refuses an empty or invalid address before any RPC, the same guard text style as `readEvmSecurityInspectors`. Then it runs `evmSecurityTermsShapeFromCode(await readEvmContractCode(registry))`.
3. **wallet-connect exports** (`packages/wallet-connect/src/index.ts`, the security block around lines 406-423 only).
   - Export `evmSecurityRegistryTerms12Abi`, `EVM_SET_TERMS_SELECTORS`, `evmSecurityTermsShapeFromCode`, `readEvmSecurityTermsShape` and `type EvmSecurityTermsShape`.
   - Export `readEvmContractCode` next to the other `write.ts` exports, if they are re-exported. Otherwise keep it internal.
4. **Trustee: shape query and threading** (`packages/trustee/src/api/useRiskCouncil.ts`).
   - Add `export function evmSecurityTermsShapeQuery()`, returning `queryOptions`:
     - key `["evm-security-terms-shape", ENV.EVM_SECURITY_REGISTRY_ADDRESS]`;
     - `queryFn`: throw `SECURITY_NOT_CONFIGURED` when the address is unset, else `readEvmSecurityTermsShape({ registry })`;
     - `staleTime: Infinity`, `gcTime: Infinity`, `retry: false`.
   - Add `export function useEvmSecurityTermsShape(chainId)`, a `useQuery` of these options with `enabled: !isStellarTarget(chainId) && riskCouncilChainReason(chainId) === null`.
   - Add `async function evmTermsShapeFor(queryClient, fn): Promise<EvmSecurityTermsShape | undefined>`. It returns `await queryClient.fetchQuery(evmSecurityTermsShapeQuery())` when `fn === "set_terms"`, else `undefined`.
   - Make `evmSelectorFor(fn, termsShape?)`, `evmCalldataFor(call, termsShape?)`, `readEvmScheduleFor(evm, call, caller, termsShape?)` and `relayEvmFor(…, termsShape?)` forward it.
   - Fetch the shape once in the EVM arm of three places and pass it to every call:
     - `useRiskCouncilAccess`'s `queryFn` (add `useQueryClient()`);
     - `useRiskCouncilRelay`'s `mutationFn`;
     - the `calldata: evmCalldataFor(call, shape)` stored on schedule.
   - `usePendingOperationExecute` does not change, because it sends the served `calldata` verbatim.
   - The `RISK_COUNCIL_KEYS` invalidation list does not change, because the build never changes in a session.
5. **Trustee: Set terms form** (`packages/trustee/src/routes/-risk-council-security.ts`).
   - Add `function evmTermsExtras(chainId, termsShape): boolean`, defined as `!isStellarTarget(chainId) && termsShape === "terms15"`.
   - `termsFieldsFor(chainId, termsShape: EvmSecurityTermsShape | null)` returns:
     - `STELLAR_TERMS_FIELDS` on Stellar, on `terms12` and while the shape is `null` (loading or error);
     - today's 12-field EVM list only on `terms15`.
   - `ratioOrderErrorFor(parsed, chainId, termsShape)` applies the default-ratio rule only when `evmTermsExtras`.
   - `buildSetTermsCall(loanId, values, chainId, termsShape)`:
     - on EVM with `termsShape === null` it returns `null`, so the action is disabled;
     - the extras are required and spread only when `evmTermsExtras`;
     - on `terms12` the call is byte-for-byte the Stellar-shaped `SecurityTermsInput`, with no extras.
   - In `useRiskCouncilSecurity`, `const termsShape = useEvmSecurityTermsShape(chainId).data ?? null;` and pass it to the three functions above. No new view field and no new copy.
   - `prefillTermsForm` does not change: served `null` extras prefill `""` and are hidden.
6. **Trustee: pending operations** (`packages/trustee/src/routes/-risk-council-pending.ts`).
   - Add `EVM_TERMS12_KEYS`, the 12 camelCase `f92d719` names.
   - Change `decodeEvmTerms` to accept exactly the 15 keys (today's rules, unchanged) **or** exactly the 12 keys. For 12 keys:
     - `paymentTerm` is an ordinal of `SECURITY_PAYMENT_TERMS`;
     - u32 fields: `advanceRatioBps, marginCallRatioBps, defaultRate, toleranceBps, gradeToleranceBps`;
     - u64 strings: `curePeriod, priceStaleAfter, gracePeriod, attestationInterval, inspectionInterval`;
     - `marginCallAt === "0"`;
     - it returns the terms **without** `defaultRatioBps` / `originatorFeeRate`.
   - Anything else (13 or 14 keys, or 12 keys plus `defaultBreachAt`) stays `null`, which is the raw-JSON fallback.
   - Share the 10 common checks and the result fields between both shapes through one helper.
   - `termsForRows` and `pendingArgRows` need no change: undefined extras hide the "Default ratio" and "Originator fee rate" rows (`formatTermsRows`, `-risk-council-terms.ts:24-35`). The hub reuses `pendingArgRows`.
7. **Fixtures** (`packages/trustee/src/routes/-riskCouncilFixtures.ts`).
   - Add `EVM_SET_TERMS_F92D719_ARGS`: `["7", {12 keys, same values as EVM_SET_TERMS_ARGS minus the three}]`.
   - Add `EVM_SET_TERMS_F92D719_CALLDATA`, the viem encoding with `evmSecurityRegistryTerms12Abi`, pinned as hex beginning `0x36b14cd2`.
   - Add an `evmPendingOp` variant that uses them.
8. **Lint.**
   - With `PATH=/opt/homebrew/opt/node@22/bin:$PATH`, run `node .yarn/releases/yarn-4.13.0.cjs workspace @pipeline/wallet-connect lint` and `… workspace @pipeline/trustee lint` (eslint + prettier), then `… workspace @pipeline/trustee build` (`tsc -b && vite build`, which also type-checks the wallet-connect sources it imports).
   - Run `npx tsx scripts/lint-docs.ts` and `npx tsx scripts/lint-comments.ts`, and shrink `scripts/lint-comments.baseline.json` for any touched listed file.
   - Keep the one spec-pointer header per file and add no other comments.
9. **Tests and docs** (below).

## Test Strategy

Vitest only. Run with `PATH=/opt/homebrew/opt/node@22/bin:$PATH node .yarn/releases/yarn-4.13.0.cjs workspace @pipeline/wallet-connect test` and `… workspace @pipeline/trustee test`.

**wallet-connect `src/evm/contracts/securityRegistry.test.ts`:**
- Selectors:
  - `evmSecuritySelector("set_terms", "terms15") === "0x45f225f5"` and `("set_terms", "terms12") === "0x36b14cd2"`.
  - `EVM_SET_TERMS_SELECTORS` equals both values.
  - `evmSecuritySelector("set_terms")` throws.
  - `resolve_flag`, `release_with_consent` and `set_inspectors` are unchanged with or without a shape.
- `terms12` encoding:
  - `decodeFunctionData({ abi: evmSecurityRegistryTerms12Abi, data })` round-trips the 12 fields with `marginCallAt 0n`, and the data is 420 bytes (4 + 13 × 32).
  - Pin the exact hex for loan 1 and Terms `(6000, 7500, 259200, 86400, Dp, 432000, 20000, 604800, 2592000, 500, 200, 0)`. It must equal the payload simulated on Hoodi. Reproduce it with `cast calldata "setTerms(uint256,(uint32,uint32,uint64,uint64,uint8,uint64,uint32,uint64,uint64,uint32,uint32,uint64))" 1 "(6000,7500,259200,86400,1,432000,20000,604800,2592000,500,200,0)"`.
  - Throws when `defaultRatioBps` or `originatorFeeRate` is present, mirroring the Stellar test.
  - Throws on margin below advance.
  - Does **not** throw for any default-ratio ordering, because there is no such field.
  - Same range checks as `terms15` (u32 overflow, negative u64, bad `paymentTerm`).
  - `encodeEvmSecurityRegistryCalldata(setTerms())` without a shape throws.
- `terms15`: the existing tests pass `"terms15"` explicitly and stay green.
- `relayEvmSecurityRegistry` / `readEvmSecurityRegistrySchedule` with `termsShape: "terms12"` forward data starting with `0x36b14cd2`.
- `evmSecurityTermsShapeFromCode`:
  - the Hoodi dispatcher excerpt `0x80632c16cd8a146134855780 6336b14cd2 14612ea957 8063378a1899 14612e6657` (spaces removed) gives `terms12`;
  - the same with `45f225f5` gives `terms15`;
  - both selectors, or neither, throws and names both selectors;
  - a `PUSH32` (`0x7f…`) whose data contains `6345f225f5`, followed by a real `PUSH4 0x36b14cd2`, gives `terms12` (push data is skipped);
  - a truncated trailing `PUSH4` does not throw a range error.
- `readEvmSecurityTermsShape`:
  - an invalid or empty address throws before `readEvmContractCode` is called (mock `./write`);
  - with the mocked code it returns the shape.

**wallet-connect `src/evm/contracts/write.test.ts`** (`@wagmi/core` is already mocked there; add `getStorageAt` / `getBytecode`):
- `readEvmContractCode` reads the implementation when the slot is non-zero, using the Hoodi slot value `0x…502ff7b573acf4efd69414a25c45fe18c839a683`.
- It reads the address itself when the slot is zero.
- It throws on `undefined` or `0x` code.

**Trustee `routes/-risk-council-security.test.ts`:**
- `termsFieldsFor`:
  - `(EVM, "terms12")` and `(EVM, null)` keys equal `termsFieldsFor(STELLAR, null)` (10);
  - `(EVM, "terms15")` keeps today's 12 with the two extra specs.
- `buildSetTermsCall`:
  - `(4, FILLED, EVM, "terms12")` `toEqual(buildSetTermsCall(4, FILLED, STELLAR, null))`;
  - `(4, EVM_FILLED, EVM, "terms12")` has no `defaultRatioBps` / `originatorFeeRate` keys, even when they are filled in the values;
  - `(4, FILLED, EVM, null)` is `null`.
- `ratioOrderErrorFor(parseTermsForm(belowMargin), EVM, "terms12")` is `null`, and margin below advance still gives `RATIO_ORDER_ERROR`.
- The existing EVM tests pass `"terms15"`.

**Trustee `routes/-risk-council-pending.test.ts`:**
- `decodeEvmSecurityCall("set_terms", EVM_SET_TERMS_F92D719_ARGS)` equals the call without extras.
- These give `null`:
  - 12 keys plus `defaultRatioBps` (13 keys);
  - 12 keys plus `defaultBreachAt`;
  - 12 keys with a key missing and `defaultRate` replaced by `originatorFeeRate`;
  - `marginCallAt: "5"`;
  - a numeric id.
- `fromServed` of an EVM `setTerms` op with the 12-key args and `EVM_SET_TERMS_F92D719_CALLDATA`:
  - `pendingActionLabel` is "Set terms";
  - `pendingArgRows` labels equal those of the Stellar `set_terms` fixture (no "Default ratio", no "Originator fee rate");
  - the payment term shows its label.
- The 15-key tests are unchanged.

**Trustee `api/-useRiskCouncil.test.tsx`** (add a `readEvmSecurityTermsShape` mock, default `"terms15"`):
- With `"terms12"`:
  - access for `set_terms` calls `evmSecuritySelector("set_terms", "terms12")`;
  - relay calls `relayEvmSecurityRegistry` with `termsShape: "terms12"`;
  - the scheduled op stores `encodeEvmSecurityRegistryCalldata(call, "terms12")`;
  - the execute-mode schedule lookup passes `termsShape: "terms12"`.
- `resolve_flag` / `release_with_consent` / `set_inspectors` never call `readEvmSecurityTermsShape`.
- Stellar `set_terms` never calls it.
- One access query plus one relay call `readEvmSecurityTermsShape` once in total (shared query cache).
- A rejected probe surfaces as `access.error` and no relay or `canCall` is attempted.

**Trustee `routes/-risk-council-security-page.test.tsx`** (mock `useEvmSecurityTermsShape`; the existing EVM block uses `"terms15"`):
- New `describe("Security page — EVM loan on an f92d719 registry")`:
  - 10 numeric inputs, no "Default ratio (%)" or "Originator fee rate (%)" inputs;
  - no default-ratio error with a default below margin;
  - Set terms relays a `set_terms` call without the extras;
  - a served 12-key pending row renders the Stellar-style rows and Execute sends the served `calldata` verbatim.
- While the shape is loading (`data: undefined`), 10 inputs show and Set terms is disabled.

No Rust tests: there is no backend change. Run the full `@pipeline/trustee` and `@pipeline/wallet-connect` suites before handing off.

## Docs to Update

Narrow edits only. Line numbers are as of `9bb9150c`.

`docs/frontend/trustee-flows.md`:
- **L2473** (Sources of "Risk Council security actions"): after "EVM (#1942, epic #1937): contract `pipeline-contracts@150631a` (…)", add "; Hoodi runs `pipeline-contracts@f92d719` (12-field `Terms`, `setTerms` `0x36b14cd2`), handled per build (#2082)".
- **L2500** (Set terms bullet): change "10 numeric inputs (12 on EVM, see [EVM](#evm-1942))" to "10 numeric inputs (12 on an EVM `150631a` registry, 10 on `f92d719`; see [EVM](#evm-1942))".
- **L2527** (function table, `setTerms` row): first cell "`setTerms(uint256, Terms)`: `0x45f225f5` (`150631a`) or `0x36b14cd2` (`f92d719`), per the detected build".
- **L2532**: replace "the EVM encoder throws when either is missing" with "the `terms15` EVM encoder throws when either is missing, the `terms12` one when either is present (as Stellar)". Also add "`set_terms` takes the detected `termsShape`; there is no default".
- **L2536** (Encoding, `Terms` bullet): append "On `f92d719` (`terms12`) `Terms` is the 12-field tuple `advanceRatioBps, marginCallRatioBps, curePeriod, priceStaleAfter, paymentTerm, gracePeriod, defaultRate, attestationInterval, inspectionInterval, toleranceBps, gradeToleranceBps, marginCallAt` (`evmSecurityRegistryTerms12Abi`), `marginCallAt = 0`: the Stellar field set in Solidity order."
- **L2539**: change "unless `advance ≤ margin call ≤ default`" to "unless `advance ≤ margin call ≤ default` (`150631a`; `advance ≤ margin call` on `f92d719`)".
- **New paragraph inserted after L2539** (before **Form.**). Text: "**Deployed build (#2082).** `readEvmSecurityTermsShape` reads the EIP-1967 implementation of `EVM_SECURITY_REGISTRY_ADDRESS` (the address itself when the slot is zero), walks its opcodes and looks for the `setTerms` `PUSH4`: `0x45f225f5` alone is `terms15`, `0x36b14cd2` alone is `terms12`, anything else is an error shown in the details of the access error, and Set terms stays disabled. Key `["evm-security-terms-shape", address]`, `staleTime` and `gcTime` infinite, no retry; fetched only for `set_terms` and shared by the form, `canCall` selector, schedule lookup, relay and the stored calldata. No env key: the chain is the source of truth, and neither `terms()` nor the API can tell the build before the first terms exist."
- **L2541** (Form): prefix with "On a `terms15` registry,". At the end, add "On `terms12`, and while the build is unknown, the form is the Stellar one: the 10 inputs, the first rule only, and no extras in the call (`termsFieldsFor(chainId, termsShape)`; `buildSetTermsCall` is `null` until the build is known)."
- **Differences table, L2562 (row 10)**: EVM cell becomes "15-field tuple, `marginCallAt = defaultBreachAt = 0` (`150631a`); 12-field on `f92d719` (row 22)".
- **L2563 (row 11)**: EVM cell becomes "12 fields, second ratio rule (`150631a`); 10 fields on `f92d719` (row 22)".
- **New rows after #2072's row 20** (renumber 20 to 22 if #2072 has not merged):
  - `| 21 | Contract build | one build per network, nothing to detect | detected per session from the SR implementation bytecode (`readEvmSecurityTermsShape`): `terms15` (`150631a`) or `terms12` (`f92d719`, Hoodi); unknown is an error and Set terms stays disabled | Contracts and deployments are never changed, so the client adapts to the deployed build; Hoodi has no loans or terms, so `terms()` and the API cannot tell, and an env key could drift |`
  - `| 22 | Terms on `f92d719` | 10 inputs, `advance ≤ margin call`; `defaultRatioBps` / `originatorFeeRate` refused if present | the same 10 inputs, the same rule and the same refusal; `setTerms` `0x36b14cd2` with the 12-field tuple, `marginCallAt = 0` | `f92d719` `Terms` is the Stellar field set; absent fields are handled as Stellar handles them (binding directive) |`
  - `| 23 | Pending `set_terms` args | 12-key snake_case map | 15 camelCase keys (`150631a`) or 12 (`f92d719`: no `defaultRatioBps`, `originatorFeeRate`, `defaultBreachAt`); a 12-key row renders the Stellar rows | The worker decodes both selectors (#2070); Execute sends the served `calldata` either way |`
- **L2605** (EVM pending rows): change "the `Terms` tuple has exactly the 15 camelCase keys" to "the `Terms` tuple has exactly the 15 camelCase keys (`150631a`) or the 12 of `f92d719` (#2082)". Change "`marginCallAt` and `defaultBreachAt` are `"0"`" to "`marginCallAt` (and `defaultBreachAt` when present) is `"0"`". Change "The pending rows of `set_terms` add …" to "The pending rows of a 15-key `set_terms` add …".
- Do **not** touch L1021-1024, L2453-2463, L2544-2548 or L2569-2573 (#2072).

New `docs/user-stories/epic-1937/2082-evm-setterms-f92d719.md`. Same header format as `1942-trustee-evm-security-page.md`. It has three stories:
1. On Hoodi, the Security page of an EVM loan shows 10 term inputs and no "Default ratio" / "Originator fee rate". With the SR role wallet (`0xfe1748f5…`, Open Question 1), Set terms calls `AccessManager.execute(SR, 0x36b14cd2…)`.
2. After execution, "Current security terms" shows no extra rows. This needs a drawn Hoodi loan (Open Question 2) and #2073 for the served terms.
3. A `150631a` deployment (or a mocked `terms15`) keeps the 12-input form and the second ratio rule. The Stellar stage `99000001` form is unchanged.

`docs/user-stories/index.md`: add one row after L448: `| [#2082 Trustee + wallet-connect: EVM setTerms for the deployed f92d719 SecurityRegistry (12-field Terms)](https://github.com/eq-lab/pipeline/issues/2082) | [2082-evm-setterms-f92d719.md](./epic-1937/2082-evm-setterms-f92d719.md) | Initial |`.

No product-spec change. The served `/security` contract is #2070's. This issue changes only Trustee rendering and encoding, which `trustee-flows.md` specifies.
