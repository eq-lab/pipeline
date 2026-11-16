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
  args_xdr: string;
  args: unknown;
  ready_at: string;
  expires_at: string;
  state: PendingOperationState;
}
