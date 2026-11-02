// spec: docs/product-specs/staking.md#default-pockets
import {
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
  rpc as SorobanRpc,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { RelayStage } from "./accessManager";
import { simulateRead, type SimulateReadOptions } from "./simulateRead";

export type ClaimPocketStage = RelayStage;

const POCKET_NOT_FOUND = /Error\(Contract, #2\)/;

export interface PocketBase extends SimulateReadOptions {
  pocketId: string;
  loanId: number;
}

export interface PocketHolderRead extends PocketBase {
  holder: string;
}

export interface PocketData {
  balance: string | null;
}

function requireId(who: string, pocketId: string): void {
  if (!pocketId) throw new Error(`${who}: pocketId must not be empty`);
}

function loanIdScVal(loanId: number) {
  return nativeToScVal(loanId, { type: "u32" });
}

export async function readPocket({
  pocketId,
  loanId,
  rpcUrl,
  networkPassphrase,
}: PocketBase): Promise<PocketData | null> {
  requireId("readPocket", pocketId);
  try {
    const data = (await simulateRead(
      pocketId,
      "pocket",
      [loanIdScVal(loanId)],
      { rpcUrl, networkPassphrase },
    )) as Record<string, unknown> | undefined;
    const balance = data?.balance;
    return {
      balance:
        balance === undefined || balance === null ? null : String(balance),
    };
  } catch (err) {
    if (err instanceof Error && POCKET_NOT_FOUND.test(err.message)) return null;
    throw err;
  }
}

async function readHolderAmount(
  fn: "claimable" | "claimed",
  { pocketId, holder, loanId, rpcUrl, networkPassphrase }: PocketHolderRead,
): Promise<string> {
  requireId(fn, pocketId);
  const value = await simulateRead(
    pocketId,
    fn,
    [new Address(holder).toScVal(), loanIdScVal(loanId)],
    { rpcUrl, networkPassphrase },
  );
  return String(value);
}

export function readPocketClaimable(p: PocketHolderRead): Promise<string> {
  return readHolderAmount("claimable", p);
}

export function readPocketClaimed(p: PocketHolderRead): Promise<string> {
  return readHolderAmount("claimed", p);
}

export interface BuildClaimEnvelopeParams {
  pocketId: string;
  holder: string;
  loanId: number;
  rpcUrl: string;
  networkPassphrase: string;
}

export interface ClaimPocketParams extends BuildClaimEnvelopeParams {
  signTransaction: (
    xdrStr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
  onStageChange?: (stage: ClaimPocketStage) => void;
}

export interface ClaimPocketResult {
  hash: string;
  amount: string | null;
}

export async function buildClaimEnvelope({
  pocketId,
  holder,
  loanId,
  rpcUrl,
  networkPassphrase,
}: BuildClaimEnvelopeParams): Promise<string> {
  requireId("buildClaimEnvelope", pocketId);
  if (!holder) throw new Error("buildClaimEnvelope: holder must not be empty");

  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
  const sourceAccount = await server.getAccount(holder);
  const op = new Contract(pocketId).call(
    "claim",
    new Address(holder).toScVal(),
    loanIdScVal(loanId),
  );
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`claimPocket simulation error: ${simResult.error}`);
  }
  return SorobanRpc.assembleTransaction(tx, simResult).build().toXDR();
}

function amountFromReturnValue(
  finalResult: SorobanRpc.Api.GetSuccessfulTransactionResponse,
): string | null {
  if (!finalResult.returnValue) return null;
  try {
    const native = scValToNative(finalResult.returnValue);
    return typeof native === "bigint" || typeof native === "number"
      ? String(native)
      : null;
  } catch {
    return null;
  }
}

export async function claimPocket({
  signTransaction,
  onStageChange,
  ...build
}: ClaimPocketParams): Promise<ClaimPocketResult> {
  onStageChange?.("awaiting-signature");
  const assembledXdr = await buildClaimEnvelope(build);

  const { networkPassphrase, rpcUrl, holder } = build;
  const { signedTxXdr } = await signTransaction(assembledXdr, {
    networkPassphrase,
    address: holder,
  });

  onStageChange?.("submitting");
  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);
  const sendResult = await server.sendTransaction(signedTx as Transaction);
  if (sendResult.status === "ERROR") {
    throw new Error(
      `claimPocket: sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
    );
  }

  onStageChange?.("confirming");
  const finalResult = await server.pollTransaction(sendResult.hash);
  if (finalResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `claimPocket: transaction ${sendResult.hash} failed with status ${finalResult.status}`,
    );
  }
  return { hash: sendResult.hash, amount: amountFromReturnValue(finalResult) };
}
