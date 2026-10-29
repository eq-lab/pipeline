// spec: docs/product-specs/loan-repayment-recovery.md
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  rpc as SorobanRpc,
  type Transaction,
} from "@stellar/stellar-sdk";
import { simulateRead, type SimulateReadOptions } from "./simulateRead";

export type RelayStage = "awaiting-signature" | "submitting" | "confirming";
export type RelayMode = "schedule" | "execute";

export interface CanCall {
  immediate: boolean;
  delay: number;
}

export interface ReadCanCallParams extends SimulateReadOptions {
  accessManagerId: string;
  caller: string;
  target: string;
  fn: string;
}

export interface OperationSchedule {
  operationId: string;
  readyAt: number;
}

export interface ReadOperationScheduleParams extends ReadCanCallParams {
  args: xdr.ScVal[];
}

export interface BuildRelayEnvelopeParams extends ReadCanCallParams {
  mode: RelayMode;
  args: xdr.ScVal[];
}

export interface RelayParams extends BuildRelayEnvelopeParams {
  signTransaction: (
    xdrStr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
  onStageChange?: (stage: RelayStage) => void;
}

export interface RelayResult {
  hash: string;
}

function requireIds({
  accessManagerId,
  caller,
  target,
  who,
}: {
  accessManagerId: string;
  caller: string;
  target: string;
  who: string;
}): void {
  if (!accessManagerId) {
    throw new Error(`${who}: accessManagerId must not be empty`);
  }
  if (!caller) throw new Error(`${who}: caller must not be empty`);
  if (!target) throw new Error(`${who}: target must not be empty`);
}

function relayCallArgs(
  target: string,
  fn: string,
  args: xdr.ScVal[],
  caller: string,
): xdr.ScVal[] {
  return [
    new Address(target).toScVal(),
    xdr.ScVal.scvSymbol(fn),
    xdr.ScVal.scvVec(args),
    new Address(caller).toScVal(),
  ];
}

export async function readCanCall({
  accessManagerId,
  caller,
  target,
  fn,
  rpcUrl,
  networkPassphrase,
}: ReadCanCallParams): Promise<CanCall> {
  requireIds({ accessManagerId, caller, target, who: "readCanCall" });
  const data = (await simulateRead(
    accessManagerId,
    "can_call",
    [
      new Address(caller).toScVal(),
      new Address(target).toScVal(),
      xdr.ScVal.scvSymbol(fn),
    ],
    { rpcUrl, networkPassphrase },
  )) as { immediate?: boolean; delay?: number | bigint };
  return {
    immediate: data?.immediate === true,
    delay: Number(data?.delay ?? 0),
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readOperationSchedule({
  accessManagerId,
  caller,
  target,
  fn,
  args,
  rpcUrl,
  networkPassphrase,
}: ReadOperationScheduleParams): Promise<OperationSchedule> {
  requireIds({ accessManagerId, caller, target, who: "readOperationSchedule" });
  const opts = { rpcUrl, networkPassphrase };
  const [targetArg, fnArg, argsArg, callerArg] = relayCallArgs(
    target,
    fn,
    args,
    caller,
  );
  const hash = (await simulateRead(
    accessManagerId,
    "hash_operation",
    [callerArg!, targetArg!, fnArg!, argsArg!],
    opts,
  )) as Uint8Array;
  const readyAt = await simulateRead(
    accessManagerId,
    "get_schedule",
    [nativeToScVal(hash, { type: "bytes" })],
    opts,
  );
  return { operationId: toHex(hash), readyAt: Number(readyAt) };
}

export async function buildRelayEnvelope({
  accessManagerId,
  mode,
  caller,
  target,
  fn,
  args,
  rpcUrl,
  networkPassphrase,
}: BuildRelayEnvelopeParams): Promise<string> {
  requireIds({ accessManagerId, caller, target, who: "buildRelayEnvelope" });

  const [targetArg, fnArg, argsArg, callerArg] = relayCallArgs(
    target,
    fn,
    args,
    caller,
  );
  const callArgs =
    mode === "schedule"
      ? [
          targetArg!,
          fnArg!,
          argsArg!,
          nativeToScVal(0n, { type: "u64" }),
          callerArg!,
        ]
      : [targetArg!, fnArg!, argsArg!, callerArg!];

  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
  const sourceAccount = await server.getAccount(caller);
  const op = new Contract(accessManagerId).call(mode, ...callArgs);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`${mode} simulation error: ${simResult.error}`);
  }

  return SorobanRpc.assembleTransaction(tx, simResult).build().toXDR();
}

export async function relay({
  signTransaction,
  onStageChange,
  ...build
}: RelayParams): Promise<RelayResult> {
  onStageChange?.("awaiting-signature");

  const assembledXdr = await buildRelayEnvelope(build);

  const { networkPassphrase, rpcUrl, caller, mode } = build;
  const { signedTxXdr } = await signTransaction(assembledXdr, {
    networkPassphrase,
    address: caller,
  });

  onStageChange?.("submitting");

  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);

  const sendResult = await server.sendTransaction(signedTx as Transaction);
  if (sendResult.status === "ERROR") {
    throw new Error(
      `${mode}: sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
    );
  }

  onStageChange?.("confirming");

  const finalResult = await server.pollTransaction(sendResult.hash);
  if (finalResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `${mode}: transaction ${sendResult.hash} failed with status ${finalResult.status}`,
    );
  }

  return { hash: sendResult.hash };
}
