// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import {
  Address,
  BASE_FEE,
  Contract,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc as SorobanRpc,
  scValToNative,
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
export type InspectionKind =
  | "LoadingTally"
  | "DraftSurvey"
  | "SamplingAssay"
  | "DischargeSurvey"
  | "StockCount";

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
export const INSPECTION_KINDS: readonly InspectionKind[] = [
  "LoadingTally",
  "DraftSurvey",
  "SamplingAssay",
  "DischargeSurvey",
  "StockCount",
];

export function inspectionMeasuresQuantity(kind: InspectionKind): boolean {
  return kind !== "SamplingAssay";
}

export interface NewInspectionInput {
  inspector: string;
  kind: InspectionKind;
  inspectedAt: number | string;
  region: string;
  siteHash: string;
  quantity: string;
  grade: string;
  certificateHash: string;
  certificateNo: string;
}

export interface SecurityTermsInput {
  advanceRatioBps: number;
  marginCallRatioBps: number;
  defaultRatioBps?: number;
  curePeriod: number | string;
  priceStaleAfter: number | string;
  paymentTerm: SecurityPaymentTerm;
  gracePeriod: number | string;
  defaultRate: number;
  originatorFeeRate?: number;
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

export function decimal7ToI128(text: string, what = "value per unit"): bigint {
  const match = DECIMAL_7DP.exec(text.trim());
  if (!match) fail(what, text);
  const [, whole = "0", fraction = ""] = match;
  const raw = BigInt(whole) * 10n ** 7n + BigInt(fraction.padEnd(7, "0"));
  if (raw > I128_MAX) fail(what, text);
  return raw;
}

function variant(name: string): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
}

