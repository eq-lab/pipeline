/**
 * Public surface of the wallet module.
 *
 * Only import from this barrel outside of `src/wallet/`.
 * Do NOT import wagmi, viem, @reown/appkit, or @tanstack/react-query directly
 * from outside this module — the ESLint `no-restricted-imports` rule enforces
 * this boundary.
 */
export { WalletProvider } from "./WalletProvider";
export { useWallet, useContractRead } from "./useWallet";
export type {
  WalletState,
  UseContractReadArgs,
  ContractReadResult,
} from "./useWallet";
export {
  useDepositManagerAddresses,
  useDepositManagerMinDeposit,
  useRequestDeposit,
  useClaim,
} from "./useDepositManager";
export type {
  DepositManagerAddressesResult,
  DepositManagerMinDepositResult,
  RequestDepositResult,
  ClaimResult,
} from "./useDepositManager";
export { useRequestWithdrawal, useClaimWithdrawal } from "./useWithdrawalQueue";
export type {
  RequestWithdrawalResult,
  ClaimWithdrawalResult,
} from "./useWithdrawalQueue";
export {
  useStakedPlusdAsset,
  useStakedPlusdConvertToShares,
  useStakedPlusdConvertToAssets,
  useStake,
  useUnstake,
} from "./useStakedPlusd";
export type {
  StakedPlusdAssetResult,
  StakedPlusdConvertResult,
  StakeResult,
  UnstakeResult,
} from "./useStakedPlusd";
export { useApproval } from "./useApproval";
export type { UseApprovalResult, UseApprovalArgs } from "./useApproval";
export { useToken } from "./useToken";
export type { UseTokenArgs, UseTokenResult } from "./useToken";
export {
  isMockKeyPresent,
  readMock,
  useMock,
  subscribeMock,
  parseJson,
} from "./mock";
export { parseUnits, formatUnits } from "./units";
export {
  readTermsAcknowledged,
  useTermsAcknowledgement,
} from "./useTermsAcknowledgement";
export type { UseTermsAcknowledgementResult } from "./useTermsAcknowledgement";
export { useNetworkFeeEstimate, formatFeeEth } from "./useNetworkFeeEstimate";
export type {
  UseNetworkFeeEstimateResult,
  NetworkFeeDirection,
} from "./useNetworkFeeEstimate";
