// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
} from "./-riskCouncilFixtures";
import type { RiskCouncilAccess } from "@/api/useRiskCouncil";
import {
  _resetRiskCouncilOpsForTests,
  recordScheduledOp,
} from "@/lib/riskCouncilOps";

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
    }: {
      children: React.ReactNode;
      to: string;
      params?: Record<string, string>;
    }) => <a href={to.replace("$id", params?.id ?? "")}>{children}</a>,
  };
});

vi.mock("@/api/useLoanBook", () => ({ useLoanBook: vi.fn() }));
vi.mock("@/api/useRiskCouncil", () => ({
  useRiskCouncilAccess: vi.fn(),
  useRiskCouncilLoanState: vi.fn(),
  useRiskCouncilRelay: vi.fn(),
}));

import { useLoanBook } from "@/api/useLoanBook";
import {
  useRiskCouncilAccess,
  useRiskCouncilLoanState,
  useRiskCouncilRelay,
} from "@/api/useRiskCouncil";
import { Route } from "./risk-council.writedown.$id";

const mockLoanBook = vi.mocked(useLoanBook);
const mockAccess = vi.mocked(useRiskCouncilAccess);
const mockLoanState = vi.mocked(useRiskCouncilLoanState);
const mockRelay = vi.mocked(useRiskCouncilRelay);

let chain = STELLAR;
(Route as unknown as { useParams: () => { id: string } }).useParams = () => ({
  id: "4471",
});
(Route as unknown as { useSearch: () => { chain: number } }).useSearch =
  () => ({ chain });

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

let relay: ReturnType<typeof relayResult>;

function setup({
  access = DELAYED,
  perFn = {},
  status = "Default",
  outstanding = "18400000000000",
}: {
  access?: RiskCouncilAccess | undefined;
  perFn?: Partial<Record<string, RiskCouncilAccess>>;
  status?: string;
  outstanding?: string;
} = {}) {
  mockLoanBook.mockReturnValue(
    loanBookResult([loanEntry({ chain_id: chain, onchain_status: status })]),
  );
  mockAccess.mockImplementation(((_c: number, _call: unknown, fn: string) =>
    accessResult(perFn[fn] ?? access)) as never);
  mockLoanState.mockReturnValue({
    data: chain === STELLAR ? loanState({ status, outstanding }) : undefined,
  } as never);
  mockRelay.mockReturnValue(relay as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  chain = STELLAR;
  relay = relayResult();
  _resetRiskCouncilOpsForTests();
});

describe("Default resolution — layout", () => {
  it("renders the title, the chain state and three action cards with role lines", () => {
    setup();
    renderRoute();
    expect(
      screen.getByRole("heading", {
        name: "Default resolution — Delta Commodities — Coffee",
      }),
    ).toBeInTheDocument();
    const rows = screen.getByTestId("risk-council-writedown-chain-state");
    expect(rows).toHaveTextContent("Status (on chain)Default");
    expect(rows).toHaveTextContent("Outstanding principal$1,840,000.00");
    expect(rows).toHaveTextContent("Closure reasonNone");
    for (const prefix of ["writedown", "close", "cure"]) {
      expect(
        screen.getByTestId(`risk-council-writedown-${prefix}-role`),
      ).toHaveTextContent(/24 h delay/);
    }
    const cards = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(cards).toEqual([
      "Chain state",
      "Write down",
      "Close defaulted loan",
      "Cure",
    ]);
  });

  it("has no signer rows, code block, Safe or proposal text", () => {
    setup();
    const { container } = renderRoute();
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).not.toMatch(/safe|proposal|signer|queued/i);
    expect(
      screen.getByTestId("risk-council-writedown-close"),
    ).toHaveTextContent("Other write-down — Risk Council only · 24 hours");
  });
});

describe("Default resolution — write down", () => {
  it("prefills the amount from the chain outstanding and schedules it", () => {
    setup();
    renderRoute();
    const input = screen.getByTestId("risk-council-writedown-amount");
    expect(input).toHaveValue("$1,840,000.00");
    const button = screen.getByTestId(
      "risk-council-writedown-writedown-button",
    );
    expect(button).toHaveTextContent("Schedule write-down");
    fireEvent.click(button);
    expect(relay.mutateAsync).toHaveBeenCalledWith({
      mode: "schedule",
      call: { fn: "write_down", loanId: 4471, amount: "18400000000000" },
      chainId: STELLAR,
    });
  });

  it("sends an edited amount and executes once scheduled", () => {
    setup({ perFn: { write_down: SCHEDULED } });
    renderRoute();
    fireEvent.change(screen.getByTestId("risk-council-writedown-amount"), {
      target: { value: "500" },
    });
    const button = screen.getByTestId(
      "risk-council-writedown-writedown-button",
    );
    expect(button).toHaveTextContent("Execute write-down");
    fireEvent.click(button);
    expect(relay.mutateAsync).toHaveBeenCalledWith({
      mode: "execute",
      call: { fn: "write_down", loanId: 4471, amount: "5000000000" },
      chainId: STELLAR,
    });
  });
});

