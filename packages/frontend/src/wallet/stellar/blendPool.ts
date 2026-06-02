/**
 * Blend Pool — Soroban transaction helper for deposit and withdraw.
 *
 * This is the ONLY file in the wallet module that imports
 * `@blend-capital/blend-sdk`. The ESLint boundary (`eslint.config.js`) restricts
 * blend-sdk to `src/wallet/stellar/**`.
 *
 * ## Architecture
 *
 * Blend is a lending protocol deployed as a Soroban smart contract on Stellar.
 * Interacting with it differs from Horizon (which handles classic payments):
 *
 *   - **Soroban RPC** (`STELLAR_RPC_URL`) is used for simulation, transaction
 *     assembly, sending, and polling — NOT Horizon.
 *   - Transactions must be **simulated** before signing so the RPC can compute
 *     the resource footprint and Soroban auth entries.
 *   - After simulation, `rpc.assembleTransaction` attaches the resource footprint
 *     and source-account auth. The assembled (unsigned) envelope is signed by the
 *     wallet, then submitted.
 *
 * ## Amount convention
 *
 * Stellar reserves use **7 decimals**. `amount` in `Request` is a `bigint`
 * fixed-point: 1 XLM = `10_000_000n`. The caller is responsible for scaling;
 * these helpers accept and return raw bigint amounts.
 *
 * ## Soroban transaction lifecycle (`submitBlendTx`)
 *
 *   1. Build `rpc.Server` → fetch source account (sequence number).
 *   2. Build operation XDR via blend-sdk's `PoolContractV2.submit`.
 *   3. Wrap in `TransactionBuilder`, set fee/timeout, build.
 *   4. `simulateTransaction` → on error, throw with a readable message.
 *   5. `assembleTransaction` → attaches footprint + auth, returns a builder;
 *      call `.build()` to get the assembled (unsigned) transaction.
 *   6. Caller-injected `sign(xdr)` → returns `{ signedTxXdr }`.
 *   7. Rebuild `Transaction` from signed XDR → `sendTransaction`.
 *   8. Poll `pollTransaction` until SUCCESS/FAILED; throw on FAILED.
 */

import {
  TransactionBuilder,
  Networks,
  Transaction,
  xdr,
  rpc,
} from "@stellar/stellar-sdk";
import {
  PoolContractV2,
  PoolV2,
  RequestType,
  type Network,
} from "@blend-capital/blend-sdk";
import { sorobanRpcUrl, networkPassphrase } from "./chain";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BuildSubmitOpArgs {
  poolId: string;
  from: string;
  reserveId: string;
  amount: bigint;
  requestType: RequestType;
}

