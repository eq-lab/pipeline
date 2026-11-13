// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { useState } from "react";
import { isInspectorAddress } from "@pipeline/wallet-connect";
import { useSessionState } from "@/auth/sessionStore";
import {
  useSecurityInspectors,
  type SecurityRegistryCall,
} from "@/api/useRiskCouncil";
import { ENV } from "@/lib/env";
import { toUserError, type UserFacingError } from "@/utils/userError";
import {
  useRiskCouncilActionView,
  type ActionView,
} from "./-risk-council-shared";

export const INSPECTORS_NO_ROLE =
  "Setting the inspector panel belongs to the Risk Council.";
export const INSPECTORS_NOTE = "Applies to inspections entered from now on.";
export const EMPTY_PANEL_WARNING =
  "The resulting panel is empty: no inspection company can enter inspections until one is added.";
export const NO_CHANGES_NOTE = "No changes to the current panel.";
export const INVALID_ADDRESS = "Enter a valid Stellar address (G… or C…).";
export const DUPLICATE_ADDRESS = "This address is already on the panel.";

export interface InspectorRow {
  address: string;
  status: "current" | "new" | "removed";
}

export function applyInspectorEdits(
  current: ReadonlyArray<string>,
  removed: ReadonlySet<string>,
  added: ReadonlyArray<string>,
): string[] {
  return [...current.filter((a) => !removed.has(a)), ...added];
}

export function validateInspectorDraft(
  draft: string,
  existing: ReadonlyArray<string>,
): string | null {
  const value = draft.trim();
  if (value === "") return null;
  if (!isInspectorAddress(value)) return INVALID_ADDRESS;
  return existing.includes(value) ? DUPLICATE_ADDRESS : null;
}

export function buildInspectorsCall(
  current: ReadonlyArray<string> | undefined,
  resulting: ReadonlyArray<string>,
): SecurityRegistryCall | null {
  if (current === undefined) return null;
  const same =
    current.length === resulting.length &&
    current.every((address, index) => address === resulting[index]);
  return same ? null : { fn: "set_inspectors", inspectors: [...resulting] };
}

export interface RiskCouncilInspectorsView {
  chainId: number;
  loading: boolean;
  loadError: UserFacingError | null;
  current: string[];
  rows: InspectorRow[];
  resulting: string[];
  draft: string;
  setDraft: (value: string) => void;
  draftError: string | null;
  canAdd: boolean;
  add: () => void;
  toggleRemoved: (address: string) => void;
  emptyWarning: string | null;
  noChanges: string | null;
  note: string;
  action: ActionView;
}

export function useRiskCouncilInspectors(): RiskCouncilInspectorsView {
  const session = useSessionState();
  const chainId = session.chainId ?? ENV.STELLAR_CHAIN_ID;
  const query = useSecurityInspectors(chainId);
  const current = query.data;
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const resulting = applyInspectorEdits(current ?? [], removed, added);
  const draftError = validateInspectorDraft(draft, [
    ...(current ?? []),
    ...added,
  ]);
  const canAdd = draft.trim() !== "" && draftError === null;
  const call = buildInspectorsCall(current, resulting);

  const action = useRiskCouncilActionView({
    chainId,
    call,
    fn: "set_inspectors",
    noRoleCopy: INSPECTORS_NO_ROLE,
    labels: {
      now: "Set inspectors",
      schedule: "Schedule inspector panel",
      execute: "Execute inspector panel",
    },
    enabled: current !== undefined,
  });

  const rows: InspectorRow[] = [
    ...(current ?? []).map<InspectorRow>((address) => ({
      address,
      status: removed.has(address) ? "removed" : "current",
    })),
    ...added.map<InspectorRow>((address) => ({ address, status: "new" })),
  ];

  return {
    chainId,
    loading: query.isLoading,
    loadError: query.error
      ? toUserError(query.error, "Failed to read the inspector panel.")
      : null,
    current: current ?? [],
    rows,
    resulting,
    draft,
    setDraft,
    draftError,
    canAdd,
    add: () => {
      if (!canAdd) return;
      setAdded((prev) => [...prev, draft.trim()]);
      setDraft("");
    },
    toggleRemoved: (address) => {
      if (added.includes(address)) {
        setAdded((prev) => prev.filter((a) => a !== address));
        return;
      }
      setRemoved((prev) => {
        const next = new Set(prev);
        if (next.has(address)) next.delete(address);
        else next.add(address);
        return next;
      });
    },
    emptyWarning:
      current !== undefined && resulting.length === 0
        ? EMPTY_PANEL_WARNING
        : null,
    noChanges: current !== undefined && call === null ? NO_CHANGES_NOTE : null,
    note: INSPECTORS_NOTE,
    action,
  };
}
