/**
 * Generic Soroban token client for SAC (Stellar Asset Contract) tokens.
 *
 * Exposes `total_supply()` and `balance(account)` for any SAC/fungible token.
 * Modeled on `StakedPlusdClient` — same `simulateReadCall` helper, same
 * `createTokenClient` factory pattern.
 *
 * Used by the Balance Sheet panel to read:
 *   - PLUSD total supply  (plusd SAC contract)
 *   - Protocol USDC reserve balance  (usdc SAC contract)
 *
 * Futurenet addresses:
 *   - plusd:  CBVAYH66RIGA5PKSGHKKGOOQDUPKNVFYBW6P7CGMDX4SD7BI7TXUXSKI
 *   - usdc:   CBSUIUCCJKYOAMDYDJHQUJRVOGZIMBBTHWQDOEOZOM4KAMCBKYBP7PLI
 *
 * WARNING — Stellar Futurenet is periodically reset. If contract calls start
 * failing with "contract not found", re-deploy and update the env vars.
 * All amounts are raw i128 `bigint` at 7-decimal (SAC) scale.
 */

import {
  Account,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  scValToNative,
  rpc as SorobanRpc,
} from "@stellar/stellar-sdk";
import {
  sorobanRpcUrl,
  networkPassphrase,
  READ_SIMULATION_SOURCE,
} from "../chain";

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Lightweight Soroban client for any SAC/fungible token contract.
 * Read-only: `totalSupply()` and `balance(account)`.
 */
export class TokenClient {
  private readonly contract: Contract;
  private readonly server: SorobanRpc.Server;

  constructor(contractId: string) {
    if (!contractId) {
      throw new Error(
        "TokenClient: contractId must not be empty. " +
          "Set the appropriate VITE_STELLAR_*_ID env var.",
      );
    }
    this.contract = new Contract(contractId);
    this.server = new SorobanRpc.Server(sorobanRpcUrl, {
      allowHttp: sorobanRpcUrl.startsWith("http://"),
    });
  }

  // ── Internal simulate helper ───────────────────────────────────────────────

  private async simulateReadCall(operation: xdr.Operation): Promise<xdr.ScVal> {
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
      throw new Error(`TokenClient simulation error: ${result.error}`);
    }

    if (!result.result) {
      throw new Error("TokenClient: simulation returned no result");
    }

    return result.result.retval;
  }

  // ── Read views ─────────────────────────────────────────────────────────────

  /**
   * Returns the total token supply as a raw i128 bigint at 7-decimal scale.
   * For PLUSD: 1 PLUSD = 10_000_000n.
   */
  async totalSupply(): Promise<bigint> {
    const op = this.contract.call("total_supply");
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as bigint;
  }

  /**
   * Returns the token balance for a given account as a raw i128 bigint at
   * 7-decimal scale.
   *
   * @param account - Stellar public key to query.
   */
  async balance(account: string): Promise<bigint> {
    const op = this.contract.call("balance", new Address(account).toScVal());
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as bigint;
  }
}

// ── Module-level factory ──────────────────────────────────────────────────────

/**
 * Creates a `TokenClient` from a contract ID.
 * Returns `null` when `contractId` is empty (unconfigured env) — callers must
 * short-circuit to `undefined` in this case, no crash.
 */
export function createTokenClient(contractId: string): TokenClient | null {
  if (!contractId) return null;
  return new TokenClient(contractId);
}
