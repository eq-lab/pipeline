// spec: docs/frontend/trustee-flows.md#register-debt-token-1766
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CanCall, OperationSchedule } from "@pipeline/wallet-connect";

const mocks = vi.hoisted(() => ({
  deal: {
    data: null as { debt: string } | null | undefined,
    isPending: false,
    isError: false,
  },
  access: {
    data: undefined as
      | { canCall: CanCall; schedule: OperationSchedule | null }
      | undefined,
    isPending: false,
    isError: false,
  },
  register: {
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null as Error | null,
    stage: null as string | null,
  },
  configured: true,
  wallet: { address: "GTRUSTEE" as string | null, isConnected: true },
}));

vi.mock("@/lib/env", () => ({
  ENV: { STELLAR_CHAIN_ID: 99_000_001, EVM_CHAIN_ID: 560_048 },
}));
vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: () => mocks.wallet,
}));
vi.mock("@/api/useDealToken", () => ({
  dealTokenConfigured: () => mocks.configured,
  useDeal: () => mocks.deal,
  useRegisterDealAccess: () => mocks.access,
  useRegisterDeal: () => mocks.register,
}));

import { RegisterDebtTokenAction } from "./-RegisterDebtTokenAction";

const STELLAR = 99_000_001;
const EVM = 560_048;

function setAccess(
  canCall: CanCall,
  schedule: OperationSchedule | null = null,
) {
  mocks.access.data = { canCall, schedule };
}

beforeEach(() => {
  mocks.deal.data = null;
  mocks.deal.isPending = false;
  mocks.deal.isError = false;
  mocks.access.data = undefined;
  mocks.access.isPending = false;
  mocks.access.isError = false;
  mocks.register.mutateAsync.mockReset();
  mocks.register.mutateAsync.mockResolvedValue({ hash: "h" });
  mocks.register.reset.mockReset();
  mocks.register.isPending = false;
  mocks.register.error = null;
  mocks.register.stage = null;
  mocks.configured = true;
  mocks.wallet.address = "GTRUSTEE";
  mocks.wallet.isConnected = true;
});

function renderAction(
  props: Partial<Parameters<typeof RegisterDebtTokenAction>[0]> = {},
) {
  return render(
    <RegisterDebtTokenAction
      chainId={STELLAR}
      loanId={7}
      variant="card"
      {...props}
    />,
  );
}

describe("RegisterDebtTokenAction", () => {
  it("signs execute with one click for an immediate role", async () => {
    setAccess({ immediate: true, delay: 0 });
    renderAction();
    const button = screen.getByTestId("register-debt-token-button");
    expect(button).toHaveTextContent("Register debt token");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.register.mutateAsync).toHaveBeenCalledWith({
        mode: "execute",
        loanId: 7,
        chainId: STELLAR,
      }),
    );
  });

  it("schedules, then executes, for a delayed role", () => {
    setAccess(
      { immediate: false, delay: 3600 },
      { operationId: "a", readyAt: 0 },
    );
    const { unmount } = renderAction();
    expect(screen.getByTestId("register-debt-token-button")).toHaveTextContent(
      "Schedule registration",
    );
    fireEvent.click(screen.getByTestId("register-debt-token-button"));
    expect(mocks.register.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "schedule" }),
    );
    unmount();

    setAccess(
      { immediate: false, delay: 3600 },
      { operationId: "a", readyAt: 1_800_000_000 },
    );
    renderAction();
    expect(screen.getByTestId("register-debt-token-button")).toHaveTextContent(
      "Execute registration",
    );
    expect(screen.getByTestId("register-debt-token-note")).toHaveTextContent(
      /Scheduled\. Executable from/,
    );
  });

  it("disables the action for a wallet without the role", () => {
    setAccess({ immediate: false, delay: 0 });
    renderAction();
    expect(screen.getByTestId("register-debt-token-button")).toBeDisabled();
    expect(screen.getByTestId("register-debt-token-note")).toHaveTextContent(
      "Only the Trustee role can register",
    );
  });

  it("disables the action while the wallet is not connected", () => {
    mocks.wallet.address = null;
    mocks.wallet.isConnected = false;
    renderAction();
    expect(screen.getByTestId("register-debt-token-button")).toBeDisabled();
    expect(screen.getByTestId("register-debt-token-note")).toHaveTextContent(
      "Connect your trustee wallet",
    );
  });

  it("shows the stage label while signing", () => {
    setAccess({ immediate: true, delay: 0 });
    mocks.register.isPending = true;
    mocks.register.stage = "awaiting-signature";
    renderAction();
    const button = screen.getByTestId("register-debt-token-button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Waiting for wallet signature…");
  });

  it("maps a contract error to the specific copy", () => {
    setAccess({ immediate: true, delay: 0 });
    mocks.register.error = new Error(
      "execute simulation error: Error(Contract, #3)",
    );
    renderAction();
    expect(screen.getByTestId("register-debt-token-error")).toHaveTextContent(
      /already registered/,
    );
  });

  it("blocks EVM loans with the Stellar-only reason and no button", () => {
    renderAction({ chainId: EVM });
    expect(screen.queryByTestId("register-debt-token-button")).toBeNull();
    expect(screen.getByTestId("register-debt-token-note")).toHaveTextContent(
      /Stellar only/,
    );
  });

  it("blocks an unconfigured environment with no button", () => {
    mocks.configured = false;
    renderAction();
    expect(screen.queryByTestId("register-debt-token-button")).toBeNull();
    expect(screen.getByTestId("register-debt-token-note")).toHaveTextContent(
      "Debt token registration isn't configured for this environment.",
    );
  });

  it("renders nothing while loading, on a read error, and (card) once registered", () => {
    mocks.deal.isPending = true;
    mocks.deal.data = undefined;
    const first = renderAction();
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();

    mocks.deal.isPending = false;
    mocks.deal.isError = true;
    const second = renderAction();
    expect(second.container).toBeEmptyDOMElement();
    second.unmount();

    mocks.deal.isError = false;
    mocks.deal.data = { debt: "CDEBT" };
    const third = renderAction();
    expect(third.container).toBeEmptyDOMElement();
  });

  it("inline variant swaps in the registered debt address verbatim", () => {
    mocks.deal.data = { debt: "CDEBTADDRESS" };
    renderAction({ variant: "inline" });
    expect(
      screen.getByTestId("register-debt-token-registered"),
    ).toHaveTextContent("Debt token registered · CDEBTADDRESS");
    expect(screen.queryByTestId("register-debt-token-button")).toBeNull();
  });
});
