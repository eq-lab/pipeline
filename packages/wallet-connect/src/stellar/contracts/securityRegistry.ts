// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { Address, StrKey, xdr } from "@stellar/stellar-sdk";
import {
  readOperationSchedule,
  relay,
  type OperationSchedule,
  type RelayParams,
  type RelayResult,
} from "./accessManager";
import { hexToBytes32ScVal } from "./minter";
import { sha256Hex } from "./hash";
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
  | { fn: "set_inspectors"; inspectors: string[] };

const U32_MAX = 0xffffffff;
const U64_MAX = 2n ** 64n - 1n;
const HEX32 = /^[0-9a-f]{64}$/;
const DECIMAL = /^[0-9]+$/;

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
    default:
      throw new Error("encodeSecurityRegistryArgs: unknown function");
  }
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
