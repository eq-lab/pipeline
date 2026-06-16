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
export { useEvmWallet, useContractRead, useEvmConnectors } from "./evm/useEvmWallet";
export type {
  WalletState,
  UseContractReadArgs,
  ContractReadResult,
  UseEvmConnectorsResult,
  EvmWalletConnectorId,
} from "./evm/useEvmWallet";
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
export { useApproval } from "./evm/useApproval";
export type { UseApprovalResult, UseApprovalArgs } from "./evm/useApproval";
export { useEvmToken } from "./evm/useEvmToken";
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
export { useStellarWallet, useStellarConnectors } from "./stellar/useStellarWallet";
export type {
  StellarWalletState,
  UseStellarConnectorsResult,
  SorobanWalletId,
} from "./stellar/useStellarWallet";
export { useStellarToken } from "./stellar/useStellarToken";
export type { UseStellarTokenResult } from "./stellar/useStellarToken";
export { useBlendDeposit } from "./stellar/useBlendDeposit";
export { useBlendWithdraw } from "./stellar/useBlendWithdraw";
export { useBlendPosition } from "./stellar/useBlendPosition";
export type { BlendWriteResult } from "./stellar/useBlendDeposit";
export type { UseBlendPositionResult } from "./stellar/useBlendPosition";

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
