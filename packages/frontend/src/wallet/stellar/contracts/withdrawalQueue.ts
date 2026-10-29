// spec: docs/frontend/wallet-flows.md#withdrawal-queue-reads
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
import {
  sorobanRpcUrl,
  networkPassphrase,
  READ_SIMULATION_SOURCE,
} from "../chain";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Mirrors the on-chain `Request` struct. */
export interface WithdrawalRequest {
  amount: bigint;
  claimed: boolean;
  timestamp: bigint;
  user: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Lightweight Soroban client for WithdrawalQueue.
 */
export class WithdrawalQueueClient {
  private readonly contract: Contract;
  private readonly server: SorobanRpc.Server;

  constructor(contractId: string) {
    if (!contractId) {
      throw new Error(
        "WithdrawalQueueClient: contractId must not be empty. " +
          "Set VITE_STELLAR_WITHDRAWAL_QUEUE_ID in your .env.",
      );
    }
    this.contract = new Contract(contractId);
    this.server = new SorobanRpc.Server(sorobanRpcUrl, {
      allowHttp: sorobanRpcUrl.startsWith("http://"),
    });
  }

  // ── Internal simulate helper ───────────────────────────────────────────────

  private async simulateReadCall(operation: xdr.Operation): Promise<xdr.ScVal> {
    // Read-only simulations require a structurally valid classic source
    // account (`G…`) on the envelope — NOT the contract ID.
    const dummyAccount = new Account(READ_SIMULATION_SOURCE, "0");

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
        `WithdrawalQueueClient simulation error: ${result.error}`,
      );
    }

    if (!result.result) {
      throw new Error("WithdrawalQueueClient: simulation returned no result");
    }

    return result.result.retval;
  }

  // ── Read views ─────────────────────────────────────────────────────────────

  /**
   * Returns the underlying asset (PLUSD SAC) contract ID.
   */
  async asset(): Promise<string> {
    const op = this.contract.call("asset");
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as string;
  }

  /**
   * Returns the share token contract ID.
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
   * Returns the verifier public key bytes (BytesN<32>).
   */
  async verifier(): Promise<Uint8Array> {
    const op = this.contract.call("verifier");
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as Uint8Array;
  }

  /**
   * Returns the withdrawal request for a given request ID.
   */
  async getRequest(requestId: bigint): Promise<WithdrawalRequest> {
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
   * Returns the EIP-712-style digest for a withdrawal request.
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

  async rate(): Promise<bigint> {
    const retval = await this.simulateReadCall(this.contract.call("rate"));
    return BigInt(scValToNative(retval) as bigint | number | string);
  }

  async totalQueued(): Promise<bigint> {
    const retval = await this.simulateReadCall(
      this.contract.call("total_queued"),
    );
    return BigInt(scValToNative(retval) as bigint | number | string);
  }

  async totalClaimed(): Promise<bigint> {
    const retval = await this.simulateReadCall(
      this.contract.call("total_claimed"),
    );
    return BigInt(scValToNative(retval) as bigint | number | string);
  }

  async claimable(requestId: bigint): Promise<boolean> {
    const retval = await this.simulateReadCall(
      this.contract.call(
        "claimable",
        nativeToScVal(requestId, { type: "u128" }),
      ),
    );
    return scValToNative(retval) as boolean;
  }

  async withdrawalRequestQueued(requestId: bigint): Promise<bigint> {
    const retval = await this.simulateReadCall(
      this.contract.call(
        "withdrawal_request_queued",
        nativeToScVal(requestId, { type: "u128" }),
      ),
    );
    return BigInt(scValToNative(retval) as bigint | number | string);
  }

  async simulateClaimPayout(
    sender: string,
    requestId: bigint,
    verifierSignature: Uint8Array,
    deadline: bigint,
  ): Promise<bigint> {
    const op = this.contract.call(
      "claim_request",
      nativeToScVal(requestId, { type: "u128" }),
      xdr.ScVal.scvBytes(
        Uint8Array.from(verifierSignature) as Parameters<
          typeof xdr.ScVal.scvBytes
        >[0],
      ),
      nativeToScVal(deadline, { type: "u64" }),
    );
    const tx = new TransactionBuilder(new Account(sender, "0"), {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();
    const result = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(result)) {
      throw new Error(
        `WithdrawalQueue.claim_request simulation error: ${result.error}`,
      );
    }
    if (!result.result) {
      throw new Error("WithdrawalQueueClient: simulation returned no result");
    }
    return BigInt(
      scValToNative(result.result.retval) as bigint | number | string,
    );
  }

  // ── Write builders (unsigned) ──────────────────────────────────────────────

  /**
   * Builds an unsigned `request_withdrawal` transaction XDR.
   * Callers must sign and submit via the wallet kit.
   *
   * @param sender        - Stellar public key of the withdrawing account.
   * @param amount        - Raw i128 amount (7-decimal; 1 PLUSD = 10_000_000n).
   * @param sourceAccount - Funded `Account` object for transaction fee.
   * @returns Assembled (but unsigned) transaction XDR string.
   */
  async buildRequestWithdrawal(
    sender: string,
    amount: bigint,
    sourceAccount: Account,
  ): Promise<string> {
    const op = this.contract.call(
      "request_withdrawal",
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
        `WithdrawalQueue.request_withdrawal simulation error: ${simResult.error}`,
      );
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return assembled.toXDR();
  }

  /**
   * Builds an unsigned `claim_request` transaction XDR.
   *
   * @param requestId         - The u128 request ID.
   * @param verifierSignature - 64-byte verifier signature (BytesN<64>).
   * @param deadline          - Claim deadline (u64 seconds), from the voucher response.
   * @param sourceAccount     - Funded `Account` for transaction fee.
   * @returns Assembled (but unsigned) transaction XDR string.
   */
  async buildClaimRequest(
    requestId: bigint,
    verifierSignature: Uint8Array,
    deadline: bigint,
    sourceAccount: Account,
  ): Promise<string> {
    if (verifierSignature.length !== 64) {
      throw new Error(
        `WithdrawalQueue.claim_request: verifierSignature must be 64 bytes, got ${verifierSignature.length}`,
      );
    }

    const op = this.contract.call(
      "claim_request",
      nativeToScVal(requestId, { type: "u128" }),
      xdr.ScVal.scvBytes(
        Uint8Array.from(verifierSignature) as Parameters<
          typeof xdr.ScVal.scvBytes
        >[0],
      ),
      nativeToScVal(deadline, { type: "u64" }),
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
        `WithdrawalQueue.claim_request simulation error: ${simResult.error}`,
      );
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return assembled.toXDR();
  }
}

// ── Module-level factory ──────────────────────────────────────────────────────

/**
 * Creates a `WithdrawalQueueClient` from a contract ID.
 * Returns `null` when `contractId` is empty (unconfigured env).
 */
export function createWithdrawalQueueClient(
  contractId: string,
): WithdrawalQueueClient | null {
  if (!contractId) return null;
  return new WithdrawalQueueClient(contractId);
}
