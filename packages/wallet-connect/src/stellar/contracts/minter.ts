// spec: docs/product-specs/deposits.md#stellar-plusd-mint-leg
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
  rpc as SorobanRpc,
  type Transaction,
} from "@stellar/stellar-sdk";

export type RecordWireInStage =
  | "awaiting-signature"
  | "submitting"
  | "confirming";

export interface RecordWireInArgs {
  caller: string;
  receiver: string;
  amount: string;
  valueDate: number;
  refHash: string;
}

export interface BuildRecordWireInEnvelopeParams extends RecordWireInArgs {
  minterId: string;
  rpcUrl: string;
  networkPassphrase: string;
}

export interface RecordWireInParams extends BuildRecordWireInEnvelopeParams {
  signTransaction: (
    xdrStr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
  onStageChange?: (stage: RecordWireInStage) => void;
}

export interface RecordWireInResult {
  hash: string;
  wireId: number | null;
}

const CONTRACT_DECIMALS = 7;

export function parseUsdDollarsToI128(decimalStr: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(decimalStr.trim());
  if (!match) {
    throw new Error(
      `parseUsdDollarsToI128: invalid USD amount "${decimalStr}"`,
    );
  }
  const [, intPart = "0", fracPart = ""] = match;
  const scaled =
    BigInt(intPart) * 10n ** BigInt(CONTRACT_DECIMALS) +
    BigInt(fracPart.padEnd(CONTRACT_DECIMALS, "0"));
  if (scaled <= 0n) {
    throw new Error(
      `parseUsdDollarsToI128: amount must be greater than zero ("${decimalStr}")`,
    );
  }
  return scaled;
}

export function hexToBytes32ScVal(hex: string): xdr.ScVal {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(
      `hexToBytes32ScVal: expected 64 lowercase hex characters, got "${hex}"`,
    );
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return nativeToScVal(bytes, { type: "bytes" });
}

export function encodeRecordWireInArgs({
  caller,
  receiver,
  amount,
  valueDate,
  refHash,
}: RecordWireInArgs): xdr.ScVal[] {
  if (!Number.isInteger(valueDate) || valueDate <= 0) {
    throw new Error(
      `encodeRecordWireInArgs: valueDate must be a positive Unix-seconds integer, got ${valueDate}`,
    );
  }
  return [
    new Address(caller).toScVal(),
    new Address(receiver).toScVal(),
    nativeToScVal(parseUsdDollarsToI128(amount), { type: "i128" }),
    nativeToScVal(BigInt(valueDate), { type: "u64" }),
    hexToBytes32ScVal(refHash),
  ];
}

export async function buildRecordWireInEnvelope({
  minterId,
  caller,
  receiver,
  amount,
  valueDate,
  refHash,
  rpcUrl,
  networkPassphrase,
}: BuildRecordWireInEnvelopeParams): Promise<string> {
  if (!minterId) {
    throw new Error("buildRecordWireInEnvelope: minterId must not be empty");
  }
  if (!caller) {
    throw new Error("buildRecordWireInEnvelope: caller must not be empty");
  }
  if (!receiver) {
    throw new Error("buildRecordWireInEnvelope: receiver must not be empty");
  }

  const args = encodeRecordWireInArgs({
    caller,
    receiver,
    amount,
    valueDate,
    refHash,
  });

  const contract = new Contract(minterId);
  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });

  const sourceAccount = await server.getAccount(caller);
  const op = contract.call("record_wire_in", ...args);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`recordWireIn simulation error: ${simResult.error}`);
  }

  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
  return assembled.toXDR();
}

function toWireId(native: unknown): number | null {
  const n =
    typeof native === "bigint"
      ? Number(native)
      : typeof native === "number"
        ? native
        : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function extractWireId(
  finalResult: SorobanRpc.Api.GetSuccessfulTransactionResponse,
): number | null {
  try {
    if (finalResult.returnValue) {
      const id = toWireId(scValToNative(finalResult.returnValue));
      if (id != null) return id;
    }
  } catch {}

  try {
    const events = finalResult.resultMetaXdr.v3().sorobanMeta()?.events() ?? [];
    for (const event of events) {
      const topics = event.body().v0().topics();
      const nameTopic = topics[0];
      const idTopic = topics[1];
      if (!nameTopic || !idTopic) continue;
      if (scValToNative(nameTopic) === "wire_in") {
        const id = toWireId(scValToNative(idTopic));
        if (id != null) return id;
      }
    }
  } catch {}

  return null;
}

export async function recordWireIn({
  minterId,
  caller,
  receiver,
  amount,
  valueDate,
  refHash,
  rpcUrl,
  networkPassphrase,
  signTransaction,
  onStageChange,
}: RecordWireInParams): Promise<RecordWireInResult> {
  onStageChange?.("awaiting-signature");

  const assembledXdr = await buildRecordWireInEnvelope({
    minterId,
    caller,
    receiver,
    amount,
    valueDate,
    refHash,
    rpcUrl,
    networkPassphrase,
  });

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
      `recordWireIn: sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
    );
  }

  onStageChange?.("confirming");

  const finalResult = await server.pollTransaction(sendResult.hash);

  if (finalResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `recordWireIn: transaction ${sendResult.hash} failed with status ${finalResult.status}`,
    );
  }

  return { hash: sendResult.hash, wireId: extractWireId(finalResult) };
}
