// spec: docs/frontend/trustee-flows.md#disburse-1898
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const ok = { isPending: false, isError: false };
  return {
    ok,
    loan: {
      data: undefined as unknown,
      isPending: false,
      isError: false,
    },
    deal: { data: undefined as unknown, isPending: false, isError: false },
    trustline: { data: undefined as unknown, isPending: false, isError: false },
    paused: { data: false as unknown, isPending: false, isError: false },
    access: { data: undefined as unknown, isPending: false, isError: false },
    pool: { data: undefined as unknown },
    evmDeal: { data: undefined as unknown, isPending: false, isError: false },
    evmCash: { data: undefined as unknown },
    evmPaused: { data: false as unknown, isPending: false, isError: false },
    evmWallet: { address: "0xTRUSTEE" as string | null, isConnected: true },
    accessChain: undefined as unknown,
    accessEnabled: undefined as unknown,
    disburse: {
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isSuccess: false,
      error: null as Error | null,
      stage: null as string | null,
    },
    configured: true,
    wallet: { address: "GTRUSTEE" as string | null, isConnected: true },
  };
});

vi.mock("@/lib/env", () => ({
  ENV: { STELLAR_CHAIN_ID: 99_000_001, EVM_CHAIN_ID: 560_048 },
}));
vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: () => mocks.wallet,
  useEvmWallet: () => mocks.evmWallet,
  bankReferenceRefHash: async (reference: string) => `hash:${reference.trim()}`,
}));
vi.mock("@/api/useDisburse", () => ({
  disburseConfigured: () => mocks.configured,
  useLoanDisbursementState: () => mocks.loan,
  useDebtTrustline: () => mocks.trustline,
  useDisburseAccess: (chainId: unknown, enabled: unknown) => {
    mocks.accessChain = chainId;
    mocks.accessEnabled = enabled;
    return mocks.access;
  },
  useDisburse: () => mocks.disburse,
  useEvmMinterBankCash: () => mocks.evmCash,
  useEvmMinterPaused: () => mocks.evmPaused,
}));
vi.mock("@/api/useDealToken", () => ({
  useDeal: () => mocks.deal,
  useEvmDeal: () => mocks.evmDeal,
}));
vi.mock("@/api/useConversions", () => ({
  useMinterPoolState: () => mocks.pool,
  useMinterPaused: () => mocks.paused,
}));

import { DisburseAction } from "./-DisburseAction";

const STELLAR = 99_000_001;
const EVM = 560_048;

function ready() {
  mocks.loan.data = {
    status: "Approved",
    carvedOut: false,
    disbursed: "0",
    originalSeniorTranche: "500000000000",
  };
  mocks.deal.data = { debt: "CDEBT" };
  mocks.trustline.data = { holder: "CHOLDER", trustline: "present" };
  mocks.paused.data = false;
  mocks.access.data = { immediate: true, delay: 0 };
  mocks.pool.data = { bankCash: "1000000000000" };
}

beforeEach(() => {
  mocks.loan.data = undefined;
  mocks.loan.isError = false;
  mocks.deal.data = undefined;
  mocks.trustline.data = undefined;
  mocks.paused.data = false;
  mocks.access.data = undefined;
  mocks.pool.data = undefined;
  mocks.evmDeal.data = undefined;
  mocks.evmCash.data = undefined;
  mocks.evmPaused.data = false;
  mocks.evmWallet.address = "0xTRUSTEE";
  mocks.evmWallet.isConnected = true;
  mocks.disburse.mutateAsync.mockReset();
  mocks.disburse.mutateAsync.mockResolvedValue({ hash: "TXHASH" });
  mocks.disburse.isPending = false;
  mocks.disburse.error = null;
  mocks.disburse.stage = null;
  mocks.configured = true;
  mocks.wallet.address = "GTRUSTEE";
  mocks.wallet.isConnected = true;
});

