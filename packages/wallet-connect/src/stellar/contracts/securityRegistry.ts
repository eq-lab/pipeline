// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import {
  Address,
  BASE_FEE,
  Contract,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc as SorobanRpc,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import {
  readOperationSchedule,
  relay,
  type OperationSchedule,
  type RelayStage,
  type RelayParams,
  type RelayResult,
} from "./accessManager";
import { hexToBytes32ScVal } from "./minter";
import { sha256Hex } from "./hash";
import { operationArgsXdr } from "./scheduledOperation";
import { scMap, u32, u64 } from "./scval";
import { simulateRead, type SimulateReadOptions } from "./simulateRead";

export type SecurityPaymentTerm = "Lc" | "Dp" | "Da" | "OpenAccount";
export type FlagOutcome = "Accepted" | "TopUpRequired" | "Escalated";

export const SECURITY_PAYMENT_TERMS: readonly SecurityPaymentTerm[] = [
  "Lc",
  "Dp",
  "Da",
  "OpenAccount",
];
export const FLAG_OUTCOMES: readonly FlagOutcome[] = [
  "Accepted",
  "TopUpRequired",
  "Escalated",
];

export interface SecurityTermsInput {
  advanceRatioBps: number;
  marginCallRatioBps: number;
  curePeriod: number | string;
  priceStaleAfter: number | string;
  paymentTerm: SecurityPaymentTerm;
  gracePeriod: number | string;
  defaultRate: number;
  attestationInterval: number | string;
  inspectionInterval: number | string;
  toleranceBps: number;
  gradeToleranceBps: number;
}

export type SecurityRegistryCall =
  | { fn: "set_terms"; loanId: number; terms: SecurityTermsInput }
  | {
      fn: "resolve_flag";
      recordId: number;
      outcome: FlagOutcome;
      reasonHash: string;
    }
  | { fn: "release_with_consent"; recordId: number; consentHash: string }
  | { fn: "set_inspectors"; inspectors: string[] }
  | {
      fn: "revalue";
      recordId: number;
      valuePerUnit: string;
      benchmark: string;
      reportHash: string;
    }
  | {
      fn: "record_extension_consent";
      loanId: number;
      newMaturity: number | string;
      consentHash: string;
    };

const U32_MAX = 0xffffffff;
const U64_MAX = 2n ** 64n - 1n;
const HEX32 = /^[0-9a-f]{64}$/;
const DECIMAL = /^[0-9]+$/;
const DECIMAL_7DP = /^(\d+)(?:\.(\d{1,7}))?$/;
const BENCHMARK = /^[A-Za-z0-9_]{1,32}$/;
const I128_MAX = 2n ** 127n - 1n;

function fail(what: string, value: unknown): never {
  throw new Error(`encodeSecurityRegistryArgs: invalid ${what} ${value}`);
}

function u32Arg(value: number, what: string): xdr.ScVal {
  if (!Number.isInteger(value) || value < 0 || value > U32_MAX) {
    fail(what, value);
  }
  return u32(value);
}

function u64Arg(value: number | string, what: string): xdr.ScVal {
  const text = typeof value === "number" ? String(value) : value;
  if (!DECIMAL.test(text) || BigInt(text) > U64_MAX) fail(what, value);
  return u64(BigInt(text));
}

function hashArg(value: string, what: string): xdr.ScVal {
  if (!HEX32.test(value)) fail(what, value);
  return hexToBytes32ScVal(value);
}

export function isSecurityBenchmark(value: string): boolean {
  return BENCHMARK.test(value);
}

export function decimal7ToI128(text: string): bigint {
  const match = DECIMAL_7DP.exec(text.trim());
  if (!match) fail("value per unit", text);
  const [, whole = "0", fraction = ""] = match;
  const raw = BigInt(whole) * 10n ** 7n + BigInt(fraction.padEnd(7, "0"));
  if (raw > I128_MAX) fail("value per unit", text);
  return raw;
}

