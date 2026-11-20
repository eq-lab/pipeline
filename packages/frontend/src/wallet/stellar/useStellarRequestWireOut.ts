// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { useCallback, useRef, useState } from "react";
import { requestWireOut } from "@pipeline/wallet-connect";
import { toError } from "@/utils/userError";
import { minterId, networkPassphrase, sorobanRpcUrl } from "./chain";
import { useStellarWallet } from "./useStellarWallet";

export interface UseRequestWireOutResult {
  request: (amountRaw: bigint) => void;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  wireOutId: string | undefined;
  hash: string | undefined;
  reset: () => void;
}

export function useStellarRequestWireOut(): UseRequestWireOutResult {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [wireOutId, setWireOutId] = useState<string | undefined>(undefined);
  const [hash, setHash] = useState<string | undefined>(undefined);
  const inFlight = useRef(false);

  const reset = useCallback(() => {
    setIsPending(false);
    setIsSuccess(false);
    setError(null);
    setWireOutId(undefined);
    setHash(undefined);
  }, []);

  const request = useCallback(
    (amountRaw: bigint) => {
      if (!minterId) {
        setError(new Error("Minter not configured"));
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
      setWireOutId(undefined);
      setHash(undefined);

      void (async () => {
        try {
          const result = await requestWireOut({
            minterId,
            lp: address,
            amountRaw,
            rpcUrl: sorobanRpcUrl,
            networkPassphrase,
            signTransaction,
          });
          setHash(result.hash);
          setWireOutId(
            result.wireOutId === null ? undefined : String(result.wireOutId),
          );
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

  return { request, isPending, isSuccess, error, wireOutId, hash, reset };
}
