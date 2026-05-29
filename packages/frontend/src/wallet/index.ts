/**
 * Public surface of the wallet module.
 *
 * Only import from this barrel outside of `src/wallet/evm/`.
 * Do NOT import wagmi, viem, @reown/appkit, or @tanstack/react-query directly
 * from outside this module — the ESLint `no-restricted-imports` rule enforces
 * this boundary.
 */
export { EvmWalletProvider } from "./evm/EvmWalletProvider";
export { useEvmWallet, useContractRead } from "./evm/useEvmWallet";
export type {
  WalletState,
  UseContractReadArgs,
  ContractReadResult,
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
  RequestDepositResult,
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
} from "./evm/useTermsAcknowledgement";
export type { UseTermsAcknowledgementResult } from "./evm/useTermsAcknowledgement";
export {
  useNetworkFeeEstimate,
  formatFeeEth,
} from "./evm/useNetworkFeeEstimate";
export type {
  UseNetworkFeeEstimateResult,
  NetworkFeeDirection,
} from "./evm/useNetworkFeeEstimate";
