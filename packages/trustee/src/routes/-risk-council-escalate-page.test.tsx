// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DELAYED,
  IMMEDIATE,
  NO_ROLE,
  OTHER_CHAIN,
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
    Link: ({
      children,
      to,
      params,
      search,
      ...rest
    }: {
      children: React.ReactNode;
      to: string;
      params?: Record<string, string>;
      search?: Record<string, unknown>;
    } & Record<string, unknown>) => {
      const href = Object.entries(params ?? {}).reduce(
        (acc, [k, v]) => acc.replace(`$${k}`, v),
        to,
      );
      const qs = search ? `?chain=${search.chain}` : "";
      return (
        <a href={`${href}${qs}`} {...rest}>
          {children}
        </a>
      );
    },
  };
});

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
import { Route } from "./risk-council.escalate.$id";

const mockLoanBook = vi.mocked(useLoanBook);
const mockSecurity = vi.mocked(useLoanSecurity);
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
  status = "WatchList",
  onchainStatus = status,
  entryChain = STELLAR,
  state,
}: {
  access?: Parameters<typeof accessResult>[0];
  status?: string;
  onchainStatus?: string;
  entryChain?: number;
  state?: ReturnType<typeof loanState> | null;
} = {}) {
  mockLoanBook.mockReturnValue(
    loanBookResult([
      loanEntry({ chain_id: entryChain, onchain_status: onchainStatus }),
    ]),
  );
  mockSecurity.mockReturnValue(securityResult());
  mockAccess.mockReturnValue(accessResult(access) as never);
  mockLoanState.mockReturnValue({
    data: state === null ? undefined : (state ?? loanState({ status })),
  } as never);
  mockRelay.mockReturnValue(relay as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  chain = STELLAR;
  relay = relayResult();
});

describe("Escalate to Default — evidence", () => {
  beforeEach(() => setup());

  it("renders the title, back link and the ledger rows from the loan book", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", {
        name: "Escalate to Default — Delta Commodities",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("‹ Risk Council").closest("a")).toHaveAttribute(
      "href",
      "/risk-council",
    );
    expect(
      screen.getByTestId("risk-council-escalate-facility"),
    ).toHaveTextContent("$2,300,000 / $1,840,000");
    expect(
      screen.getByTestId("risk-council-escalate-security-value"),
    ).toHaveTextContent("$2,106,000");
    const ltv = screen.getByTestId("risk-council-escalate-ltv");
    expect(ltv).toHaveTextContent("81.3% — margin call at 85%");
    expect(ltv.querySelector("span:last-child")).toHaveStyle({
      color: "#6e6400",
    });
    expect(
      screen.getByTestId("risk-council-escalate-ratios"),
    ).toHaveTextContent("80% / 85%");
    expect(
      screen.queryByTestId("risk-council-escalate-price-stale"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("risk-council-escalate-days-on-watchlist"),
    ).toHaveTextContent("12");
    expect(
      screen.getByTestId("risk-council-escalate-concentration"),
    ).toHaveTextContent("3.9%");
    expect(
      screen.getByTestId("risk-council-escalate-at-risk"),
    ).toHaveTextContent("2.1% of deployed");
    expect(screen.queryByText(/CCR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Collateral/)).not.toBeInTheDocument();
  });

  it("flags a stale price", () => {
    mockSecurity.mockReturnValue(
      securityResult({
        data: {
          terms: { advance_ratio_bps: 8000, margin_call_ratio_bps: 8500 },
          valuation: {
            value: "1",
            debt: "1",
            ltv_bps: 9000,
            price_stale: true,
          },
        },
      }),
    );
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-price-stale"),
    ).toBeInTheDocument();
  });

  it.each([
    ["EVM / not configured", { data: undefined, notConfigured: true }],
    ["terms: null", { data: { terms: null } }],
  ])("omits the security rows for %s", (_name, override) => {
    mockSecurity.mockReturnValue(securityResult(override));
    renderRoute();
    for (const id of ["security-value", "ltv", "ratios", "price-stale"]) {
      expect(
        screen.queryByTestId(`risk-council-escalate-${id}`),
      ).not.toBeInTheDocument();
    }
    expect(
      screen.getByTestId("risk-council-escalate-days-on-watchlist"),
    ).toBeInTheDocument();
  });

  it("shows Principal repaid and the chain-state rows from the chain", () => {
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-repaid"),
    ).toHaveTextContent("Principal repaid$10.00");
    const rows = screen.getByTestId("risk-council-escalate-chain-state");
    expect(rows).toHaveTextContent("Status (on chain)WatchList");
    expect(rows).toHaveTextContent("Outstanding principal$1,840,000.00");
    expect(rows).toHaveTextContent("Written down$0.00");
    expect(rows).toHaveTextContent("Pocket openedNo");
  });

  it("shows the declaration effects and links to Amend economics", () => {
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-effects"),
    ).toHaveTextContent(/moves out of the staking vault into a pocket/);
    expect(screen.getByText("Amend economics →").closest("a")).toHaveAttribute(
      "href",
      `/risk-council/reterm/4471?chain=${STELLAR}`,
    );
  });

  it("has no Safe, proposal, timelock or voting text anywhere", () => {
    const { container } = renderRoute();
    expect(container.textContent).not.toMatch(/safe|proposal|timelock/i);
  });
});

