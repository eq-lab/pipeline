// spec: docs/frontend/trustee-flows.md#security-marks-1859
import type React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  wallet: { address: "GTRUSTEE" as string | null, isConnected: true },
  access: { data: undefined as unknown },
  enterAccess: { data: undefined as unknown },
  approveAccess: { data: undefined as unknown },
  configured: true,
}));

vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: () => mocks.wallet,
  securityReasonHash: async (text: string) => `hash:${text}`,
  isSecurityBenchmark: (v: string) => /^[A-Za-z0-9_]{1,32}$/.test(v),
  INSPECTION_KINDS: ["DraftSurvey", "SamplingAssay"],
  inspectionMeasuresQuantity: (kind: string) => kind !== "SamplingAssay",
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: { chain: number };
  }) => (
    <a
      href={`${to.replace("$id", params?.id ?? "")}${search ? `?chain=${search.chain}` : ""}`}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/api/useSecurityInspections", () => ({
  useRecordInspection: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
    stage: null,
  }),
  useApproveInspection: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
    stage: null,
  }),
}));
vi.mock("@/api/useSecurityMarks", () => ({
  securityMarksConfigured: () => mocks.configured,
  checkCoverageConfigured: () => mocks.configured,
  useSecurityRegistryAccess: (fn: string) =>
    fn === "record_inspection"
      ? mocks.enterAccess
      : fn === "approve_inspection"
        ? mocks.approveAccess
        : mocks.access,
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
  mocks.enterAccess.data = { immediate: true, delay: 0 };
  mocks.approveAccess.data = { immediate: true, delay: 0 };
  mocks.configured = true;
});

function renderCard(chainId = STELLAR, cardView = view) {
  return render(
    <SecurityRecordsCard view={cardView} chainId={chainId} loanId="4471" />,
  );
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

const OTHER = "GOTHEROPERATORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const INSPECTOR = "GINSPECTORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function inspectionView(
  over: {
    inspectors?: string[];
    paused?: boolean;
    flagged_by?: string | null;
    protection?: string;
  } = {},
) {
  return buildSecurityRecords(
    securityResult({
      data: {
        terms: { advance_ratio_bps: 8000, tolerance_bps: 100 },
        inspectors: over.inspectors ?? [INSPECTOR],
        paused: over.paused ?? false,
        records: [
          {
            record_id: "7",
            protection: over.protection ?? "WarehousePledge",
            status: "Active",
            unit: "MT",
            open: true,
            flagged_by: over.flagged_by ?? null,
            inspections: [
              {
                inspection_id: "11",
                inspector: INSPECTOR,
                certificate_no: "C-11",
                entered_by: "GTRUSTEE",
                approved_by: null,
                complete: true,
              },
              {
                inspection_id: "12",
                inspector: INSPECTOR,
                certificate_no: "C-12",
                entered_by: OTHER,
                approved_by: null,
                complete: true,
              },
            ],
          },
        ],
      },
    }),
  );
}

describe("SecurityRecordsCard inspections (#1857)", () => {
  it("enables Enter inspection and opens the dialog", () => {
    renderCard(STELLAR, inspectionView());
    expect(screen.getByTestId("loan-detail-enter-inspection")).toBeEnabled();
    fireEvent.click(screen.getByTestId("loan-detail-enter-inspection"));
    expect(screen.getByTestId("inspection-dialog")).toBeInTheDocument();
  });

  it("hides Enter and Approve on an EVM loan and when not configured", () => {
    renderCard(560_048, inspectionView());
    expect(screen.queryByTestId("loan-detail-enter-inspection")).toBeNull();
    expect(screen.queryByTestId("loan-detail-approve-inspection")).toBeNull();
  });

  it("hides Enter and Approve when the environment is not configured", () => {
    mocks.configured = false;
    renderCard(STELLAR, inspectionView());
    expect(screen.queryByTestId("loan-detail-enter-inspection")).toBeNull();
  });

  it("disables Enter without a wallet, without a role, when paused and with no panel", () => {
    mocks.wallet.address = null;
    mocks.wallet.isConnected = false;
    const { unmount } = renderCard(STELLAR, inspectionView());
    expect(screen.getByTestId("loan-detail-enter-inspection")).toBeDisabled();
    expect(
      screen.getAllByTestId("loan-detail-inspection-note")[0],
    ).toHaveTextContent("Connect a Stellar wallet to enter an inspection.");
    unmount();

    mocks.wallet.address = "GTRUSTEE";
    mocks.wallet.isConnected = true;
    mocks.enterAccess.data = { immediate: false, delay: 0 };
    const second = renderCard(STELLAR, inspectionView());
    expect(screen.getByTestId("loan-detail-enter-inspection")).toBeDisabled();
    expect(
      screen.getAllByTestId("loan-detail-inspection-note")[0],
    ).toHaveTextContent("This wallet is not allowed to enter inspections.");
    second.unmount();

    mocks.enterAccess.data = { immediate: true, delay: 0 };
    const third = renderCard(STELLAR, inspectionView({ paused: true }));
    expect(screen.getByTestId("loan-detail-enter-inspection")).toBeDisabled();
    expect(
      screen.getAllByTestId("loan-detail-inspection-note")[0],
    ).toHaveTextContent("The SecurityRegistry is paused.");
    third.unmount();

    renderCard(STELLAR, inspectionView({ inspectors: [] }));
    expect(screen.getByTestId("loan-detail-enter-inspection")).toBeDisabled();
    expect(
      screen.getAllByTestId("loan-detail-inspection-note")[0],
    ).toHaveTextContent(
      "No inspectors are on the panel. The Risk Council sets the panel.",
    );
  });

  it("hides Approve for the entering wallet and shows it for another", () => {
    renderCard(STELLAR, inspectionView());
    const buttons = screen.getAllByTestId("loan-detail-approve-inspection");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("data-inspection-id", "12");
    expect(screen.getByText(/Entered by this wallet/)).toBeInTheDocument();
    fireEvent.click(buttons[0]!);
    expect(screen.getByTestId("approve-inspection-dialog")).toBeInTheDocument();
  });

  it("disables Approve without the role", () => {
    mocks.approveAccess.data = { immediate: false, delay: 0 };
    renderCard(STELLAR, inspectionView());
    expect(screen.getByTestId("loan-detail-approve-inspection")).toBeDisabled();
    expect(
      screen.getByText("This wallet is not allowed to approve inspections."),
    ).toBeInTheDocument();
  });

  it("shows the panel block and its empty copy", () => {
    const { unmount } = renderCard(STELLAR, inspectionView());
    expect(screen.getByTestId("loan-detail-inspector-panel")).toHaveTextContent(
      "Inspector panel",
    );
    expect(
      screen.getByRole("link", { name: "Inspector panel" }),
    ).toHaveAttribute("href", "/risk-council/inspectors");
    unmount();
    renderCard(STELLAR, inspectionView({ inspectors: [] }));
    expect(screen.getByTestId("loan-detail-inspector-panel")).toHaveTextContent(
      "No inspectors are on the panel.",
    );
  });

  it("links an open flag to the Risk Council page with the chain", () => {
    renderCard(STELLAR, inspectionView({ flagged_by: "12" }));
    expect(screen.getByTestId("loan-detail-open-flag")).toHaveTextContent(
      "Inspection #12. The Risk Council settles it.",
    );
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      `/risk-council/security/4471?chain=${STELLAR}`,
    );
  });

  it("omits the open flag when none is served and shows the counted-quantity note", () => {
    renderCard(STELLAR, inspectionView());
    expect(screen.queryByTestId("loan-detail-open-flag")).toBeNull();
    expect(
      screen.getByText(
        /Counted quantity is the smaller of the document quantity/,
      ),
    ).toBeInTheDocument();
  });
});
