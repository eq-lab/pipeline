/**
 * React Query mutation hook — wraps `@pipeline/wallet-connect`'s `drawLoan`:
 * the trustee-wallet-signed on-chain `draw_loan` mint that runs before the
 * DB review flip on Approve (see `-useOriginationReview.ts`).
 *
 * The Trustee app cannot import `@stellar/stellar-sdk` directly (TD-33, no
 * `src/wallet/**` carve-out) — all Soroban build/simulate/sign/submit/poll
 * machinery lives in the shared package; this hook only wires env values +
 * the connected wallet in, guards the unconfigured/disconnected cases, and
 * surfaces `drawLoan`'s progress stages for the Approve-button UX.
 *
 * spec: docs/frontend/trustee-flows.md#chain-first-approve-ordering-831.
 */
import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  drawLoan,
  useStellarWallet,
  type SubmitLoanRequest,
  type DrawLoanStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

export type { DrawLoanStage };

export interface UseDrawLoanInput {
  loanData: SubmitLoanRequest;
}

export interface DrawLoanOutcome {
  hash: string;
  /** On-chain id of the loan just drawn (#876); `null` if not recoverable. */
  loanId: number | null;
}

export interface UseDrawLoanResult {
  mutateAsync: (input: UseDrawLoanInput) => Promise<DrawLoanOutcome>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  /** The in-flight progress stage, or `null` before/after a mint attempt. */
  stage: DrawLoanStage | null;
  /** Id of the loan drawn in this session, or `null` before success / if not recoverable (#876). */
  mintedLoanId: number | null;
  reset: () => void;
}

/**
 * Mutation hook for the Approve action's on-chain `draw_loan` mint.
 *
 * Guards (both throw BEFORE any RPC call, mirroring `useCapitalWalletBalance`'s
 * unconfigured convention):
 *   - `ENV.STELLAR_LOAN_REGISTRY_ID` / `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID`
 *     unset → "On-chain minting isn't configured for this environment."
 *   - Stellar wallet not connected → "Connect your trustee wallet to approve
 *     on-chain."
 */
export function useDrawLoan(): UseDrawLoanResult {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<DrawLoanStage | null>(null);

  const mutation = useMutation<DrawLoanOutcome, Error, UseDrawLoanInput>({
    mutationFn: async ({ loanData }) => {
      setStage(null);

      if (
        !ENV.STELLAR_LOAN_REGISTRY_ID ||
        !ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
      ) {
        throw new Error(
          "On-chain minting is not configured for this environment.",
        );
      }
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }

      return drawLoan({
        executorId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        targetId: ENV.STELLAR_LOAN_REGISTRY_ID,
        caller: address,
        loanData,
        rpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
        signTransaction,
        onStageChange: setStage,
      });
    },
  });

  const reset = useCallback(() => {
    setStage(null);
    mutation.reset();
  }, [mutation]);

  return {
    // `mutation.mutateAsync` is already referentially stable across renders
    // (React Query), so no extra `useCallback` wrapper is needed here.
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    stage,
    mintedLoanId: mutation.data?.loanId ?? null,
    reset,
  };
}
