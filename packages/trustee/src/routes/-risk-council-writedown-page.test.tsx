// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
        href={`${to.replace("$id", params?.id ?? "")}${search ? `?chain=${search.chain}` : ""}`}
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
vi.mock("@pipeline/wallet-connect", () => ({
  FLAG_OUTCOMES: ["Accepted", "TopUpRequired", "Escalated"],
  SECURITY_PAYMENT_TERMS: ["Lc", "Dp", "Da", "OpenAccount"],
  useStellarWallet: () => ({ address: walletState.address }),
  useEvmWallet: () => ({ address: undefined, isConnected: false }),
}));

vi.mock("@/api/useLoanBook", () => ({ useLoanBook: vi.fn() }));
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
import {
  usePendingOperationExecute,
  useRiskCouncilAccess,
  useRiskCouncilLoanState,
  useRiskCouncilRelay,
} from "@/api/useRiskCouncil";
import { Route } from "./risk-council.writedown.$id";

const mockLoanBook = vi.mocked(useLoanBook);
const mockAccess = vi.mocked(useRiskCouncilAccess);
const mockLoanState = vi.mocked(useRiskCouncilLoanState);
const mockRelay = vi.mocked(useRiskCouncilRelay);
const mockPendingExecute = vi.mocked(usePendingOperationExecute);

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
let pendingExecute: ReturnType<typeof pendingExecuteResult>;

function setup({
  access = DELAYED,
  perFn = {},
  status = "Default",
  outstanding = "18400000000000",
  pending,
}: {
  access?: RiskCouncilAccess | undefined;
  perFn?: Partial<Record<string, RiskCouncilAccess>>;
  status?: string;
  outstanding?: string;
  pending?: ReturnType<typeof pendingOp>[];
} = {}) {
  mockLoanBook.mockReturnValue(
    loanBookResult([
      loanEntry({
        chain_id: chain,
        onchain_status: status,
        pending_operations: pending,
      }),
    ]),
  );
  mockPendingExecute.mockReturnValue(pendingExecute as never);
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
  pendingExecute = pendingExecuteResult();
  walletState.address = SCHEDULER;
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
      "Scheduled operations",
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
    ).toHaveAttribute("href", `/risk-council/escalate/4471?chain=${STELLAR}`);
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

