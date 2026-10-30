// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { useContext } from "react";
import { useWireOutRequests } from "@/api";
import { AuthFlowContext } from "@/auth/AuthFlowContext";
import { useWalletView, useWireOuts } from "@/wallet";
import type { WireOutRead } from "@/wallet";

export interface WireOutRowView {
  id: string;
  timestamp: string | undefined;
  read: WireOutRead | undefined;
}

export interface UseWireOutSectionResult {
  rows: WireOutRowView[];
  refetch: () => void;
}

export function useKybPassed(): boolean {
  const ctx = useContext(AuthFlowContext);
  return ctx?.lpRead === "loaded" && ctx.kybStatus === "Passed";
}

export function useWireOutSection(
  submittedIds: string[],
): UseWireOutSectionResult {
  const { kind } = useWalletView();
  const { items, refetch } = useWireOutRequests();

  const servedIds = new Set(items.map((item) => item.id));
  const rowsBase = [
    ...submittedIds
      .filter((id) => !servedIds.has(id))
      .map((id) => ({ id, timestamp: undefined as string | undefined })),
    ...items.map((item) => ({ id: item.id, timestamp: item.timestamp })),
  ];
  const reads = useWireOuts(
    kind,
    rowsBase.map((row) => row.id),
  );

  return {
    rows: rowsBase.map((row) => ({ ...row, read: reads[row.id] })),
    refetch,
  };
}
