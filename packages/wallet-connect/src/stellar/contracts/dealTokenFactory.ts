// spec: docs/product-specs/loans-data.md#security-considerations
import { nativeToScVal } from "@stellar/stellar-sdk";
import { relay, type RelayParams, type RelayResult } from "./accessManager";
import { simulateRead, type SimulateReadOptions } from "./simulateRead";

const REGISTER_DEAL_FN = "register_deal";
const NOT_REGISTERED_CODE = /Error\(Contract,\s*#4\)/;
const CONTRACT_ADDRESS = /^C[A-Z2-7]{55}$/;
const MAX_U32 = 0xffffffff;

export interface DealRead {
  debt: string;
}

function requireLoanId(loanId: number, who: string): void {
  if (!Number.isInteger(loanId) || loanId < 0 || loanId > MAX_U32) {
    throw new Error(`${who}: invalid loan id ${loanId}`);
  }
}

export interface ReadDealParams extends SimulateReadOptions {
  factoryId: string;
  loanId: number;
}

export async function readDeal({
  factoryId,
  loanId,
  rpcUrl,
  networkPassphrase,
}: ReadDealParams): Promise<DealRead | null> {
  if (!factoryId) throw new Error("readDeal: factoryId must not be empty");
  requireLoanId(loanId, "readDeal");
  let data: unknown;
  try {
    data = await simulateRead(
      factoryId,
      "deal",
      [nativeToScVal(loanId, { type: "u32" })],
      { rpcUrl, networkPassphrase },
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (NOT_REGISTERED_CODE.test(text)) return null;
    throw error;
  }
  const debt = (data as { debt?: unknown } | null)?.debt;
  if (typeof debt !== "string" || !CONTRACT_ADDRESS.test(debt)) {
    throw new Error("readDeal: debt missing or not a contract address");
  }
  return { debt };
}

export type RegisterDealParams = Omit<RelayParams, "target" | "fn" | "args"> & {
  factoryId: string;
  loanId: number;
};

export function registerDeal({
  factoryId,
  loanId,
  ...rest
}: RegisterDealParams): Promise<RelayResult> {
  requireLoanId(loanId, "registerDeal");
  return relay({
    ...rest,
    target: factoryId,
    fn: REGISTER_DEAL_FN,
    args: registerDealArgs(loanId),
  });
}

export function registerDealArgs(loanId: number) {
  requireLoanId(loanId, "registerDealArgs");
  return [nativeToScVal(loanId, { type: "u32" })];
}
