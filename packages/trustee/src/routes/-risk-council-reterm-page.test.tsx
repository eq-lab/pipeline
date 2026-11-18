// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import {
  DELAYED,
  IMMEDIATE,
  NO_ROLE,
  SCHEDULED,
  STELLAR,
  accessResult,
  loanBookResult,
  loanEntry,
  loanRegistryOp,
  loanState,
  minterOp,
  pendingExecuteResult,
  pendingOp,
  relayResult,
  SCHEDULER,
  securityResult,
} from "./-riskCouncilFixtures";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    Link: ({
      children,
      to,
      params,
      search,
      "data-testid": testId,
    }: {
      children: React.ReactNode;
      to: string;
      params?: Record<string, string>;
      search?: { chain: number };
      "data-testid"?: string;
    }) => (
      <a
        data-testid={testId}
        href={`${to.replace("$id", params?.id ?? "")}?chain=${search?.chain}`}
      >
        {children}
      </a>
    ),
  };
});

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  const { LOAN_REGISTRY } = await import("./-riskCouncilFixtures");
  return {
    ...actual,
    ENV: { ...actual.ENV, STELLAR_LOAN_REGISTRY_ID: LOAN_REGISTRY },
  };
});
const walletState = vi.hoisted(() => ({ address: null as string | null }));

const HASH = "cd".repeat(32);
vi.mock("@pipeline/wallet-connect", () => ({
  FLAG_OUTCOMES: ["Accepted", "TopUpRequired", "Escalated"],
  SECURITY_PAYMENT_TERMS: ["Lc", "Dp", "Da", "OpenAccount"],
  riskCouncilReasonHash: vi.fn(async () => "cd".repeat(32)),
  useStellarWallet: () => ({ address: walletState.address }),
  useEvmWallet: () => ({ address: undefined, isConnected: false }),
}));
vi.mock("@/api/useLoanBook", () => ({ useLoanBook: vi.fn() }));
vi.mock("@/api/useLoanSecurity", () => ({ useLoanSecurity: vi.fn() }));
vi.mock("@/api/useRiskCouncil", async () => {
  const actual = await vi.importActual<typeof import("@/api/useRiskCouncil")>(
    "@/api/useRiskCouncil",
  );
  return {
    NoLongerScheduledError: actual.NoLongerScheduledError,
    PendingArgsMismatchError: actual.PendingArgsMismatchError,
    PendingTargetMismatchError: actual.PendingTargetMismatchError,
    RegistryPausedError: actual.RegistryPausedError,
    useRiskCouncilAccess: vi.fn(),
    useRiskCouncilLoanState: vi.fn(),
    useRiskCouncilRelay: vi.fn(),
    usePendingOperationExecute: vi.fn(),
  };
});

import { useLoanBook } from "@/api/useLoanBook";
import { useLoanSecurity } from "@/api/useLoanSecurity";
import {
  usePendingOperationExecute,
  useRiskCouncilAccess,
  useRiskCouncilLoanState,
  useRiskCouncilRelay,
} from "@/api/useRiskCouncil";
import { _resetRiskCouncilOpsForTests } from "@/lib/riskCouncilOps";
import { Route } from "./risk-council.reterm.$id";

const mockLoanBook = vi.mocked(useLoanBook);
const mockSecurity = vi.mocked(useLoanSecurity);
const mockAccess = vi.mocked(useRiskCouncilAccess);
const mockLoanState = vi.mocked(useRiskCouncilLoanState);
const mockRelay = vi.mocked(useRiskCouncilRelay);
const mockPendingExecute = vi.mocked(usePendingOperationExecute);

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
let pendingExecute: ReturnType<typeof pendingExecuteResult>;

