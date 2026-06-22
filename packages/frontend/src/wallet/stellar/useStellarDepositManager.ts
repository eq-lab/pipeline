/**
 * Stellar/Soroban deposit manager hooks.
 *
 * Provides four hooks for interacting with the Pipeline DepositManager contract
 * on Stellar:
 *
 *   - `useStellarRequestDeposit()` — write hook for `request_deposit`
 *   - `useStellarClaim()`          — write hook for `claim_request`
 *   - `useStellarDepositRequest()` — read hook for `get_request` (polling)
 *   - `useChangeTrust()`           — builds and submits a `changeTrust` op for PLUSD
 *
 * All write hooks expose the same state shape:
 *   `{ write, data, isPending, isSuccess, error, reset }`
 *
 * In-flight recovery
 * ------------------
 * After a successful `request_deposit`, the request ID is persisted to
 * `localStorage` under `pipeline.stellar.deposit.inflight.<G…>`. The entry is
 * validated via `useStellarDepositRequest` and dropped once `claimed: true`.
 *
 * Mock layer
 * ----------
 *   `pipeline.mock.wallet.stellar.depositManager.requestDeposit`
 *     → JSON `{ hash: "...", requestId?: "123" }`
 *   `pipeline.mock.wallet.stellar.depositManager.claim`
 *     → JSON `{ hash: "..." }`
 *   `pipeline.mock.wallet.stellar.changeTrust`
 *     → JSON `{ hash: "..." }`
 */

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  rpc,
  TransactionBuilder,
  Transaction,
  Horizon,
  Asset,
  Operation,
  scValToNative,
} from "@stellar/stellar-sdk";
import {
  DepositManagerClient,
  createDepositManagerClient,
  type DepositRequest,
} from "./contracts/depositManager";
import { useStellarWallet } from "./useStellarWallet";
import {
  depositManagerId,
  sorobanRpcUrl,
  networkPassphrase,
  horizonUrl,
} from "./chain";
import { useStellarDepositManagerAddresses } from "./useStellarDepositManagerAddresses";
import { useStellarSacToken } from "./useStellarSacToken";
import {
  readMockStellarRequestDeposit,
  readMockStellarClaim,
  readMockStellarChangeTrust,
} from "./mock";
import { normalizeStellarActionError } from "./errors";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RequestDepositResult {
  write: (amountRaw: bigint) => void;
  /** `{ hash, requestId? }` on success, `undefined` while pending or before first call. */
  data: { hash: string; requestId?: bigint } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

export interface StellarClaimResult {
  write: (requestId: bigint, verifierSignature: Uint8Array) => void;
  data: { hash: string } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

export interface UseStellarDepositRequestResult {
  request: DepositRequest | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export interface UseChangeTrustResult {
  submit: () => void;
  /** `true` when the connected account is missing the PLUSD classic trustline. */
  needsTrustline: boolean;
  data: { hash: string } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

// ── In-flight recovery localStorage helpers ───────────────────────────────────

const INFLIGHT_KEY_PREFIX = "pipeline.stellar.deposit.inflight.";

export interface InflightDeposit {
  requestId: string;
  amount: string;
  createdAt: number;
}

/**
 * Reads the in-flight deposit entry for a given Stellar address.
 * Returns `undefined` when no entry is stored or the stored JSON is malformed.
 */
export function readInflightDeposit(
  address: string,
): InflightDeposit | undefined {
  try {
    const raw = localStorage.getItem(`${INFLIGHT_KEY_PREFIX}${address}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<InflightDeposit>;
    if (
      typeof parsed.requestId === "string" &&
      typeof parsed.amount === "string" &&
      typeof parsed.createdAt === "number"
    ) {
      return parsed as InflightDeposit;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes an in-flight deposit entry for a given Stellar address.
 */
export function writeInflightDeposit(
  address: string,
  entry: InflightDeposit,
): void {
  try {
    localStorage.setItem(
      `${INFLIGHT_KEY_PREFIX}${address}`,
      JSON.stringify(entry),
    );
  } catch {
    // localStorage may be unavailable (e.g. SSR or storage quota exceeded) — swallow silently.
  }
}

/**
 * Clears the in-flight deposit entry for a given Stellar address.
 */
export function clearInflightDeposit(address: string): void {
  try {
    localStorage.removeItem(`${INFLIGHT_KEY_PREFIX}${address}`);
  } catch {
    // swallow silently
  }
}

// ── useStellarRequestDeposit ──────────────────────────────────────────────────

/**
 * Write hook for `request_deposit(sender, amount: i128) → request_id: u128`.
 *
 * @example
 * ```tsx
 * const { write, data, isPending, isSuccess, error, reset } = useStellarRequestDeposit();
 * // Deposit 1 USDC (7 decimals: 10_000_000n)
 * write(10_000_000n);
 * ```
 */
export function useStellarRequestDeposit(): RequestDepositResult {
  const [data, setData] = useState<
    { hash: string; requestId?: bigint } | undefined
  >(undefined);
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isInFlight, setIsInFlight] = useState(false);

  const { address, isConnected, signTransaction } = useStellarWallet();

  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setIsSuccess(false);
    setError(null);
  }, []);

  const write = useCallback(
    (amountRaw: bigint) => {
      // ── Mock fast-path ────────────────────────────────────────────────────
      const mockResult = readMockStellarRequestDeposit();
      if (mockResult !== undefined) {
        setData(undefined);
        setIsPending(true);
        setIsSuccess(false);
        setError(null);
        Promise.resolve().then(() => {
          const result = {
            hash: mockResult.hash,
            requestId:
              mockResult.requestId !== undefined
                ? BigInt(mockResult.requestId)
                : undefined,
          };
          setData(result);
          setIsPending(false);
          setIsSuccess(true);
          if (address && result.requestId !== undefined) {
            writeInflightDeposit(address, {
              requestId: result.requestId.toString(),
              amount: amountRaw.toString(),
              createdAt: Date.now(),
            });
          }
        });
        return;
      }

      // ── Unconfigured guard ────────────────────────────────────────────────
      if (!depositManagerId) {
        setError(new Error("DepositManager not configured"));
        return;
      }

      // ── Disconnected guard ────────────────────────────────────────────────
      if (!isConnected || !address) {
        setError(new Error("Stellar wallet not connected"));
        return;
      }

      // ── Re-entrant guard ──────────────────────────────────────────────────
      if (isInFlight) return;

      setIsInFlight(true);
      setIsPending(true);
      setData(undefined);
      setIsSuccess(false);
      setError(null);

      void (async () => {
        try {
          const server = new rpc.Server(sorobanRpcUrl, {
            allowHttp: sorobanRpcUrl.startsWith("http://"),
          });
          const client = new DepositManagerClient(depositManagerId);

          // 1. Fetch source account (sequence number).
          const sourceAccount = await server.getAccount(address);

          // 2. Build assembled (unsigned) transaction XDR.
          const assembledXdr = await client.buildRequestDeposit(
            address,
            amountRaw,
            sourceAccount,
          );

          // 3. Sign via wallet.
          const { signedTxXdr } = await signTransaction(assembledXdr, {
            networkPassphrase: networkPassphrase as string,
            address,
          });

          // 4. Rebuild and submit.
          const signedTx = TransactionBuilder.fromXDR(
            signedTxXdr,
            networkPassphrase as string,
          );

          const sendResult = await server.sendTransaction(
            signedTx as Transaction,
          );

          if (sendResult.status === "ERROR") {
            throw new Error(
              `[requestDeposit] sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
            );
          }

          // 5. Poll until terminal status.
          const finalResult = await server.pollTransaction(sendResult.hash);

          if (finalResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
            throw new Error(
              `[requestDeposit] Transaction ${sendResult.hash} failed with status ${finalResult.status}`,
            );
          }

          // 6. Decode requestId from returnValue. Without it, the user cannot
          // fetch a voucher, claim, or recover the deposit after reload.
          if (!finalResult.returnValue) {
            throw new Error(
              `[requestDeposit] Transaction ${sendResult.hash} succeeded but returned no request_id`,
            );
          }

          let requestId: bigint;
          try {
            const native = scValToNative(finalResult.returnValue);
            requestId =
              typeof native === "bigint" ? native : BigInt(String(native));
          } catch (decodeErr) {
            const detail =
              decodeErr instanceof Error
                ? decodeErr.message
                : String(decodeErr);
            throw new Error(
              `[requestDeposit] Could not decode request_id from transaction ${sendResult.hash}: ${detail}`,
            );
          }

          const result = { hash: sendResult.hash, requestId };
          setData(result);
          setIsSuccess(true);

          writeInflightDeposit(address, {
            requestId: requestId.toString(),
            amount: amountRaw.toString(),
            createdAt: Date.now(),
          });
        } catch (err) {
          setError(normalizeStellarActionError(err, address));
        } finally {
          setIsPending(false);
          setIsInFlight(false);
        }
      })();
    },
    [address, isConnected, isInFlight, signTransaction],
  );

  return { write, data, isPending, isSuccess, error, reset };
}

