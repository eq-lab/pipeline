// spec: docs/product-specs/staking.md#default-pockets
import { useCallback, useRef, useState } from "react";
import { claimPocket } from "@pipeline/wallet-connect";
import { toError } from "@/utils/userError";
import { networkPassphrase, pocketId, sorobanRpcUrl } from "./chain";
import { useStellarWallet } from "./useStellarWallet";

export interface UsePocketClaimResult {
  claim: (loanId: string) => void;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  loanId: string | undefined;
  amountRaw: string | undefined;
  hash: string | undefined;
  reset: () => void;
}

export function useStellarPocketClaim(): UsePocketClaimResult {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loanId, setLoanId] = useState<string | undefined>(undefined);
  const [amountRaw, setAmountRaw] = useState<string | undefined>(undefined);
  const [hash, setHash] = useState<string | undefined>(undefined);
  const inFlight = useRef(false);

  const reset = useCallback(() => {
    setIsPending(false);
    setIsSuccess(false);
    setError(null);
    setLoanId(undefined);
    setAmountRaw(undefined);
    setHash(undefined);
  }, []);

  const claim = useCallback(
    (id: string) => {
      if (!pocketId) {
        setError(new Error("Pocket not configured"));
        return;
      }
      if (!isConnected || !address) {
        setError(new Error("Stellar wallet not connected"));
        return;
      }
      if (inFlight.current) return;
      inFlight.current = true;
      setIsPending(true);
      setIsSuccess(false);
      setError(null);
      setLoanId(id);
      setAmountRaw(undefined);
      setHash(undefined);

      void (async () => {
        try {
          const result = await claimPocket({
            pocketId,
            holder: address,
            loanId: Number(id),
            rpcUrl: sorobanRpcUrl,
            networkPassphrase,
            signTransaction,
          });
          setHash(result.hash);
          setAmountRaw(result.amount ?? undefined);
          setIsSuccess(true);
        } catch (err) {
          setError(toError(err));
        } finally {
          inFlight.current = false;
          setIsPending(false);
        }
      })();
    },
    [address, isConnected, signTransaction],
  );

  return {
    claim,
    isPending,
    isSuccess,
    error,
    loanId,
    amountRaw,
    hash,
    reset,
  };
}