describe("Default resolution — close", () => {
  it("sends Default by default and OtherWriteDown when selected", () => {
    setup();
    renderRoute();
    expect(
      screen.getByTestId("risk-council-writedown-reason-Default"),
    ).toBeChecked();
    fireEvent.click(
      screen.getByTestId("risk-council-writedown-reason-OtherWriteDown"),
    );
    fireEvent.click(screen.getByTestId("risk-council-writedown-close-button"));
    expect(relay.mutateAsync).toHaveBeenCalledWith({
      mode: "schedule",
      call: { fn: "close_defaulted", loanId: 4471, reason: "OtherWriteDown" },
      chainId: STELLAR,
    });
  });

  it("allows scheduling while the outstanding principal is above zero", () => {
    setup({ outstanding: "1" });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-writedown-close-button"),
    ).toBeEnabled();
  });

  it("blocks the execute with the copy until the outstanding principal is zero", () => {
    setup({ perFn: { close_defaulted: SCHEDULED }, outstanding: "1" });
    const { unmount } = renderRoute();
    expect(
      screen.getByTestId("risk-council-writedown-close-button"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("risk-council-writedown-close-notice"),
    ).toHaveTextContent("Executable once the outstanding principal is zero.");
    unmount();
    setup({ perFn: { close_defaulted: SCHEDULED }, outstanding: "0" });
    renderRoute();
    const button = screen.getByTestId("risk-council-writedown-close-button");
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent("Execute close");
    expect(
      screen.queryByTestId("risk-council-writedown-close-notice"),
    ).not.toBeInTheDocument();
  });

  it("gates the immediate execute as well", () => {
    setup({ perFn: { close_defaulted: IMMEDIATE }, outstanding: "5" });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-writedown-close-button"),
    ).toBeDisabled();
  });
});

describe("Default resolution — cure", () => {
  it("shows the effects and schedules the cure", () => {
    setup();
    renderRoute();
    expect(
      screen.getByTestId("risk-council-writedown-cure-effects"),
    ).toHaveTextContent("The loan returns to WatchList. The pocket stays open");
    fireEvent.click(screen.getByTestId("risk-council-writedown-cure-button"));
    expect(relay.mutateAsync).toHaveBeenCalledWith({
      mode: "schedule",
      call: { fn: "cure", loanId: 4471 },
      chainId: STELLAR,
    });
  });
});

describe("Default resolution — roles and states", () => {
  it("is read-only for a wallet without the role", () => {
    setup({ access: NO_ROLE });
    renderRoute();
    for (const prefix of ["writedown", "close", "cure"]) {
      expect(
        screen.getByTestId(`risk-council-writedown-${prefix}-button`),
      ).toBeDisabled();
      expect(
        screen.getByTestId(`risk-council-writedown-${prefix}-role`),
      ).toHaveTextContent(
        "Writing down, closing a defaulted loan and curing belong to the Risk Council.",
      );
    }
  });

  it("points a non-Default loan back to escalate and disables the actions", () => {
    setup({ status: "WatchList" });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-writedown-not-default"),
    ).toHaveTextContent("This loan is not in Default.");
    expect(
      screen.getByRole("link", { name: /Back to Escalate to Default/ }),
    ).toHaveAttribute("href", "/risk-council/escalate/4471");
    expect(
      screen.getByTestId("risk-council-writedown-cure-button"),
    ).toBeDisabled();
  });

  it("says the schedule is gone when a page-local op reads zero and was not executed here", () => {
    setup();
    recordScheduledOp({
      chainId: STELLAR,
      call: { fn: "cure", loanId: 4471 },
    });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    mockAccess.mockImplementation(((
      _c: number,
      _call: unknown,
      fn: string,
    ) => ({
      ...accessResult(DELAYED),
      dataUpdatedAt: fn === "cure" ? Date.now() : 0,
    })) as never);
    renderRoute();
    vi.useRealTimers();
    expect(
      screen.getByTestId("risk-council-writedown-cure-no-longer"),
    ).toHaveTextContent(
      "No longer scheduled — cancelled by the Guardian or the Admin, or executed from another session.",
    );
    expect(
      screen.queryByTestId("risk-council-writedown-close-no-longer"),
    ).not.toBeInTheDocument();
  });

  it("stays read-only on another chain with the Stellar-only reason", () => {
    chain = 1;
    setup({ access: undefined });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-writedown-cure-button"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("risk-council-writedown-cure-role"),
    ).toHaveTextContent(/On-chain actions run on Stellar only/);
    expect(
      screen.getByTestId("risk-council-writedown-chain-state"),
    ).toHaveTextContent("Status (on chain)—");
  });
});
