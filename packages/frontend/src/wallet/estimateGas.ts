/**
 * Shared gas estimation helper for wallet write hooks.
 *
 * Wraps `publicClient.estimateContractGas` with:
 *   - A +20 % safety buffer (`gas * 12 / 10`).
 *   - A hard clamp below the chain's per-tx cap (`EVM_TX_GAS_CAP`).
 *   - Typed result so callers branch cleanly without try/catch.
 *
 * See `gas.ts` for the cap constant and buffer helpers.
 * See: https://github.com/eq-lab/pipeline/issues/342
 */
import type { Abi, PublicClient } from "viem";
import { applyGasBuffer, clampGas } from "./gas";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EstimateGasArgs = {
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

export type EstimateGasResult =
  | { ok: true; gas: bigint }
  | { ok: false; error: Error };

// ── estimateGasCapped ─────────────────────────────────────────────────────────

/**
 * Estimates gas for a contract write, applies a +20 % buffer, and clamps the
 * result below the chain's per-tx cap (`EVM_TX_GAS_CAP`).
 *
 * Returns `{ ok: true, gas }` on success or `{ ok: false, error }` on failure
 * (estimation revert, network error, or missing client/account).
 *
 * The caller is responsible for deciding what to do with the error — typically
 * set it on the hook's `error` state and skip the `writeContract` call.
 */
export async function estimateGasCapped({
  publicClient,
  account,
  abi,
  address,
  functionName,
  args,
}: EstimateGasArgs): Promise<EstimateGasResult> {
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
    const estimated = await publicClient.estimateContractGas({
      account,
      abi,
      address,
      functionName,
      args,
    });
    const gas = clampGas(applyGasBuffer(estimated));
    return { ok: true, gas };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { ok: false, error };
  }
}