describe("Default resolution — scheduled operations", () => {
  const PENDING = "risk-council-writedown-pending";
  const WRITE_DOWN = loanRegistryOp("write_down", {
    args: [4471, "5000000"],
    args_xdr: "WDXDR",
  });
  const CLOSE = loanRegistryOp("close_defaulted", {
    args: [4471, ["OtherWriteDown"]],
    args_xdr: "CLOSEXDR",
  });
  const CURE = loanRegistryOp("cure", { args: [4471] });
  const AMEND = loanRegistryOp("amend_economics", {
    args: [4471, 145_000, "1816128000"],
  });
  const SET_DEFAULT = loanRegistryOp("set_default", { args: [4471] });
  const SET_TERMS = pendingOp({ operation_id: "61".repeat(32) });
  const REVERSE = minterOp({ args: [4471, 2, "cd".repeat(32)] });
  const id = (op: ReturnType<typeof pendingOp>) =>
    `${PENDING}-${op.operation_id}`;

  it("renders first in the right column, above Write down, with every operation of the loan", () => {
    setup({
      pending: [
        WRITE_DOWN,
        CLOSE,
        CURE,
        AMEND,
        SET_DEFAULT,
        SET_TERMS,
        REVERSE,
      ],
    });
    renderRoute();
    const card = screen.getByTestId(PENDING);
    expect(
      card.compareDocumentPosition(
        screen.getByTestId("risk-council-writedown-writedown"),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getAllByTestId(`${PENDING}-row`)).toHaveLength(7);
    expect(screen.getByTestId(`${id(CLOSE)}-args`)).toHaveTextContent(
      "Closure reasonOther write-down",
    );
  });

  it("gives Execute to write_down, close_defaulted and cure and links the rest", () => {
    setup({
      outstanding: "0",
      pending: [
        WRITE_DOWN,
        CLOSE,
        CURE,
        AMEND,
        SET_DEFAULT,
        SET_TERMS,
        REVERSE,
      ],
    });
    renderRoute();
    for (const op of [WRITE_DOWN, CLOSE, CURE]) {
      expect(screen.getByTestId(`${id(op)}-button`)).toBeEnabled();
    }
    const links: Array<[ReturnType<typeof pendingOp>, string, string]> = [
      [
        AMEND,
        "Open Amend economics",
        `/risk-council/reterm/4471?chain=${STELLAR}`,
      ],
      [
        SET_DEFAULT,
        "Open Escalate to Default",
        `/risk-council/escalate/4471?chain=${STELLAR}`,
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
    setup();
    renderRoute();
    expect(screen.getByTestId(`${PENDING}-empty`)).toHaveTextContent(
      "No scheduled operations found.",
    );
  });

  it("executes with the served args verbatim", () => {
    setup({ pending: [WRITE_DOWN] });
    renderRoute();
    fireEvent.click(screen.getByTestId(`${id(WRITE_DOWN)}-button`));
    expect(pendingExecute.mutateAsync).toHaveBeenCalledWith({
      chainId: STELLAR,
      operationId: WRITE_DOWN.operation_id,
      caller: SCHEDULER,
      target: WRITE_DOWN.target,
      expectedTarget: WRITE_DOWN.target,
      paused: false,
      fn: "write_down",
      argsXdr: "WDXDR",
      calldata: null,
      targetKind: "loan_registry",
    });
  });

  it("shows the other-wallet copy for another wallet", () => {
    walletState.address = "GOTHERWALLETADDRESS1234567890XYZ";
    setup({ pending: [WRITE_DOWN] });
    renderRoute();
    expect(screen.getByTestId(`${id(WRITE_DOWN)}-button`)).toBeDisabled();
    expect(screen.getByTestId(`${id(WRITE_DOWN)}-notice`)).toHaveTextContent(
      "Only the scheduling wallet",
    );
  });

  it("disables ready owned rows of a loan that is not in Default and leaves link rows alone", () => {
    setup({ status: "WatchList", pending: [WRITE_DOWN, CURE, AMEND] });
    renderRoute();
    for (const op of [WRITE_DOWN, CURE]) {
      expect(screen.getByTestId(`${id(op)}-button`)).toBeDisabled();
      expect(screen.getByTestId(`${id(op)}-notice`)).toHaveTextContent(
        "This loan is not in Default.",
      );
    }
    expect(screen.queryByTestId(`${id(AMEND)}-notice`)).toBeNull();
  });

  it("blocks a ready close_defaulted while the outstanding principal is above zero", () => {
    setup({ pending: [WRITE_DOWN, CLOSE] });
    renderRoute();
    expect(screen.getByTestId(`${id(CLOSE)}-button`)).toBeDisabled();
    expect(screen.getByTestId(`${id(CLOSE)}-notice`)).toHaveTextContent(
      "Executable once the outstanding principal is zero.",
    );
    expect(screen.getByTestId(`${id(WRITE_DOWN)}-button`)).toBeEnabled();
  });

  it("enables a ready close_defaulted when the outstanding principal is zero", () => {
    setup({ outstanding: "0", pending: [CLOSE] });
    renderRoute();
    expect(screen.getByTestId(`${id(CLOSE)}-button`)).toBeEnabled();
    fireEvent.click(screen.getByTestId(`${id(CLOSE)}-button`));
    expect(pendingExecute.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ fn: "close_defaulted", argsXdr: "CLOSEXDR" }),
    );
  });

  it("does not gate a waiting close_defaulted row", () => {
    setup({ pending: [{ ...CLOSE, state: "waiting" }] });
    renderRoute();
    expect(screen.getByTestId(`${id(CLOSE)}-button`)).toBeDisabled();
    expect(screen.queryByTestId(`${id(CLOSE)}-notice`)).toBeNull();
  });

  it("does not block while the on-chain status and outstanding are unknown", () => {
    setup({ pending: [WRITE_DOWN, CURE, CLOSE] });
    mockLoanState.mockReturnValue({ data: undefined } as never);
    renderRoute();
    for (const op of [WRITE_DOWN, CURE, CLOSE]) {
      expect(screen.getByTestId(`${id(op)}-button`)).toBeEnabled();
      expect(screen.queryByTestId(`${id(op)}-notice`)).toBeNull();
    }
  });

  it("never executes a link row", () => {
    setup({ pending: [AMEND, SET_DEFAULT, SET_TERMS, REVERSE] });
    renderRoute();
    expect(
      within(screen.getByTestId(PENDING)).queryAllByRole("button"),
    ).toHaveLength(0);
    expect(pendingExecute.mutateAsync).not.toHaveBeenCalled();
  });
});
