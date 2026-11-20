// spec: docs/frontend/trustee-flows.md#security-inspections-1857
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  approve: {
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null as Error | null,
    stage: null as string | null,
  },
}));

vi.mock("@/api/useSecurityInspections", () => ({
  useApproveInspection: () => mocks.approve,
}));
vi.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { ApproveInspectionDialog } from "./-ApproveInspectionDialog";
import type { SecurityInspectionRow } from "./-loanSecurityRecords";

const ROW: SecurityInspectionRow = {
  id: "12",
  inspectionId: 12,
  inspector: "GINSPECTORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  certificateNo: "C-12",
  enteredBy: "GOTHER",
  awaitingApproval: true,
  kind: "DraftSurvey",
  inspected: "15 Jan 2026",
  quantity: "1,200 MT",
  grade: "98.5",
  entered: { address: "GOTHER", date: "16 Jan 2026" },
  approved: "awaiting",
  varianceReference: "—",
  variancePrevious: "—",
  varianceGrade: "—",
  flagged: false,
  resolution: "—",
  latest: false,
};

const onClose = vi.fn();
const onDone = vi.fn();

function renderDialog(row = ROW) {
  return render(
    <ApproveInspectionDialog
      chainId={99_000_001}
      row={row}
      tolerances={{ quantity: "100 bps", grade: "50 bps" }}
      onClose={onClose}
      onDone={onDone}
    />,
  );
}

beforeEach(() => {
  mocks.approve.mutateAsync.mockReset();
  mocks.approve.mutateAsync.mockResolvedValue({ hash: "TXHASH" });
  mocks.approve.isPending = false;
  mocks.approve.error = null;
  mocks.approve.stage = null;
  onClose.mockReset();
  onDone.mockReset();
});

describe("ApproveInspectionDialog", () => {
  it("shows the inspection, the effect text and the served tolerances", () => {
    renderDialog();
    const context = screen.getByTestId("approve-inspection-context");
    expect(context).toHaveTextContent("DraftSurvey");
    expect(context).toHaveTextContent("1,200 MT");
    expect(context).toHaveTextContent("C-12");
    expect(context).toHaveTextContent("100 bps");
    expect(context).toHaveTextContent("50 bps");
    expect(screen.getByTestId("approve-inspection-dialog")).toHaveTextContent(
      "Approving computes the variances",
    );
  });

  it("submits the inspection id and reports the result", async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("approve-inspection-confirm"));
    await waitFor(() =>
      expect(mocks.approve.mutateAsync).toHaveBeenCalledWith({
        chainId: 99_000_001,
        inspectionId: 12,
      }),
    );
    expect(onDone).toHaveBeenCalledWith({ inspectionId: 12, hash: "TXHASH" });
  });

  it("disables the confirm button without a numeric id", () => {
    renderDialog({ ...ROW, inspectionId: null });
    expect(screen.getByTestId("approve-inspection-confirm")).toBeDisabled();
  });

  it("labels the stage and shows the SameOperator copy by name", () => {
    mocks.approve.isPending = true;
    mocks.approve.stage = "confirming";
    mocks.approve.error = new Error("simulation error: Error(Contract, #31)");
    renderDialog();
    expect(screen.getByTestId("approve-inspection-confirm")).toHaveTextContent(
      "Confirming…",
    );
    expect(screen.getByTestId("approve-inspection-error")).toHaveTextContent(
      "(SameOperator)",
    );
  });

  it("stays open when the write fails", async () => {
    mocks.approve.mutateAsync.mockRejectedValue(new Error("boom"));
    renderDialog();
    fireEvent.click(screen.getByTestId("approve-inspection-confirm"));
    await waitFor(() => expect(mocks.approve.mutateAsync).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
  });

  it("cancels on Escape and on backdrop click", () => {
    renderDialog();
    fireEvent.keyDown(screen.getByTestId("approve-inspection-dialog"), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("approve-inspection-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