describe("Escalate to Default — role-driven action", () => {
  it("is read-only for a wallet without the role", () => {
    setup({ access: NO_ROLE });
    renderRoute();
    expect(screen.getByTestId("risk-council-escalate-button")).toBeDisabled();
    expect(screen.getByTestId("risk-council-escalate-role")).toHaveTextContent(
      "Declaring a default belongs to the Risk Council.",
    );
    expect(screen.getByTestId("risk-council-escalate-chip")).toHaveTextContent(
      "Risk Council only",
    );
  });

  it("schedules when delayed with nothing scheduled, after a confirm", async () => {
    setup({ access: DELAYED });
    renderRoute();
    expect(screen.getByTestId("risk-council-escalate-chip")).toHaveTextContent(
      "Risk Council · 24 h delay",
    );
    const button = screen.getByTestId("risk-council-escalate-button");
    expect(button).toHaveTextContent("Schedule default");
    expect(screen.getByTestId("risk-council-escalate-role")).toHaveTextContent(
      "The Guardian or the Admin can cancel it during the wait.",
    );
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Declare default on Loan #4471? The pocket opens on the first default.",
    );
    fireEvent.click(within(dialog).getByTestId(/confirm$/));
    expect(relay.mutateAsync).toHaveBeenCalledWith({
      mode: "schedule",
      call: { fn: "set_default", loanId: 4471 },
      chainId: STELLAR,
    });
  });

  it("offers the execute once scheduled and shows the ready time", () => {
    setup({ access: SCHEDULED });
    renderRoute();
    expect(screen.getByTestId("risk-council-escalate-role")).toHaveTextContent(
      "Scheduled. Executable from 2027-01-15 08:00 UTC.",
    );
    const button = screen.getByTestId("risk-council-escalate-button");
    expect(button).toHaveTextContent("Execute default");
    fireEvent.click(button);
    fireEvent.click(within(screen.getByRole("dialog")).getByTestId(/confirm$/));
    expect(relay.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "execute" }),
    );
  });

  it("runs a single execute on the immediate path", () => {
    setup({ access: IMMEDIATE });
    renderRoute();
    expect(screen.getByTestId("risk-council-escalate-chip")).toHaveTextContent(
      "Risk Council · executes at once",
    );
    const button = screen.getByTestId("risk-council-escalate-button");
    expect(button).toHaveTextContent("Declare default");
    fireEvent.click(button);
    fireEvent.click(within(screen.getByRole("dialog")).getByTestId(/confirm$/));
    expect(relay.mutateAsync).toHaveBeenCalledTimes(1);
    expect(relay.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "execute" }),
    );
  });

  it("cancels the confirm dialog with Escape or the backdrop without relaying", () => {
    setup({ access: IMMEDIATE });
    renderRoute();
    fireEvent.click(screen.getByTestId("risk-council-escalate-button"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("risk-council-escalate-button"));
    fireEvent.click(
      screen.getByTestId("risk-council-escalate-confirm-dialog-backdrop"),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(relay.mutateAsync).not.toHaveBeenCalled();
  });

  it("renders the stage text while pending and the hash after success", () => {
    relay = relayResult({ isPending: true, stage: "awaiting-signature" });
    setup({ access: IMMEDIATE });
    const { unmount } = renderRoute();
    expect(screen.getByTestId("risk-council-escalate-stage")).toHaveTextContent(
      "Waiting for wallet signature…",
    );
    expect(screen.getByTestId("risk-council-escalate-button")).toBeDisabled();
    unmount();
    relay = relayResult({ hash: "ABC123" });
    setup({ access: IMMEDIATE });
    renderRoute();
    expect(screen.getByTestId("risk-council-escalate-hash")).toHaveTextContent(
      "ABC123",
    );
  });

  it("maps AM #7 to its copy", async () => {
    relay = relayResult({ error: new Error("HostError: Error(Contract, #7)") });
    setup({ access: SCHEDULED });
    renderRoute();
    expect(screen.getByTestId("risk-council-escalate-error")).toHaveTextContent(
      "This operation is not ready yet.",
    );
  });
});

