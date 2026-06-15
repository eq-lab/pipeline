/**
 * Typed Soroban client for the Pipeline DepositManager contract.
 *
 * Contract ID (testnet):  CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO
 * Interface captured:     2026-06-10  (extracted from testnet WASM via
 *                         `stellar contract info interface --id <C...> --network testnet`)
 *
 * WARNING — Stellar testnet is periodically reset. If contract calls start
 * failing with "contract not found", re-deploy the contract and update
 * `VITE_STELLAR_DEPOSIT_MANAGER_ID`. The checked-in bindings remain valid
 * (same ABI) as long as the same WASM is re-deployed.
 *
 * Only the frontend-relevant subset is exposed here:
 *   Reads:  asset, share, paused, verifier, get_request, digest, domain_separator
 *   Writes: request_deposit (builder only — no submit), claim_request (builder only)
 *
 * Write methods return the raw unsigned XDR transaction envelope — callers are
 * responsible for signing and submitting.
 */

import {
  Account,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
  rpc as SorobanRpc,
} from "@stellar/stellar-sdk";
import { sorobanRpcUrl, networkPassphrase } from "../chain";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Mirrors the on-chain `Request` struct. */
export interface DepositRequest {
  amount: bigint;
  claimed: boolean;
  timestamp: bigint;
  user: string;
}

// ── Client factory ────────────────────────────────────────────────────────────

/**
 * Lightweight Soroban client for DepositManager.
 * Constructed from a `contractId` so callers can inject testnet/mainnet IDs
 * from env without re-importing chain constants.
 */
export class DepositManagerClient {
  private readonly contract: Contract;
  private readonly server: SorobanRpc.Server;
  private readonly contractId: string;

  constructor(contractId: string) {
    if (!contractId) {
      throw new Error(
        "DepositManagerClient: contractId must not be empty. " +
          "Set VITE_STELLAR_DEPOSIT_MANAGER_ID in your .env.",
      );
    }
    this.contractId = contractId;
    this.contract = new Contract(contractId);
    this.server = new SorobanRpc.Server(sorobanRpcUrl, {
      allowHttp: sorobanRpcUrl.startsWith("http://"),
    });
  }

  // ── Internal simulate helper ───────────────────────────────────────────────

  /**
   * Simulate a read-only contract invocation and return the decoded result.
   * Uses a dummy zero-sequence account for read-only simulations that don't
   * require auth.
   */
  private async simulateReadCall(
    operation: xdr.Operation,
  ): Promise<xdr.ScVal> {
    // Use a dummy Account (zero sequence) as source for the simulation envelope.
    // Soroban RPC accepts this for read-only (view) calls.
    const dummyAccount = new Account(this.contractId, "0");

    const tx = new TransactionBuilder(dummyAccount, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await this.server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(result)) {
      throw new Error(
        `DepositManagerClient simulation error: ${result.error}`,
      );
    }

    if (!result.result) {
      throw new Error("DepositManagerClient: simulation returned no result");
    }

    return result.result.retval;
  }

  // ── Read views ─────────────────────────────────────────────────────────────

  /**
   * Returns the underlying asset (USDC SAC) contract ID.
   */
  async asset(): Promise<string> {
    const op = this.contract.call("asset");
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as string;
  }

  /**
   * Returns the share token (PLUSD SAC) contract ID.
   */
  async share(): Promise<string> {
    const op = this.contract.call("share");
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as string;
  }

  /**
   * Returns `true` if the contract is currently paused.
   */
  async paused(): Promise<boolean> {
    const op = this.contract.call("paused");
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as boolean;
  }

  /**
   * Returns the verifier public key (32-byte hash).
   */
  async verifier(): Promise<Uint8Array> {
    const op = this.contract.call("verifier");
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as Uint8Array;
  }

  /**
   * Returns the deposit request for a given request ID.
   */
  async getRequest(requestId: bigint): Promise<DepositRequest> {
    const op = this.contract.call(
      "get_request",
      nativeToScVal(requestId, { type: "u128" }),
    );
    const retval = await this.simulateReadCall(op);
    const raw = scValToNative(retval) as {
      amount: bigint;
      claimed: boolean;
      timestamp: bigint;
      user: string;
    };
    return {
      amount: raw.amount,
      claimed: raw.claimed,
      timestamp: raw.timestamp,
      user: raw.user,
    };
  }

  /**
   * Returns the EIP-712-style digest for a request.
   */
  async digest(
    requestId: bigint,
    sender: string,
    amount: bigint,
  ): Promise<Uint8Array> {
    const op = this.contract.call(
      "digest",
      nativeToScVal(requestId, { type: "u128" }),
      new Address(sender).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    );
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as Uint8Array;
  }

  /**
   * Returns the domain separator bytes for this contract instance.
   */
  async domainSeparator(): Promise<Uint8Array> {
    const op = this.contract.call("domain_separator");
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as Uint8Array;
  }

  // ── Write builders (unsigned) ──────────────────────────────────────────────

  /**
   * Builds an unsigned `request_deposit` transaction XDR.
   * Callers must sign and submit via the wallet kit.
   *
   * @param sender        - Stellar public key of the depositing account.
   * @param amount        - Raw i128 amount (7-decimal; 1 USDC = 10_000_000n).
   * @param sourceAccount - Funded `Account` object for transaction fee.
   * @returns Assembled (but unsigned) transaction XDR string.
   */
  async buildRequestDeposit(
    sender: string,
    amount: bigint,
    sourceAccount: Account,
  ): Promise<string> {
    const op = this.contract.call(
      "request_deposit",
      new Address(sender).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const simResult = await this.server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw new Error(
        `DepositManager.request_deposit simulation error: ${simResult.error}`,
      );
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return assembled.toXDR();
  }

  /**
   * Builds an unsigned `claim_request` transaction XDR.
   * Callers must sign and submit via the wallet kit.
   *
   * @param requestId         - The u128 request ID.
   * @param verifierSignature - 64-byte verifier signature (BytesN<64>).
   * @param sourceAccount     - Funded `Account` for transaction fee.
   * @returns Assembled (but unsigned) transaction XDR string.
   */
  async buildClaimRequest(
    requestId: bigint,
    verifierSignature: Uint8Array,
    sourceAccount: Account,
  ): Promise<string> {
    if (verifierSignature.length !== 64) {
      throw new Error(
        `DepositManager.claim_request: verifierSignature must be 64 bytes, got ${verifierSignature.length}`,
      );
    }

    const op = this.contract.call(
      "claim_request",
      nativeToScVal(requestId, { type: "u128" }),
      xdr.ScVal.scvBytes(Buffer.from(verifierSignature)),
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const simResult = await this.server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw new Error(
        `DepositManager.claim_request simulation error: ${simResult.error}`,
      );
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return assembled.toXDR();
  }
}

// ── Module-level singleton factory ────────────────────────────────────────────

/**
 * Creates a `DepositManagerClient` from a contract ID.
 * Returns `null` when `contractId` is empty (unconfigured env).
 */
export function createDepositManagerClient(
  contractId: string,
): DepositManagerClient | null {
  if (!contractId) return null;
  return new DepositManagerClient(contractId);
}
