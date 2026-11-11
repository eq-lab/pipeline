// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";
import {
  readOperationSchedule,
  relay,
  type OperationSchedule,
  type RelayParams,
  type RelayResult,
} from "./accessManager";
import { hexToBytes32ScVal } from "./minter";
import { sha256Hex } from "./hash";
import { simulateRead, type SimulateReadOptions } from "./simulateRead";

export type RiskCouncilClosureReason = "Default" | "OtherWriteDown";

export type RiskCouncilCall =
  | { fn: "set_default"; loanId: number }
  | { fn: "cure"; loanId: number }
  | { fn: "amend_economics"; loanId: number; rateBps: number; maturity: number }
  | { fn: "adjust_interest"; loanId: number; delta: string; reasonHash: string }
  | { fn: "write_down"; loanId: number; amount: string }
  | {
      fn: "close_defaulted";
      loanId: number;
      reason: RiskCouncilClosureReason;
    };

const BASE_UNIT_INT = /^[0-9]+$/;
const SIGNED_INT = /^-?[0-9]+$/;
const MAX_RATE_BPS = 10_000;
const RATE_SCALE = 100;

function u32Arg(value: number, what: string): xdr.ScVal {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`encodeRiskCouncilArgs: invalid ${what} ${value}`);
  }
  return nativeToScVal(value, { type: "u32" });
}

export function encodeRiskCouncilArgs(call: RiskCouncilCall): xdr.ScVal[] {
  const loanId = u32Arg(call.loanId, "loanId");
  switch (call.fn) {
    case "set_default":
    case "cure":
      return [loanId];
    case "amend_economics": {
      if (
        !Number.isInteger(call.rateBps) ||
        call.rateBps < 1 ||
        call.rateBps > MAX_RATE_BPS
      ) {
        throw new Error(
          `encodeRiskCouncilArgs: invalid rateBps ${call.rateBps}`,
        );
      }
      if (!Number.isInteger(call.maturity) || call.maturity <= 0) {
        throw new Error(
          `encodeRiskCouncilArgs: invalid maturity ${call.maturity}`,
        );
      }
      return [
        loanId,
        nativeToScVal(call.rateBps * RATE_SCALE, { type: "u32" }),
        nativeToScVal(call.maturity, { type: "u64" }),
      ];
    }
    case "adjust_interest": {
      if (!SIGNED_INT.test(call.delta) || BigInt(call.delta) === 0n) {
        throw new Error(`encodeRiskCouncilArgs: invalid delta ${call.delta}`);
      }
      if (!/^[0-9a-f]{64}$/.test(call.reasonHash)) {
        throw new Error(
          `encodeRiskCouncilArgs: invalid reasonHash ${call.reasonHash}`,
        );
      }
      return [
        loanId,
        nativeToScVal(BigInt(call.delta), { type: "i128" }),
        hexToBytes32ScVal(call.reasonHash),
      ];
    }
    case "write_down": {
      if (!BASE_UNIT_INT.test(call.amount) || BigInt(call.amount) === 0n) {
        throw new Error(`encodeRiskCouncilArgs: invalid amount ${call.amount}`);
      }
      return [loanId, nativeToScVal(BigInt(call.amount), { type: "u128" })];
    }
    case "close_defaulted": {
      if (call.reason !== "Default" && call.reason !== "OtherWriteDown") {
        throw new Error(`encodeRiskCouncilArgs: invalid reason ${call.reason}`);
      }
      return [loanId, xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(call.reason)])];
    }
    default:
      throw new Error("encodeRiskCouncilArgs: unknown function");
  }
}

export interface RiskCouncilRelayParams extends Omit<
  RelayParams,
  "target" | "fn" | "args" | "caller"
> {
  call: RiskCouncilCall;
  registryId: string;
  caller: string;
}

export function relayRiskCouncil({
  call,
  registryId,
  ...rest
}: RiskCouncilRelayParams): Promise<RelayResult> {
  return relay({
    ...rest,
    target: registryId,
    fn: call.fn,
    args: encodeRiskCouncilArgs(call),
  });
}

export interface ReadRiskCouncilScheduleParams extends SimulateReadOptions {
  call: RiskCouncilCall;
  accessManagerId: string;
  registryId: string;
  caller: string;
}

export function readRiskCouncilSchedule({
  call,
  registryId,
  ...rest
}: ReadRiskCouncilScheduleParams): Promise<OperationSchedule> {
  return readOperationSchedule({
    ...rest,
    target: registryId,
    fn: call.fn,
    args: encodeRiskCouncilArgs(call),
  });
}

export function riskCouncilReasonHash(reason: string): Promise<string> {
  return sha256Hex(reason.trim());
}

export interface LoanMoney {
  accruedInterest: string;
  carvedOut: boolean;
  disbursed: string;
  outstanding: string;
  repaid: string;
  writtenDown: string;
}

export interface ReadLoanParams extends SimulateReadOptions {
  registryId: string;
  loanId: number;
}

function requireRegistry(registryId: string, who: string): void {
  if (!registryId) throw new Error(`${who}: registryId must not be empty`);
}

function rawField(
  data: Record<string, unknown> | undefined,
  key: string,
  who: string,
): string {
  const raw = data?.[key];
  if (raw === undefined || raw === null) {
    throw new Error(`${who}: ${key} missing`);
  }
  return String(raw);
}

function enumTag(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "");
}

export async function readLoanMoney({
  registryId,
  loanId,
  rpcUrl,
  networkPassphrase,
}: ReadLoanParams): Promise<LoanMoney> {
  requireRegistry(registryId, "readLoanMoney");
  const data = (await simulateRead(
    registryId,
    "loan_money",
    [nativeToScVal(loanId, { type: "u32" })],
    { rpcUrl, networkPassphrase },
  )) as Record<string, unknown> | undefined;
  const who = "readLoanMoney";
  return {
    accruedInterest: rawField(data, "accrued_interest", who),
    carvedOut: data?.carved_out === true,
    disbursed: rawField(data, "disbursed", who),
    outstanding: rawField(data, "outstanding", who),
    repaid: rawField(data, "repaid", who),
    writtenDown: rawField(data, "written_down", who),
  };
}

export interface LoanChainState {
  status: string;
  closureReason: string;
  currentRate: number;
  currentMaturity: number;
  interestAdjustment: string;
  writtenDown: string;
  carvedOut: boolean;
  metadataUri: string;
}

export async function readLoanChainState({
  registryId,
  loanId,
  rpcUrl,
  networkPassphrase,
}: ReadLoanParams): Promise<LoanChainState> {
  requireRegistry(registryId, "readLoanChainState");
  const data = (await simulateRead(
    registryId,
    "mutable_loan_data",
    [nativeToScVal(loanId, { type: "u32" })],
    { rpcUrl, networkPassphrase },
  )) as Record<string, unknown> | undefined;
  const who = "readLoanChainState";
  return {
    status: enumTag(data?.status),
    closureReason: enumTag(data?.closure_reason),
    currentRate: Number(rawField(data, "current_rate", who)),
    currentMaturity: Number(rawField(data, "current_maturity_timestamp", who)),
    interestAdjustment: rawField(data, "interest_adjustment", who),
    writtenDown: rawField(data, "written_down", who),
    carvedOut: data?.carved_out === true,
    metadataUri: String(data?.metadata_uri ?? ""),
  };
}
