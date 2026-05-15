/**
 * Public surface of the wallet module.
 *
 * Only import from this barrel outside of `src/wallet/`.
 * Do NOT import wagmi, viem, @reown/appkit, or @tanstack/react-query directly
 * from outside this module — the ESLint `no-restricted-imports` rule enforces
 * this boundary.
 */
export { WalletProvider } from "./WalletProvider";
export { useWallet, useUsdcBalance, useContractRead } from "./useWallet";
export type {
  WalletState,
  UsdcBalanceResult,
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
export { useApproval } from "./useApproval";
export type { UseApprovalResult, UseApprovalArgs } from "./useApproval";
