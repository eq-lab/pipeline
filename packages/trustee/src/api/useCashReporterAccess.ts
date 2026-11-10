// spec: docs/frontend/trustee-flows.md#cash-reporter-bookings
import { useQuery } from "@tanstack/react-query";
import {
  readCanCall,
  useStellarWallet,
  type CanCall,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { cashReporterReason, type CashReporterFn } from "@/lib/cashReporter";

export function useCashReporterAccess(fn: CashReporterFn, enabled: boolean) {
  const { address } = useStellarWallet();
  const configured =
    !!ENV.STELLAR_YIELD_MINTER_ID && !!ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID;

  const query = useQuery<CanCall, Error>({
    queryKey: ["cash-reporter-access", address, fn],
    enabled: enabled && !!address && configured,
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      readCanCall({
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        caller: address!,
        target: ENV.STELLAR_YIELD_MINTER_ID,
        fn,
        rpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
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
