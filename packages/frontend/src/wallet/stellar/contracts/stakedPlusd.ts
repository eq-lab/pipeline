/**
 * Typed Soroban client for the Pipeline StakedPLUSD FungibleVault contract.
 *
 * Contract ID (testnet):  CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5
 * Interface captured:     2026-06-18  (extracted from testnet WASM via
 *                         `stellar contract info interface --id CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5 --network testnet`)
 *
 * WARNING — Stellar testnet is periodically reset. If contract calls start
 * failing with "contract not found", re-deploy and update
 * `VITE_STELLAR_STAKED_PLUSD_ID`. The checked-in bindings remain valid as long
 * as the same WASM is re-deployed.
 *
 * Interface notes (resolved from live WASM — diverges from EVM ERC-4626):
 *   - The vault contract IS the share token (sPLUSD) — it implements a SAC-like
 *     interface (`balance`, `total_supply`, `name`, `symbol`, `decimals`).
 *     There is NO separate share contract; `balance(account)` returns LP's sPLUSD shares.
 *   - Underlying asset accessor: `query_asset()` (NOT `asset()`).
 *   - `deposit` and `redeem` take four arguments: the standard ERC-4626 pair
 *     plus `from` (the account whose PLUSD is pulled) and `operator`
 *     (the authorized caller). For user-initiated staking, `sender == from == operator`.
 *   - No `paused()` method is exposed in the frontend-relevant interface.
 *   - All i128 amounts use 7-decimal SAC scale: 1 PLUSD/sPLUSD = 10_000_000n.
 *
 * Frontend-relevant subset exposed here:
 *   Reads:  query_asset, balance, convert_to_assets, convert_to_shares,
 *           total_supply, total_assets, name (share token name)
 *   Writes: deposit (builder only), redeem (builder only), withdraw (builder only)
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
import {
  sorobanRpcUrl,
  networkPassphrase,
  READ_SIMULATION_SOURCE,
} from "../chain";

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Lightweight Soroban client for the StakedPLUSD FungibleVault contract.
 */
export class StakedPlusdClient {
  private readonly contract: Contract;
  private readonly server: SorobanRpc.Server;

