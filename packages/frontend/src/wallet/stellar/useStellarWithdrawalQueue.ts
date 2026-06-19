/**
 * Stellar/Soroban withdrawal queue hooks.
 *
 * Provides four hooks for interacting with the Pipeline WithdrawalQueue contract
 * on Stellar:
 *
 *   - `useStellarRequestWithdrawal()` — write hook for `request_withdrawal`
 *   - `useStellarClaimWithdrawal()`   — write hook for `claim_request`
 *   - `useStellarWithdrawalRequest()` — read hook for `get_request` (polling)
 *   - `useStellarChangeTrustUsdc()`   — builds and submits a `changeTrust` op for USDC
 *
 * All write hooks follow the same state shape as `-useBlendSubmit.ts`:
 *   `{ write, data, isPending, isSuccess, error, reset }`
 *
 * In-flight recovery
 * ------------------
 * After a successful `request_withdrawal`, the request ID is persisted to
 * `localStorage` under `pipeline.stellar.withdrawal.inflight.<G…>`. The entry
 * is validated via `useStellarWithdrawalRequest` and dropped once `claimed: true`.
 *
 * Mock layer
 * ----------
 *   `pipeline.mock.wallet.stellar.withdrawalQueue.requestWithdrawal`
 *     → JSON `{ hash: "...", requestId?: "123" }`
 *   `pipeline.mock.wallet.stellar.withdrawalQueue.claimWithdrawal`
 *     → JSON `{ hash: "..." }`
 *   `pipeline.mock.wallet.stellar.changeTrust`
 *     → JSON `{ hash: "..." }` (shared with deposit's changeTrust)
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
  WithdrawalQueueClient,
  createWithdrawalQueueClient,
  type WithdrawalRequest,
} from "./contracts/withdrawalQueue";
import { useStellarWallet } from "./useStellarWallet";
import {
  withdrawalQueueId,
  sorobanRpcUrl,
  networkPassphrase,
  horizonUrl,
} from "./chain";
import { useStellarDepositManagerAddresses } from "./useStellarDepositManagerAddresses";
import { useStellarSacToken } from "./useStellarSacToken";
import {
  readMockStellarRequestWithdrawal,
  readMockStellarClaimWithdrawal,
  readMockStellarChangeTrust,
} from "./mock";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RequestWithdrawalResult {
  write: (amountRaw: bigint) => void;
  /** `{ hash, requestId? }` on success, `undefined` while pending or before first call. */
  data: { hash: string; requestId?: bigint } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

