// spec: docs/frontend/wallet-flows.md#withdrawal-queue-reads
import { useQuery } from "@tanstack/react-query";
import { withdrawalQueueId } from "./chain";
import { createWithdrawalQueueClient } from "./contracts/withdrawalQueue";

const TOTALS_MS = 30_000;
const RATE_MS = 60_000;
const CLAIMABLE_MS = 15_000;

interface ReadOptions {
  enabled?: boolean;
}

export interface UseStellarWithdrawalQueueTotalsResult {
  totalQueued: bigint | undefined;
  totalClaimed: bigint | undefined;
  rate: bigint | undefined;
  paused: boolean | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface UseStellarWithdrawalRequestQueueStateResult {
  position: bigint | undefined;
  claimable: boolean | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface UseStellarClaimPayoutArgs {
  requestId: bigint | undefined;
  signatureBytes: Uint8Array | undefined;
  deadline: bigint | undefined;
  sender: string | undefined;
  enabled?: boolean;
}

export interface UseStellarClaimPayoutResult {
  data: bigint | undefined;
  isLoading: boolean;
  error: Error | null;
}

function client() {
  const c = createWithdrawalQueueClient(withdrawalQueueId);
  if (!c) throw new Error("Stellar withdrawal queue is not configured");
  return c;
}

export function useStellarWithdrawalQueueTotals({
  enabled = true,
}: ReadOptions = {}): UseStellarWithdrawalQueueTotalsResult {
  const active = enabled && !!withdrawalQueueId;
  const base = { enabled: active, retry: false } as const;

  const queued = useQuery<bigint, Error>({
    queryKey: ["stellarWqTotalQueued", withdrawalQueueId],
    queryFn: () => client().totalQueued(),
    staleTime: TOTALS_MS,
    refetchInterval: TOTALS_MS,
    ...base,
  });
  const claimed = useQuery<bigint, Error>({
    queryKey: ["stellarWqTotalClaimed", withdrawalQueueId],
    queryFn: () => client().totalClaimed(),
    staleTime: TOTALS_MS,
    refetchInterval: TOTALS_MS,
    ...base,
  });
  const rate = useQuery<bigint, Error>({
    queryKey: ["stellarWqRate", withdrawalQueueId],
    queryFn: () => client().rate(),
    staleTime: RATE_MS,
    refetchInterval: RATE_MS,
    ...base,
  });
  const paused = useQuery<boolean, Error>({
    queryKey: ["stellarWqPaused", withdrawalQueueId],
    queryFn: () => client().paused(),
    staleTime: TOTALS_MS,
    refetchInterval: TOTALS_MS,
    ...base,
  });

  if (!active) {
    return {
      totalQueued: undefined,
      totalClaimed: undefined,
      rate: undefined,
      paused: undefined,
      isLoading: false,
      error: null,
    };
  }
  return {
    totalQueued: queued.data,
    totalClaimed: claimed.data,
    rate: rate.data,
    paused: paused.data,
    isLoading:
      queued.isLoading ||
      claimed.isLoading ||
      rate.isLoading ||
      paused.isLoading,
    error: queued.error ?? claimed.error ?? rate.error ?? paused.error ?? null,
  };
}

export function useStellarWithdrawalRequestQueueState(
  requestId: bigint | undefined,
  { enabled = true }: ReadOptions = {},
): UseStellarWithdrawalRequestQueueStateResult {
  const active = enabled && !!withdrawalQueueId && requestId !== undefined;
  const id = requestId?.toString();

  const position = useQuery<bigint, Error>({
    queryKey: ["stellarWqRequestQueued", withdrawalQueueId, id],
    queryFn: () => client().withdrawalRequestQueued(requestId as bigint),
    enabled: active,
    staleTime: Infinity,
    retry: false,
  });
  const claimable = useQuery<boolean, Error>({
    queryKey: ["stellarWqClaimable", withdrawalQueueId, id],
    queryFn: () => client().claimable(requestId as bigint),
    enabled: active,
    staleTime: CLAIMABLE_MS,
    refetchInterval: CLAIMABLE_MS,
    retry: false,
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

export function useStellarClaimPayout({
  requestId,
  signatureBytes,
  deadline,
  sender,
  enabled = true,
}: UseStellarClaimPayoutArgs): UseStellarClaimPayoutResult {
  const active =
    enabled &&
    !!withdrawalQueueId &&
    requestId !== undefined &&
    signatureBytes !== undefined &&
    deadline !== undefined &&
    !!sender;

  const query = useQuery<bigint, Error>({
    queryKey: [
      "stellarWqClaimPayout",
      withdrawalQueueId,
      requestId?.toString(),
      deadline?.toString(),
      sender,
    ],
    queryFn: () =>
      client().simulateClaimPayout(
        sender as string,
        requestId as bigint,
        signatureBytes as Uint8Array,
        deadline as bigint,
      ),
    enabled: active,
    staleTime: RATE_MS,
    retry: false,
  });

  if (!active) return { data: undefined, isLoading: false, error: null };
  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}
