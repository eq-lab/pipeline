// Chain access of the e2e journeys on the local Stellar stack: classic payments, Soroban invoke and read; see docs/e2e.md.

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  nativeToScVal,
  Operation,
  rpc,
  scValToNative,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";
import { STANDALONE_PASSPHRASE } from "./guard";
import { PORTS } from "./env";
import { stackDir } from "./stack";

const RPC_URL = `http://localhost:${PORTS.stellar}/rpc`;
const HORIZON_URL = `http://localhost:${PORTS.stellar}`;
export const soroban = new rpc.Server(RPC_URL, { allowHttp: true });
const horizon = new Horizon.Server(HORIZON_URL, { allowHttp: true });

export const addr = (a: string) => nativeToScVal(a, { type: "address" });
export const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
export const u128 = (n: bigint) => nativeToScVal(n, { type: "u128" });
export const u64 = (n: bigint) => nativeToScVal(n, { type: "u64" });
export const bytes = (hex: string) => nativeToScVal(Buffer.from(hex.replace(/^0x/, ""), "hex"));

export function stackKey(tag: string, name: string): Keypair {
  const env = { ...process.env, XDG_CONFIG_HOME: stackDir(tag) };
  return Keypair.fromSecret(execFileSync("stellar", ["keys", "secret", name], { encoding: "utf8", env }).trim());
}

export async function friendbot(account: string): Promise<void> {
  const r = await fetch(`${HORIZON_URL}/friendbot?addr=${account}`);
  if (!r.ok) throw new Error(`friendbot ${account}: ${r.status}`);
}

export async function classic(source: Keypair, ops: xdr.Operation[], signers: Keypair[] = [source]): Promise<void> {
  const account = await horizon.loadAccount(source.publicKey());
  const builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: STANDALONE_PASSPHRASE }).setTimeout(60);
  for (const op of ops) builder.addOperation(op);
  const tx = builder.build();
  tx.sign(...signers);
  await horizon.submitTransaction(tx);
}

export const trust = (asset: Asset) => Operation.changeTrust({ asset });
export const pay = (destination: string, asset: Asset, raw: bigint) =>
  Operation.payment({ destination, asset, amount: (Number(raw) / 1e7).toFixed(7) });

/** Contract error code of a failed simulation or transaction ("Error(Contract, #12)"), or undefined. */
export const contractError = (message: string) => /Error\(Contract, #(\d+)\)/.exec(message)?.[1];

let lastWrite = 0;
// Raw JSON-RPC: SDK 15.1 cannot decode the protocol-30 ledger header that getLatestLedger returns.
const latestLedger = async () =>
  (
    (await (
      await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" }) })
    ).json()) as { result: { sequence: number } }
  ).result.sequence;

export const invoke = (signer: Keypair, contractId: string, fn: string, args: xdr.ScVal[]): Promise<unknown> =>
  submit(signer, new Contract(contractId).call(fn, ...args), fn);

/** Simulates, signs and sends one Soroban operation; the return value as a native value. */
export async function submit(signer: Keypair, op: xdr.Operation, fn: string): Promise<unknown> {
  // Simulated in the ledger of the previous write, a per-ledger key (sPLUSD's HolderCheckpoint) lands outside the footprint.
  while ((await latestLedger()) <= lastWrite) await new Promise((r) => setTimeout(r, 250));
  const account = await soroban.getAccount(signer.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: STANDALONE_PASSPHRASE }).addOperation(op).setTimeout(60).build();
  const sim = await soroban.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${fn}: simulation failed: ${sim.error}`);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(signer);
  const sent = await soroban.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`${fn}: send failed: ${sent.errorResult?.result().switch().name}`);
  const done = await soroban.pollTransaction(sent.hash, { attempts: 60, sleepStrategy: () => 500 });
  if (done.status !== "SUCCESS") throw new Error(`${fn}: transaction ${sent.hash} ${done.status}`);
  lastWrite = done.ledger;
  return done.returnValue === undefined ? undefined : scValToNative(done.returnValue);
}

export async function read<T>(source: string, contractId: string, fn: string, args: xdr.ScVal[] = []): Promise<T> {
  const account = await soroban.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: STANDALONE_PASSPHRASE })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(60)
    .build();
  const sim = await soroban.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${fn}: simulation failed: ${sim.error}`);
  return scValToNative(sim.result!.retval) as T;
}

export { Asset, Keypair, Operation };
