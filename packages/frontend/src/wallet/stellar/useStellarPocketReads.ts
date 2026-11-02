// spec: docs/product-specs/staking.md#default-pockets
import { useQueries } from "@tanstack/react-query";
import {
  readPocket,
  readPocketClaimable,
  readPocketClaimed,
  type PocketData,
} from "@pipeline/wallet-connect";
import { networkPassphrase, pocketId, sorobanRpcUrl } from "./chain";

const POLL_MS = 30_000;

export interface StellarPocketRead {
  exists: boolean | undefined;
  balanceRaw: string | undefined;
  claimableRaw: string | undefined;
  claimedRaw: string | undefined;
  error: Error | null;
}

interface Options {
  enabled?: boolean;
}

const queryOptions = {
  retry: false,
  staleTime: POLL_MS,
  refetchInterval: POLL_MS,
} as const;

export function useStellarPocketReads(
  loanIds: string[],
  holder: string | undefined,
  { enabled = true }: Options = {},
): Record<string, StellarPocketRead> {
  const active = enabled && !!pocketId;
  const rpc = { rpcUrl: sorobanRpcUrl, networkPassphrase };

  const pockets = useQueries({
    queries: loanIds.map((id) => ({
      queryKey: ["pocket", "stellar", pocketId, id, "pocket"],
      queryFn: () => readPocket({ pocketId, loanId: Number(id), ...rpc }),
      enabled: active,
      ...queryOptions,
    })),
  });

  const holderEnabled = (i: number) => active && !!holder && !!pockets[i]?.data;

  const claimables = useQueries({
    queries: loanIds.map((id, i) => ({
      queryKey: ["pocket", "stellar", pocketId, id, "claimable", holder],
      queryFn: () =>
        readPocketClaimable({
          pocketId,
          holder: holder as string,
          loanId: Number(id),
          ...rpc,
        }),
      enabled: holderEnabled(i),
      ...queryOptions,
    })),
  });

  const claimeds = useQueries({
    queries: loanIds.map((id, i) => ({
      queryKey: ["pocket", "stellar", pocketId, id, "claimed", holder],
      queryFn: () =>
        readPocketClaimed({
          pocketId,
          holder: holder as string,
          loanId: Number(id),
          ...rpc,
        }),
      enabled: holderEnabled(i),
      ...queryOptions,
    })),
  });

  const out: Record<string, StellarPocketRead> = {};
  loanIds.forEach((id, i) => {
    const pocket = pockets[i]?.data as PocketData | null | undefined;
    const exists = pocket === undefined ? undefined : pocket !== null;
    out[id] = {
      exists,
      balanceRaw: pocket?.balance ?? undefined,
      claimableRaw: exists === false ? undefined : claimables[i]?.data,
      claimedRaw: exists === false ? undefined : claimeds[i]?.data,
      error:
        (pockets[i]?.error as Error | null) ??
        (exists === false ? null : (claimables[i]?.error as Error | null)) ??
        (exists === false ? null : (claimeds[i]?.error as Error | null)) ??
        null,
    };
  });
  return out;
}
