// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import {
  _resetRiskCouncilOpsForTests,
  markOperationExecuted,
  recordScheduledOp,
} from "@/lib/riskCouncilOps";
import {
  DELAYED,
  EVM,
  HASH_A,
  LOAN_REGISTRY,
  NO_ROLE,
  OPERATION_ID,
  OTHER_CHAIN,
  READY_AT,
  SCHEDULER,
  STELLAR,
  accessResult,
  loanBookResult,
  loanEntry,
  loanRegistryOp,
  minterOp,
  pendingOp,
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

const walletState = vi.hoisted(() => ({ address: null as string | null }));
vi.mock("@pipeline/wallet-connect", () => ({
  FLAG_OUTCOMES: ["Accepted", "TopUpRequired", "Escalated"],
  SECURITY_PAYMENT_TERMS: ["Lc", "Dp", "Da", "OpenAccount"],
  useStellarWallet: () => ({ address: walletState.address }),
  useEvmWallet: () => ({ address: undefined, isConnected: false }),
}));
vi.mock("@/api/useLoanBook", () => ({ useLoanBook: vi.fn() }));
vi.mock("@/auth/sessionStore", () => ({ useSessionState: vi.fn() }));
vi.mock("@/api/useRiskCouncil", async () => {
  const actual = await vi.importActual<typeof import("@/api/useRiskCouncil")>(
    "@/api/useRiskCouncil",
  );
  return { ...actual, useRiskCouncilAccess: vi.fn() };
});

import { useLoanBook, type LoanBookEntry } from "@/api/useLoanBook";
import { useSessionState } from "@/auth/sessionStore";
import { useRiskCouncilAccess } from "@/api/useRiskCouncil";
import { Route } from "./risk-council.index";

const mockLoanBook = vi.mocked(useLoanBook);
const mockSession = vi.mocked(useSessionState);
const mockAccess = vi.mocked(useRiskCouncilAccess);

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

function isoAt(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

function loans(
  pending: Record<string, ReturnType<typeof pendingOp>[]> = {},
): LoanBookEntry[] {
  return [
    loanEntry({
      loan_id: "1",
      onchain_status: "WatchList",
      pending_operations: pending["1"],
    }),
    loanEntry({
      loan_id: "2",
      onchain_status: "Default",
      pending_operations: pending["2"],
    }),
    loanEntry({
      loan_id: "3",
      onchain_status: "Closed",
      pending_operations: pending["3"],
    }),
  ];
}

function setup({
  chainId = STELLAR,
  access = DELAYED,
  pending,
  address = SCHEDULER,
}: {
  chainId?: number;
  access?: Parameters<typeof accessResult>[0];
  pending?: Record<string, ReturnType<typeof pendingOp>[]>;
  address?: string | null;
} = {}) {
  walletState.address = address;
  mockSession.mockReturnValue({ chainId } as never);
  mockLoanBook.mockReturnValue(loanBookResult(loans(pending)) as never);
  mockAccess.mockReturnValue(accessResult(access) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRiskCouncilOpsForTests();
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
    ).toHaveTextContent(
      "Inspector panel changes are not tied to a loan and are not listed here",
    );
  });

  it("shows only the header and the Stellar-only reason on a non-Stellar session", () => {
    setup({ chainId: OTHER_CHAIN, pending: { "1": [pendingOp()] } });
    renderRoute();
    expect(screen.getByTestId("risk-council-blocked")).toHaveTextContent(
      /On-chain actions run on Stellar only/,
    );
    expect(screen.queryByTestId("risk-council-scheduled")).toBeNull();
    expect(screen.queryByTestId("risk-council-loans")).toBeNull();
    expect(screen.queryByTestId("risk-council-inspectors-link")).toBeNull();
  });

  it("keeps the LoanRegistry hub blocked on an EVM session but links the Inspector panel", () => {
    setup({ chainId: EVM, pending: { "1": [pendingOp()] } });
    renderRoute();
    expect(screen.getByTestId("risk-council-blocked")).toHaveTextContent(
      /On-chain actions run on Stellar only/,
    );
    expect(
      screen.getByTestId("risk-council-inspectors-link"),
    ).toHaveTextContent("Inspector panel");
    expect(screen.queryByTestId("risk-council-intro")).toBeNull();
    expect(screen.queryByTestId("risk-council-scheduled")).toBeNull();
    expect(screen.queryByTestId("risk-council-loans")).toBeNull();
  });

  it("links the Inspector panel on a Stellar session", () => {
    setup();
    renderRoute();
    expect(
      screen.getByTestId("risk-council-inspectors-link"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("risk-council-blocked")).toBeNull();
  });

  it("lists the served rows of two loans sorted by ready time with every column", () => {
    setup({
      pending: {
        "1": [
          loanRegistryOp("amend_economics", {
            args: [1, 145_000, "1816128000"],
            state: "waiting",
            ready_at: isoAt(READY_AT + 100),
          }),
        ],
        "2": [
          loanRegistryOp("write_down", {
            args: [2, "18400000000000"],
            state: "ready",
          }),
          loanRegistryOp("close_defaulted", {
            args: [2, ["Default"]],
            state: "expired",
            ready_at: isoAt(READY_AT - 1_000_000),
            expires_at: isoAt(READY_AT - 395_200),
            caller: "GOTHERSCHEDULERADDRESS1234XYZ",
          }),
        ],
      },
    });
    renderRoute();
    const headers = within(screen.getByTestId("risk-council-scheduled"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual([
      "Loan",
      "Action",
      "Arguments",
      "Scheduled by",
      "Executable from",
      "State",
      "",
    ]);
    const rows = screen.getAllByTestId("risk-council-scheduled-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Delta Commodities — Coffee (#2)");
    expect(rows[0]).toHaveTextContent("Close defaulted loan");
    expect(rows[0]).toHaveTextContent("Default");
    expect(rows[0]).toHaveTextContent("GOTHER…4XYZ");
    expect(rows[0]).toHaveTextContent("Expired");
    expect(rows[1]).toHaveTextContent("Write down");
    expect(rows[1]).toHaveTextContent("$1,840,000.00");
    expect(rows[1]).toHaveTextContent("GSCHED…ABCD · this wallet");
    expect(rows[1]).toHaveTextContent("2027-01-15 08:00 UTC");
    expect(rows[1]).toHaveTextContent("Ready");
    expect(rows[2]).toHaveTextContent("Delta Commodities — Coffee (#1)");
    expect(rows[2]).toHaveTextContent("Amend economics");
    expect(rows[2]).toHaveTextContent("New maturity: 21 Jul 2027");
    expect(rows[2]).toHaveTextContent("Waiting");
    expect(
      screen.queryByTestId("risk-council-scheduled-empty"),
    ).not.toBeInTheDocument();
  });

  it("shows the raw JSON for arguments that do not decode", () => {
    setup({
      pending: { "1": [loanRegistryOp("write_down", { args: [1, 5] })] },
    });
    renderRoute();
    const [row] = screen.getAllByTestId("risk-council-scheduled-row");
    expect(row).toHaveTextContent("[1,5]");
    expect(row).toHaveTextContent("Write down");
  });

  it("links each row to the page that executes it", () => {
    const at = (offset: number) => isoAt(READY_AT + offset);
    setup({
      pending: {
        "1": [
          loanRegistryOp("amend_economics", {
            args: [1, 145_000, "1816128000"],
            ready_at: at(1),
          }),
          loanRegistryOp("adjust_interest", {
            args: [1, "5", HASH_A],
            ready_at: at(2),
          }),
          loanRegistryOp("set_default", { args: [1], ready_at: at(3) }),
          pendingOp({
            operation_id: "61".repeat(32),
            function: "release_with_consent",
            args: [3, HASH_A],
            ready_at: at(4),
          }),
          pendingOp({
            operation_id: "62".repeat(32),
            function: "resolve_flag",
            args: [3, ["Accepted"], HASH_A],
            ready_at: at(5),
          }),
          pendingOp({
            operation_id: "63".repeat(32),
            function: "set_terms",
            args: [9, "bad"],
            ready_at: at(6),
          }),
          minterOp({ args: [1, 2, HASH_A], ready_at: at(7) }),
        ],
        "2": [
          loanRegistryOp("write_down", { args: [2, "5"], ready_at: at(8) }),
          loanRegistryOp("cure", { args: [2], ready_at: at(9) }),
          loanRegistryOp("close_defaulted", {
            args: [2, ["Default"]],
            ready_at: at(10),
          }),
        ],
      },
    });
    renderRoute();
    const hrefs = screen
      .getAllByTestId("risk-council-scheduled-row")
      .map((row) => within(row).getByRole("link", { name: "Open" }))
      .map((link) => link.getAttribute("href"));
    const c = `?chain=${STELLAR}`;
    expect(hrefs).toEqual([
      `/risk-council/reterm/1${c}`,
      `/risk-council/reterm/1${c}`,
      `/risk-council/escalate/1${c}`,
      `/risk-council/security/1${c}`,
      `/risk-council/security/1${c}`,
      `/risk-council/security/1${c}`,
      `/loans/1${c}`,
      `/risk-council/writedown/2${c}`,
      `/risk-council/writedown/2${c}`,
      `/risk-council/writedown/2${c}`,
    ]);
  });

  it("labels a Minter reverse_repay row", () => {
    setup({ pending: { "1": [minterOp({ args: [1, 4, HASH_A] })] } });
    renderRoute();
    const [row] = screen.getAllByTestId("risk-council-scheduled-row");
    expect(row).toHaveTextContent("Reverse repayment");
    expect(row).toHaveTextContent("repayment #4");
  });

  it("lets a wallet without the role see the rows and shows the new role line", () => {
    setup({
      access: NO_ROLE,
      address: "GTRUSTEEONLYADDRESS1234567890XY",
      pending: { "1": [loanRegistryOp("cure", { args: [1] })] },
    });
    renderRoute();
    expect(screen.getByTestId("risk-council-role")).toHaveTextContent(
      "Risk Council actions belong to the Risk Council.",
    );
    expect(screen.getByTestId("risk-council-role")).not.toHaveTextContent(
      "visible to the scheduling wallet only",
    );
    expect(screen.queryByTestId("risk-council-scheduled-no-role")).toBeNull();
    const rows = screen.getAllByTestId("risk-council-scheduled-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveTextContent("this wallet");
  });

  it("renders the rows without a connected wallet", () => {
    setup({
      address: null,
      pending: { "2": [loanRegistryOp("cure", { args: [2] })] },
    });
    renderRoute();
    const [row] = screen.getAllByTestId("risk-council-scheduled-row");
    expect(row).toHaveTextContent("GSCHED…ABCD");
    expect(row).not.toHaveTextContent("this wallet");
  });

  it("treats a missing pending_operations as the empty state", () => {
    setup();
    renderRoute();
    expect(screen.getByTestId("risk-council-scheduled-empty")).toBeVisible();
    expect(screen.queryAllByTestId("risk-council-scheduled-row")).toHaveLength(
      0,
    );
  });

  describe("session bridge", () => {
    const SESSION_ID = "71".repeat(32);

    function scheduleHere(loanId: number) {
      act(() => {
        recordScheduledOp({
          chainId: STELLAR,
          call: { fn: "write_down", loanId, amount: "5000000" },
          operationId: SESSION_ID,
          readyAt: READY_AT,
          caller: SCHEDULER,
          target: LOAN_REGISTRY,
          argsXdr: "AAAA",
        });
      });
    }

    it("lists an operation scheduled here until the API serves its id", () => {
      setup();
      scheduleHere(2);
      const view = renderRoute();
      const [row] = screen.getAllByTestId("risk-council-scheduled-row");
      expect(row).toHaveTextContent("Write down");
      expect(row).toHaveTextContent("(#2)");
      expect(row).toHaveTextContent("$0.50");
      expect(row).toHaveTextContent("GSCHED…ABCD · this wallet");
      view.unmount();

      setup({
        pending: {
          "2": [
            loanRegistryOp("write_down", {
              operation_id: SESSION_ID,
              args: [2, "5000000"],
            }),
          ],
        },
      });
      renderRoute();
      expect(screen.getAllByTestId("risk-council-scheduled-row")).toHaveLength(
        1,
      );
    });

    it("hides an operation executed here", () => {
      setup({
        pending: {
          "2": [
            loanRegistryOp("write_down", {
              operation_id: SESSION_ID,
              args: [2, "5000000"],
            }),
          ],
        },
      });
      scheduleHere(2);
      act(() => {
        markOperationExecuted(STELLAR, SESSION_ID, "HASH", READY_AT);
      });
      renderRoute();
      expect(
        screen.queryAllByTestId("risk-council-scheduled-row"),
      ).toHaveLength(0);
      expect(screen.getByTestId("risk-council-scheduled-empty")).toBeVisible();
    });

    it("does not list inspector panel operations or loans outside the book", () => {
      setup();
      act(() => {
        recordScheduledOp({
          chainId: STELLAR,
          call: { fn: "set_inspectors", inspectors: ["GA", "GB"] },
          operationId: OPERATION_ID,
          readyAt: READY_AT,
          caller: SCHEDULER,
          target: "CSEC",
          argsXdr: "AAAA",
        });
      });
      scheduleHere(99);
      renderRoute();
      expect(
        screen.queryAllByTestId("risk-council-scheduled-row"),
      ).toHaveLength(0);
    });
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
    expect(
      within(rows[0]!).getByRole("link", { name: "Security" }),
    ).toHaveAttribute("href", `/risk-council/security/1?chain=${STELLAR}`);
    expect(
      within(rows[1]!).getByRole("link", { name: "Security" }),
    ).toHaveAttribute("href", `/risk-council/security/2?chain=${STELLAR}`);
  });

  it("links to the inspector panel from the header", () => {
    setup();
    renderRoute();
    expect(
      screen.getByRole("link", { name: "Inspector panel" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/risk-council/inspectors"),
    );
  });
});
