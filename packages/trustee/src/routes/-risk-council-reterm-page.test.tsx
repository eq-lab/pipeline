// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  DELAYED,
  IMMEDIATE,
  NO_ROLE,
  SCHEDULED,
  STELLAR,
  accessResult,
  loanBookResult,
  loanEntry,
  loanState,
  relayResult,
  securityResult,
} from "./-riskCouncilFixtures";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

const HASH = "cd".repeat(32);
vi.mock("@pipeline/wallet-connect", () => ({
  riskCouncilReasonHash: vi.fn(async () => "cd".repeat(32)),
}));
vi.mock("@/api/useLoanBook", () => ({ useLoanBook: vi.fn() }));
vi.mock("@/api/useLoanSecurity", () => ({ useLoanSecurity: vi.fn() }));
vi.mock("@/api/useRiskCouncil", () => ({
  useRiskCouncilAccess: vi.fn(),
  useRiskCouncilLoanState: vi.fn(),
  useRiskCouncilRelay: vi.fn(),
}));

import { useLoanBook } from "@/api/useLoanBook";
import { useLoanSecurity } from "@/api/useLoanSecurity";
import {
  useRiskCouncilAccess,
  useRiskCouncilLoanState,
  useRiskCouncilRelay,
} from "@/api/useRiskCouncil";
import { Route } from "./risk-council.reterm.$id";

const mockLoanBook = vi.mocked(useLoanBook);
const mockSecurity = vi.mocked(useLoanSecurity);
const mockAccess = vi.mocked(useRiskCouncilAccess);
const mockLoanState = vi.mocked(useRiskCouncilLoanState);
const mockRelay = vi.mocked(useRiskCouncilRelay);

(Route as unknown as { useParams: () => { id: string } }).useParams = () => ({
  id: "4471",
});
(Route as unknown as { useSearch: () => { chain: number } }).useSearch =
  () => ({ chain: STELLAR });

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

let relay: ReturnType<typeof relayResult>;

function setup(
  access: Parameters<typeof accessResult>[0],
  status = "WatchList",
) {
  mockLoanBook.mockReturnValue(loanBookResult([loanEntry()]));
  mockSecurity.mockReturnValue(securityResult());
  mockAccess.mockReturnValue(accessResult(access) as never);
  mockLoanState.mockReturnValue({
    data: loanState({ status, interestAdjustment: "-12000000" }),
  } as never);
  mockRelay.mockReturnValue(relay as never);
}

function fillAmend(rate = "14.5", date = "2026-12-15") {
  fireEvent.change(screen.getByTestId("risk-council-reterm-rate"), {
    target: { value: rate },
  });
  fireEvent.change(screen.getByTestId("risk-council-reterm-maturity-input"), {
    target: { value: date },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  relay = relayResult();
});

describe("Amend economics — current terms", () => {
  it("shows the chain-sourced terms", () => {
    setup(DELAYED);
    renderRoute();
    expect(screen.getByTestId("risk-council-reterm-loan")).toHaveTextContent(
      "Delta Commodities — Coffee",
    );
    expect(screen.getByTestId("risk-council-reterm-coupon")).toHaveTextContent(
      "14.5%",
    );
    expect(
      screen.getByTestId("risk-council-reterm-maturity"),
    ).toHaveTextContent("15 Dec 2026");
    expect(screen.getByTestId("risk-council-reterm-accrued")).toHaveTextContent(
      "$0.50",
    );
    expect(
      screen.getByTestId("risk-council-reterm-adjustment"),
    ).toHaveTextContent("-$1.20");
  });

  it("shows the LTV row from the security state and no CCR row", () => {
    setup(DELAYED);
    renderRoute();
    expect(screen.getByTestId("risk-council-reterm-ltv")).toHaveTextContent(
      "81.2% — margin call at 85%",
    );
    expect(screen.queryByText("CCR")).not.toBeInTheDocument();
  });

  it("omits the LTV row when security is not configured", () => {
    setup(DELAYED);
    mockSecurity.mockReturnValue(
      securityResult({ data: undefined, notConfigured: true }),
    );
    renderRoute();
    expect(
      screen.queryByTestId("risk-council-reterm-ltv"),
    ).not.toBeInTheDocument();
  });

  it("has no Safe, proposal or timestamp artefacts", () => {
    setup(DELAYED);
    const { container } = renderRoute();
    expect(container.textContent).not.toMatch(/safe|proposal|timelock/i);
    expect(
      screen.queryByTestId("risk-council-reterm-timestamp"),
    ).not.toBeInTheDocument();
  });
});

describe("Amend economics — form", () => {
  it("echoes bps live and flags an invalid rate", () => {
    setup(DELAYED);
    renderRoute();
    expect(
      screen.getByTestId("risk-council-reterm-rate-bps"),
    ).toHaveTextContent("1 bp = 0.01%");
    fireEvent.change(screen.getByTestId("risk-council-reterm-rate"), {
      target: { value: "14.5" },
    });
    expect(
      screen.getByTestId("risk-council-reterm-rate-bps"),
    ).toHaveTextContent("= 1450 bps");
    fireEvent.change(screen.getByTestId("risk-council-reterm-rate"), {
      target: { value: "abc" },
    });
    expect(
      screen.getByTestId("risk-council-reterm-rate-error"),
    ).toBeInTheDocument();
  });

  it("keeps the button disabled until the form is valid, then schedules", () => {
    setup(DELAYED);
    renderRoute();
    const button = screen.getByTestId("risk-council-reterm-amend-button");
    expect(button).toHaveTextContent("Schedule amendment");
    expect(button).toBeDisabled();
    fillAmend();
    expect(mockAccess).toHaveBeenCalledWith(
      STELLAR,
      expect.objectContaining({ fn: "amend_economics" }),
      "amend_economics",
    );
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(relay.mutateAsync).toHaveBeenCalledWith({
      mode: "schedule",
      call: {
        fn: "amend_economics",
        loanId: 4471,
        rateBps: 1450,
        maturity: 1_797_292_800,
      },
      chainId: STELLAR,
    });
  });

  it("shows the existing schedule for re-entered args and offers the execute", () => {
    setup(SCHEDULED);
    renderRoute();
    fillAmend();
    expect(
      screen.getByTestId("risk-council-reterm-amend-role"),
    ).toHaveTextContent("Scheduled. Executable from 2027-01-15 08:00 UTC.");
    const button = screen.getByTestId("risk-council-reterm-amend-button");
    expect(button).toHaveTextContent("Execute amendment");
    fireEvent.click(button);
    expect(relay.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "execute" }),
    );
  });

  it("executes at once on the immediate path", () => {
    setup(IMMEDIATE);
    renderRoute();
    fillAmend();
    const button = screen.getByTestId("risk-council-reterm-amend-button");
    expect(button).toHaveTextContent("Amend economics");
    fireEvent.click(button);
    expect(relay.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "execute" }),
    );
  });
});