  constructor(contractId: string) {
    if (!contractId) {
      throw new Error(
        "StakedPlusdClient: contractId must not be empty. " +
          "Set VITE_STELLAR_STAKED_PLUSD_ID in your .env.",
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
      throw new Error(`StakedPlusdClient simulation error: ${result.error}`);
    }

    if (!result.result) {
      throw new Error("StakedPlusdClient: simulation returned no result");
    }

    return result.result.retval;
  }

  // ── Read views ─────────────────────────────────────────────────────────────

  /**
   * Returns the underlying asset (PLUSD SAC) contract ID.
   * NOTE: the method name on-chain is `query_asset`, NOT `asset()`.
   */
  async queryAsset(): Promise<string> {
    const op = this.contract.call("query_asset");
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as string;
  }

  /**
   * Returns the share token (sPLUSD) balance for a given account.
   * Since the vault IS the share token, this reads the vault's own SAC balance.
   *
   * @param account - Stellar public key to query.
   * @returns Raw i128 balance at 7-decimal scale.
   */
  async balance(account: string): Promise<bigint> {
    const op = this.contract.call("balance", new Address(account).toScVal());
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as bigint;
  }

  /**
   * Converts a share amount to the equivalent asset (PLUSD) amount.
   *
   * @param shares - Raw i128 share amount at 7-decimal scale.
   * @returns Raw i128 asset amount at 7-decimal scale.
   */
  async convertToAssets(shares: bigint): Promise<bigint> {
    const op = this.contract.call(
      "convert_to_assets",
      nativeToScVal(shares, { type: "i128" }),
    );
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as bigint;
  }

  /**
   * Converts an asset (PLUSD) amount to the equivalent share amount.
   *
   * @param assets - Raw i128 asset amount at 7-decimal scale.
   * @returns Raw i128 share amount at 7-decimal scale.
   */
  async convertToShares(assets: bigint): Promise<bigint> {
    const op = this.contract.call(
      "convert_to_shares",
      nativeToScVal(assets, { type: "i128" }),
    );
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as bigint;
  }

  /**
   * Returns the total supply of sPLUSD shares outstanding.
   */
  async totalSupply(): Promise<bigint> {
    const op = this.contract.call("total_supply");
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as bigint;
  }

  /**
   * Returns the total PLUSD assets managed by the vault.
   */
  async totalAssets(): Promise<bigint> {
    const op = this.contract.call("total_assets");
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as bigint;
  }

  /**
   * Returns the share token name string (e.g. `"sPLUSD:GISSUER"`).
   * Used to derive the classic `{ code, issuer }` for trustline checks.
   */
  async name(): Promise<string> {
    const op = this.contract.call("name");
    const retval = await this.simulateReadCall(op);
    return scValToNative(retval) as string;
  }

  // ── Write builders (unsigned) ──────────────────────────────────────────────

  /**
   * Builds an unsigned `deposit` transaction XDR.
   *
   * On-chain signature: `deposit(assets, receiver, from, operator) → shares`.
   * For user-initiated staking: `sender == from == operator`.
   * A single Soroban auth entry is sufficient — no separate `approve()` needed.
   *
   * @param sender        - Stellar public key of the staking account (from = operator = sender).
   * @param assets        - Raw i128 PLUSD amount to stake (7-decimal; 1 PLUSD = 10_000_000n).
   * @param receiver      - Account that receives the sPLUSD shares (usually = sender).
   * @param sourceAccount - Funded `Account` object for transaction fee.
   * @returns Assembled (but unsigned) transaction XDR string.
   */
  async buildDeposit(
    sender: string,
    assets: bigint,
    receiver: string,
    sourceAccount: Account,
  ): Promise<string> {
    const op = this.contract.call(
      "deposit",
      nativeToScVal(assets, { type: "i128" }),
      new Address(receiver).toScVal(),
      new Address(sender).toScVal(), // from
      new Address(sender).toScVal(), // operator
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
        `StakedPlusd.deposit simulation error: ${simResult.error}`,
      );
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return assembled.toXDR();
  }

  /**
   * Builds an unsigned `redeem` transaction XDR.
   *
   * On-chain signature: `redeem(shares, receiver, owner, operator) → assets`.
   * For user-initiated unstaking: `sender == owner == operator`.
   *
   * @param sender        - Stellar public key of the unstaking account (owner = operator = sender).
   * @param shares        - Raw i128 sPLUSD share amount to redeem (7-decimal; 1 sPLUSD = 10_000_000n).
   * @param receiver      - Account that receives the PLUSD assets (usually = sender).
   * @param sourceAccount - Funded `Account` object for transaction fee.
   * @returns Assembled (but unsigned) transaction XDR string.
   */
  async buildRedeem(
    sender: string,
    shares: bigint,
    receiver: string,
    sourceAccount: Account,
  ): Promise<string> {
    const op = this.contract.call(
      "redeem",
      nativeToScVal(shares, { type: "i128" }),
      new Address(receiver).toScVal(),
      new Address(sender).toScVal(), // owner
      new Address(sender).toScVal(), // operator
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
        `StakedPlusd.redeem simulation error: ${simResult.error}`,
      );
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return assembled.toXDR();
  }

  /**
   * Builds an unsigned `withdraw` transaction XDR.
   *
   * On-chain signature: `withdraw(assets, receiver, owner, operator) → shares`.
   * For user-initiated unstaking by asset amount: `sender == owner == operator`.
   *
   * @param sender        - Stellar public key of the unstaking account (owner = operator = sender).
   * @param assets        - Raw i128 PLUSD asset amount to withdraw (7-decimal).
   * @param receiver      - Account that receives the PLUSD assets (usually = sender).
   * @param sourceAccount - Funded `Account` object for transaction fee.
   * @returns Assembled (but unsigned) transaction XDR string.
   */
  async buildWithdraw(
    sender: string,
    assets: bigint,
    receiver: string,
    sourceAccount: Account,
  ): Promise<string> {
    const op = this.contract.call(
      "withdraw",
      nativeToScVal(assets, { type: "i128" }),
      new Address(receiver).toScVal(),
      new Address(sender).toScVal(), // owner
      new Address(sender).toScVal(), // operator
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
        `StakedPlusd.withdraw simulation error: ${simResult.error}`,
      );
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
    return assembled.toXDR();
  }
}

// ── Module-level factory ──────────────────────────────────────────────────────

/**
 * Creates a `StakedPlusdClient` from a contract ID.
 * Returns `null` when `contractId` is empty (unconfigured env).
 */
export function createStakedPlusdClient(
  contractId: string,
): StakedPlusdClient | null {
  if (!contractId) return null;
  return new StakedPlusdClient(contractId);
}
