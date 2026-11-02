// spec: docs/product-specs/staking.md#default-pockets
import { ContractFunctionRevertedError, type BaseError } from "viem";
import { useReadContracts } from "wagmi";
import { pocketAbi } from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const POLL_MS = 30_000;

export interface EvmPocketRead {
  exists: boolean | undefined;
  balanceRaw: string | undefined;
  claimableRaw: string | undefined;
  claimedRaw: string | undefined;
  error: Error | null;
}

interface Options {
  enabled?: boolean;
}

function pocketAddress(): `0x${string}` | undefined {
  const address = ENV.EVM_POCKET_ADDRESS;
  return address && address.toLowerCase() !== ZERO_ADDRESS
    ? address
    : undefined;
}

function isRevert(error: unknown): boolean {
  const found = (error as BaseError | undefined)?.walk?.(
    (e) => e instanceof ContractFunctionRevertedError,
  );
  return found instanceof ContractFunctionRevertedError;
}

type Row = { status: "success" | "failure"; result?: unknown; error?: unknown };

export function useEvmPocketReads(
  loanIds: string[],
  holder: string | undefined,
  { enabled = true }: Options = {},
): Record<string, EvmPocketRead> {
  const address = pocketAddress();
  const active = enabled && address !== undefined && loanIds.length > 0;
  const holderArg = (holder ?? ZERO_ADDRESS) as `0x${string}`;
  const contracts = loanIds.flatMap((id) => {
    const loanId = BigInt(id);
    const base = { address: address as `0x${string}`, abi: pocketAbi };
    return [
      { ...base, functionName: "pocket" as const, args: [loanId] as const },
      {
        ...base,
        functionName: "claimable" as const,
        args: [holderArg, loanId] as const,
      },
      {
        ...base,
        functionName: "claimed" as const,
        args: [holderArg, loanId] as const,
      },
    ];
  });

  const { data } = useReadContracts({
    contracts,
    query: {
      enabled: active,
      retry: false,
      staleTime: POLL_MS,
      refetchInterval: POLL_MS,
    },
  });

  const out: Record<string, EvmPocketRead> = {};
  loanIds.forEach((id, i) => {
    const pocket = data?.[i * 3] as Row | undefined;
    const claimable = data?.[i * 3 + 1] as Row | undefined;
    const claimed = data?.[i * 3 + 2] as Row | undefined;
    if (pocket === undefined) {
      out[id] = {
        exists: undefined,
        balanceRaw: undefined,
        claimableRaw: undefined,
        claimedRaw: undefined,
        error: null,
      };
      return;
    }
    if (pocket.status === "failure") {
      const reverted = isRevert(pocket.error);
      out[id] = {
        exists: reverted ? false : undefined,
        balanceRaw: undefined,
        claimableRaw: undefined,
        claimedRaw: undefined,
        error: reverted ? null : (pocket.error as Error),
      };
      return;
    }
    const tuple = pocket.result as { balance: bigint };
    const holderRow = (row: Row | undefined) =>
      row?.status === "success" ? (row.result as bigint).toString() : undefined;
    out[id] = {
      exists: true,
      balanceRaw: tuple.balance.toString(),
      claimableRaw: holder ? holderRow(claimable) : undefined,
      claimedRaw: holder ? holderRow(claimed) : undefined,
      error:
        claimable?.status === "failure"
          ? (claimable.error as Error)
          : claimed?.status === "failure"
            ? (claimed.error as Error)
            : null,
    };
  });
  return out;
}
