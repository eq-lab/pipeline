// spec: docs/frontend/trustee-flows.md#risk-council-pending-operations
export type PendingOperationState = "waiting" | "ready" | "expired";
export type PendingTargetKind =
  | "security_registry"
  | "loan_registry"
  | "minter"
  | "other";

export interface PendingOperation {
  operation_id: string;
  nonce: number;
  caller: string;
  target: string;
  target_kind: PendingTargetKind;
  function: string;
  args_xdr: string | null;
  calldata?: string | null;
  args: unknown;
  ready_at: string;
  expires_at: string;
  state: PendingOperationState;
}

export const EVM_PENDING_FUNCTIONS: Readonly<Record<string, string>> = {
  setDefault: "set_default",
  cure: "cure",
  amendEconomics: "amend_economics",
  adjustInterest: "adjust_interest",
  writeDown: "write_down",
  closeDefaulted: "close_defaulted",
  reverseRepay: "reverse_repay",
  setTerms: "set_terms",
  resolveFlag: "resolve_flag",
  releaseWithConsent: "release_with_consent",
  setInspectors: "set_inspectors",
};

export function canonicalPendingFunction(fn: string): string {
  return Object.hasOwn(EVM_PENDING_FUNCTIONS, fn)
    ? EVM_PENDING_FUNCTIONS[fn]!
    : fn;
}
