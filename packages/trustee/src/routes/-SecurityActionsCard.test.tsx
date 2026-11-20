// spec: docs/frontend/trustee-flows.md#security-marks-1859
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const mutation = () => ({
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null as Error | null,
    stage: null as string | null,
  });
  return {
    wallet: { address: "GANY" as string | null, isConnected: true },
    access: { data: undefined as unknown },
    coverage: mutation(),
    consent: mutation(),
    coverageConfigured: true,
    marksConfigured: true,
  };
});

vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: () => mocks.wallet,
  securityReasonHash: async (text: string) => `hash:${text.trim()}`,
}));
vi.mock("@/api/useSecurityMarks", () => ({
  checkCoverageConfigured: () => mocks.coverageConfigured,
  securityMarksConfigured: () => mocks.marksConfigured,
  useCheckCoverage: () => mocks.coverage,
  useRecordExtensionConsent: () => mocks.consent,
  useSecurityRegistryAccess: () => mocks.access,
}));
vi.mock("@/lib/env", () => ({
  ENV: { STELLAR_CHAIN_ID: 99_000_001, EVM_CHAIN_ID: 560_048 },
}));

import { SecurityActionsCard } from "./-SecurityActionsCard";
import type { SecurityActionsView } from "./-securityActions";

const STELLAR = 99_000_001;
const READY: SecurityActionsView = {
  state: "ready",
  notes: ["LTV is back at or below the advance ratio."],
  consents: [
    {
      key: "0-0",
      position: "#0",
      newMaturity: "1 Jan 2027",
      consentHash: "ab".repeat(32),
      recordedAt: "20 Nov 2026",
    },
  ],
};

function renderCard(
  view: SecurityActionsView = READY,
  chainId: number = STELLAR,
  loanId: number | null = 4488,
) {
  return render(
    <SecurityActionsCard view={view} chainId={chainId} loanId={loanId} />,
  );
}

beforeEach(() => {
  mocks.wallet.address = "GANY";
  mocks.wallet.isConnected = true;
  mocks.access.data = { immediate: true, delay: 0 };
  for (const m of [mocks.coverage, mocks.consent]) {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue({ hash: "TXHASH" });
    m.isPending = false;
    m.error = null;
    m.stage = null;
  }
  mocks.coverageConfigured = true;
  mocks.marksConfigured = true;
});

describe("SecurityActionsCard", () => {
  it("renders nothing when hidden, for an EVM loan or without a numeric loan", () => {
    const hidden: SecurityActionsView = {
      state: "hidden",
      notes: [],
      consents: [],
    };
    expect(renderCard(hidden).container).toBeEmptyDOMElement();
    expect(renderCard(READY, 560_048).container).toBeEmptyDOMElement();
    expect(renderCard(READY, STELLAR, null).container).toBeEmptyDOMElement();
  });

  it("shows the served hints and the consents verbatim", () => {
    renderCard();
    expect(
      screen.getByTestId("loan-detail-security-actions-note"),
    ).toHaveTextContent("LTV is back at or below the advance ratio.");
    expect(
      screen.getByTestId("loan-detail-extension-consent"),
    ).toHaveTextContent("Extend to 1 Jan 2027");
    expect(
      screen.getByTestId("loan-detail-extension-consent"),
    ).toHaveTextContent("Recorded 20 Nov 2026");
  });

  it("shows the empty consents line", () => {
    renderCard({ ...READY, consents: [] });
    expect(
      screen.getByTestId("loan-detail-extension-consents-empty"),
    ).toHaveTextContent("No extension consents are recorded.");
  });

  it("runs check coverage for any connected wallet and shows the hash", async () => {
    mocks.access.data = { immediate: false, delay: 0 };
    renderCard();
    fireEvent.click(screen.getByTestId("check-coverage-button"));
    await waitFor(() =>
      expect(mocks.coverage.mutateAsync).toHaveBeenCalledWith({
        chainId: STELLAR,
        loanId: 4488,
      }),
    );
    expect(
      await screen.findByTestId("check-coverage-result"),
    ).toHaveTextContent("TXHASH");
  });

  it("disables check coverage without a wallet", () => {
    mocks.wallet.address = null;
    mocks.wallet.isConnected = false;
    renderCard();
    expect(screen.getByTestId("check-coverage-button")).toBeDisabled();
    expect(screen.getByTestId("check-coverage-connect")).toBeInTheDocument();
  });

  it("surfaces a check coverage failure with mapped copy", () => {
    mocks.coverage.error = new Error("simulation error: Error(Contract, #14)");
    renderCard();
    expect(screen.getByTestId("check-coverage-error")).toHaveTextContent(
      "This loan has no security terms yet.",
    );
  });

  it("validates and submits the consent with the hashed reference and UTC midnight", async () => {
    renderCard();
    expect(screen.getByTestId("extension-consent-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("extension-consent-date"), {
      target: { value: "2099-01-02" },
    });
    fireEvent.change(screen.getByTestId("extension-consent-reference"), {
      target: { value: " email-42 " },
    });
    await waitFor(() =>
      expect(screen.getByTestId("extension-consent-hash")).toHaveTextContent(
        "hash:email-42",
      ),
    );
    fireEvent.click(screen.getByTestId("extension-consent-submit"));
    await waitFor(() =>
      expect(mocks.consent.mutateAsync).toHaveBeenCalledWith({
        chainId: STELLAR,
        loanId: 4488,
        newMaturity: Date.parse("2099-01-02T00:00:00Z") / 1000,
        consentHash: "hash:email-42",
      }),
    );
    expect(
      await screen.findByTestId("extension-consent-result"),
    ).toHaveTextContent("TXHASH");
  });

  it("rejects a past maturity date", () => {
    renderCard();
    fireEvent.change(screen.getByTestId("extension-consent-date"), {
      target: { value: "2001-01-01" },
    });
    fireEvent.change(screen.getByTestId("extension-consent-reference"), {
      target: { value: "x" },
    });
    expect(
      screen.getByTestId("extension-consent-validation"),
    ).toHaveTextContent("after today");
    expect(screen.getByTestId("extension-consent-submit")).toBeDisabled();
  });

  it("blocks the consent form for a wallet without the role", () => {
    mocks.access.data = { immediate: false, delay: 0 };
    renderCard();
    expect(screen.getByTestId("extension-consent-no-role")).toHaveTextContent(
      "not allowed to record an extension consent",
    );
    expect(screen.getByTestId("extension-consent-submit")).toBeDisabled();
    expect(screen.getByTestId("extension-consent-date")).toBeDisabled();
  });

  it("hides the consent form when the executor is not configured but keeps check coverage", () => {
    mocks.marksConfigured = false;
    renderCard();
    expect(screen.queryByTestId("extension-consent-submit")).toBeNull();
    expect(screen.getByTestId("check-coverage-button")).toBeEnabled();
  });
});