function variant(name: string): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
}

function encodeTerms(terms: SecurityTermsInput): xdr.ScVal {
  if (terms.marginCallRatioBps < terms.advanceRatioBps) {
    fail(
      "marginCallRatioBps (below advanceRatioBps)",
      terms.marginCallRatioBps,
    );
  }
  if (!SECURITY_PAYMENT_TERMS.includes(terms.paymentTerm)) {
    fail("paymentTerm", terms.paymentTerm);
  }
  return scMap([
    ["advance_ratio_bps", u32Arg(terms.advanceRatioBps, "advanceRatioBps")],
    [
      "attestation_interval",
      u64Arg(terms.attestationInterval, "attestationInterval"),
    ],
    ["cure_period", u64Arg(terms.curePeriod, "curePeriod")],
    ["default_rate", u32Arg(terms.defaultRate, "defaultRate")],
    ["grace_period", u64Arg(terms.gracePeriod, "gracePeriod")],
    [
      "grade_tolerance_bps",
      u32Arg(terms.gradeToleranceBps, "gradeToleranceBps"),
    ],
    [
      "inspection_interval",
      u64Arg(terms.inspectionInterval, "inspectionInterval"),
    ],
    ["margin_call_at", u64(0n)],
    [
      "margin_call_ratio_bps",
      u32Arg(terms.marginCallRatioBps, "marginCallRatioBps"),
    ],
    ["payment_term", variant(terms.paymentTerm)],
    ["price_stale_after", u64Arg(terms.priceStaleAfter, "priceStaleAfter")],
    ["tolerance_bps", u32Arg(terms.toleranceBps, "toleranceBps")],
  ]);
}

export function isInspectorAddress(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value);
}

export function encodeSecurityRegistryArgs(
  call: SecurityRegistryCall,
): xdr.ScVal[] {
  switch (call.fn) {
    case "set_terms":
      return [u32Arg(call.loanId, "loanId"), encodeTerms(call.terms)];
    case "resolve_flag": {
      if (!FLAG_OUTCOMES.includes(call.outcome)) fail("outcome", call.outcome);
      return [
        u32Arg(call.recordId, "recordId"),
        variant(call.outcome),
        hashArg(call.reasonHash, "reasonHash"),
      ];
    }
    case "release_with_consent":
      return [
        u32Arg(call.recordId, "recordId"),
        hashArg(call.consentHash, "consentHash"),
      ];
    case "set_inspectors": {
      const seen = new Set<string>();
      for (const inspector of call.inspectors) {
        if (!isInspectorAddress(inspector)) fail("inspector", inspector);
        if (seen.has(inspector)) fail("duplicate inspector", inspector);
        seen.add(inspector);
      }
      return [
        xdr.ScVal.scvVec(
          call.inspectors.map((inspector) => new Address(inspector).toScVal()),
        ),
      ];
    }
    case "revalue": {
      if (!BENCHMARK.test(call.benchmark)) fail("benchmark", call.benchmark);
      return [
        u32Arg(call.recordId, "recordId"),
        nativeToScVal(decimal7ToI128(call.valuePerUnit), { type: "i128" }),
        xdr.ScVal.scvSymbol(call.benchmark),
        hashArg(call.reportHash, "reportHash"),
      ];
    }
    case "record_extension_consent":
      return [
        u32Arg(call.loanId, "loanId"),
        u64Arg(call.newMaturity, "newMaturity"),
        hashArg(call.consentHash, "consentHash"),
      ];
    default:
      throw new Error("encodeSecurityRegistryArgs: unknown function");
  }
}

export function securityRegistryArgsXdr(call: SecurityRegistryCall): string {
  return operationArgsXdr(encodeSecurityRegistryArgs(call));
}

export interface SecurityRegistryRelayParams extends Omit<
  RelayParams,
  "target" | "fn" | "args" | "caller"
> {
  call: SecurityRegistryCall;
  registryId: string;
  caller: string;
}

