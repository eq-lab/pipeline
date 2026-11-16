// spec: docs/frontend/trustee-flows.md#risk-council-pending-operations
import { xdr } from "@stellar/stellar-sdk";
import {
  readOperationSchedule,
  relay,
  type OperationSchedule,
  type ReadCanCallParams,
  type RelayParams,
  type RelayResult,
} from "./accessManager";

export function decodeOperationArgs(argsXdr: string): xdr.ScVal[] {
  const value = xdr.ScVal.fromXDR(argsXdr, "base64");
  const args = value.switch().name === "scvVec" ? value.vec() : null;
  if (args == null) {
    throw new Error("decodeOperationArgs: args_xdr is not an ScVal vector");
  }
  return args;
}

export function operationArgsXdr(args: xdr.ScVal[]): string {
  return xdr.ScVal.scvVec(args).toXDR("base64");
}

export interface ScheduledOperationParams extends ReadCanCallParams {
  argsXdr: string;
}

export function readScheduledOperation({
  argsXdr,
  ...rest
}: ScheduledOperationParams): Promise<OperationSchedule> {
  return readOperationSchedule({ ...rest, args: decodeOperationArgs(argsXdr) });
}

export interface ExecuteScheduledOperationParams extends Omit<
  RelayParams,
  "mode" | "args"
> {
  argsXdr: string;
}

export function executeScheduledOperation({
  argsXdr,
  ...rest
}: ExecuteScheduledOperationParams): Promise<RelayResult> {
  return relay({
    ...rest,
    mode: "execute",
    args: decodeOperationArgs(argsXdr),
  });
}