export interface StellarClaimWithdrawalResult {
  write: (requestId: bigint, verifierSignature: Uint8Array) => void;
  data: { hash: string } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

export interface UseStellarWithdrawalRequestResult {
  request: WithdrawalRequest | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export interface UseStellarChangeTrustUsdcResult {
  submit: () => void;
  /** `true` when the connected account is missing the USDC classic trustline. */
  needsTrustline: boolean;
  data: { hash: string } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

// ── In-flight recovery localStorage helpers ───────────────────────────────────

const INFLIGHT_KEY_PREFIX = "pipeline.stellar.withdrawal.inflight.";

export interface InflightWithdrawal {
  requestId: string;
  amount: string;
  createdAt: number;
}

/**
 * Reads the in-flight withdrawal entry for a given Stellar address.
 * Returns `undefined` when no entry is stored or the stored JSON is malformed.
 */
export function readInflightWithdrawal(
  address: string,
): InflightWithdrawal | undefined {
  try {
    const raw = localStorage.getItem(`${INFLIGHT_KEY_PREFIX}${address}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<InflightWithdrawal>;
    if (
      typeof parsed.requestId === "string" &&
      typeof parsed.amount === "string" &&
      typeof parsed.createdAt === "number"
    ) {
      return parsed as InflightWithdrawal;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes an in-flight withdrawal entry for a given Stellar address.
 */
export function writeInflightWithdrawal(
  address: string,
  entry: InflightWithdrawal,
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
 * Clears the in-flight withdrawal entry for a given Stellar address.
 */
export function clearInflightWithdrawal(address: string): void {
  try {
    localStorage.removeItem(`${INFLIGHT_KEY_PREFIX}${address}`);
  } catch {
    // swallow silently
  }
}

// ── useStellarRequestWithdrawal ───────────────────────────────────────────────

/**
 * Write hook for `request_withdrawal(sender, amount: i128) → request_id: u128`.
 *
 * @example
 * ```tsx
 * const { write, data, isPending, isSuccess, error, reset } = useStellarRequestWithdrawal();
 * // Withdraw 1 PLUSD (7 decimals: 10_000_000n)
 * write(10_000_000n);
 * ```
 */
export function useStellarRequestWithdrawal(): RequestWithdrawalResult {
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
      const mockResult = readMockStellarRequestWithdrawal();
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
            writeInflightWithdrawal(address, {
              requestId: result.requestId.toString(),
              amount: amountRaw.toString(),
              createdAt: Date.now(),
            });
          }
        });
        return;
      }

      // ── Unconfigured guard ────────────────────────────────────────────────
      if (!withdrawalQueueId) {
        setError(new Error("WithdrawalQueue not configured"));
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
          const client = new WithdrawalQueueClient(withdrawalQueueId);

          // 1. Fetch source account (sequence number).
          const sourceAccount = await server.getAccount(address);

          // 2. Build assembled (unsigned) transaction XDR.
          const assembledXdr = await client.buildRequestWithdrawal(
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
              `[requestWithdrawal] sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
            );
          }

          // 5. Poll until terminal status.
          const finalResult = await server.pollTransaction(sendResult.hash);

          if (finalResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
            throw new Error(
              `[requestWithdrawal] Transaction ${sendResult.hash} failed with status ${finalResult.status}`,
            );
          }

          // 6. Decode requestId from returnValue. Without it, the user cannot
          // fetch a voucher, claim, or recover the withdrawal after reload.
          if (!finalResult.returnValue) {
            throw new Error(
              `[requestWithdrawal] Transaction ${sendResult.hash} succeeded but returned no request_id`,
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
              `[requestWithdrawal] Could not decode request_id from transaction ${sendResult.hash}: ${detail}`,
            );
          }

          const result = { hash: sendResult.hash, requestId };
          setData(result);
          setIsSuccess(true);

          writeInflightWithdrawal(address, {
            requestId: requestId.toString(),
            amount: amountRaw.toString(),
            createdAt: Date.now(),
          });
        } catch (err) {
          setError(err instanceof Error ? err : new Error(String(err)));
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

// ── useStellarClaimWithdrawal ─────────────────────────────────────────────────

/**
 * Write hook for `claim_request(request_id: u128, verifier_signature: BytesN<64>)`.
 *
 * The `verifierSignature` must be exactly 64 bytes (ed25519 signature from the
 * `useStellarWithdrawalVoucher` hook).
 *
 * @example
 * ```tsx
 * const { write, data, isPending, isSuccess, error, reset } = useStellarClaimWithdrawal();
 * write(requestId, signatureBytes);
 * ```
 */
export function useStellarClaimWithdrawal(): StellarClaimWithdrawalResult {
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
            `[useStellarClaimWithdrawal] verifierSignature must be 64 bytes, got ${verifierSignature.length}`,
          ),
        );
        return;
      }

