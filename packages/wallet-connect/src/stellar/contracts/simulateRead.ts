// spec: docs/product-specs/loan-repayment-recovery.md
import {
  Account,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  scValToNative,
  rpc as SorobanRpc,
  type xdr,
} from "@stellar/stellar-sdk";
import { READ_SIMULATION_SOURCE } from "../sacBalance";

export interface SimulateReadOptions {
  rpcUrl: string;
  networkPassphrase: string;
  label?: string;
}

export async function simulateRead(
  contractId: string,
  fn: string,
  args: xdr.ScVal[],
  { rpcUrl, networkPassphrase, label = fn }: SimulateReadOptions,
): Promise<unknown> {
  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
  const op = new Contract(contractId).call(fn, ...args);
  const tx = new TransactionBuilder(new Account(READ_SIMULATION_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`${label} simulation error: ${sim.error}`);
  }
  if (!sim.result) {
    throw new Error(`${label}: simulation returned no result`);
  }
  return scValToNative(sim.result.retval);
}
