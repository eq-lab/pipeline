/**
 * Public surface of the wallet module.
 *
 * Only import from this barrel outside of `src/wallet/evm/` or
 * `src/wallet/stellar/`.
 * Do NOT import wagmi, viem, @reown/appkit, @tanstack/react-query,
 * @creit.tech/stellar-wallets-kit, or @stellar/stellar-sdk directly
 * from outside this module — the ESLint `no-restricted-imports` rule enforces
 * this boundary.
 */

// ── Shared gate ───────────────────────────────────────────────────────────────
export { WalletGateProvider } from "./WalletGateProvider";

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
export { EvmChainAutoSwitch } from "./evm/EvmChainAutoSwitch";
export { useEvmNetworkGuard } from "./evm/useEvmNetworkGuard";
export type {
  EvmNetworkGuard,
  WrongNetworkInfo,
} from "./evm/useEvmNetworkGuard";
export {
  useDepositManagerAddresses,
  useDepositManagerMinDeposit,
  useRequestDeposit,
  useClaim,
} from "./evm/useDepositManager";
export type {
  DepositManagerAddressesResult,
  DepositManagerMinDepositResult,
  RequestDepositResult as EvmRequestDepositResult,
  ClaimResult,
} from "./evm/useDepositManager";
export {
  useRequestWithdrawal,
  useClaimWithdrawal,
} from "./evm/useWithdrawalQueue";
export type {
  RequestWithdrawalResult,
  ClaimWithdrawalResult,
} from "./evm/useWithdrawalQueue";
export {
  useStakedPlusdAsset,
  useStakedPlusdConvertToShares,
  useStakedPlusdConvertToAssets,
  useStake,
  useUnstake,
} from "./evm/useStakedPlusd";
export type {
  StakedPlusdAssetResult,
  StakedPlusdConvertResult,
  StakeResult,
  UnstakeResult,
} from "./evm/useStakedPlusd";
export {
  useEvmPlusdTotalSupply,
  useEvmUsdcCustodyBalance,
} from "./evm/useEvmFinancialPositionReads";
export type { UseEvmTokenReadResult } from "./evm/useEvmFinancialPositionReads";
export {
  readInflightEvmRequest,
  writeInflightEvmRequest,
  clearInflightEvmRequest,
} from "./evm/inflight";
export type { InflightEvmKind, InflightEvmRequest } from "./evm/inflight";
export { useApproval } from "./evm/useApproval";
export type { UseApprovalResult, UseApprovalArgs } from "./evm/useApproval";
export { useEvmToken } from "./evm/useEvmToken";
export { useEvmStakeDecimals } from "./evm/useEvmStakeDecimals";
export type { EvmStakeDecimals } from "./evm/useEvmStakeDecimals";
export type { UseTokenArgs, UseTokenResult } from "./evm/useEvmToken";
export {
  isMockKeyPresent,
  readMock,
  useMock,
  subscribeMock,
  parseJson,
} from "./evm/mock";
export { parseUnits, formatUnits } from "./evm/units";
export {
  readTermsAcknowledged,
  useTermsAcknowledgement,
} from "./useTermsAcknowledgement";
export type { UseTermsAcknowledgementResult } from "./useTermsAcknowledgement";
export {
  useNetworkFeeEstimate,
  formatFeeEth,
} from "./evm/useNetworkFeeEstimate";
export type {
  UseNetworkFeeEstimateResult,
  NetworkFeeDirection,
} from "./evm/useNetworkFeeEstimate";

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
export { useStellarToken, formatUsdcDisplay } from "./stellar/useStellarToken";
export type { UseStellarTokenResult } from "./stellar/useStellarToken";
export { useStellarXlmBalance } from "./stellar/useStellarXlmBalance";
export type { UseStellarXlmBalanceResult } from "./stellar/useStellarXlmBalance";
export {
  useStellarSacToken,
  SAC_DECIMALS,
  sacRawToDisplay,
  sacDisplayToRaw,
} from "./stellar/useStellarSacToken";
export type {
  UseStellarSacTokenParams,
  UseStellarSacTokenResult,
} from "./stellar/useStellarSacToken";
export { useStellarDepositManagerAddresses } from "./stellar/useStellarDepositManagerAddresses";
export type {
  StellarDepositManagerAddresses,
  UseStellarDepositManagerAddressesResult,
} from "./stellar/useStellarDepositManagerAddresses";
export { useStellarDepositManagerMinDeposit } from "./stellar/useStellarDepositManagerMinDeposit";
export type { UseStellarDepositManagerMinDepositResult } from "./stellar/useStellarDepositManagerMinDeposit";
export {
  useStellarNetworkFeeEstimate,
  formatFeeXlm,
} from "./stellar/useStellarNetworkFeeEstimate";
export type {
  UseStellarNetworkFeeEstimateResult,
  StellarFeeDirection,
} from "./stellar/useStellarNetworkFeeEstimate";