      // ── Mock fast-path ────────────────────────────────────────────────────
      const mockResult = readMockStellarClaimWithdrawal();
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
            clearInflightWithdrawal(address);
          }
        });
        return;
      }

      // ── Unconfigured guard ────────────────────────────────────────────────
      if (!withdrawalQueueId) {
        setError(new Error("WithdrawalQueue not configured"));
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
          const client = new WithdrawalQueueClient(withdrawalQueueId);

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
              `[claimWithdrawal] sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
            );
          }

          // 5. Poll until terminal status.
          const finalResult = await server.pollTransaction(sendResult.hash);

          if (finalResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
            throw new Error(
              `[claimWithdrawal] Transaction ${sendResult.hash} failed with status ${finalResult.status}`,
            );
          }

          setData({ hash: sendResult.hash });
          setIsSuccess(true);
          clearInflightWithdrawal(address);
        } catch (err) {
          setError(err instanceof Error ? err : new Error(String(err)));
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

// ── useStellarWithdrawalRequest ───────────────────────────────────────────────

/**
 * React Query read hook for `get_request(requestId)` on the WithdrawalQueue.
 *
 * Polls every 5 seconds while the request has not been claimed yet.
 * Returns `undefined` when `requestId` is undefined or the contract is
 * unconfigured.
 *
 * @param requestId - The u128 request ID, or `undefined` to keep the hook idle.
 */
export function useStellarWithdrawalRequest(
  requestId: bigint | undefined,
): UseStellarWithdrawalRequestResult {
  const isConfigured = !!withdrawalQueueId;

  const query = useQuery<WithdrawalRequest, Error>({
    queryKey: ["stellarWithdrawalRequest", requestId?.toString()],
    queryFn: async () => {
      const client = createWithdrawalQueueClient(withdrawalQueueId);
      if (!client) {
        throw new Error("WithdrawalQueue not configured");
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

// ── useStellarChangeTrustUsdc ─────────────────────────────────────────────────

/**
 * Hook that builds and submits a classic `changeTrust` op for the USDC asset.
 *
 * Withdraw claim pays out USDC, so the trustline guard for the withdraw flow
 * is on USDC (opposite of the deposit flow which guards on PLUSD).
 *
 * Depends on `useStellarDepositManagerAddresses()` to resolve `usdcAsset`.
 * Uses Horizon (not Soroban RPC) for submission — classic ops go to Horizon.
 *
 * @example
 * ```tsx
 * const { submit, isPending, isSuccess, error } = useStellarChangeTrustUsdc();
 * // After ensuring the user needs a USDC trustline:
 * submit();
 * ```
 */
export function useStellarChangeTrustUsdc(): UseStellarChangeTrustUsdcResult {
  const [data, setData] = useState<{ hash: string } | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isInFlight, setIsInFlight] = useState(false);

  const { address, isConnected, signTransaction } = useStellarWallet();
  const { addresses } = useStellarDepositManagerAddresses();
  const usdcTrustline = useStellarSacToken({
    assetCode: "USDC",
    assetIssuer: addresses?.usdcAsset.issuer ?? "",
    contractId: addresses?.usdc ?? "",
  });
  const needsTrustline =
    isConnected &&
    !!addresses?.usdcAsset &&
    !usdcTrustline.isLoading &&
    !usdcTrustline.hasTrustline;
  // Refetch the trustline status immediately after a successful changeTrust so
  // the UI flips without waiting for the 30s SAC-token poll (see #662).
  const { refetchBalance: refetchUsdcTrustline } = usdcTrustline;

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
        refetchUsdcTrustline();
      });
      return;
    }

    // ── Unconfigured guard ────────────────────────────────────────────────
    if (!withdrawalQueueId) {
      setError(new Error("WithdrawalQueue not configured"));
      return;
    }

    // ── Disconnected guard ────────────────────────────────────────────────
    if (!isConnected || !address) {
      setError(new Error("Stellar wallet not connected"));
      return;
    }

    // ── Addresses not loaded yet ──────────────────────────────────────────
    if (!addresses?.usdcAsset) {
      setError(new Error("USDC asset not loaded"));
      return;
    }

    // ── Re-entrant guard ──────────────────────────────────────────────────
    if (isInFlight) return;

    setIsInFlight(true);
    setIsPending(true);
    setData(undefined);
    setIsSuccess(false);
    setError(null);

    const { usdcAsset } = addresses;

    void (async () => {
      try {
        const horizon = new Horizon.Server(horizonUrl);

        // 1. Load account from Horizon for the transaction fee + sequence.
        const account = await horizon.loadAccount(address);

        // 2. Build the changeTrust transaction for USDC.
        const asset = new Asset(usdcAsset.code, usdcAsset.issuer);
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
        refetchUsdcTrustline();
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
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
    refetchUsdcTrustline,
  ]);

  return { submit, needsTrustline, data, isPending, isSuccess, error, reset };
}
