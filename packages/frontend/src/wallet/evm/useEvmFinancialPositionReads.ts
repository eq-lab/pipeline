// spec: docs/product-specs/dashboards-balance-sheet-sources.md#balance-sheet-sources
import { useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { ENV } from "@/lib/env";
import { depositManagerAbi } from "./abis/depositManager";
import { erc20Abi } from "./abis/erc20";
import { useDepositManagerAddresses } from "./useDepositManager";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const POLL_MS = 30_000;

export interface UseEvmTokenReadResult {
  data: string | undefined;
  isLoading: boolean;
  error: Error | null;
}

interface ReadOptions {
  enabled?: boolean;
}

function usableAddress(address: string | undefined): address is `0x${string}` {
  return address !== undefined && address !== ZERO_ADDRESS;
}

export function useEvmPlusdTotalSupply({
  enabled = true,
}: ReadOptions = {}): UseEvmTokenReadResult {
  const { plusd } = useDepositManagerAddresses();
  const token = usableAddress(plusd) ? plusd : undefined;
  const active = enabled && token !== undefined;

  const supply = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "totalSupply",
    query: { enabled: active, staleTime: POLL_MS, refetchInterval: POLL_MS },
  });
  const decimals = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: active, staleTime: Infinity },
  });

  return toResult(supply, decimals);
}

export function useEvmUsdcCustodyBalance({
  enabled = true,
}: ReadOptions = {}): UseEvmTokenReadResult {
  const { usdc } = useDepositManagerAddresses();
  const token = usableAddress(usdc) ? usdc : undefined;
  const manager = usableAddress(ENV.DEPOSIT_MANAGER_ADDRESS)
    ? ENV.DEPOSIT_MANAGER_ADDRESS
    : undefined;

  const custodian = useReadContract({
    address: manager,
    abi: depositManagerAbi,
    functionName: "custodian",
    query: {
      enabled: enabled && manager !== undefined,
      staleTime: Infinity,
      retry: false,
    },
  });
  const custodianAddress = usableAddress(custodian.data)
    ? custodian.data
    : undefined;
  const active =
    enabled && token !== undefined && custodianAddress !== undefined;

  const balance = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [custodianAddress ?? (ZERO_ADDRESS as `0x${string}`)],
    query: { enabled: active, staleTime: POLL_MS, refetchInterval: POLL_MS },
  });
  const decimals = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: active, staleTime: Infinity },
  });

  const result = toResult(balance, decimals);
  return {
    ...result,
    isLoading: result.isLoading || (enabled && custodian.isLoading),
    error: result.error ?? custodian.error ?? null,
  };
}

interface ReadLike<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
}

function toResult(
  value: ReadLike<bigint>,
  decimals: ReadLike<number>,
): UseEvmTokenReadResult {
  const ready = value.data !== undefined && decimals.data !== undefined;
  return {
    data: ready ? formatUnits(value.data!, decimals.data!) : undefined,
    isLoading: value.isLoading || decimals.isLoading,
    error: value.error ?? decimals.error ?? null,
  };
}
