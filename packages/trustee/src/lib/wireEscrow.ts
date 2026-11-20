// spec: docs/frontend/trustee-flows.md#cash-management--escrowed-wires
import type { CanCall, MinterWireIn } from "@pipeline/wallet-connect";
import { ApiError } from "@/api/client";
import type { WireEscrowFn } from "@/api/useEscrowedWires";
import {
  parseSorobanContractErrorCode,
  toUserError,
  type UserFacingError,
} from "@/utils/userError";

export type OnChainRowState =
  | "reading"
  | "read-error"
  | "confirmed"
  | "assigned-pending-index"
  | "returned-pending-index"
  | "mismatch";

export interface AccessReasonInput {
  access: CanCall | undefined;
  isPending: boolean;
  isError: boolean;
}

export function escrowAccessReason(
  fn: WireEscrowFn,
  { access, isPending, isError }: AccessReasonInput,
): string | null {
  if (access?.immediate) return null;
  if (isPending) return "Checking this wallet's Trustee role…";
  if (isError || !access) return "Could not verify this wallet's Trustee role.";
  if (access.delay > 0) {
    return `This wallet holds the Trustee role with a ${access.delay / 3600} h delay; the app does not schedule wire assignments.`;
  }
  return fn === "assign_wire_in"
    ? "Only the Trustee role can assign escrowed wires."
    : "Only the Trustee role can return escrowed wires.";
}

export interface ChainRead {
  data: MinterWireIn | undefined;
  isPending: boolean;
  isError: boolean;
}

export function onChainRowState(
  servedStatus: string,
  chain: ChainRead,
): OnChainRowState {
  if (chain.isError) return "read-error";
  if (!chain.data) return chain.isPending ? "reading" : "read-error";
  const status = chain.data.status;
  if (status === "Escrowed") return "confirmed";
  if (servedStatus === "Escrowed" && status === "Assigned") {
    return "assigned-pending-index";
  }
  if (servedStatus === "Escrowed" && status === "Returned") {
    return "returned-pending-index";
  }
  return "mismatch";
}

export function onChainStateLabel(
  state: OnChainRowState,
  chainStatus: string | undefined,
): string {
  switch (state) {
    case "confirmed":
      return "Escrowed (confirmed on-chain)";
    case "assigned-pending-index":
      return "Assigned on-chain — waiting for the indexer";
    case "returned-pending-index":
      return "Returned on-chain — waiting for the indexer";
    case "mismatch":
      return `On-chain status ${chainStatus ?? "unknown"} differs from the cash book`;
    case "read-error":
      return "Could not confirm on-chain";
    case "reading":
      return "Confirming on-chain…";
  }
}

export function onChainStateReason(
  state: OnChainRowState,
  chainStatus: string | undefined,
): string | null {
  switch (state) {
    case "confirmed":
      return null;
    case "reading":
      return "Confirming this wire on-chain…";
    case "read-error":
      return "Could not confirm this wire on-chain. Try again shortly.";
    case "assigned-pending-index":
    case "returned-pending-index":
      return "Submitted — waiting for the indexer to update this list.";
    case "mismatch":
      return `This wire is ${chainStatus ?? "no longer escrowed"} on-chain, not in escrow.`;
  }
}

export const NOT_IN_ESCROW_COPY =
  "This wire is no longer in escrow. Refresh the list.";
export const REUSED_REFERENCE_COPY =
  "This bank reference is already recorded on-chain. Use the outgoing wire's own reference.";
export const UNAUTHORIZED_RECEIVER_COPY =
  "This lender's address is not authorised to hold PLUSD.";

export function wireEscrowErrorCopy(
  fn: WireEscrowFn,
  err: unknown,
): UserFacingError {
  const fallback =
    fn === "assign_wire_in"
      ? "Could not assign this wire. Please try again."
      : "Could not return this wire. Please try again.";
  const mapped = toUserError(err, fallback);
  const isRejection = /^You cancelled the transaction/.test(mapped.message);
  if (
    isRejection ||
    (mapped.isSpecific && !/simulation error/i.test(mapped.details))
  ) {
    return mapped;
  }
  const code = parseSorobanContractErrorCode(mapped.details);
  const specific = (message: string): UserFacingError => ({
    message,
    details: mapped.details,
    isSpecific: true,
  });
  if (
    fn === "return_wire_in" &&
    (/RefHashSeen/i.test(mapped.details) || code === 7)
  ) {
    return specific(REUSED_REFERENCE_COPY);
  }
  if (fn === "assign_wire_in" && code === 15) {
    return specific(UNAUTHORIZED_RECEIVER_COPY);
  }
  if (code === 14) return specific(NOT_IN_ESCROW_COPY);
  if (code === 9) return specific("The minter has no wire with this id.");
  return mapped;
}

export function cashBookError(
  error: Error,
  chainLabel: string,
): UserFacingError {
  if (error instanceof ApiError) {
    const message =
      error.status === 404 && /minter_not_configured/.test(error.message)
        ? `The cash book is not configured for ${chainLabel} on this server.`
        : error.status === 403
          ? "Your trustee account is not authorized to view the cash book."
          : error.status === 401
            ? "Your session expired. Sign in again."
            : null;
    if (message) return { message, details: error.message, isSpecific: true };
  }
  return toUserError(error, "Could not load the cash book. Please try again.");
}
