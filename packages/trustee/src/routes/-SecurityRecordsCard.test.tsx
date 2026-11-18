// spec: docs/frontend/trustee-flows.md#security-marks-1859
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  wallet: { address: "GTRUSTEE" as string | null, isConnected: true },
  access: { data: undefined as unknown },
  configured: true,
}));

vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: () => mocks.wallet,
  securityReasonHash: async (text: string) => `hash:${text}`,
  isSecurityBenchmark: (v: string) => /^[A-Za-z0-9_]{1,32}$/.test(v),
}));
vi.mock("@/api/useSecurityMarks", () => ({
  securityMarksConfigured: () => mocks.configured,
  useSecurityRegistryAccess: () => mocks.access,
  useRevalue: () => ({
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null,
    stage: null,
  }),
}));
vi.mock("@/lib/env", () => ({
  ENV: { STELLAR_CHAIN_ID: 99_000_001, EVM_CHAIN_ID: 560_048 },
}));

import { SecurityRecordsCard } from "./-SecurityRecordsCard";
import { buildSecurityRecords } from "./-loanSecurityRecords";
import { securityResult } from "./-riskCouncilFixtures";

const STELLAR = 99_000_001;
const view = buildSecurityRecords(
  securityResult({
    data: {
      terms: { advance_ratio_bps: 8000 },
      records: [
        {
          record_id: "7",
          protection: "warehouse_receipt",
          unit: "MT",
          open: true,
          mark: { value_per_unit: "9500.0000000", benchmark: "LME_Cu" },
          suggested_mark: {
            value_per_unit: "9600.0000000",
            benchmark: "LME_Cu",
            report_hash: "ab".repeat(32),
          },
          suggestion_status: "ok",
          mark_due: true,
          mark_due_reasons: ["age"],
        },
        { record_id: "8", protection: "cash_cover", open: true },
      ],
    },
  }),
);

beforeEach(() => {
  mocks.wallet.address = "GTRUSTEE";
  mocks.wallet.isConnected = true;
  mocks.access.data = { immediate: true, delay: 0 };
  mocks.configured = true;
});

function renderCard(chainId = STELLAR) {
  return render(<SecurityRecordsCard view={view} chainId={chainId} />);
}

describe("SecurityRecordsCard revalue", () => {
  it("shows the mark-due chip and one enabled button for the goods record only", () => {
    renderCard();
    expect(screen.getAllByTestId("loan-detail-revalue-button")).toHaveLength(1);
    expect(screen.getByTestId("loan-detail-revalue-button")).toBeEnabled();
    expect(
      screen.getByTestId("loan-detail-security-record-chip"),
    ).toHaveTextContent("Mark due");
  });

  it("opens the dialog from the button", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("loan-detail-revalue-button"));
    expect(screen.getByTestId("revalue-dialog")).toBeInTheDocument();
  });

  it("disables with the no-role copy for a wallet that cannot call revalue", () => {
    mocks.access.data = { immediate: false, delay: 0 };
    renderCard();
    expect(screen.getByTestId("loan-detail-revalue-button")).toBeDisabled();
    expect(screen.getByTestId("loan-detail-revalue-note")).toHaveTextContent(
      "This wallet is not allowed to set a price mark.",
    );
  });

  it("disables and asks to connect a wallet when none is connected", () => {
    mocks.wallet.address = null;
    mocks.wallet.isConnected = false;
    renderCard();
    expect(screen.getByTestId("loan-detail-revalue-button")).toBeDisabled();
    expect(screen.getByTestId("loan-detail-revalue-note")).toHaveTextContent(
      "Connect a Stellar wallet",
    );
  });

  it("hides the button for an EVM loan or when not configured", () => {
    renderCard(560_048);
    expect(screen.queryByTestId("loan-detail-revalue-button")).toBeNull();
  });

  it("hides the button when the environment is not configured", () => {
    mocks.configured = false;
    renderCard();
    expect(screen.queryByTestId("loan-detail-revalue-button")).toBeNull();
  });
});
