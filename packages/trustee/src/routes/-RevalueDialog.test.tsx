// spec: docs/frontend/trustee-flows.md#security-marks-1859
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  revalue: {
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
    stage: null as string | null,
  },
}));

vi.mock("@pipeline/wallet-connect", () => ({
  securityReasonHash: async (text: string) => `hash:${text.trim()}`,
  isSecurityBenchmark: (v: string) => /^[A-Za-z0-9_]{1,32}$/.test(v),
}));
vi.mock("@/api/useSecurityMarks", () => ({ useRevalue: () => mocks.revalue }));

import type { RevalueSeed } from "@/lib/securityMarks";
import { RevalueDialog } from "./-RevalueDialog";

const HASH = "ab".repeat(32);
const SEED: RevalueSeed = {
  recordId: 7,
  title: "Record #7 · warehouse_receipt",
  suggestedValue: "9600.0000000",
  suggestedBenchmark: "LME_Cu",
  suggestedHash: HASH,
  currentBenchmark: "LME_Cu",
};
const ROWS = [
  { label: "Current price", value: "LME_Cu · $9,500 per MT" },
  { label: "Suggested price", value: "LME_Cu · $9,600 per MT" },
];

const onClose = vi.fn();
const onDone = vi.fn();

function renderDialog(seed = SEED) {
  return render(
    <RevalueDialog
      chainId={99_000_001}
      seed={seed}
      rows={ROWS}
      onClose={onClose}
      onDone={onDone}
    />,
  );
}

beforeEach(() => {
  mocks.revalue.mutateAsync.mockReset();
  mocks.revalue.mutateAsync.mockResolvedValue({ hash: "TXHASH" });
  mocks.revalue.isPending = false;
  mocks.revalue.error = null;
  mocks.revalue.stage = null;
  onClose.mockReset();
  onDone.mockReset();
});

describe("RevalueDialog", () => {
  it("prefills the served suggestion and shows the served report hash", () => {
    renderDialog();
    expect(screen.getByTestId("revalue-value")).toHaveValue("9600.0000000");
    expect(screen.getByTestId("revalue-benchmark")).toHaveValue("LME_Cu");
    expect(screen.getByTestId("revalue-context")).toHaveTextContent(
      "LME_Cu · $9,600 per MT",
    );
    expect(screen.queryByTestId("revalue-evidence")).toBeNull();
    expect(screen.getByTestId("revalue-hash")).toHaveTextContent(HASH);
    expect(screen.getByTestId("revalue-confirm")).toBeEnabled();
  });

  it("submits the accepted suggestion with the served hash", async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("revalue-confirm"));
    await waitFor(() =>
      expect(mocks.revalue.mutateAsync).toHaveBeenCalledWith({
        chainId: 99_000_001,
        recordId: 7,
        valuePerUnit: "9600.0000000",
        benchmark: "LME_Cu",
        reportHash: HASH,
      }),
    );
    expect(onDone).toHaveBeenCalledWith({ recordId: 7, hash: "TXHASH" });
  });

  it("requires evidence on override and submits its sha256", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("revalue-value"), {
      target: { value: "9700" },
    });
    expect(screen.getByTestId("revalue-confirm")).toBeDisabled();
    expect(screen.getByTestId("revalue-validation")).toHaveTextContent(
      "Describe the source of your price.",
    );
    fireEvent.change(screen.getByTestId("revalue-evidence"), {
      target: { value: " LME 14:00 " },
    });
    await waitFor(() =>
      expect(screen.getByTestId("revalue-hash")).toHaveTextContent(
        "hash:LME 14:00",
      ),
    );
    fireEvent.click(screen.getByTestId("revalue-confirm"));
    await waitFor(() =>
      expect(mocks.revalue.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          valuePerUnit: "9700",
          reportHash: "hash:LME 14:00",
        }),
      ),
    );
  });

  it("allows a zero price and rejects a negative one", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("revalue-value"), {
      target: { value: "-5" },
    });
    expect(screen.getByTestId("revalue-validation")).toHaveTextContent(
      "can't be negative",
    );
    expect(screen.getByTestId("revalue-confirm")).toBeDisabled();
    fireEvent.change(screen.getByTestId("revalue-value"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByTestId("revalue-evidence"), {
      target: { value: "written off" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("revalue-confirm")).toBeEnabled(),
    );
  });

  it("starts empty and demands evidence when nothing was suggested", () => {
    renderDialog({
      ...SEED,
      suggestedValue: null,
      suggestedBenchmark: null,
      suggestedHash: null,
    });
    expect(screen.getByTestId("revalue-value")).toHaveValue("");
    expect(screen.getByTestId("revalue-benchmark")).toHaveValue("LME_Cu");
    expect(screen.getByTestId("revalue-evidence")).toBeInTheDocument();
    expect(screen.getByTestId("revalue-confirm")).toBeDisabled();
  });

  it("shows the mapped contract error with raw details and keeps the dialog open", async () => {
    mocks.revalue.error = new Error("simulation error: Error(Contract, #1)");
    renderDialog();
    expect(screen.getByTestId("revalue-error")).toHaveTextContent(
      "This record does not exist on-chain.",
    );
    mocks.revalue.mutateAsync.mockRejectedValue(new Error("boom"));
    fireEvent.click(screen.getByTestId("revalue-confirm"));
    await waitFor(() => expect(mocks.revalue.mutateAsync).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
  });

  it("labels the submit button with the relay stage", () => {
    mocks.revalue.isPending = true;
    mocks.revalue.stage = "awaiting-signature";
    renderDialog();
    expect(screen.getByTestId("revalue-confirm")).toHaveTextContent(
      "Waiting for wallet signature…",
    );
    expect(screen.getByTestId("revalue-confirm")).toBeDisabled();
  });
});
