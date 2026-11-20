// spec: docs/frontend/trustee-flows.md#cash-reporter-bookings
import { useQuery } from "@tanstack/react-query";
import {
  readCanCall,
  readEvmCanCall,
  type CanCall,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import {
  EVM_CASH_REPORTER_SELECTORS,
  cashReporterReason,
  type CashReporterFn,
} from "@/lib/cashReporter";
import { useChainWallet } from "@/lib/chainWallet";
import { isStellarTarget } from "@/lib/targetChains";

export function useCashReporterAccess(
  fn: CashReporterFn,
  enabled: boolean,
  chainId?: number | null,
) {
  const { address } = useChainWallet(chainId);
  const stellar = isStellarTarget(chainId);
  const evmSelector = EVM_CASH_REPORTER_SELECTORS[fn];
  const configured = stellar
    ? !!ENV.STELLAR_YIELD_MINTER_ID && !!ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
    : !!ENV.EVM_MINTER_ADDRESS &&
      !!ENV.EVM_ACCESS_MANAGER_ADDRESS &&
      evmSelector != null;

  const query = useQuery<CanCall, Error>({
    queryKey: ["cash-reporter-access", address, fn],
    enabled: enabled && !!address && configured,
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      stellar
        ? readCanCall({
            accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
            caller: address!,
            target: ENV.STELLAR_YIELD_MINTER_ID,
            fn,
            rpcUrl: ENV.STELLAR_RPC_URL,
            networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
          })
        : readEvmCanCall({
            accessManager: ENV.EVM_ACCESS_MANAGER_ADDRESS,
            caller: address!,
            target: ENV.EVM_MINTER_ADDRESS,
            selector: evmSelector!(),
          }),
  });

  const reason = !enabled
    ? null
    : !address
      ? "Connect your trustee wallet to check the Cash reporter role."
      : cashReporterReason(fn, {
          access: query.data,
          isPending: query.isPending || !configured,
          isError: query.isError,
        });

  return { reason, query };
}
