// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { useReadContract, useReadContracts } from "wagmi";
import {
  minterWireOutAbi,
  EVM_WIRE_OUT_STATUS,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const POLL_MS = 30_000;

interface ReadOptions {
  enabled?: boolean;
}

export type EvmWireOutStatus = (typeof EVM_WIRE_OUT_STATUS)[number];

export interface EvmWireOutRead {
  amountRaw: string | undefined;
  status: EvmWireOutStatus | undefined;
  error: Error | null;
}

type WireOutTuple = { lp: string; status: number; amount: bigint };

function minterAddress(): `0x${string}` | undefined {
  const address = ENV.EVM_MINTER_ADDRESS;
  return address && address.toLowerCase() !== ZERO_ADDRESS
    ? address
    : undefined;
}

function isTerminalStatus(status: number | undefined): boolean {
  return status === 1 || status === 2;
}

export function useEvmWireOuts(
  ids: string[],
  { enabled = true }: ReadOptions = {},
): Record<string, EvmWireOutRead> {
  const address = minterAddress();
  const active = enabled && address !== undefined && ids.length > 0;
  const { data } = useReadContracts({
    contracts: ids.map((id) => ({
      address: address as `0x${string}`,
      abi: minterWireOutAbi,
      functionName: "wireOut" as const,
      args: [BigInt(id)] as const,
    })),
    query: {
      enabled: active,
      retry: false,
      staleTime: POLL_MS,
      refetchInterval: (query: {
        state: { data: ReadonlyArray<{ result?: unknown }> | undefined };
      }) => {
        const rows = query.state.data;
        const allTerminal =
          rows !== undefined &&
          rows.length > 0 &&
          rows.every((row) =>
            isTerminalStatus((row.result as WireOutTuple | undefined)?.status),
          );
        return allTerminal ? false : POLL_MS;
      },
    },
  });

  const out: Record<string, EvmWireOutRead> = {};
  ids.forEach((id, i) => {
    const row = data?.[i];
    if (row === undefined) {
      out[id] = { amountRaw: undefined, status: undefined, error: null };
      return;
    }
    if (row.status === "failure") {
      out[id] = {
        amountRaw: undefined,
        status: undefined,
        error: row.error as Error,
      };
      return;
    }
    const tuple = row.result as WireOutTuple;
    out[id] = {
      amountRaw: tuple.amount.toString(),
      status: EVM_WIRE_OUT_STATUS[tuple.status],
      error: null,
    };
  });
  return out;
}

export function useEvmMinterPaused({ enabled = true }: ReadOptions = {}):
  | boolean
  | undefined {
  const address = minterAddress();
  const { data } = useReadContract({
    address,
    abi: minterWireOutAbi,
    functionName: "paused",
    query: {
      enabled: enabled && address !== undefined,
      retry: false,
      staleTime: POLL_MS,
      refetchInterval: POLL_MS,
    },
  });
  return data;
}
