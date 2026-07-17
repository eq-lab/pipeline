/**
 * Public surface of `@pipeline/wallet-connect`.
 *
 * Minimal shared wallet-connect slice extracted from `packages/frontend/src/wallet`
 * (#791): connect/disconnect + connected address/chain + a picker modal +
 * provider mounting + message signing (EVM `personal_sign` / Stellar
 * SEP-0053), for consumption by both the LP frontend and the Trustee app.
 *
 * Callers must call `setWalletConnectConfig(...)` once, at the very start of
 * bootstrap, before rendering `EvmWalletProvider` / `StellarWalletProvider`.
 * Those providers lazily initialise AppKit / the wagmi adapter / the Stellar
 * kit on first render (not at module load — ES module imports are hoisted
 * and evaluated before the importing module's own body runs, so a
 * module-scope read of the injected config would throw before an app's
 * `main.tsx` ever gets a chance to call `setWalletConnectConfig()`).
 *
 * The gate (`WalletGateContext`) is optional: mount a
 * `WalletGateContext.Provider` above these providers to interpose a
 * pre-connect gate (e.g. the LP terms attestation); omit it (the Trustee's
 * choice) to connect directly.
 *
 * Do NOT import wagmi, viem, @reown/appkit, @tanstack/react-query,
 * @creit.tech/stellar-wallets-kit, or @stellar/stellar-sdk directly from
 * outside this package — the ESLint `no-restricted-imports` rule enforces
 * this boundary (mirrors `packages/frontend/src/wallet/index.ts`, TD-33).
 *
 * `getSacBalance` (issue #805) is a plain async Stellar SAC `balance(account)`
 * read — NOT a hook (this package forbids `@tanstack/react-query` outside
 * `src/evm/**`). Callers that want polling/caching wrap it in their own
 * `useQuery` (e.g. the Trustee's `useCapitalWalletBalance`).
 */

// ── Config ───────────────────────────────────────────────────────────────────
export {
  setWalletConnectConfig,
  getWalletConnectConfig,
  _resetWalletConnectConfigForTests,
} from "./config";
export type { WalletConnectConfig } from "./config";

// ── Gate (optional, injectable) ───────────────────────────────────────────────
export { WalletGateContext, useWalletGate } from "./WalletGateContext";
export type { WalletGateContextValue } from "./WalletGateContext";

// ── EVM namespace ─────────────────────────────────────────────────────────────
export { EvmWalletProvider } from "./evm/EvmWalletProvider";
export {
  useEvmWallet,
  useContractRead,
  useEvmConnectors,
} from "./evm/useEvmWallet";
export type {
  WalletState,
  UseContractReadArgs,
  ContractReadResult,
  UseEvmConnectorsResult,
  EvmWalletConnectorId,
} from "./evm/useEvmWallet";
export {
  isMockKeyPresent,
  readMock,
  useMock,
  subscribeMock,
  parseJson,
} from "./evm/mock";

// ── Stellar namespace ─────────────────────────────────────────────────────────
export { StellarWalletProvider } from "./stellar/StellarWalletProvider";
export {
  useStellarWallet,
  useStellarConnectors,
} from "./stellar/useStellarWallet";
export type {
  StellarWalletState,
  UseStellarConnectorsResult,
  SorobanWalletId,
} from "./stellar/useStellarWallet";
export {
  getSacBalance,
  isSacBalanceSentinel,
  SAC_BALANCE_I64_MAX,
} from "./stellar/sacBalance";
export type { GetSacBalanceParams } from "./stellar/sacBalance";

/**
 * `drawLoan` (issue #831) — trustee-wallet-signed on-chain `draw_loan` mint,
 * reached through the executor/access-control contract's `execute`. Also a
 * plain async function (not a hook), same reasoning as `getSacBalance`.
 * `encodeDrawLoanArgs` and `parseUsdcAmountToU128` are exported for direct
 * unit testing of the ScVal transform matrix.
 */
export {
  drawLoan,
  buildDrawLoanEnvelope,
  encodeDrawLoanArgs,
  parseUsdcAmountToU128,
} from "./stellar/contracts/loanRegistry";
export type {
  SubmitLoanRequest,
  EconomicsInput,
  LocationInput,
  DrawLoanParams,
  DrawLoanResult,
  DrawLoanStage,
  BuildDrawLoanEnvelopeParams,
} from "./stellar/contracts/loanRegistry";

/**
 * `rollover` (issue #870) — trustee-wallet-signed on-chain `LoanRegistry.rollover`
 * through the same executor `execute` proxy as `draw_loan`. Appends an epoch,
 * sets `currentMaturityDate`, returns status to Performing (mints nothing).
 * `encodeRolloverArgs` is exported for unit-testing the ScVal transform.
 */
export {
  rollover,
  buildRolloverEnvelope,
  encodeRolloverArgs,
} from "./stellar/contracts/loanRegistry";

/**
 * `record_payment` (issue #882) — trustee-wallet-signed on-chain
 * `LoanRegistry.recordPayment` through the executor `execute` proxy. Pure
 * accounting; records a repayment split as a `RepaymentData` struct.
 */
export {
  recordPayment,
  buildRecordPaymentEnvelope,
  encodeRecordPaymentArgs,
} from "./stellar/contracts/loanRegistry";
export type {
  RepaymentInput,
  RecordPaymentParams,
  RecordPaymentResult,
  RecordPaymentStage,
  BuildRecordPaymentEnvelopeParams,
} from "./stellar/contracts/loanRegistry";

/**
 * `close_loan` (issue #884) — trustee-wallet-signed on-chain
 * `LoanRegistry.closeLoan` through the executor `execute` proxy. Moves the loan
 * to `Closed` with a `ClosureReason`.
 */
export {
  closeLoan,
  buildCloseLoanEnvelope,
  encodeCloseLoanArgs,
} from "./stellar/contracts/loanRegistry";
export type {
  CloseLoanParams,
  CloseLoanResult,
  CloseLoanStage,
  BuildCloseLoanEnvelopeParams,
} from "./stellar/contracts/loanRegistry";
export type {
  RolloverParams,
  RolloverResult,
  RolloverStage,
  BuildRolloverEnvelopeParams,
} from "./stellar/contracts/loanRegistry";

/**
 * `updateMutable` (issue #872) — trustee-wallet-signed on-chain
 * `LoanRegistry.updateMutable` through the executor `execute` proxy. Non-economic
 * fields only (status / CCR / location / metadata URI), no NAV impact.
 */
export {
  updateMutable,
  buildUpdateMutableEnvelope,
  encodeUpdateMutableArgs,
} from "./stellar/contracts/loanRegistry";
export type {
  UpdateMutableParams,
  UpdateMutableResult,
  UpdateMutableStage,
  BuildUpdateMutableEnvelopeParams,
} from "./stellar/contracts/loanRegistry";

// ── Connect-modal (shared single instance) ────────────────────────────────────
export { ConnectModalProvider } from "./ConnectModalProvider";
export { useConnectModal } from "./ConnectModalContext";
export type { ConnectModalContextValue } from "./ConnectModalContext";
export { ConnectWalletModal } from "./ConnectWalletModal";
export type { ConnectWalletModalProps, WalletTab } from "./ConnectWalletModal";
