/**
 * Shared simulate pre-flight helper for wallet write hooks.
 *
 * Wraps `publicClient.simulateContract` (`eth_call`) so hooks can detect
 * reverts — with decoded custom-error names — before committing to the
 * `estimateGasCapped` → `writeContract` path. Some public RPCs (e.g. Hoodi
 * via `publicnode`) strip revert data on `eth_estimateGas` but return it on
 * `eth_call`; this pre-flight makes the error path robust against that
 * behaviour and surfaces the real revert reason via viem's
 * `ContractFunctionExecutionError.shortMessage`.
 *
 * See: https://github.com/eq-lab/pipeline/issues/350
 * See also: `estimateGas.ts` — the subsequent gas estimation step.
 */
import type { Abi, PublicClient } from "viem";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SimulateArgs = {
  /** viem PublicClient from `usePublicClient()`. Must not be undefined when this helper is called on the real path. */
  publicClient: PublicClient | undefined;
  /** Connected wallet address from `useWallet()`. */
  account: `0x${string}` | undefined;
  /** Contract ABI. */
  abi: Abi;
  /** Contract address. */
  address: `0x${string}`;
  /** Function to call. */
  functionName: string;
  /** Encoded function arguments. */
  args: readonly unknown[];
};

export type SimulateResult = { ok: true } | { ok: false; error: Error };

// ── simulateOrFail ─────────────────────────────────────────────────────────────

/**
 * Runs a read-only `eth_call` simulation of a contract write to detect reverts
 * before committing gas estimation and the actual write.
 *
 * Returns `{ ok: true }` when the call succeeds, or `{ ok: false, error }`
 * when it reverts or the client/account is missing. On revert viem provides a
 * `ContractFunctionExecutionError` whose `.shortMessage` already contains the
 * decoded error name when the ABI includes the matching `error` entry — no
 * custom decoding required.
 *
 * The caller is responsible for setting the hook's `error` state and skipping
 * `estimateGasCapped` + `writeContract` on failure.
 */
export async function simulateOrFail({
  publicClient,
  account,
  abi,
  address,
  functionName,
  args,
}: SimulateArgs): Promise<SimulateResult> {
  if (publicClient === undefined) {
    return {
      ok: false,
      error: new Error("RPC not ready"),
    };
  }

  if (account === undefined) {
    return {
      ok: false,
      error: new Error("Wallet not connected"),
    };
  }

  try {
    await publicClient.simulateContract({
      account,
      abi,
      address,
      functionName,
      args,
    });
    return { ok: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { ok: false, error };
  }
}