function setup(
  access: Parameters<typeof accessResult>[0],
  status = "WatchList",
  pending?: ReturnType<typeof pendingOp>[],
) {
  mockLoanBook.mockReturnValue(
    loanBookResult([loanEntry({ pending_operations: pending })]),
  );
  mockPendingExecute.mockReturnValue(pendingExecute as never);
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
  pendingExecute = pendingExecuteResult();
  walletState.address = SCHEDULER;
  _resetRiskCouncilOpsForTests();
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
      "81.3% — margin call at 85%",
    );
    expect(screen.queryByText("CCR")).not.toBeInTheDocument();
  });

  it("shows a loading marker while /security loads", () => {
    setup(DELAYED);
    mockSecurity.mockReturnValue(
      securityResult({ data: undefined, isLoading: true }),
    );
    renderRoute();
    expect(screen.getByTestId("risk-council-reterm-ltv")).toHaveTextContent(
      "Loading…",
    );
  });

  it("shows an error marker when /security fails", () => {
    setup(DELAYED);
    mockSecurity.mockReturnValue(
      securityResult({ data: undefined, error: new Error("boom") }),
    );
    renderRoute();
    expect(screen.getByTestId("risk-council-reterm-ltv")).toHaveTextContent(
      "Couldn't load",
    );
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

describe("Amend economics — scheduled operations", () => {
  const PENDING = "risk-council-reterm-pending";
  const AMEND = loanRegistryOp("amend_economics", {
    args: [4471, 145_000, "1816128000"],
    args_xdr: "AMENDXDR",
  });
  const ADJUST = loanRegistryOp("adjust_interest", {
    args: [4471, "-1000000", HASH],
    args_xdr: "ADJUSTXDR",
  });
  const WRITE_DOWN = loanRegistryOp("write_down", { args: [4471, "5000000"] });
  const SET_TERMS = pendingOp({ operation_id: "61".repeat(32) });
  const REVERSE = minterOp({ args: [4471, 2, HASH] });
  const id = (op: ReturnType<typeof pendingOp>) =>
    `${PENDING}-${op.operation_id}`;

  it("renders first in the right column, above Amend economics, with every operation of the loan", () => {
    setup(DELAYED, "WatchList", [
      AMEND,
      ADJUST,
      WRITE_DOWN,
      SET_TERMS,
      REVERSE,
    ]);
    renderRoute();
    const card = screen.getByTestId(PENDING);
    expect(
      card.compareDocumentPosition(
        screen.getByTestId("risk-council-reterm-amend"),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getAllByTestId(`${PENDING}-row`)).toHaveLength(5);
    expect(screen.getByTestId(`${id(AMEND)}-args`)).toHaveTextContent(
      "New rate14.5% (1450 bps)",
    );
    expect(screen.getByTestId(`${id(ADJUST)}-args`)).toHaveTextContent(
      "Delta-$0.10",
    );
  });

  it("gives Execute to amend_economics and adjust_interest and links the rest", () => {
    setup(DELAYED, "WatchList", [
      AMEND,
      ADJUST,
      WRITE_DOWN,
      SET_TERMS,
      REVERSE,
    ]);
    renderRoute();
    expect(screen.getByTestId(`${id(AMEND)}-button`)).toBeEnabled();
    expect(screen.getByTestId(`${id(ADJUST)}-button`)).toBeEnabled();
    const links: Array<[ReturnType<typeof pendingOp>, string, string]> = [
      [
        WRITE_DOWN,
        "Open Default resolution",
        `/risk-council/writedown/4471?chain=${STELLAR}`,
      ],
      [
        SET_TERMS,
        "Open Security",
        `/risk-council/security/4471?chain=${STELLAR}`,
      ],
      [
        REVERSE,
        "Open loan · Repayment recovery",
        `/loans/4471?chain=${STELLAR}`,
      ],
    ];
    for (const [op, label, href] of links) {
      expect(screen.queryByTestId(`${id(op)}-button`)).toBeNull();
      expect(screen.getByTestId(`${id(op)}-link`)).toHaveTextContent(label);
      expect(screen.getByTestId(`${id(op)}-link`)).toHaveAttribute(
        "href",
        href,
      );
    }
  });

  it("shows the empty state", () => {
    setup(DELAYED);
    renderRoute();
    expect(screen.getByTestId(`${PENDING}-empty`)).toHaveTextContent(
      "No scheduled operations found.",
    );
  });

  it("executes with the served args verbatim and no form input", () => {
    setup(DELAYED, "WatchList", [AMEND]);
    renderRoute();
    fireEvent.click(screen.getByTestId(`${id(AMEND)}-button`));
    expect(pendingExecute.mutateAsync).toHaveBeenCalledWith({
      chainId: STELLAR,
      operationId: AMEND.operation_id,
      caller: SCHEDULER,
      target: AMEND.target,
      expectedTarget: AMEND.target,
      paused: false,
      fn: "amend_economics",
      argsXdr: "AMENDXDR",
      calldata: null,
      targetKind: "loan_registry",
    });
  });

  it("shows the other-wallet copy for another wallet", () => {
    walletState.address = "GOTHERWALLETADDRESS1234567890XYZ";
    setup(DELAYED, "WatchList", [AMEND]);
    renderRoute();
    expect(screen.getByTestId(`${id(AMEND)}-button`)).toBeDisabled();
    expect(screen.getByTestId(`${id(AMEND)}-notice`)).toHaveTextContent(
      "Only the scheduling wallet",
    );
  });

  it("disables ready owned rows for a Closed loan and leaves link rows alone", () => {
    setup(DELAYED, "Closed", [AMEND, WRITE_DOWN]);
    renderRoute();
    expect(screen.getByTestId(`${id(AMEND)}-button`)).toBeDisabled();
    expect(screen.getByTestId(`${id(AMEND)}-notice`)).toHaveTextContent(
      "Not available for a Closed loan.",
    );
    expect(screen.queryByTestId(`${id(WRITE_DOWN)}-notice`)).toBeNull();
    expect(screen.getByTestId(`${id(WRITE_DOWN)}-link`)).toBeInTheDocument();
  });

  it("does not block while the on-chain status is unknown", () => {
    setup(DELAYED, "WatchList", [AMEND, ADJUST]);
    mockLoanState.mockReturnValue({ data: undefined } as never);
    renderRoute();
    expect(screen.getByTestId(`${id(AMEND)}-button`)).toBeEnabled();
    expect(screen.getByTestId(`${id(ADJUST)}-button`)).toBeEnabled();
    expect(screen.queryByTestId(`${id(AMEND)}-notice`)).toBeNull();
  });

  it("never executes a link row", () => {
    setup(DELAYED, "WatchList", [WRITE_DOWN, SET_TERMS, REVERSE]);
    renderRoute();
    expect(
      within(screen.getByTestId(PENDING)).queryAllByRole("button"),
    ).toHaveLength(0);
    expect(pendingExecute.mutateAsync).not.toHaveBeenCalled();
  });
});
