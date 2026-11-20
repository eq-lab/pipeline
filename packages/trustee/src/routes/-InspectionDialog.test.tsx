// spec: docs/frontend/trustee-flows.md#security-inspections-1857
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  record: {
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null as Error | null,
    stage: null as string | null,
  },
}));

vi.mock("@pipeline/wallet-connect", () => ({
  INSPECTION_KINDS: ["LoadingTally", "DraftSurvey", "SamplingAssay"],
  inspectionMeasuresQuantity: (kind: string) => kind !== "SamplingAssay",
}));
vi.mock("@/api/useSecurityInspections", () => ({
  useRecordInspection: () => mocks.record,
}));

import { InspectionDialog } from "./-InspectionDialog";
import type { InspectionTarget } from "./-loanSecurityRecords";

const A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const HASH = "ab".repeat(32);
const TARGET: InspectionTarget = {
  title: "Record #7 · WarehousePledge",
  rows: [
    { label: "Commodity", value: "Copper" },
    { label: "Document quantity", value: "1,250 MT" },
  ],
  seed: {
    recordId: 7,
    unit: "MT",
    inspector: "",
    region: "Santos",
    siteHash: HASH,
  },
};

const onClose = vi.fn();
const onDone = vi.fn();

function renderDialog(target = TARGET, panel = [A, B]) {
  return render(
    <InspectionDialog
      chainId={99_000_001}
      target={target}
      panel={panel}
      onClose={onClose}
      onDone={onDone}
    />,
  );
}

function type(id: string, value: string) {
  fireEvent.change(screen.getByTestId(id), { target: { value } });
}

function fillValid() {
  type("inspection-inspector", A);
  type("inspection-kind", "DraftSurvey");
  type("inspection-date", "2026-01-15");
  type("inspection-quantity", "1200.5");
  type("inspection-certificate-no", "C-1");
  type("inspection-certificate-hash", HASH.toUpperCase());
}

beforeEach(() => {
  mocks.record.mutateAsync.mockReset();
  mocks.record.mutateAsync.mockResolvedValue({
    hash: "TXHASH",
    inspectionId: 42,
  });
  mocks.record.isPending = false;
  mocks.record.error = null;
  mocks.record.stage = null;
  onClose.mockReset();
  onDone.mockReset();
});

describe("InspectionDialog", () => {
  it("shows the record context and prefills region and site hash", () => {
    renderDialog();
    expect(screen.getByTestId("inspection-context")).toHaveTextContent(
      "1,250 MT",
    );
    expect(screen.getByTestId("inspection-region")).toHaveValue("Santos");
    expect(screen.getByTestId("inspection-site-hash")).toHaveValue(HASH);
    expect(screen.getByTestId("inspection-inspector")).toHaveValue("");
    expect(screen.getByTestId("inspection-confirm")).toBeDisabled();
  });

  it("preselects the only inspector on the panel", () => {
    renderDialog({ ...TARGET, seed: { ...TARGET.seed, inspector: A } }, [A]);
    expect(screen.getByTestId("inspection-inspector")).toHaveValue(A);
  });

  it("shows the first failing validation message", () => {
    renderDialog();
    expect(screen.getByTestId("inspection-validation")).toHaveTextContent(
      "Pick an inspector from the panel.",
    );
    type("inspection-inspector", A);
    type("inspection-kind", "DraftSurvey");
    type("inspection-date", "2999-01-01");
    expect(screen.getByTestId("inspection-validation")).toHaveTextContent(
      "can't be in the future",
    );
    type("inspection-date", "2026-01-15");
    expect(screen.getByTestId("inspection-validation")).toHaveTextContent(
      "Enter the quantity found",
    );
  });

  it("disables the quantity for a sampling assay", () => {
    renderDialog();
    type("inspection-kind", "SamplingAssay");
    expect(screen.getByTestId("inspection-quantity")).toBeDisabled();
    expect(
      screen.getByText("Not measured by a sampling assay"),
    ).toBeInTheDocument();
  });

  it("submits the encoded input and reports the result", async () => {
    renderDialog();
    fillValid();
    expect(screen.queryByTestId("inspection-validation")).toBeNull();
    fireEvent.click(screen.getByTestId("inspection-confirm"));
    await waitFor(() =>
      expect(mocks.record.mutateAsync).toHaveBeenCalledWith({
        chainId: 99_000_001,
        recordId: 7,
        inspection: {
          inspector: A,
          kind: "DraftSurvey",
          inspectedAt: Date.UTC(2026, 0, 15) / 1000,
          region: "Santos",
          siteHash: HASH,
          quantity: "1200.5",
          grade: "0",
          certificateHash: HASH,
          certificateNo: "C-1",
        },
      }),
    );
    expect(onDone).toHaveBeenCalledWith({
      recordId: 7,
      hash: "TXHASH",
      inspectionId: 42,
    });
  });

  it("labels the submit button with the relay stage", () => {
    mocks.record.isPending = true;
    mocks.record.stage = "awaiting-signature";
    renderDialog();
    expect(screen.getByTestId("inspection-confirm")).toHaveTextContent(
      "Waiting for wallet signature…",
    );
    expect(screen.getByTestId("inspection-confirm")).toBeDisabled();
  });

  it("shows the error by contract name and stays open on failure", async () => {
    mocks.record.error = new Error("simulation error: Error(Contract, #27)");
    renderDialog();
    expect(screen.getByTestId("inspection-error")).toHaveTextContent(
      "(NotInspector)",
    );
    mocks.record.mutateAsync.mockRejectedValue(new Error("boom"));
    fillValid();
    fireEvent.click(screen.getByTestId("inspection-confirm"));
    await waitFor(() => expect(mocks.record.mutateAsync).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
  });

  it("cancels on Escape and on backdrop click", () => {
    renderDialog();
    fireEvent.keyDown(screen.getByTestId("inspection-dialog"), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("inspection-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
