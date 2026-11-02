// spec: docs/product-specs/staking.md#default-pockets
import { useCallback, useState } from "react";
import {
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { pocketAbi } from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { estimateGasCapped } from "./estimateGas";
import { simulateOrFail } from "./simulate";
import { useEvmWallet } from "./useEvmWallet";
import type { UsePocketClaimResult } from "../stellar/useStellarPocketClaim";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function useEvmPocketClaim(): UsePocketClaimResult {
  const pocket = ENV.EVM_POCKET_ADDRESS;
  const isUnconfigured = !pocket || pocket.toLowerCase() === ZERO_ADDRESS;
  const { address, isConnected } = useEvmWallet();
  const publicClient = usePublicClient();
  const wagmiWrite = useWriteContract();
  const [writeError, setWriteError] = useState<Error | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [loanId, setLoanId] = useState<string | undefined>(undefined);

  const receipt = useWaitForTransactionReceipt({
    hash: wagmiWrite.data,
    query: {
      enabled: isConnected && address !== undefined && !!wagmiWrite.data,
    },
  });

  const { writeContract, reset: resetWagmi } = wagmiWrite;

  const claim = useCallback(
    (id: string) => {
      if (isUnconfigured) {
        setWriteError(new Error("Pocket not configured"));
        return;
      }
      if (!isConnected || !address) {
        setWriteError(new Error("EVM wallet not connected"));
        return;
      }
      if (isEstimating) return;
      setWriteError(null);
      setLoanId(id);

      void (async () => {
        setIsEstimating(true);
        const args = [address, BigInt(id)] as const;
        const call = {
          publicClient,
          account: address,
          abi: pocketAbi,
          address: pocket,
          functionName: "claim",
          args,
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
          abi: pocketAbi,
          address: pocket,
          functionName: "claim",
          args,
          gas: estimated.gas,
          chainId: ENV.EVM_CHAIN_ID,
        });
      })();
    },
    [
      isUnconfigured,
      isConnected,
      isEstimating,
      publicClient,
      address,
      pocket,
      writeContract,
    ],
  );

  const reset = useCallback(() => {
    setWriteError(null);
    setLoanId(undefined);
    resetWagmi();
  }, [resetWagmi]);

  const hash = wagmiWrite.data;
  return {
    claim,
    isPending:
      isEstimating ||
      wagmiWrite.isPending ||
      (hash !== undefined && receipt.isLoading),
    isSuccess: receipt.isSuccess,
    error: (writeError ?? wagmiWrite.error ?? receipt.error) as Error | null,
    loanId,
    amountRaw: undefined,
    hash,
    reset,
  };
}
