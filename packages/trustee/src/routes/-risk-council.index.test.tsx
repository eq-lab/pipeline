// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  DELAYED,
  NO_ROLE,
  OTHER_CHAIN,
  READY_AT,
  STELLAR,
  accessResult,
  loanBookResult,
  loanEntry,
} from "./-riskCouncilFixtures";
import type { HubLookup } from "@/api/useRiskCouncil";

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
    }: {
      children: React.ReactNode;
      to: string;
      params?: Record<string, string>;
      search?: { chain: number };
    }) => (
      <a href={`${to.replace("$id", params?.id ?? "")}?chain=${search?.chain}`}>
        {children}
      </a>
    ),
  };
});

vi.mock("@/api/useLoanBook", () => ({ useLoanBook: vi.fn() }));
vi.mock("@/auth/sessionStore", () => ({ useSessionState: vi.fn() }));
vi.mock("@/api/useRiskCouncil", () => ({
  useRiskCouncilAccess: vi.fn(),
  useRiskCouncilHubLookups: vi.fn(),
}));

import { useLoanBook } from "@/api/useLoanBook";
import { useSessionState } from "@/auth/sessionStore";
import {
  useRiskCouncilAccess,
  useRiskCouncilHubLookups,
} from "@/api/useRiskCouncil";
import { Route } from "./risk-council.index";

const mockLoanBook = vi.mocked(useLoanBook);
const mockSession = vi.mocked(useSessionState);
const mockAccess = vi.mocked(useRiskCouncilAccess);
const mockLookups = vi.mocked(useRiskCouncilHubLookups);

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

function setup({
  chainId = STELLAR,
  access = DELAYED,
  lookups = [],
}: {
  chainId?: number;
  access?: Parameters<typeof accessResult>[0];
  lookups?: Array<HubLookup | null>;
} = {}) {
  mockSession.mockReturnValue({ chainId } as never);
  mockLoanBook.mockReturnValue(
    loanBookResult([
      loanEntry({ loan_id: "1", onchain_status: "WatchList" }),
      loanEntry({ loan_id: "2", onchain_status: "Default" }),
      loanEntry({ loan_id: "3", onchain_status: "Closed" }),
    ]),
  );
  mockAccess.mockReturnValue(accessResult(access) as never);
  mockLookups.mockReturnValue({ lookups, isLoading: false } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Risk Council hub", () => {
  it("shows the heading, the docs sentence and the empty state with the footnote", () => {
    setup();
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Risk Council" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("risk-council-intro")).toHaveTextContent(
      "Declaring a default executes at once; every other Risk Council action waits 24 hours",
    );
    expect(
      screen.getByTestId("risk-council-scheduled-empty"),
    ).toHaveTextContent("No scheduled operations found.");
    expect(
      screen.getByTestId("risk-council-scheduled-footnote"),
    ).toHaveTextContent("Other scheduled operations need an indexer");
  });

  it("shows only the header and the Stellar-only reason on a non-Stellar session", () => {
    setup({ chainId: OTHER_CHAIN });
    renderRoute();
    expect(screen.getByTestId("risk-council-blocked")).toHaveTextContent(
      /On-chain actions run on Stellar only/,
    );
    expect(screen.queryByTestId("risk-council-scheduled")).toBeNull();
    expect(screen.queryByTestId("risk-council-loans")).toBeNull();
    expect(mockLookups).toHaveBeenCalledWith(
      OTHER_CHAIN,
      [],
      expect.anything(),
      expect.anything(),
    );
  });

  it("lists pending and page-local operations and the lookup input loans", () => {
    setup({
      lookups: [
        {
          call: { fn: "set_default", loanId: 1 },
          readyAt: READY_AT,
          pageLocal: undefined,
        },
        {
          call: { fn: "write_down", loanId: 2, amount: "18400000000000" },
          readyAt: READY_AT,
          pageLocal: {
            chainId: STELLAR,
            call: { fn: "write_down", loanId: 2, amount: "18400000000000" },
            scheduledAt: 1,
            executedHere: false,
          },
        },
        {
          call: { fn: "cure", loanId: 2 },
          readyAt: 0,
          pageLocal: {
            chainId: STELLAR,
            call: { fn: "cure", loanId: 2 },
            scheduledAt: 1,
            executedHere: false,
          },
        },
        {
          call: { fn: "cure", loanId: 3 },
          readyAt: 0,
          pageLocal: undefined,
        },
        null,
      ],
    });
    renderRoute();
    const rows = screen.getAllByTestId("risk-council-scheduled-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Declare default");
    expect(rows[0]).toHaveTextContent("2027-01-15 08:00 UTC");
    expect(rows[0]).toHaveTextContent("Scheduled");
    expect(rows[1]).toHaveTextContent("$1,840,000.00");
    expect(rows[2]).toHaveTextContent("No longer scheduled — cancelled");
    expect(rows[2]).toHaveTextContent("—");
    expect(
      screen.queryByTestId("risk-council-scheduled-empty"),
    ).not.toBeInTheDocument();
    expect(mockLookups.mock.calls[0]![1]).toHaveLength(3);
  });

  it("skips lookups and shows dashes for a wallet without the role", () => {
    setup({ access: NO_ROLE });
    renderRoute();
    expect(screen.getByTestId("risk-council-role")).toHaveTextContent(
      "Pending operations are visible to the scheduling wallet only.",
    );
    expect(
      screen.getByTestId("risk-council-scheduled-no-role"),
    ).toHaveTextContent("—");
    expect(mockLookups.mock.calls[0]![3]).toBe(false);
  });

  it("indexes the loans with links that carry the chain", () => {
    setup();
    renderRoute();
    const rows = screen.getAllByTestId("risk-council-loan-row");
    expect(rows).toHaveLength(3);
    expect(
      within(rows[0]!).getByRole("link", { name: "Declare default" }),
    ).toHaveAttribute("href", `/risk-council/escalate/1?chain=${STELLAR}`);
    expect(
      within(rows[0]!).getByRole("link", { name: "Amend economics" }),
    ).toHaveAttribute("href", `/risk-council/reterm/1?chain=${STELLAR}`);
    expect(
      within(rows[1]!).getByRole("link", { name: "Resolve default" }),
    ).toHaveAttribute("href", `/risk-council/writedown/2?chain=${STELLAR}`);
    expect(within(rows[2]!).queryAllByRole("link")).toHaveLength(0);
    expect(rows[2]).toHaveTextContent("—");
  });
});