describe("Escalate to Default — eligibility", () => {
  it("links a Default loan to the resolution page and disables the button", () => {
    setup({ access: IMMEDIATE, status: "Default" });
    renderRoute();
    const line = screen.getByTestId("risk-council-escalate-eligibility");
    expect(line).toHaveTextContent("This loan is in Default.");
    expect(within(line).getByRole("link")).toHaveAttribute(
      "href",
      `/risk-council/writedown/4471?chain=${STELLAR}`,
    );
    expect(screen.getByTestId("risk-council-escalate-button")).toBeDisabled();
  });

  it("says a Closed loan is not available", () => {
    setup({ access: IMMEDIATE, status: "Closed" });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-eligibility"),
    ).toHaveTextContent("Not available for a Closed loan.");
    expect(screen.getByTestId("risk-council-escalate-button")).toBeDisabled();
  });
});

describe("Escalate to Default — non-Stellar loan", () => {
  it("keeps the evidence, dashes the chain state and disables the action with the reason", () => {
    chain = OTHER_CHAIN;
    setup({ access: undefined, entryChain: OTHER_CHAIN, state: null });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-facility"),
    ).toHaveTextContent("$2,300,000 / $1,840,000");
    const rows = screen.getByTestId("risk-council-escalate-chain-state");
    expect(rows).toHaveTextContent("Status (on chain)—");
    expect(screen.getByTestId("risk-council-escalate-button")).toBeDisabled();
    expect(screen.getByTestId("risk-council-escalate-role")).toHaveTextContent(
      /On-chain actions run on Stellar only/,
    );
  });
});

describe("Escalate to Default — page states", () => {
  it("renders a loading skeleton", () => {
    setup();
    mockLoanBook.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-loading"),
    ).toBeInTheDocument();
  });

  it("renders the friendly error and reveals the raw text only via details", async () => {
    const user = userEvent.setup();
    setup();
    mockLoanBook.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("network error"),
      refetch: () => {},
    });
    renderRoute();
    const alert = screen.getByTestId("risk-council-escalate-error");
    expect(alert).toHaveTextContent("Failed to load the loan.");
    expect(alert).not.toHaveTextContent("network error");
    await user.click(screen.getByTestId("inline-error-view-details"));
    expect(screen.getByTestId("error-details-raw")).toHaveTextContent(
      "network error",
    );
  });

  it("renders not-found with a back link", () => {
    setup();
    mockLoanBook.mockReturnValue(loanBookResult([]));
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-not-found"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to Risk Council" }),
    ).toHaveAttribute("href", "/risk-council");
  });
});
