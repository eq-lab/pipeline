// spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer
import { useQuery } from "@tanstack/react-query";
import { getErc20Balance, getSacBalance } from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

const SAC_DECIMALS = 7;

function rawToDisplay(raw: bigint, decimals: number): string {
  const factor = 10n ** BigInt(decimals);
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

export function useUsdcCustodyBalance(
  chainId: number,
): UseUsdcCustodyBalanceResult {
  const arm =
    chainId === ENV.STELLAR_CHAIN_ID
      ? "stellar"
      : chainId === ENV.EVM_CHAIN_ID
        ? "evm"
        : null;
  const rpcUrl = arm === "evm" ? ENV.EVM_RPC_URL : ENV.STELLAR_RPC_URL;
  const tokenId = arm === "evm" ? ENV.EVM_USDC_ADDRESS : ENV.STELLAR_USDC_ID;
  const custodyId =
    arm === "evm" ? ENV.EVM_USDC_CUSTODY_ADDRESS : ENV.STELLAR_USDC_CUSTODY_ID;
  const isConfigured = arm !== null && !!tokenId && !!custodyId;

  const query = useQuery<string, Error>({
    queryKey: ["usdcCustodyBalance", chainId, rpcUrl, tokenId, custodyId],
    queryFn: async () => {
      if (arm === "evm") {
        const { raw, decimals } = await getErc20Balance({
          rpcUrl,
          tokenAddress: tokenId,
          account: custodyId,
        });
        return rawToDisplay(raw, decimals);
      }
      const raw = await getSacBalance({
        sorobanRpcUrl: rpcUrl,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
        sacContractId: tokenId,
        account: custodyId,
      });
      return rawToDisplay(raw, SAC_DECIMALS);
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