export {
  useStellarRequestDeposit,
  useStellarClaim,
  useStellarDepositRequest,
  useChangeTrust,
  readInflightDeposit,
  writeInflightDeposit,
  clearInflightDeposit,
} from "./stellar/useStellarDepositManager";
export type {
  RequestDepositResult,
  StellarClaimResult,
  UseStellarDepositRequestResult,
  UseChangeTrustResult,
  InflightDeposit,
} from "./stellar/useStellarDepositManager";

export {
  useStellarRequestWithdrawal,
  useStellarClaimWithdrawal,
  useStellarWithdrawalRequest,
  useStellarChangeTrustUsdc,
  readInflightWithdrawal,
  writeInflightWithdrawal,
  clearInflightWithdrawal,
} from "./stellar/useStellarWithdrawalQueue";
export type {
  RequestWithdrawalResult as StellarRequestWithdrawalResult,
  StellarClaimWithdrawalResult,
  UseStellarWithdrawalRequestResult,
  UseStellarChangeTrustUsdcResult,
  InflightWithdrawal,
} from "./stellar/useStellarWithdrawalQueue";

// ── View selection ────────────────────────────────────────────────────────────
export { WalletViewProvider, useWalletView } from "./WalletViewContext";
export type {
  WalletViewKind,
  WalletViewContextValue,
} from "./WalletViewContext";

// ── Active chain for protocol reads (issue #1498) ─────────────────────────────
export { useActiveChain } from "./useActiveChain";
export type { UseActiveChainResult } from "./useActiveChain";

// ── Active-namespace wallet derivation (issue #1284) ──────────────────────────
export { useActiveWalletAccount } from "./useActiveWalletAccount";
export type { UseActiveWalletAccountResult } from "./useActiveWalletAccount";

// ── Connect-modal (shared single instance) ────────────────────────────────────
export { ConnectModalProvider } from "./ConnectModalProvider";
export { useConnectModal } from "./ConnectModalContext";
export type { ConnectModalContextValue } from "./ConnectModalContext";

// ── Stellar StakedPLUSD vault hooks (#633) ─────────────────────────────────────
export {
  useStellarStake,
  useStellarUnstake,
  useStellarStakedPlusdAsset,
  useStellarStakeConvertToShares,
  useStellarUnstakeConvertToAssets,
  useStellarStakedPlusdBalance,
  useStellarChangeTrustStakedPlusd,
} from "./stellar/useStellarStakedPlusd";
export type {
  StellarStakeResult,
  StellarUnstakeResult,
  UseStellarStakedPlusdAssetResult,
  UseStellarConvertResult,
  UseStellarStakedPlusdBalanceResult,
  UseStellarChangeTrustStakedPlusdResult,
} from "./stellar/useStellarStakedPlusd";

// ── Withdrawal queue reads (position, payable now, totals, recovery rate) ─────
export {
  useWithdrawalQueueTotals,
  isRecoveryRateActive,
} from "./useWithdrawalQueueReads";
export type {
  WithdrawalQueueTotals,
  WithdrawalRequestQueueState,
} from "./useWithdrawalQueueReads";

// ── Bank wire-out (#1757) ─────────────────────────────────────────────────────
export { isWireOutMinterConfigured } from "./wireOutConfig";
export { useWireOuts, useMinterPaused } from "./useWireOutReads";
export type { WireOutRead, WireOutStatus } from "./useWireOutReads";
export { useStellarRequestWireOut } from "./stellar/useStellarRequestWireOut";
export type { UseRequestWireOutResult } from "./stellar/useStellarRequestWireOut";
export { useEvmRequestWireOut } from "./evm/useEvmRequestWireOut";

// ── Flow adapter (chain-agnostic deposit/withdraw) ────────────────────────────
export { useDepositFlow } from "./useDepositFlow";
export type {
  FlowState,
  Direction as FlowDirection,
  StepState as FlowStepState,
  StepInfo,
  WithdrawQueueInfo,
  StepTxState,
  TrustlineInfo,
} from "./useDepositFlow";

// ── Flow adapter (chain-agnostic stake/unstake) ───────────────────────────────
export { useStakeFlow } from "./useStakeFlow";
export type {
  StakeFlowState,
  StakeTab,
  StakeStepState,
  StakeStepInfo,
} from "./useStakeFlow";

// ── Wallet presence (issue #1458) ─────────────────────────────────────────────
export { useWalletPresence } from "./useWalletPresence";
export type { UseWalletPresenceResult } from "./useWalletPresence";

// ── Network switcher (cross-deployment links, issue #1032) ───────────────────
export {
  getNetworkSwitcherState,
  isMainnetNetwork,
  navigateToNetworkLink,
  shouldConfirmNetworkSwitch,
} from "./networkSwitcher";
export {
  useNetworkSwitcherState,
  useIsMainnetNetwork,
} from "./useNetworkIdentity";
export type {
  NetworkSwitcherState,
  NetworkIdentity,
  NetworkLink,
} from "./networkSwitcher";