// ── useStellarClaim ───────────────────────────────────────────────────────────

/**
 * Write hook for `claim_request(request_id: u128, verifier_signature: BytesN<64>)`.
 *
 * The `verifierSignature` must be exactly 64 bytes (ed25519 signature).
 *
 * @example
 * ```tsx
 * const { write, data, isPending, isSuccess, error, reset } = useStellarClaim();
 * write(requestId, signatureBytes);
 * ```
 */
export function useStellarClaim(): StellarClaimResult {
  const [data, setData] = useState<{ hash: string } | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isInFlight, setIsInFlight] = useState(false);

  const { address, isConnected, signTransaction } = useStellarWallet();

  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setIsSuccess(false);
    setError(null);
  }, []);

  const write = useCallback(
    (requestId: bigint, verifierSignature: Uint8Array) => {
      // ── Validate signature length ─────────────────────────────────────────
      if (verifierSignature.length !== 64) {
        setError(
          new Error(
            `[useStellarClaim] verifierSignature must be 64 bytes, got ${verifierSignature.length}`,
          ),
        );
        return;
      }

      // ── Mock fast-path ────────────────────────────────────────────────────
      const mockResult = readMockStellarClaim();
      if (mockResult !== undefined) {
        setData(undefined);
        setIsPending(true);
        setIsSuccess(false);
        setError(null);
        Promise.resolve().then(() => {
          setData(mockResult);
          setIsPending(false);
          setIsSuccess(true);
          if (address) {
            clearInflightDeposit(address);
          }
        });
        return;
      }

      // ── Unconfigured guard ────────────────────────────────────────────────
      if (!depositManagerId) {
        setError(new Error("DepositManager not configured"));
        return;
      }

      // ── Disconnected guard ────────────────────────────────────────────────
      if (!isConnected || !address) {
        setError(new Error("Stellar wallet not connected"));
        return;
      }

      // ── Re-entrant guard ──────────────────────────────────────────────────
      if (isInFlight) return;

      setIsInFlight(true);
      setIsPending(true);
      setData(undefined);
      setIsSuccess(false);
      setError(null);

      void (async () => {
        try {
          const server = new rpc.Server(sorobanRpcUrl, {
            allowHttp: sorobanRpcUrl.startsWith("http://"),
          });
          const client = new DepositManagerClient(depositManagerId);

          // 1. Fetch source account.
          const sourceAccount = await server.getAccount(address);

          // 2. Build assembled (unsigned) transaction XDR.
          const assembledXdr = await client.buildClaimRequest(
            requestId,
            verifierSignature,
            sourceAccount,
          );

          // 3. Sign via wallet.
          const { signedTxXdr } = await signTransaction(assembledXdr, {
            networkPassphrase: networkPassphrase as string,
            address,
          });

          // 4. Rebuild and submit.
          const signedTx = TransactionBuilder.fromXDR(
            signedTxXdr,
            networkPassphrase as string,
          );

          const sendResult = await server.sendTransaction(
            signedTx as Transaction,
          );

          if (sendResult.status === "ERROR") {
            throw new Error(
              `[claim] sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
            );
          }

          // 5. Poll until terminal status.
          const finalResult = await server.pollTransaction(sendResult.hash);

          if (finalResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
            throw new Error(
              `[claim] Transaction ${sendResult.hash} failed with status ${finalResult.status}`,
            );
          }

          setData({ hash: sendResult.hash });
          setIsSuccess(true);
          clearInflightDeposit(address);
        } catch (err) {
          setError(normalizeStellarActionError(err, address));
        } finally {
          setIsPending(false);
          setIsInFlight(false);
        }
      })();
    },
    [address, isConnected, isInFlight, signTransaction],
  );

  return { write, data, isPending, isSuccess, error, reset };
}

// ── useStellarDepositRequest ──────────────────────────────────────────────────

/**
 * React Query read hook for `get_request(requestId)`.
 *
 * Polls every 5 seconds while the request has not been claimed yet.
 * Returns `undefined` when `requestId` is undefined or the contract is
 * unconfigured.
 *
 * @param requestId - The u128 request ID, or `undefined` to keep the hook idle.
 */
export function useStellarDepositRequest(
  requestId: bigint | undefined,
): UseStellarDepositRequestResult {
  const isConfigured = !!depositManagerId;

  const query = useQuery<DepositRequest, Error>({
    queryKey: ["stellarDepositRequest", requestId?.toString()],
    queryFn: async () => {
      const client = createDepositManagerClient(depositManagerId);
      if (!client) {
        throw new Error("DepositManager not configured");
      }
      return client.getRequest(requestId!);
    },
    enabled: requestId !== undefined && isConfigured,
    refetchInterval: (q) => {
      // Stop polling once the request is claimed.
      if (q.state.data?.claimed) return false;
      return 5000;
    },
    staleTime: 0,
  });

  return {
    request: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}

// ── useChangeTrust ────────────────────────────────────────────────────────────

/**
 * Hook that builds and submits a classic `changeTrust` op for the PLUSD asset.
 *
 * Depends on `useStellarDepositManagerAddresses()` to resolve `plusdAsset`.
 * Uses Horizon (not Soroban RPC) for submission — classic ops go to Horizon.
 *
 * @example
 * ```tsx
 * const { submit, isPending, isSuccess, error } = useChangeTrust();
 * // After ensuring the user needs a trustline:
 * submit();
 * ```
 */
export function useChangeTrust(): UseChangeTrustResult {
  const [data, setData] = useState<{ hash: string } | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isInFlight, setIsInFlight] = useState(false);

  const { address, isConnected, signTransaction } = useStellarWallet();
  const { addresses } = useStellarDepositManagerAddresses();
  const plusdTrustline = useStellarSacToken({
    assetCode: "PLUSD",
    assetIssuer: addresses?.plusdAsset.issuer ?? "",
    contractId: addresses?.plusd ?? "",
  });
  const needsTrustline =
    isConnected &&
    !!addresses?.plusdAsset &&
    !plusdTrustline.isLoading &&
    !plusdTrustline.hasTrustline;
  // Refetch the trustline status immediately after a successful changeTrust so
  // the UI flips without waiting for the 30s SAC-token poll (see #662).
  const { refetchBalance: refetchPlusdTrustline } = plusdTrustline;

  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setIsSuccess(false);
    setError(null);
  }, []);

  const submit = useCallback(() => {
    // ── Mock fast-path ────────────────────────────────────────────────────
    const mockResult = readMockStellarChangeTrust();
    if (mockResult !== undefined) {
      setData(undefined);
      setIsPending(true);
      setIsSuccess(false);
      setError(null);
      Promise.resolve().then(() => {
        setData(mockResult);
        setIsPending(false);
        setIsSuccess(true);
        refetchPlusdTrustline();
      });
      return;
    }

    // ── Unconfigured guard ────────────────────────────────────────────────
    if (!depositManagerId) {
      setError(new Error("DepositManager not configured"));
      return;
    }

    // ── Disconnected guard ────────────────────────────────────────────────
    if (!isConnected || !address) {
      setError(new Error("Stellar wallet not connected"));
      return;
    }

    // ── Addresses not loaded yet ──────────────────────────────────────────
    if (!addresses?.plusdAsset) {
      setError(new Error("PLUSD asset not loaded"));
      return;
    }

    // ── Re-entrant guard ──────────────────────────────────────────────────
    if (isInFlight) return;

    setIsInFlight(true);
    setIsPending(true);
    setData(undefined);
    setIsSuccess(false);
    setError(null);

    const { plusdAsset } = addresses;

    void (async () => {
      try {
        const horizon = new Horizon.Server(horizonUrl);

        // 1. Load account from Horizon for the transaction fee + sequence.
        const account = await horizon.loadAccount(address);

        // 2. Build the changeTrust transaction.
        const asset = new Asset(plusdAsset.code, plusdAsset.issuer);
        const tx = new TransactionBuilder(account, {
          fee: "100",
          networkPassphrase: networkPassphrase as string,
        })
          .addOperation(Operation.changeTrust({ asset }))
          .setTimeout(30)
          .build();

        // 3. Sign via wallet.
        const { signedTxXdr } = await signTransaction(tx.toXDR(), {
          networkPassphrase: networkPassphrase as string,
          address,
        });

        // 4. Rebuild and submit to Horizon.
        const signedTx = TransactionBuilder.fromXDR(
          signedTxXdr,
          networkPassphrase as string,
        );

        const submitResult = await horizon.submitTransaction(
          signedTx as Transaction,
        );

        setData({ hash: submitResult.hash });
        setIsSuccess(true);
        refetchPlusdTrustline();
      } catch (err) {
        setError(normalizeStellarActionError(err, address));
      } finally {
        setIsPending(false);
        setIsInFlight(false);
      }
    })();
  }, [
    address,
    addresses,
    isConnected,
    isInFlight,
    signTransaction,
    refetchPlusdTrustline,
  ]);

  return { submit, needsTrustline, data, isPending, isSuccess, error, reset };
}