export function relaySecurityRegistry({
  call,
  registryId,
  ...rest
}: SecurityRegistryRelayParams): Promise<RelayResult> {
  return relay({
    ...rest,
    target: registryId,
    fn: call.fn,
    args: encodeSecurityRegistryArgs(call),
  });
}

export interface ReadSecurityRegistryScheduleParams extends SimulateReadOptions {
  call: SecurityRegistryCall;
  accessManagerId: string;
  registryId: string;
  caller: string;
}

export function readSecurityRegistrySchedule({
  call,
  registryId,
  ...rest
}: ReadSecurityRegistryScheduleParams): Promise<OperationSchedule> {
  return readOperationSchedule({
    ...rest,
    target: registryId,
    fn: call.fn,
    args: encodeSecurityRegistryArgs(call),
  });
}

export function securityReasonHash(text: string): Promise<string> {
  return sha256Hex(text.trim());
}

export interface ReadSecurityInspectorsParams extends SimulateReadOptions {
  registryId: string;
}

export async function readSecurityInspectors({
  registryId,
  rpcUrl,
  networkPassphrase,
}: ReadSecurityInspectorsParams): Promise<string[]> {
  if (!registryId) {
    throw new Error("readSecurityInspectors: registryId must not be empty");
  }
  const data = await simulateRead(registryId, "inspectors", [], {
    rpcUrl,
    networkPassphrase,
  });
  if (data == null) return [];
  if (!Array.isArray(data)) {
    throw new Error("readSecurityInspectors: unexpected result");
  }
  return data.map(String);
}

export interface BuildCheckCoverageEnvelopeParams {
  registryId: string;
  loanId: number;
  caller: string;
  rpcUrl: string;
  networkPassphrase: string;
}

export interface CheckCoverageParams extends BuildCheckCoverageEnvelopeParams {
  signTransaction: (
    xdrStr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
  onStageChange?: (stage: RelayStage) => void;
}

export async function buildCheckCoverageEnvelope({
  registryId,
  loanId,
  caller,
  rpcUrl,
  networkPassphrase,
}: BuildCheckCoverageEnvelopeParams): Promise<string> {
  if (!registryId) {
    throw new Error("buildCheckCoverageEnvelope: registryId must not be empty");
  }
  if (!caller) {
    throw new Error("buildCheckCoverageEnvelope: caller must not be empty");
  }
  const args = [u32Arg(loanId, "loanId")];
  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
  const sourceAccount = await server.getAccount(caller);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(new Contract(registryId).call("check_coverage", ...args))
    .setTimeout(30)
    .build();
  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`checkCoverage simulation error: ${simResult.error}`);
  }
  return SorobanRpc.assembleTransaction(tx, simResult).build().toXDR();
}

export async function checkCoverage({
  signTransaction,
  onStageChange,
  ...params
}: CheckCoverageParams): Promise<RelayResult> {
  onStageChange?.("awaiting-signature");
  const assembledXdr = await buildCheckCoverageEnvelope(params);
  const { signedTxXdr } = await signTransaction(assembledXdr, {
    networkPassphrase: params.networkPassphrase,
    address: params.caller,
  });
  onStageChange?.("submitting");
  const server = new SorobanRpc.Server(params.rpcUrl, {
    allowHttp: params.rpcUrl.startsWith("http://"),
  });
  const signedTx = TransactionBuilder.fromXDR(
    signedTxXdr,
    params.networkPassphrase,
  );
  const sendResult = await server.sendTransaction(signedTx as Transaction);
  if (sendResult.status === "ERROR") {
    throw new Error(
      `checkCoverage: sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
    );
  }
  onStageChange?.("confirming");
  const finalResult = await server.pollTransaction(sendResult.hash);
  if (finalResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `checkCoverage: transaction ${sendResult.hash} failed with status ${finalResult.status}`,
    );
  }
  return { hash: sendResult.hash };
}
