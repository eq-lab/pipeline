// spec: docs/frontend/trustee-flows.md#security-inspections-1857
import {
  approveInspection,
  recordInspection,
  type NewInspectionInput,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import {
  checkCoverageConfigured,
  rpc,
  useSecurityWrite,
} from "./useSecurityMarks";

export interface RecordInspectionInput {
  chainId: number | null | undefined;
  recordId: number;
  inspection: NewInspectionInput;
}

export interface ApproveInspectionInput {
  chainId: number | null | undefined;
  inspectionId: number;
}

export interface RecordInspectionResult {
  hash: string;
  inspectionId: number | null;
}

export function useRecordInspection() {
  return useSecurityWrite<RecordInspectionInput, RecordInspectionResult>(
    checkCoverageConfigured,
    (input, ctx) =>
      recordInspection({
        registryId: ENV.STELLAR_SECURITY_REGISTRY_ID,
        caller: ctx.caller,
        recordId: input.recordId,
        inspection: input.inspection,
        signTransaction: ctx.signTransaction,
        onStageChange: ctx.onStageChange,
        ...rpc(),
      }),
  );
}

export function useApproveInspection() {
  return useSecurityWrite<ApproveInspectionInput>(
    checkCoverageConfigured,
    (input, ctx) =>
      approveInspection({
        registryId: ENV.STELLAR_SECURITY_REGISTRY_ID,
        caller: ctx.caller,
        inspectionId: input.inspectionId,
        signTransaction: ctx.signTransaction,
        onStageChange: ctx.onStageChange,
        ...rpc(),
      }),
  );
}