export interface SubmitBlendTxArgs {
  opXdr: string;
  sourceAddress: string;
  sign: (
    xdrStr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
}

export interface LoadBlendCollateralArgs {
  network: Network;
  poolId: string;
  userAddress: string;
  reserveId: string;
}

// Re-export RequestType so callers don't import blend-sdk directly.
export { RequestType };

// ── Base fee (Soroban transactions carry additional resource fees on top) ─────

const BASE_FEE = "100";
const TX_TIMEOUT_SECONDS = 30;

// ── buildSubmitOpXdr ──────────────────────────────────────────────────────────

/**
 * Builds the Blend `submit` operation as a base64 XDR string.
 *
 * Uses `PoolContractV2` (the V2 pool, identified by `poolId`) and returns the
 * operation in a form that `TransactionBuilder.addOperation` accepts after
 * wrapping with `xdr.Operation.fromXDR(opXdr, "base64")`.
 *
 * `from === spender === to` for a single-account collateral supply/withdraw —
 * the auth system handles the invoker's authorization after assembly.
 */
export function buildSubmitOpXdr({
  poolId,
  from,
  reserveId,
  amount,
  requestType,
}: BuildSubmitOpArgs): string {
  const contract = new PoolContractV2(poolId);
  return contract.submit({
    from,
    spender: from,
    to: from,
    requests: [{ address: reserveId, amount, request_type: requestType }],
  });
}

// ── submitBlendTx ─────────────────────────────────────────────────────────────

/**
 * Runs the full Soroban transaction lifecycle for a Blend `submit` call.
 *
 * Returns `{ hash }` on success; throws a descriptive `Error` on simulation
 * failure or terminal FAILED status.
 *
 * @param opXdr - base64 operation XDR produced by `buildSubmitOpXdr`.
 * @param sourceAddress - the connected wallet's Stellar public key.
 * @param sign - async signing function injected by the caller (typically
 *   `useStellarWallet().signTransaction`).
 */
export async function submitBlendTx({
  opXdr,
  sourceAddress,
  sign,
}: SubmitBlendTxArgs): Promise<{ hash: string }> {
  const server = new rpc.Server(sorobanRpcUrl, { allowHttp: false });

  // 1. Fetch the source account (sequence number).
  const sourceAccount = await server.getAccount(sourceAddress);

  // 2. Wrap the operation XDR in a transaction.
  const op = xdr.Operation.fromXDR(opXdr, "base64");
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase as string,
  })
    .addOperation(op)
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();

  // 3. Simulate to get resource footprint + auth entries.
  const simulation = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(
      `[blendPool] Simulation failed: ${simulation.error ?? "unknown error"}`,
    );
  }

  // 4. Assemble: attach footprint and source-account auth from simulation.
  const assembled = rpc.assembleTransaction(tx, simulation).build();

  // 5. Sign the assembled (unsigned) envelope.
  const { signedTxXdr } = await sign(assembled.toXDR(), {
    networkPassphrase: networkPassphrase as string,
    address: sourceAddress,
  });

  // 6. Rebuild the Transaction from the signed XDR and submit.
  const signedTx = TransactionBuilder.fromXDR(
    signedTxXdr,
    networkPassphrase as string,
  );

  const sendResult = await server.sendTransaction(signedTx as Transaction);

  if (sendResult.status === "ERROR") {
    throw new Error(
      `[blendPool] sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
    );
  }

  // 7. Poll until the transaction reaches a terminal status.
  const finalResult = await server.pollTransaction(sendResult.hash);

  if (finalResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `[blendPool] Transaction ${sendResult.hash} failed with status ${finalResult.status}`,
    );
  }

  return { hash: sendResult.hash };
}

// ── loadBlendCollateral ───────────────────────────────────────────────────────

/**
 * Reads the connected account's supplied-collateral position for a given
 * reserve from the Blend V2 pool.
 *
 * Uses `PoolV2.load` + `pool.loadUser` (Soroban RPC reads). Returns `0n` when
 * the account has no position or the account is unfunded.
 *
 * @param network - Blend SDK `Network` object (rpc URL + passphrase).
 * @param poolId - Blend pool contract address.
 * @param userAddress - Stellar public key of the user.
 * @param reserveId - Reserve asset address (e.g. XLM or USDC reserve).
 */
export async function loadBlendCollateral({
  network,
  poolId,
  userAddress,
  reserveId,
}: LoadBlendCollateralArgs): Promise<bigint> {
  try {
    const pool = await PoolV2.load(network, poolId);
    const poolUser = await pool.loadUser(userAddress);

    // Find the reserve index for the target asset.
    const reserve = pool.reserves.get(reserveId);
    if (!reserve) {
      // Reserve not found in the pool — return 0 (asset not listed).
      return 0n;
    }

    // Positions.collateral is a Map<u32 (reserve index), i128 (amount)>.
    const collateralAmount = poolUser.positions.collateral.get(
      reserve.config.index,
    );
    return collateralAmount ?? 0n;
  } catch {
    // Unfunded account or RPC error → treat as no position.
    return 0n;
  }
}

// ── Resolve the correct RPC Networks passphrase constant ─────────────────────
// `networkPassphrase` from ./chain is the kit `Networks` enum value which IS
// the passphrase string in @creit.tech/stellar-wallets-kit v2.x. We re-export
// the stellar-sdk `Networks` for convenience in tests, but only use the kit
// value for the actual passphrase to avoid mismatches.
export { Networks };
