// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  readMinterPaused,
  readMinterWireOut,
  type MinterWireOut,
} from "@pipeline/wallet-connect";
import { minterId, networkPassphrase, sorobanRpcUrl } from "./chain";

const POLL_MS = 30_000;

interface ReadOptions {
  enabled?: boolean;
}

export interface StellarWireOutRead {
  data: MinterWireOut | undefined;
  error: Error | null;
}

function isTerminal(status: MinterWireOut["status"] | undefined): boolean {
  return status === "Settled" || status === "Cancelled";
}

export function useStellarWireOuts(
  ids: string[],
  { enabled = true }: ReadOptions = {},
): Record<string, StellarWireOutRead> {
  const active = enabled && !!minterId;
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["stellarWireOut", minterId, id],
      queryFn: () =>
        readMinterWireOut({
          minterId,
          id: Number(id),
          rpcUrl: sorobanRpcUrl,
          networkPassphrase,
        }),
      enabled: active,
      retry: false,
      staleTime: (query: { state: { data: MinterWireOut | undefined } }) =>
        isTerminal(query.state.data?.status) ? Infinity : POLL_MS,
      refetchInterval: (query: {
        state: { data: MinterWireOut | undefined };
      }) => (isTerminal(query.state.data?.status) ? false : POLL_MS),
    })),
  });
  const out: Record<string, StellarWireOutRead> = {};
  ids.forEach((id, i) => {
    const r = results[i];
    out[id] = { data: r?.data, error: (r?.error as Error | null) ?? null };
  });
  return out;
}

export function useStellarMinterPaused({ enabled = true }: ReadOptions = {}):
  | boolean
  | undefined {
  const query = useQuery<boolean, Error>({
    queryKey: ["stellarMinterPaused", minterId],
    queryFn: () =>
      readMinterPaused({
        minterId,
        rpcUrl: sorobanRpcUrl,
        networkPassphrase,
      }),
    enabled: enabled && !!minterId,
    retry: false,
    staleTime: POLL_MS,
    refetchInterval: POLL_MS,
  });
  return query.data;
}