function renderAction(chainId: number = STELLAR) {
  return render(
    <DisburseAction chainId={chainId} loanId={0} loanName="Loan 0" />,
  );
}

function readyEvm() {
  mocks.loan.data = {
    status: "Approved",
    carvedOut: false,
    disbursed: "0",
    originalSeniorTranche: "50000000000",
  };
  mocks.evmDeal.data = { debt: "0xdebt" };
  mocks.evmPaused.data = false;
  mocks.access.data = { immediate: true, delay: 0 };
  mocks.evmCash.data = "100000000000";
}

function fillForm(amount = "50000", reference = "WIRE-1") {
  fireEvent.change(screen.getByTestId("disburse-amount"), {
    target: { value: amount },
  });
  fireEvent.change(screen.getByTestId("disburse-reference"), {
    target: { value: reference },
  });
}

describe("DisburseAction", () => {
  it("renders nothing for a fully disbursed Performing loan", () => {
    ready();
    mocks.loan.data = {
      status: "Performing",
      carvedOut: false,
      disbursed: "500000000000",
      originalSeniorTranche: "500000000000",
    };
    renderAction();
    expect(screen.queryByTestId("loan-detail-disburse")).toBeNull();
  });

  it("shows the registration reason and a disabled button for an unregistered deal", () => {
    ready();
    mocks.deal.data = null;
    renderAction();
    expect(
      screen.getByTestId("loan-detail-disburse-blocked"),
    ).toHaveTextContent("Register this loan's debt token first.");
    expect(screen.getByTestId("loan-detail-disburse-button")).toBeDisabled();
  });

  it("shows the senior tranche, on-chain disbursed and bank cash verbatim", () => {
    ready();
    renderAction();
    const card = screen.getByTestId("loan-detail-disburse");
    expect(card).toHaveTextContent("$50,000");
    expect(card).toHaveTextContent("$100,000");
    expect(card).toHaveTextContent("not disbursed on-chain");
    expect(screen.getByTestId("loan-detail-disburse-button")).toBeEnabled();
  });

  it("disables submit on a form error and submits the parsed raw amount and UTC midnight", async () => {
    ready();
    renderAction();
    fireEvent.click(screen.getByTestId("loan-detail-disburse-button"));
    expect(screen.getByTestId("disburse-confirm")).toBeDisabled();
    fillForm("2000000");
    expect(screen.getByTestId("disburse-validation")).toHaveTextContent(
      /booked bank cash/,
    );
    expect(screen.getByTestId("disburse-confirm")).toBeDisabled();
    fillForm("50000");
    fireEvent.change(screen.getByTestId("disburse-value-date"), {
      target: { value: "2026-01-02" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("disburse-hash")).toHaveTextContent(
        "hash:WIRE-1",
      ),
    );
    fireEvent.click(screen.getByTestId("disburse-confirm"));
    await waitFor(() =>
      expect(mocks.disburse.mutateAsync).toHaveBeenCalledWith({
        chainId: STELLAR,
        loanId: 0,
        amountRaw: "500000000000",
        valueDate: Date.parse("2026-01-02T00:00:00Z") / 1000,
        reference: "WIRE-1",
      }),
    );
    expect(
      await screen.findByTestId("loan-detail-disburse-result"),
    ).toHaveTextContent("Transaction TXHASH");
    expect(screen.queryByTestId("disburse-dialog")).toBeNull();
  });

  it("renders the mapped error copy", () => {
    ready();
    mocks.disburse.error = new Error(
      "disburse simulation error: HostError: Error(Contract, #8)",
    );
    renderAction();
    fireEvent.click(screen.getByTestId("loan-detail-disburse-button"));
    expect(screen.getByTestId("disburse-error")).toHaveTextContent(
      /booked bank cash is below this amount/,
    );
  });

  it("ignores Escape and the backdrop while pending, and honours them otherwise", () => {
    ready();
    mocks.disburse.isPending = true;
    const { unmount } = renderAction();
    fireEvent.click(screen.getByTestId("loan-detail-disburse-button"));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("disburse-backdrop"));
    expect(screen.getByTestId("disburse-dialog")).toBeInTheDocument();
    unmount();

    mocks.disburse.isPending = false;
    renderAction();
    fireEvent.click(screen.getByTestId("loan-detail-disburse-button"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("disburse-dialog")).toBeNull();
  });
});

describe("DisburseAction on EVM", () => {
  it("shows the deal reason and a disabled button for an Approved loan with no deal", () => {
    readyEvm();
    mocks.evmDeal.data = null;
    renderAction(EVM);
    expect(
      screen.getByTestId("loan-detail-disburse-blocked"),
    ).toHaveTextContent("Register this loan's debt token first.");
    expect(screen.getByTestId("loan-detail-disburse-button")).toBeDisabled();
  });

  it("enables the button without a trustline step and shows 6-dp values", () => {
    readyEvm();
    renderAction(EVM);
    const card = screen.getByTestId("loan-detail-disburse");
    expect(card).toHaveTextContent("$50,000");
    expect(card).toHaveTextContent("$100,000");
    expect(screen.getByTestId("loan-detail-disburse-button")).toBeEnabled();
    expect(mocks.accessChain).toBe(EVM);
    expect(mocks.accessEnabled).toBe(true);
  });

  it("parses the amount at 6 decimals and submits the EVM chain id", async () => {
    readyEvm();
    renderAction(EVM);
    fireEvent.click(screen.getByTestId("loan-detail-disburse-button"));
    fillForm("1.1234567");
    expect(screen.getByTestId("disburse-validation")).toHaveTextContent(
      "up to 6 decimals",
    );
    fillForm("50000.5");
    fireEvent.change(screen.getByTestId("disburse-value-date"), {
      target: { value: "2026-01-02" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("disburse-hash")).toHaveTextContent(
        "hash:WIRE-1",
      ),
    );
    fireEvent.click(screen.getByTestId("disburse-confirm"));
    await waitFor(() =>
      expect(mocks.disburse.mutateAsync).toHaveBeenCalledWith({
        chainId: EVM,
        loanId: 0,
        amountRaw: "50000500000",
        valueDate: Date.parse("2026-01-02T00:00:00Z") / 1000,
        reference: "WIRE-1",
      }),
    );
    expect(
      await screen.findByTestId("loan-detail-disburse-result"),
    ).toHaveTextContent("Disbursed $50,000.5");
  });

  it("refuses an amount above the 6-dp bank cash before any signature", () => {
    readyEvm();
    renderAction(EVM);
    fireEvent.click(screen.getByTestId("loan-detail-disburse-button"));
    fillForm("100000.000001");
    expect(screen.getByTestId("disburse-validation")).toHaveTextContent(
      /booked bank cash \(\$100,000\)/,
    );
    expect(screen.getByTestId("disburse-confirm")).toBeDisabled();
  });

  it("maps an EVM revert name to the Stellar copy", () => {
    readyEvm();
    mocks.disburse.error = new Error(
      "disburseEvmLoan: simulation error: Error: MinterInsufficientBankCash(uint256,uint256)",
    );
    renderAction(EVM);
    fireEvent.click(screen.getByTestId("loan-detail-disburse-button"));
    expect(screen.getByTestId("disburse-error")).toHaveTextContent(
      /booked bank cash is below this amount/,
    );
  });

  it("keeps the Stellar-only reason on an unknown chain and never enables the access read", () => {
    readyEvm();
    renderAction(1234);
    expect(
      screen.getByTestId("loan-detail-disburse-blocked"),
    ).toHaveTextContent(/Stellar only/);
    expect(screen.getByTestId("loan-detail-disburse-button")).toBeDisabled();
    expect(mocks.accessEnabled).toBe(false);
  });
});
