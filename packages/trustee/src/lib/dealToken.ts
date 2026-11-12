// spec: docs/frontend/trustee-flows.md#register-debt-token-1766
import type { CanCall } from "@pipeline/wallet-connect";
import { toUserError, type UserFacingError } from "@/utils/userError";
import { amErrorCode, riskCouncilErrorCopy } from "./accessManagerAction";
import { stellarOnlyActionReason } from "./targetChains";

export const DEBT_TOKEN_NOT_CONFIGURED =
  "Debt token registration isn't configured for this environment.";
export const DEBT_TOKEN_NO_ROLE =
  "Only the Trustee role can register a loan's debt token.";
export const DEBT_TOKEN_CONNECT_WALLET =
  "Connect your trustee wallet to register the debt token.";

export const REGISTER_DEAL_ERROR_COPY: Readonly<Record<string, string>> = {
  "1": "The registry has no loan with this id.",
  "2": "This loan id is too large for a debt token.",
  "3": "This loan's debt token is already registered.",
  "5": "The debt token issuer has not made the factory the admin of the token yet. Ask the issuer to sign set_admin, then try again.",
};

export interface DealReadState {
  data: { debt: string } | null | undefined;
  isPending: boolean;
  isError: boolean;
}

export type DebtTokenView =
  | { kind: "hidden" }
  | { kind: "blocked"; reason: string }
  | { kind: "unregistered" }
  | { kind: "registered"; debt: string };

export function debtTokenView(
  chainId: number | null | undefined,
  configured: boolean,
  deal: DealReadState,
): DebtTokenView {
  const chainReason = stellarOnlyActionReason(chainId);
  if (chainReason) return { kind: "blocked", reason: chainReason };
  if (!configured) {
    return { kind: "blocked", reason: DEBT_TOKEN_NOT_CONFIGURED };
  }
  if (deal.isError || deal.isPending || deal.data === undefined) {
    return { kind: "hidden" };
  }
  return deal.data === null
    ? { kind: "unregistered" }
    : { kind: "registered", debt: deal.data.debt };
}

export function debtTokenRegistered(deal: DealReadState): {
  registered: boolean | null;
  debt: string | null;
} {
  if (deal.isError || deal.data === undefined) {
    return { registered: null, debt: null };
  }
  return deal.data === null
    ? { registered: false, debt: null }
    : { registered: true, debt: deal.data.debt };
}

export function registerDealAccessReason(state: {
  connected: boolean;
  access: CanCall | undefined;
  isPending: boolean;
  isError: boolean;
}): string | null {
  if (!state.connected) return DEBT_TOKEN_CONNECT_WALLET;
  if (state.isError) return "Could not verify this wallet's Trustee role.";
  if (state.isPending || !state.access) {
    return "Checking this wallet's Trustee role…";
  }
  if (!state.access.immediate && state.access.delay === 0) {
    return DEBT_TOKEN_NO_ROLE;
  }
  return null;
}

export function registerDealError(
  mode: "schedule" | "execute",
  err: unknown,
): UserFacingError {
  const mapped = toUserError(
    err,
    "Could not register the debt token. Please try again.",
  );
  const isRejection = /^You cancelled the transaction/.test(mapped.message);
  if (
    isRejection ||
    (mapped.isSpecific && !/simulation error/i.test(mapped.details))
  ) {
    return mapped;
  }
  const code = amErrorCode(mapped.details);
  const copy =
    riskCouncilErrorCopy(mode, mapped.details) ??
    (mode === "execute" && code != null
      ? REGISTER_DEAL_ERROR_COPY[code]
      : undefined);
  return copy
    ? { message: copy, details: mapped.details, isSpecific: true }
    : mapped;
}