function encodeTerms(terms: SecurityTermsInput): xdr.ScVal {
  if (terms.defaultRatioBps !== undefined) {
    fail("defaultRatioBps (EVM only)", terms.defaultRatioBps);
  }
  if (terms.originatorFeeRate !== undefined) {
    fail("originatorFeeRate (EVM only)", terms.originatorFeeRate);
  }
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

export function encodeNewInspection(input: NewInspectionInput): xdr.ScVal {
  if (!isInspectorAddress(input.inspector)) fail("inspector", input.inspector);
  if (!INSPECTION_KINDS.includes(input.kind)) fail("kind", input.kind);
  return scMap([
    ["certificate_hash", hashArg(input.certificateHash, "certificateHash")],
    ["certificate_no", nativeToScVal(input.certificateNo, { type: "string" })],
    [
      "grade",
      nativeToScVal(decimal7ToI128(input.grade, "grade"), { type: "i128" }),
    ],
    ["inspected_at", u64Arg(input.inspectedAt, "inspectedAt")],
    ["inspector", new Address(input.inspector).toScVal()],
    ["kind", variant(input.kind)],
    [
      "quantity",
      nativeToScVal(decimal7ToI128(input.quantity, "quantity"), {
        type: "i128",
      }),
    ],
    ["region", nativeToScVal(input.region, { type: "string" })],
    ["site_hash", hashArg(input.siteHash, "siteHash")],
  ]);
}

export function encodeRecordInspectionArgs(
  caller: string,
  recordId: number,
  input: NewInspectionInput,
): xdr.ScVal[] {
  return [
    new Address(caller).toScVal(),
    u32Arg(recordId, "recordId"),
    encodeNewInspection(input),
  ];
}

export function encodeApproveInspectionArgs(
  caller: string,
  inspectionId: number,
): xdr.ScVal[] {
  return [new Address(caller).toScVal(), u32Arg(inspectionId, "inspectionId")];
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

type SignTransaction = (
  xdrStr: string,
  opts?: { networkPassphrase?: string; address?: string },
) => Promise<{ signedTxXdr: string; signerAddress?: string }>;

export interface CheckCoverageParams extends BuildCheckCoverageEnvelopeParams {
  signTransaction: SignTransaction;
  onStageChange?: (stage: RelayStage) => void;
}

interface DirectCallParams {
  registryId: string;
  caller: string;
  fn: string;
  args: xdr.ScVal[];
  rpcUrl: string;
  networkPassphrase: string;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function buildDirectEnvelope(
  label: string,
  { registryId, caller, fn, args, rpcUrl, networkPassphrase }: DirectCallParams,
): Promise<string> {
  if (!registryId) {
    throw new Error(
      `build${capitalise(label)}Envelope: registryId must not be empty`,
    );
  }
  if (!caller) {
    throw new Error(
      `build${capitalise(label)}Envelope: caller must not be empty`,
    );
  }
  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
  const sourceAccount = await server.getAccount(caller);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(new Contract(registryId).call(fn, ...args))
    .setTimeout(30)
    .build();
  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`${label} simulation error: ${simResult.error}`);
  }
  return SorobanRpc.assembleTransaction(tx, simResult).build().toXDR();
}

async function submitDirect(
  label: string,
  params: DirectCallParams & {
    signTransaction: SignTransaction;
    onStageChange?: (stage: RelayStage) => void;
  },
): Promise<{ hash: string; returnValue: xdr.ScVal | undefined }> {
  const { signTransaction, onStageChange, ...call } = params;
  onStageChange?.("awaiting-signature");
  const assembledXdr = await buildDirectEnvelope(label, call);
  const { signedTxXdr } = await signTransaction(assembledXdr, {
    networkPassphrase: call.networkPassphrase,
    address: call.caller,
  });
  onStageChange?.("submitting");
  const server = new SorobanRpc.Server(call.rpcUrl, {
    allowHttp: call.rpcUrl.startsWith("http://"),
  });
  const signedTx = TransactionBuilder.fromXDR(
    signedTxXdr,
    call.networkPassphrase,
  );
  const sendResult = await server.sendTransaction(signedTx as Transaction);
  if (sendResult.status === "ERROR") {
    throw new Error(
      `${label}: sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
    );
  }
  onStageChange?.("confirming");
  const finalResult = await server.pollTransaction(sendResult.hash);
  if (finalResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `${label}: transaction ${sendResult.hash} failed with status ${finalResult.status}`,
    );
  }
  return {
    hash: sendResult.hash,
    returnValue: (finalResult as { returnValue?: xdr.ScVal }).returnValue,
  };
}

export async function buildCheckCoverageEnvelope({
  loanId,
  ...rest
}: BuildCheckCoverageEnvelopeParams): Promise<string> {
  return buildDirectEnvelope("checkCoverage", {
    ...rest,
    fn: "check_coverage",
    args: [u32Arg(loanId, "loanId")],
  });
}

export async function checkCoverage({
  loanId,
  ...rest
}: CheckCoverageParams): Promise<RelayResult> {
  const { hash } = await submitDirect("checkCoverage", {
    ...rest,
    fn: "check_coverage",
    args: [u32Arg(loanId, "loanId")],
  });
  return { hash };
}

export interface RecordInspectionParams {
  registryId: string;
  caller: string;
  recordId: number;
  inspection: NewInspectionInput;
  rpcUrl: string;
  networkPassphrase: string;
  signTransaction: SignTransaction;
  onStageChange?: (stage: RelayStage) => void;
}

export interface ApproveInspectionParams {
  registryId: string;
  caller: string;
  inspectionId: number;
  rpcUrl: string;
  networkPassphrase: string;
  signTransaction: SignTransaction;
  onStageChange?: (stage: RelayStage) => void;
}

export async function recordInspection({
  recordId,
  inspection,
  ...rest
}: RecordInspectionParams): Promise<{
  hash: string;
  inspectionId: number | null;
}> {
  const { hash, returnValue } = await submitDirect("recordInspection", {
    ...rest,
    fn: "record_inspection",
    args: encodeRecordInspectionArgs(rest.caller, recordId, inspection),
  });
  const native = returnValue == null ? null : scValToNative(returnValue);
  return {
    hash,
    inspectionId: typeof native === "number" ? native : null,
  };
}

export async function approveInspection({
  inspectionId,
  ...rest
}: ApproveInspectionParams): Promise<{ hash: string }> {
  const { hash } = await submitDirect("approveInspection", {
    ...rest,
    fn: "approve_inspection",
    args: encodeApproveInspectionArgs(rest.caller, inspectionId),
  });
  return { hash };
}
