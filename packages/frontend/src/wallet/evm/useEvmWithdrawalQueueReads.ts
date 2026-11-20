// spec: docs/frontend/wallet-flows.md#withdrawal-queue-reads
import { useReadContract } from "wagmi";
import { ENV } from "@/lib/env";
import { erc20Abi } from "./abis/erc20";
import { withdrawalQueueAbi } from "./abis/withdrawalQueue";
import { useDepositManagerAddresses } from "./useDepositManager";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TOTALS_MS = 30_000;
const RATE_MS = 60_000;
const CLAIMABLE_MS = 15_000;

interface ReadOptions {
  enabled?: boolean;
}

export interface UseEvmWithdrawalQueueTotalsResult {
  totalQueued: bigint | undefined;
  totalClaimed: bigint | undefined;
  payoutPerPlusd: bigint | undefined;
  paused: boolean | undefined;
  plusdDecimals: number | undefined;
  usdcDecimals: number | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface UseEvmWithdrawalRequestQueueStateResult {
  position: bigint | undefined;
  claimable: boolean | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface UseEvmClaimPayoutResult {
  data: bigint | undefined;
  isLoading: boolean;
  error: Error | null;
}

function queueAddress(): `0x${string}` | undefined {
  const address = ENV.WITHDRAWAL_QUEUE_ADDRESS;
  return address && address !== ZERO_ADDRESS
    ? (address as `0x${string}`)
    : undefined;
}

export function useEvmWithdrawalQueueTotals({
  enabled = true,
}: ReadOptions = {}): UseEvmWithdrawalQueueTotalsResult {
  const address = queueAddress();
  const active = enabled && address !== undefined;
  const { plusd, usdc } = useDepositManagerAddresses();
  const plusdAddress =
    plusd && plusd !== ZERO_ADDRESS ? (plusd as `0x${string}`) : undefined;
  const usdcAddress =
    usdc && usdc !== ZERO_ADDRESS ? (usdc as `0x${string}`) : undefined;

  const metadata = useReadContract({
    address,
    abi: withdrawalQueueAbi,
    functionName: "queueMetadata",
    query: {
      enabled: active,
      staleTime: TOTALS_MS,
      refetchInterval: TOTALS_MS,
      retry: false,
    },
  });
  const paused = useReadContract({
    address,
    abi: withdrawalQueueAbi,
    functionName: "paused",
    query: {
      enabled: active,
      staleTime: TOTALS_MS,
      refetchInterval: TOTALS_MS,
      retry: false,
    },
  });
  const plusdDecimalsRead = useReadContract({
    address: plusdAddress,
    abi: erc20Abi,
    functionName: "decimals",
    query: {
      enabled: active && plusdAddress !== undefined,
      staleTime: Infinity,
    },
  });
  const plusdDecimals = plusdDecimalsRead.data;
  const payout = useReadContract({
    address,
    abi: withdrawalQueueAbi,
    functionName: "convertToAssets",
    args: [10n ** BigInt(plusdDecimals ?? 0)],
    query: {
      enabled: active && plusdDecimals !== undefined,
      staleTime: RATE_MS,
      refetchInterval: RATE_MS,
      retry: false,
    },
  });
  const usdcDecimals = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "decimals",
    query: {
      enabled: active && usdcAddress !== undefined,
      staleTime: Infinity,
    },
  });

  if (!active) {
    return {
      totalQueued: undefined,
      totalClaimed: undefined,
      payoutPerPlusd: undefined,
      paused: undefined,
      plusdDecimals: undefined,
      usdcDecimals: undefined,
      isLoading: false,
      error: null,
    };
  }
  return {
    totalQueued: metadata.data?.[0],
    totalClaimed: metadata.data?.[1],
    payoutPerPlusd: payout.data,
    paused: paused.data,
    plusdDecimals,
    usdcDecimals: usdcDecimals.data,
    isLoading:
      metadata.isLoading ||
      paused.isLoading ||
      payout.isLoading ||
      usdcDecimals.isLoading ||
      plusdDecimalsRead.isLoading,
    error:
      metadata.error ??
      paused.error ??
      payout.error ??
      usdcDecimals.error ??
      plusdDecimalsRead.error ??
      null,
  };
}

export function useEvmWithdrawalRequestQueueState(
  requestId: bigint | undefined,
  { enabled = true }: ReadOptions = {},
): UseEvmWithdrawalRequestQueueStateResult {
  const address = queueAddress();
  const active = enabled && address !== undefined && requestId !== undefined;
  const args = [requestId ?? 0n] as const;

  const position = useReadContract({
    address,
    abi: withdrawalQueueAbi,
    functionName: "withdrawalRequestQueued",
    args,
    query: { enabled: active, staleTime: Infinity, retry: false },
  });
  const claimable = useReadContract({
    address,
    abi: withdrawalQueueAbi,
    functionName: "isClaimable",
    args,
    query: {
      enabled: active,
      staleTime: CLAIMABLE_MS,
      refetchInterval: CLAIMABLE_MS,
      retry: false,
    },
  });

  if (!active) {
    return {
      position: undefined,
      claimable: undefined,
      isLoading: false,
      error: null,
    };
  }
  return {
    position: position.data,
    claimable: claimable.data,
    isLoading: position.isLoading || claimable.isLoading,
    error: position.error ?? claimable.error ?? null,
  };
}

export function useEvmClaimPayout(
  amountRaw: bigint | undefined,
  { enabled = true }: ReadOptions = {},
): UseEvmClaimPayoutResult {
  const address = queueAddress();
  const active = enabled && address !== undefined && amountRaw !== undefined;

  const payout = useReadContract({
    address,
    abi: withdrawalQueueAbi,
    functionName: "convertToAssets",
    args: [amountRaw ?? 0n],
    query: { enabled: active, staleTime: RATE_MS, retry: false },
  });

  if (!active) return { data: undefined, isLoading: false, error: null };
  return {
    data: payout.data,
    isLoading: payout.isLoading,
    error: payout.error ?? null,
  };
}
