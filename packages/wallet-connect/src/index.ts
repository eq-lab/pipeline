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
 * `useQuery` (e.g. the Trustee's `useUsdcCustodyBalance`).
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
export { evmChainInfo, defineEvmChain, isKnownEvmChain } from "./evm/chains";
export { namespaceLabel } from "./namespaceLabel";
export type { WalletNamespaceKind } from "./namespaceLabel";
export type { EvmChainInfo } from "./evm/chains";
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
 * `encodeDrawLoanArgs` is exported for direct unit testing of the ScVal
 * transform matrix.
 */
export {
  drawLoan,
  buildDrawLoanEnvelope,
  encodeDrawLoanArgs,
} from "./stellar/contracts/loanRegistry";
export type {
  DrawLoanArgs,
  DrawLoanEconomics,
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

export {
  encodeRepaymentData,
  readNextRepaymentId,
  readRepaymentData,
  readIsRepaymentReversed,
  readLoanDisbursementState,
  readLoanOwner,
} from "./stellar/contracts/loanRegistry";
export type {
  LoanDisbursementState,
  RepaymentInput,
  ReadNextRepaymentIdParams,
  ReadRepaymentParams,
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

export {
  recordWireIn,
  buildRecordWireInEnvelope,
  encodeRecordWireInArgs,
  parseUsdDollarsToI128,
  hexToBytes32ScVal,
  repay,
  buildRepayEnvelope,
  encodeRepayArgs,
  repaymentRefHash,
  encodeReverseRepayArgs,
  reverseRepayRefHash,
  readMinterRepayment,
  scheduleReverseRepay,
  executeReverseRepay,
  readReverseRepaySchedule,
  recordIncome,
  buildRecordIncomeEnvelope,
  encodeRecordIncomeArgs,
  readRefHashSeen,
  bankReferenceRefHash,
  disburse,
  encodeDisburseArgs,
} from "./stellar/contracts/minter";
export type {
  RecordWireInArgs,
  RecordWireInParams,
  RecordWireInResult,
  RecordWireInStage,
  BuildRecordWireInEnvelopeParams,
  RepayArgs,
  RepayParams,
  RepayResult,
  RepayStage,
  BuildRepayEnvelopeParams,
  ReverseRepayArgs,
  ReverseRepayParams,
  ReadReverseRepayScheduleParams,
  MinterRepayment,
  ReadMinterRepaymentParams,
  RecordIncomeArgs,
  RecordIncomeParams,
  RecordIncomeResult,
  RecordIncomeStage,
  BuildRecordIncomeEnvelopeParams,
  ReadRefHashSeenParams,
  DisburseArgs,
  DisburseParams,
} from "./stellar/contracts/minter";

export {
  readMinterWireIn,
  readMinterPlusdId,
  readPlusdAuthorization,
  readWireInRefHashSeen,
  wireInReturnRefHash,
  encodeAssignWireInArgs,
  encodeReturnWireInArgs,
  assignWireIn,
  returnWireIn,
} from "./stellar/contracts/wireInEscrow";
export type {
  WireInStatus,
  MinterWireIn,
  PlusdAuthorization,
  ReadMinterWireInParams,
  ReadMinterPlusdIdParams,
  ReadPlusdAuthorizationParams,
  ReadWireInRefHashSeenParams,
  AssignWireInArgs,
  ReturnWireInArgs,
  AssignWireInParams,
  ReturnWireInParams,
} from "./stellar/contracts/wireInEscrow";

export {
  readWireOutRecord,
  encodeSettleWireOutArgs,
  encodeCancelWireOutArgs,
  settleWireOut,
  cancelWireOut,
} from "./stellar/contracts/wireOutSettlement";
export type {
  WireOutRecordStatus,
  WireOutRecord,
  ReadWireOutRecordParams,
  SettleWireOutArgs,
  CancelWireOutArgs,
  SettleWireOutParams,
  CancelWireOutParams,
} from "./stellar/contracts/wireOutSettlement";

export {
  readMinterRamp,
  readMinterPoolState,
  readMinterPaused,
  encodeOpenRampArgs,
  encodeCloseRampArgs,
  encodeRecordExpenseArgs,
  openRamp,
  closeRamp,
  recordExpense,
} from "./stellar/contracts/minterRamps";
export type {
  RampDirection,
  MinterRamp,
  MinterPoolState,
  ReadMinterRampParams,
  ReadMinterPoolStateParams,
  OpenRampArgs,
  CloseRampArgs,
  RecordExpenseArgs,
  OpenRampParams,
  CloseRampParams,
  RecordExpenseParams,
} from "./stellar/contracts/minterRamps";

export {
  readCanCall,
  readOperationSchedule,
  buildRelayEnvelope,
  relay,
} from "./stellar/contracts/accessManager";
export type {
  CanCall,
  OperationSchedule,
  RelayMode,
  RelayStage,
  RelayParams,
  RelayResult,
  ReadCanCallParams,
  ReadOperationScheduleParams,
  BuildRelayEnvelopeParams,
} from "./stellar/contracts/accessManager";

export {
  readDeal,
  readDebtTrustline,
  registerDeal,
  registerDealArgs,
} from "./stellar/contracts/dealTokenFactory";
export type {
  DealRead,
  ReadDealParams,
  ReadDebtTrustlineParams,
  RegisterDealParams,
} from "./stellar/contracts/dealTokenFactory";

export {
  encodeRiskCouncilArgs,
  riskCouncilArgsXdr,
  relayRiskCouncil,
  readRiskCouncilSchedule,
  riskCouncilReasonHash,
  readLoanMoney,
  readLoanChainState,
} from "./stellar/contracts/riskCouncil";
export type {
  RiskCouncilCall,
  RiskCouncilClosureReason,
  RiskCouncilRelayParams,
  ReadRiskCouncilScheduleParams,
  LoanMoney,
  LoanChainState,
  ReadLoanParams,
} from "./stellar/contracts/riskCouncil";

export {
  decodeOperationArgs,
  operationArgsXdr,
  readScheduledOperation,
  executeScheduledOperation,
} from "./stellar/contracts/scheduledOperation";
export type {
  ScheduledOperationParams,
  ExecuteScheduledOperationParams,
} from "./stellar/contracts/scheduledOperation";

export {
  encodeSecurityRegistryArgs,
  securityRegistryArgsXdr,
  relaySecurityRegistry,
  readSecurityRegistrySchedule,
  readSecurityInspectors,
  securityReasonHash,
  isInspectorAddress,
  SECURITY_PAYMENT_TERMS,
  FLAG_OUTCOMES,
} from "./stellar/contracts/securityRegistry";
export type {
  SecurityPaymentTerm,
  FlagOutcome,
  SecurityTermsInput,
  SecurityRegistryCall,
  SecurityRegistryRelayParams,
  ReadSecurityRegistryScheduleParams,
  ReadSecurityInspectorsParams,
} from "./stellar/contracts/securityRegistry";

// ── EVM Risk Council ──────────────────────────────────────────────────────────
export {
  EVM_TX_GAS_CAP,
  readEvmContract,
  sendEvmContractCall,
} from "./evm/contracts/write";
export type {
  ReadEvmContractParams,
  SendEvmContractCallParams,
  SendEvmContractCallResult,
} from "./evm/contracts/write";
export {
  accessManagerAbi,
  readEvmCanCall,
  readEvmOperationSchedule,
  relayEvm,
  readEvmScheduledOperation,
  executeEvmScheduledOperation,
} from "./evm/contracts/accessManager";
export type {
  EvmAccessManagerCallParams,
  ReadEvmCanCallParams,
  ReadEvmOperationScheduleParams,
  RelayEvmParams,
  ReadEvmScheduledOperationParams,
  ExecuteEvmScheduledOperationParams,
} from "./evm/contracts/accessManager";
export {
  evmSecurityRegistryAbi,
  evmSecurityRecordNftAbi,
  evmSecurityErrorAbi,
  EVM_SECURITY_FUNCTION_NAMES,
  evmSecuritySelector,
  encodeEvmSecurityRegistryCalldata,
  evmSecurityTarget,
  relayEvmSecurityRegistry,
  readEvmSecurityRegistrySchedule,
  readEvmSecurityInspectors,
  isEvmInspectorAddress,
  normalizeEvmAddress,
} from "./evm/contracts/securityRegistry";
export type {
  EvmSecurityAddresses,
  EvmSecurityCallParams,
  RelayEvmSecurityRegistryParams,
} from "./evm/contracts/securityRegistry";

export {
  evmLoanRegistryRiskCouncilAbi,
  evmLoanRegistryErrorAbi,
  evmRiskCouncilErrorAbi,
  EVM_RISK_COUNCIL_FUNCTION_NAMES,
  EVM_LOAN_STATUSES,
  EVM_CLOSURE_REASONS,
  evmRiskCouncilSelector,
  encodeEvmRiskCouncilCalldata,
  relayEvmRiskCouncil,
  readEvmRiskCouncilSchedule,
  readEvmLoanChainState,
  readEvmLoanMoney,
} from "./evm/contracts/riskCouncil";
export type {
  EvmRiskCouncilCallParams,
  RelayEvmRiskCouncilParams,
  ReadEvmLoanParams,
} from "./evm/contracts/riskCouncil";

export {
  drawEvmLoan,
  encodeEvmDrawLoanCalldata,
  evmLoanRegistryDrawAbi,
  readEvmDrawnLoanId,
} from "./evm/contracts/loanRegistry";
export type {
  DrawEvmLoanParams,
  DrawEvmLoanResult,
} from "./evm/contracts/loanRegistry";

export {
  minterRecoveryAbi,
  encodeEvmReverseRepayCalldata,
  encodeEvmRepayCalldata,
  evmMinterErrorAbi,
  evmRecoveryErrorAbi,
  evmReverseRepaySelector,
  evmRepaySelector,
  evmReverseRepayRefHash,
  relayEvmReverseRepay,
  scheduleEvmReverseRepay,
  executeEvmReverseRepay,
  readEvmReverseRepaySchedule,
  readEvmNextRepaymentId,
  readEvmMinterRepayment,
  readEvmRecoveryRepayments,
} from "./evm/contracts/minter";
export type {
  EvmReverseRepayArgs,
  EvmRepayArgs,
  EvmReverseRepayCallParams,
  RelayEvmReverseRepayParams,
  ScheduleEvmReverseRepayParams,
  EvmMinterRepaymentRecord,
  EvmRecoveryRepayment,
  ReadEvmRecoveryRepaymentsParams,
} from "./evm/contracts/minter";

export {
  EVM_LOG_CHUNK_BLOCKS,
  isTransientRpcError,
  readEvmHeadBlock,
  scanEvmLogs,
} from "./evm/contracts/logs";
export type { ScanEvmLogsParams } from "./evm/contracts/logs";

// ── Connect-modal (shared single instance) ────────────────────────────────────
export { ConnectModalProvider } from "./ConnectModalProvider";
export { useConnectModal } from "./ConnectModalContext";
export type { ConnectModalContextValue } from "./ConnectModalContext";
export { ConnectWalletModal } from "./ConnectWalletModal";
export type { ConnectWalletModalProps, WalletTab } from "./ConnectWalletModal";

/**
 * Network switcher (issue #1032) — cross-deployment link helpers. See
 * `docs/frontend/wallet-flows.md` for the design; each deployment is
 * single-network, so "switching" networks means navigating to a sibling
 * deployment's URL, not swapping runtime config.
 */
export {
  networkIdFromPassphrase,
  networkIdFromEvmChainId,
  parseNetworkLinks,
  navigateToNetworkLink,
  shouldConfirmNetworkSwitch,
} from "./network/links";
export type { NetworkIdentity, NetworkLink } from "./network/links";
