# Issue #1766: Trustee: register the per-loan debt token (DealTokenFactory.register_deal) after loan creation

Source: https://github.com/eq-lab/pipeline/issues/1766

Branch: `feat/1766-trustee-register-deal-token` (draft PR #1884). No Figma reference; the step is built from the existing trustee theme (Risk Council / escrowed-wires AccessManager action pattern), so there is no Figma verification step.

## Scope

In scope (Trustee console, Stellar):

- A **Register debt token** action that signs `DealTokenFactory.register_deal(loan_id)` through the AccessManager relay (`relay` in `packages/wallet-connect/src/stellar/contracts/accessManager.ts`, the #1761 plumbing). It is offered in two places:
  1. The approved-origination banner (`ApprovedBanner` in `packages/trustee/src/routes/origination.$id.tsx`) right after a successful `draw_loan`, when `mintedLoanId` is known.
  2. The loan detail page (`packages/trustee/src/routes/loans.$id.tsx`) for any Stellar loan whose deal is not registered.
- A "Debt token" row on the loan detail "Registry state & derived" card (`RegistryCard`), tag `chain`, showing `Deal.debt` from `deal(loan_id)` verbatim; "—" when not registered or the read fails.
- Pending/registered state is decided only by `deal(loan_id)`. Never by `debt_address(loan_id)` (see Assumptions).
- Role gating by `readCanCall` (target = factory, fn = `register_deal`) mapped with `accessAction` from `packages/trustee/src/lib/accessManagerAction.ts`. If the role has a delay, the schedule / execute-scheduled flow from the Risk Council actions applies.
- Error copy for already-registered and unknown-loan contract errors.
- No auto-chaining into the Approve (`draw_loan`) transaction. It stays a separate, explicit signature.

Out of scope:

- EVM `registerDeal`. EVM loans show the row as "—" and the action is blocked with `stellarOnlyActionReason` until the open point below is answered.
- `sync_debt` (separate follow-up if needed).
- Backend and worker changes. The worker already indexes `DealRegistered`.

## Assumptions and Risks

Verified on testnet on 2026-11-10 by simulating against the deployed factory `CAIBACM665EPLGJTVC4IXWTDV7PTJH7NSLY5TGRDAMHQZX7TCQ74OSIP` (spec read with `contract.Client.from`):

- `register_deal(loan_id: u32) -> Deal`, `deal(loan_id: u32) -> Deal`, `debt_address(loan_id: u32) -> Address`, `sync_debt(loan_id: u32)`. `loan_id` is **u32**. Passing u64 traps with `UnreachableCodeReached`.
- The deployed `Deal` struct is `{ cargo, debt }` (the legacy, pre-contracts-#38 shape). HEAD drops `cargo`. The parser must require `debt` and ignore `cargo` when present, so it works with both.
- `deal(id)` for an unregistered loan fails with `Error(Contract, #4)`. Map exactly `#4` from the `deal` read to "not registered". Any other failure is a read error: show "—" in the row and do not offer the action.
- `debt_address(id)` returns a deterministic address **even for unregistered loans** (for example id 999). So it cannot be used as the registered signal, and it must not be shown as the debt token for a loan that is not registered.
- The spec exposes no named error enum, so the `register_deal` codes for already-registered and unknown-loan are not known from the spec (see Open Questions).
- `deployments/justfile` maps `register_deal` to `TRUSTEE` on the AccessManager. It is assumed that `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID` is that AccessManager. The coder verifies this with `readCanCall` for a trustee wallet on testnet before wiring the UI.
- Risk: the factory id differs per deployment (99000001 `CAIBA…OSIP`, 99000002 `CBAZ…V3UH`). It needs a new env var per deployment, and the staging and prod env must be updated.

## Open Questions

- EVM: does `PipelineDealTokenFactory` register automatically on `drawLoan`, or does the trustee need to call `registerDeal`? This plan assumes the step is Stellar-only for now and blocks it on EVM loans. That is the issue's own open point, which needs the contracts owner.
- What are the contract error codes from `register_deal` for "already registered" and "unknown loan"? The deployed spec has no error enum. The coder reads them from `contracts/deal-token-factory/src/lib.rs` in the contracts repo. If they cannot be confirmed, only the generic relay error copy ships.
- On the loan detail page, should the action show for every role-holding trustee on every non-registered Stellar loan, or only for open (non-closed) loans? This plan assumes any non-registered Stellar loan, as the issue says.

## Implementation Steps

1. **Env**: add `STELLAR_DEAL_TOKEN_FACTORY_ID: readString("VITE_STELLAR_DEAL_TOKEN_FACTORY_ID", "")` to `packages/trustee/src/lib/env.ts`, and add it to the trustee `.env.example` and runtime-env lists (wherever `VITE_STELLAR_YIELD_MINTER_ID` is declared, with grep). An empty value means unconfigured: the row shows "—" and the action shows "Debt token registration isn't configured for this environment."
2. **Contract client**: add `packages/wallet-connect/src/stellar/contracts/dealTokenFactory.ts` (with a one-line `// spec:` header):
   - `readDeal({ factoryId, loanId, rpcUrl, networkPassphrase }): Promise<{ debt: string } | null>` uses `simulateRead(factoryId, "deal", [nativeToScVal(loanId, { type: "u32" })])`. It returns `null` only on `Error(Contract, #4)` and throws otherwise. It validates that `loanId` is an integer in the u32 range and that `debt` is a `C…` string.
   - `registerDeal(params: Omit<RelayParams, "target" | "fn" | "args"> & { factoryId; loanId })` calls `relay({ ..., target: factoryId, fn: "register_deal", args: [u32] })`.
   - Export both from `packages/wallet-connect/src/index.ts`.
3. **Hooks** in `packages/trustee/src/api/useDealToken.ts`:
   - `useDeal(chainId, loanId)` is a React Query `["deal-token", chainId, loanId]` query, enabled only for the Stellar chain, a configured factory id and a non-null loan id.
   - `useRegisterDealAccess(enabled)` follows `useCashReporterAccess`: `readCanCall` plus `readOperationSchedule` when the role has a delay.
   - `useRegisterDeal()` is a mutation calling `registerDeal` with `useStellarWallet`, tracks the stage, and invalidates `["deal-token", …]` on success.
4. **Lib** `packages/trustee/src/lib/dealToken.ts`: holds `REGISTER_DEAL_ERROR_COPY` (keyed by the confirmed contract codes, parsed with `amErrorCode`), `registerDealReason(...)` (not configured, wallet not connected, not Stellar, `no-role` copy, read error), and the button label via `stageLabel`.
5. **Loan detail**: in `packages/trustee/src/routes/-useLoanDetail.ts`, pass the `useDeal` result into `buildRegistryState`. Append `{ label: "Debt token", value: deal?.debt ?? "—", tag: "chain" }`. Do not truncate unless the card already truncates addresses. Expose `debtToken: { registered: boolean | null; ... }` in `UseLoanDetailResult`. In `loans.$id.tsx`, add a "Register debt token" control in the Registry card footer, or with the other on-chain actions to match the existing layout. It renders only when `registered === false`, with the role line from `riskCouncilRoleLine`-style copy, the stage label, and an `ErrorState` with the mapped copy.
6. **Origination after mint**: in `origination.$id.tsx`, `ApprovedBanner` renders the same control (a shared component, for example `packages/trustee/src/routes/-RegisterDebtTokenAction.tsx`) when `loanId != null`, the chain is Stellar, and `useDeal` reports `registered === false`. After success it shows the `debt` address verbatim.
7. Keep the code comment-minimal: one `// spec:` header per new file, no JSDoc.

## Test Strategy

- `packages/wallet-connect/src/stellar/contracts/dealTokenFactory.test.ts`: the u32 encoding (assert the ScVal type), `#4` gives `null`, other errors throw, `{debt,cargo}` and `{debt}` both parse, a missing `debt` throws, and `registerDeal` forwards the target, fn and args to `relay` (mock the relay).
- `packages/trustee/src/api/-useDealToken.test.tsx`: disabled when unconfigured, non-Stellar or no loan id; the mutation invalidates the deal query.
- `packages/trustee/src/lib/-dealToken.test.ts`: reason and error-copy mapping.
- `-useLoanDetail.test.ts` (`buildRegistryState`): the Debt token row with a registered deal, "—" when not registered, and "—" on a read error.
- `-loans.$id.test.tsx` and `-origination-detail-page.test.tsx`: the action is shown only when not registered and blocked for no-role, EVM or unconfigured; success swaps in the address.
- Live check on testnet staging, done by the user: approve a submission, register the debt token, confirm that `deal(id)` returns it and that the audit log shows `DealRegistered`.
- Run `yarn lint`, `yarn test`, `yarn build` in `packages/trustee` and `packages/wallet-connect`.

## Docs to Update

- `docs/frontend/trustee-flows.md`: a new subsection after §"Chain-first Approve ordering (#831)" called "Register debt token (#1766)". It covers placement, `deal()` as the source of truth, the `debt_address` caveat, role gating and error copy.
- `docs/product-specs/loans.md`: the debt token lifecycle (draw, register, sync), Stellar only for now.
- `docs/product-specs/loans-data.md`: the `DealTokenFactory` Soroban signatures (u32 `loan_id`, `Deal{debt[,cargo]}`).
- `docs/user-stories/epic-1795/1766-register-debt-token.md` (or the parent epic's folder) and `docs/user-stories/index.md`.
- `.env.example` / trustee env docs: `VITE_STELLAR_DEAL_TOKEN_FACTORY_ID`.