describe("Adjust interest — form", () => {
  it("wires the reason hash and schedules a signed delta", async () => {
    setup(DELAYED);
    renderRoute();
    fireEvent.change(screen.getByTestId("risk-council-reterm-delta"), {
      target: { value: "-1,000.5" },
    });
    fireEvent.change(screen.getByTestId("risk-council-reterm-reason"), {
      target: { value: "  Waiver agreed  " },
    });
    await waitFor(() =>
      expect(screen.getByTestId("risk-council-reterm-reason-hash")).toHaveValue(
        HASH,
      ),
    );
    const button = screen.getByTestId("risk-council-reterm-adjust-button");
    expect(button).toHaveTextContent("Schedule adjustment");
    fireEvent.click(button);
    expect(relay.mutateAsync).toHaveBeenCalledWith({
      mode: "schedule",
      call: {
        fn: "adjust_interest",
        loanId: 4471,
        delta: "-10005000000",
        reasonHash: HASH,
      },
      chainId: STELLAR,
    });
  });

  it("stays disabled without a reason", () => {
    setup(DELAYED);
    renderRoute();
    fireEvent.change(screen.getByTestId("risk-council-reterm-delta"), {
      target: { value: "5" },
    });
    expect(
      screen.getByTestId("risk-council-reterm-adjust-button"),
    ).toBeDisabled();
  });
});

describe("Amend economics — read-only states", () => {
  it("is read-only for a wallet without the role", () => {
    setup(NO_ROLE);
    renderRoute();
    expect(
      screen.getByTestId("risk-council-reterm-amend-role"),
    ).toHaveTextContent("Changing loan economics belongs to the Risk Council.");
    expect(
      screen.getByTestId("risk-council-reterm-adjust-role"),
    ).toHaveTextContent("Changing loan economics belongs to the Risk Council.");
    expect(screen.getByTestId("risk-council-reterm-chip")).toHaveTextContent(
      "Risk Council only",
    );
    fillAmend();
    expect(
      screen.getByTestId("risk-council-reterm-amend-button"),
    ).toBeDisabled();
  });

  it("is unavailable for a Closed loan", () => {
    setup(DELAYED, "Closed");
    renderRoute();
    expect(
      screen.getByTestId("risk-council-reterm-eligibility"),
    ).toHaveTextContent("Not available for a Closed loan.");
    fillAmend();
    expect(
      screen.getByTestId("risk-council-reterm-amend-button"),
    ).toBeDisabled();
  });

  it("shows the Stellar-only reason for another chain", () => {
    (Route as unknown as { useSearch: () => { chain: number } }).useSearch =
      () => ({ chain: 1 });
    mockLoanBook.mockReturnValue(loanBookResult([loanEntry({ chain_id: 1 })]));
    mockAccess.mockReturnValue(accessResult(undefined) as never);
    mockLoanState.mockReturnValue({ data: undefined } as never);
    mockRelay.mockReturnValue(relay as never);
    renderRoute();
    expect(screen.getByTestId("risk-council-reterm-coupon")).toHaveTextContent(
      "—",
    );
    expect(
      screen.getByTestId("risk-council-reterm-amend-role"),
    ).toHaveTextContent(/On-chain actions run on Stellar only/);
    (Route as unknown as { useSearch: () => { chain: number } }).useSearch =
      () => ({ chain: STELLAR });
  });
});
