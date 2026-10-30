// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { useCallback, useMemo, useState } from "react";
import { parseEventLogs } from "viem";
import {
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { minterWireOutAbi } from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { estimateGasCapped } from "./estimateGas";
import { simulateOrFail } from "./simulate";
import { useEvmWallet } from "./useEvmWallet";
import type { UseRequestWireOutResult } from "../stellar/useStellarRequestWireOut";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function useEvmRequestWireOut(): UseRequestWireOutResult {
  const minter = ENV.EVM_MINTER_ADDRESS;
  const isUnconfigured = !minter || minter.toLowerCase() === ZERO_ADDRESS;
  const { address, isConnected } = useEvmWallet();
  const publicClient = usePublicClient();
  const wagmiWrite = useWriteContract();
  const [writeError, setWriteError] = useState<Error | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);

  const receipt = useWaitForTransactionReceipt({
    hash: wagmiWrite.data,
    query: {
      enabled: isConnected && address !== undefined && !!wagmiWrite.data,
    },
  });

  const wireOutId = useMemo(() => {
    const logs = receipt.data?.logs;
    if (!logs || address === undefined) return undefined;
    try {
      const match = parseEventLogs({
        abi: minterWireOutAbi,
        eventName: "WireOutRequested",
        logs,
      }).find(
        (e) =>
          e.address.toLowerCase() === minter.toLowerCase() &&
          e.args.lp.toLowerCase() === address.toLowerCase(),
      );
      return match?.args.id.toString();
    } catch {
      return undefined;
    }
  }, [receipt.data, address, minter]);

  const { writeContract, reset: resetWagmi } = wagmiWrite;

  const request = useCallback(
    (amountRaw: bigint) => {
      if (isUnconfigured) {
        setWriteError(new Error("Minter not configured"));
        return;
      }
      if (isEstimating) return;
      setWriteError(null);

      void (async () => {
        setIsEstimating(true);
        const call = {
          publicClient,
          account: address,
          abi: minterWireOutAbi,
          address: minter,
          functionName: "requestWireOut",
          args: [amountRaw],
        } as const;
        const simulated = await simulateOrFail(call);
        if (!simulated.ok) {
          setIsEstimating(false);
          setWriteError(simulated.error);
          return;
        }
        const estimated = await estimateGasCapped(call);
        setIsEstimating(false);
        if (!estimated.ok) {
          setWriteError(estimated.error);
          return;
        }
        writeContract({
          abi: minterWireOutAbi,
          address: minter,
          functionName: "requestWireOut",
          args: [amountRaw],
          gas: estimated.gas,
          chainId: ENV.EVM_CHAIN_ID,
        });
      })();
    },
    [
      isUnconfigured,
      isEstimating,
      publicClient,
      address,
      minter,
      writeContract,
    ],
  );

  const reset = useCallback(() => {
    setWriteError(null);
    resetWagmi();
  }, [resetWagmi]);

  const hash = wagmiWrite.data;
  return {
    request,
    isPending:
      isEstimating ||
      wagmiWrite.isPending ||
      (hash !== undefined && receipt.isLoading),
    isSuccess: receipt.isSuccess,
    error: (writeError ?? wagmiWrite.error ?? receipt.error) as Error | null,
    wireOutId,
    hash,
    reset,
  };
}
