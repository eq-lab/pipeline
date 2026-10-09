// spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer
import { useQuery } from "@tanstack/react-query";
import { getSacBalance } from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

const SAC_DECIMALS = 7;

function sacRawToDisplay(raw: bigint, decimals: number = SAC_DECIMALS): string {
  const factor = BigInt(10 ** decimals);
  const whole = raw / factor;
  const frac = raw % factor;
  const fracStr = frac.toString().padStart(decimals, "0");
  return `${whole}.${fracStr}`;
}

export interface UseUsdcCustodyBalanceResult {
  data: string | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function useUsdcCustodyBalance(): UseUsdcCustodyBalanceResult {
  const isConfigured = !!ENV.STELLAR_USDC_ID && !!ENV.STELLAR_USDC_CUSTODY_ID;

  const query = useQuery<string, Error>({
    queryKey: [
      "usdcCustodyBalance",
      ENV.STELLAR_RPC_URL,
      ENV.STELLAR_USDC_ID,
      ENV.STELLAR_USDC_CUSTODY_ID,
    ],
    queryFn: async () => {
      const raw = await getSacBalance({
        sorobanRpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
        sacContractId: ENV.STELLAR_USDC_ID,
        account: ENV.STELLAR_USDC_CUSTODY_ID,
      });
      return sacRawToDisplay(raw);
    },
    enabled: isConfigured,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  if (!isConfigured) {
    return { data: undefined, isLoading: false, error: null };
  }

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}
