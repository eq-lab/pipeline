// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import {
  _resetRiskCouncilOpsForTests,
  recordScheduledOp,
} from "@/lib/riskCouncilOps";
import {
  DELAYED,
  HASH_A,
  HASH_B,
  IMMEDIATE,
  NO_ROLE,
  READY_AT,
  SCHEDULED,
  SCHEDULER,
  STELLAR,
  accessResult,
  loanBookResult,
  loanEntry,
  loanState,
  pendingOp,
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

const walletState = vi.hoisted(() => ({ address: null as string | null }));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  const { SECURITY_REGISTRY } = await import("./-riskCouncilFixtures");
  return {
    ...actual,
    ENV: { ...actual.ENV, STELLAR_SECURITY_REGISTRY_ID: SECURITY_REGISTRY },
  };
});

const HASH = "cd".repeat(32);
vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: () => ({ address: walletState.address }),
  FLAG_OUTCOMES: ["Accepted", "TopUpRequired", "Escalated"],
  SECURITY_PAYMENT_TERMS: ["Lc", "Dp", "Da", "OpenAccount"],
  securityReasonHash: vi.fn(async () => "cd".repeat(32)),
  riskCouncilReasonHash: vi.fn(async () => "cd".repeat(32)),
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
    useRiskCouncilAccess: vi.fn(),
    useRiskCouncilLoanState: vi.fn(),
    useRiskCouncilRelay: vi.fn(),
    usePendingOperationExecute: vi.fn(),
  };
});

import { useLoanBook } from "@/api/useLoanBook";
import { useLoanSecurity } from "@/api/useLoanSecurity";
import {
  NoLongerScheduledError,
  usePendingOperationExecute,
  useRiskCouncilAccess,
  useRiskCouncilLoanState,
  useRiskCouncilRelay,
} from "@/api/useRiskCouncil";
import { Route } from "./risk-council.security.$id";

const mockLoanBook = vi.mocked(useLoanBook);
const mockSecurity = vi.mocked(useLoanSecurity);
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

const TERMS = {
  advance_ratio_bps: 7000,
  margin_call_ratio_bps: 8250,
  cure_period: "604800",
  price_stale_after: "86400",
  payment_term: "Da",
  grace_period: "259200",
  default_rate: 20000,
  attestation_interval: "2592000",
  inspection_interval: "0",
  tolerance_bps: 50,
  grade_tolerance_bps: 25,
};

const RECORDS = [
  {
    record_id: "1",
    lot_id: "5",
    protection: "WarehousePledge",
    commodity: "Coffee",
    status: "Active",
    open: true,
    flagged_by: null,
    inspections: [],
  },
  {
    record_id: "2",
    lot_id: "5",
    protection: "WarehousePledge",
    commodity: "Coffee",
    status: "Active",
    open: true,
    flagged_by: "8",
    inspections: [
      {
        inspection_id: "8",
        inspector: "GINSPECTOR",
        kind: "StockCount",
        quantity: "90.0000000",
        variance_reference_bps: -1000,
        flagged: true,
        resolution: null,
      },
    ],
  },
];

let relay: ReturnType<typeof relayResult>;
let pendingExecute: ReturnType<typeof pendingExecuteResult>;

function pendingExecuteResult(error: Error | null = null) {
  return {
    mutateAsync: vi.fn().mockResolvedValue({ hash: "EH" }),
    isPending: false,
    error,
    hash: null,
    stage: null,
    reset: vi.fn(),
  };
}

function setup(
  access: Parameters<typeof accessResult>[0],
  served: Record<string, unknown> | undefined = {
    terms: TERMS,
    records: RECORDS,
    paused: false,
  },
  entryChain = STELLAR,
) {
  mockLoanBook.mockReturnValue(
    loanBookResult([loanEntry({ chain_id: entryChain })]),
  );
  mockSecurity.mockReturnValue(securityResult({ data: served as never }));
  mockAccess.mockReturnValue(accessResult(access) as never);
  mockLoanState.mockReturnValue({ data: loanState() } as never);
  mockRelay.mockReturnValue(relay as never);
  mockPendingExecute.mockReturnValue(pendingExecute as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  chain = STELLAR;
  relay = relayResult();
  pendingExecute = pendingExecuteResult();
  walletState.address = SCHEDULER;
  _resetRiskCouncilOpsForTests();
});

describe("Security page — current terms", () => {
  it("shows the served terms with units", () => {
    setup(DELAYED);
    renderRoute();
    const terms = screen.getByTestId("risk-council-security-terms");
    expect(terms).toHaveTextContent("Advance ratio70%");
    expect(terms).toHaveTextContent("Margin call ratio82.5%");
    expect(terms).toHaveTextContent("Cure period7 d");
    expect(terms).toHaveTextContent("Payment termDa");
    expect(screen.getByTestId("risk-council-security-loan")).toHaveTextContent(
      "Delta Commodities — Coffee",
    );
  });

  it("says so when no terms are set and notes a pending refresh", () => {
    setup(DELAYED, { terms: null, records: [], refresh_pending: true });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-security-no-terms"),
    ).toHaveTextContent("No security terms are set for this loan.");
    expect(
      screen.getByTestId("risk-council-security-refresh"),
    ).toBeInTheDocument();
  });

  it("shows an error state, not a blank Set terms form, when /security fails", () => {
    setup(DELAYED, undefined);
    mockSecurity.mockReturnValue(
      securityResult({ data: undefined, error: new Error("boom") }),
    );
    renderRoute();
    expect(
      screen.getByTestId("risk-council-security-load-error"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("risk-council-security-no-terms"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("risk-council-security-set-terms"),
    ).not.toBeInTheDocument();
  });

  it("blocks executing and says why while the registry is paused", () => {
    setup(IMMEDIATE, { terms: TERMS, records: RECORDS, paused: true });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-security-paused"),
    ).toHaveTextContent("paused");
    expect(
      screen.getByTestId("risk-council-security-terms-button"),
    ).toBeDisabled();
  });
});

describe("Security page — set terms", () => {
  it("prefills from served terms, so the unchanged form schedules the same call", () => {
    setup(DELAYED);
    renderRoute();
    expect(
      screen.getByTestId("risk-council-security-terms-advanceRatio"),
    ).toHaveValue("70");
    expect(
      screen.getByTestId("risk-council-security-terms-curePeriod-echo"),
    ).toHaveTextContent("= 604800 s");
    expect(
      screen.getByTestId("risk-council-security-terms-defaultRate-echo"),
    ).toHaveTextContent("= 20000 (1e6 scale)");
    const button = screen.getByTestId("risk-council-security-terms-button");
    expect(button).toHaveTextContent("Schedule terms");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(relay.mutateAsync).toHaveBeenCalledWith({
      mode: "schedule",
      call: expect.objectContaining({
        fn: "set_terms",
        loanId: 4471,
        terms: expect.objectContaining({
          advanceRatioBps: 7000,
          marginCallRatioBps: 8250,
          curePeriod: "604800",
          priceStaleAfter: "86400",
          paymentTerm: "Da",
        }),
      }),
      chainId: STELLAR,
      loanId: 4471,
    });
  });

  it("starts empty and disabled when no terms exist, then enables once filled", () => {
    setup(DELAYED, { terms: null, records: [] });
    renderRoute();
    const button = screen.getByTestId("risk-council-security-terms-button");
    expect(button).toBeDisabled();
    const values: Record<string, string> = {
      advanceRatio: "70",
      marginCallRatio: "80",
      curePeriod: "7",
      priceStaleAfter: "24",
      gracePeriod: "3",
      defaultRate: "2",
      attestationInterval: "30",
      inspectionInterval: "30",
      tolerance: "0.5",
      gradeTolerance: "0.25",
    };
    for (const [key, value] of Object.entries(values)) {
      fireEvent.change(
        screen.getByTestId(`risk-council-security-terms-${key}`),
        { target: { value } },
      );
    }
    expect(button).toBeDisabled();
    fireEvent.change(
      screen.getByTestId("risk-council-security-terms-paymentTerm"),
      { target: { value: "Lc" } },
    );
    expect(button).toBeEnabled();
  });

  it("flags a margin call ratio below the advance ratio", () => {
    setup(DELAYED);
    renderRoute();
    fireEvent.change(
      screen.getByTestId("risk-council-security-terms-marginCallRatio"),
      { target: { value: "60" } },
    );
    expect(
      screen.getByTestId("risk-council-security-terms-ratio-error"),
    ).toHaveTextContent("at least the advance ratio");
    expect(
      screen.getByTestId("risk-council-security-terms-button"),
    ).toBeDisabled();
  });

  it("flags an invalid unit input", () => {
    setup(DELAYED);
    renderRoute();
    fireEvent.change(
      screen.getByTestId("risk-council-security-terms-curePeriod"),
      { target: { value: "abc" } },
    );
    expect(
      screen.getByTestId("risk-council-security-terms-curePeriod-error"),
    ).toBeInTheDocument();
  });

  it("offers the execute for an existing schedule and executes at once on the immediate path", () => {
    setup(SCHEDULED);
    renderRoute();
    expect(
      screen.getByTestId("risk-council-security-terms-role"),
    ).toHaveTextContent("Scheduled. Executable from 2027-01-15 08:00 UTC.");
    expect(
      screen.getByTestId("risk-council-security-terms-button"),
    ).toHaveTextContent("Execute terms");
    setup(IMMEDIATE);
    renderRoute();
    fireEvent.click(
      screen.getAllByTestId("risk-council-security-terms-button")[1]!,
    );
    expect(relay.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "execute" }),
    );
  });
});

describe("Security page — flagged records", () => {
  it("lists only flagged records with the flagging inspection", () => {
    setup(DELAYED);
    renderRoute();
    const rows = screen.getAllByTestId("risk-council-security-flag-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Record #2");
    expect(
      screen.getByTestId("risk-council-security-flag-2-details"),
    ).toHaveTextContent("90.0000000");
    expect(
      screen.getByTestId("risk-council-security-flag-2-details"),
    ).toHaveTextContent("-1000 bps");
    expect(rows[0]).toHaveTextContent(
      "Opens a margin call if LTV is above the advance ratio",
    );
  });

  it("shows the empty state", () => {
    setup(DELAYED, { terms: TERMS, records: [RECORDS[0]] });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-security-flagged-empty"),
    ).toHaveTextContent("No flagged records.");
  });

  it("hashes the reason and schedules the resolution with the loan context", async () => {
    setup(DELAYED);
    renderRoute();
    const button = screen.getByTestId("risk-council-security-flag-2-button");
    expect(button).toHaveTextContent("Schedule resolution");
    expect(button).toBeDisabled();
    fireEvent.click(
      screen.getByTestId("risk-council-security-flag-2-outcome-TopUpRequired"),
    );
    fireEvent.change(
      screen.getByTestId("risk-council-security-flag-2-reason"),
      {
        target: { value: " Top up agreed " },
      },
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("risk-council-security-flag-2-reason-hash"),
      ).toHaveValue(HASH),
    );
    fireEvent.click(button);
    expect(relay.mutateAsync).toHaveBeenCalledWith({
      mode: "schedule",
      call: {
        fn: "resolve_flag",
        recordId: 2,
        outcome: "TopUpRequired",
        reasonHash: HASH,
      },
      chainId: STELLAR,
      loanId: 4471,
    });
  });
});

describe("Security page — release with consent", () => {
  async function fillConsent() {
    fireEvent.change(
      screen.getByTestId("risk-council-security-release-consent"),
      {
        target: { value: "Signed consent 2026-11-10" },
      },
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("risk-council-security-release-hash"),
      ).toHaveValue(HASH),
    );
  }

  it("lists open records, hashes the consent and needs the confirm dialog", async () => {
    setup(DELAYED);
    renderRoute();
    const select = screen.getByTestId("risk-council-security-release-record");
    expect(within(select).getAllByRole("option")).toHaveLength(3);
    fireEvent.change(select, { target: { value: "2" } });
    await fillConsent();
    const button = screen.getByTestId("risk-council-security-release-button");
    expect(button).toHaveTextContent("Schedule release");
    fireEvent.click(button);
    expect(relay.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Release record #2? This burns the record NFT and cannot be undone.",
    );
    fireEvent.click(within(screen.getByRole("dialog")).getByTestId(/confirm$/));
    expect(relay.mutateAsync).toHaveBeenCalledWith({
      mode: "schedule",
      call: { fn: "release_with_consent", recordId: 2, consentHash: HASH },
      chainId: STELLAR,
      loanId: 4471,
    });
  });

  it("starts with no record selected and keeps the button disabled until one is picked", async () => {
    setup(IMMEDIATE);
    renderRoute();
    const select = screen.getByTestId("risk-council-security-release-record");
    expect(select).toHaveValue("");
    await fillConsent();
    const button = screen.getByTestId("risk-council-security-release-button");
    expect(button).toBeDisabled();
    fireEvent.change(select, { target: { value: "1" } });
    expect(button).toBeEnabled();
  });

  it("clears the record and consent after an executed release", async () => {
    setup(IMMEDIATE);
    renderRoute();
    const select = screen.getByTestId("risk-council-security-release-record");
    fireEvent.change(select, { target: { value: "1" } });
    await fillConsent();
    fireEvent.click(screen.getByTestId("risk-council-security-release-button"));
    fireEvent.click(within(screen.getByRole("dialog")).getByTestId(/confirm$/));
    await waitFor(() => expect(select).toHaveValue(""));
    expect(
      screen.getByTestId("risk-council-security-release-consent"),
    ).toHaveValue("");
    expect(
      screen.getByTestId("risk-council-security-release-hash"),
    ).toHaveValue("");
    expect(
      screen.getByTestId("risk-council-security-release-button"),
    ).toBeDisabled();
  });

  it("keeps the record and consent after a scheduled release", async () => {
    setup(DELAYED);
    renderRoute();
    const select = screen.getByTestId("risk-council-security-release-record");
    fireEvent.change(select, { target: { value: "1" } });
    await fillConsent();
    fireEvent.click(screen.getByTestId("risk-council-security-release-button"));
    fireEvent.click(within(screen.getByRole("dialog")).getByTestId(/confirm$/));
    await waitFor(() => expect(relay.mutateAsync).toHaveBeenCalled());
    expect(select).toHaveValue("1");
    expect(
      screen.getByTestId("risk-council-security-release-consent"),
    ).toHaveValue("Signed consent 2026-11-10");
  });

  it("cancels with Escape or the backdrop without relaying", async () => {
    setup(DELAYED);
    renderRoute();
    fireEvent.change(
      screen.getByTestId("risk-council-security-release-record"),
      { target: { value: "2" } },
    );
    await fillConsent();
    fireEvent.click(screen.getByTestId("risk-council-security-release-button"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("risk-council-security-release-button"));
    fireEvent.click(
      screen.getByTestId(
        "risk-council-security-release-confirm-dialog-backdrop",
      ),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(relay.mutateAsync).not.toHaveBeenCalled();
  });

  it("shows the empty state when no record is open", () => {
    setup(DELAYED, {
      terms: TERMS,
      records: [{ record_id: "3", open: false, status: "Released" }],
    });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-security-release-empty"),
    ).toHaveTextContent("No open records.");
  });
});

describe("Security page — read-only states", () => {
  it("is read-only without the role", () => {
    setup(NO_ROLE);
    renderRoute();
    expect(
      screen.getByTestId("risk-council-security-terms-role"),
    ).toHaveTextContent("Setting security terms belongs to the Risk Council.");
    expect(
      screen.getByTestId("risk-council-security-flag-2-role"),
    ).toHaveTextContent(
      "Settling an inspection flag belongs to the Risk Council.",
    );
    expect(
      screen.getByTestId("risk-council-security-release-role"),
    ).toHaveTextContent("Releasing a record with the lenders' consent");
    expect(screen.getByTestId("risk-council-security-chip")).toHaveTextContent(
      "Risk Council only",
    );
    expect(
      screen.getByTestId("risk-council-security-terms-button"),
    ).toBeDisabled();
  });

  it("shows the Stellar-only reason on another chain", () => {
    chain = 1;
    setup(undefined, undefined, 1);
    mockSecurity.mockReturnValue(
      securityResult({ data: undefined, notConfigured: true }),
    );
    mockLoanState.mockReturnValue({ data: undefined } as never);
    renderRoute();
    expect(
      screen.getByTestId("risk-council-security-terms-role"),
    ).toHaveTextContent(/On-chain actions run on Stellar only/);
    expect(
      screen.getByTestId("risk-council-security-no-terms"),
    ).toBeInTheDocument();
  });

  it("surfaces the not-configured access error", () => {
    setup(undefined);
    mockAccess.mockReturnValue({
      data: undefined,
      error: new Error(
        "On-chain SecurityRegistry actions are not configured for this environment.",
      ),
      isLoading: false,
      dataUpdatedAt: 0,
    } as never);
    renderRoute();
    expect(
      screen.getByTestId("risk-council-security-terms-error"),
    ).toHaveTextContent("SecurityRegistry actions are not configured");
  });

  it("shows the mapped SecurityRegistry error copy after a failed relay", () => {
    setup(IMMEDIATE);
    relay = relayResult({
      error: new Error("simulation failed: Error(Contract, #32)"),
    });
    mockRelay.mockReturnValue(relay as never);
    renderRoute();
    expect(
      screen.getByTestId("risk-council-security-flag-2-error"),
    ).toHaveTextContent("This record has no flag to resolve.");
  });
});

const PENDING = "risk-council-security-pending";
const ID_READY = "ab".repeat(32);
const ID_WAITING = "bb".repeat(32);
const ID_EXPIRED = "cc".repeat(32);
const ID_RELEASE = "dd".repeat(32);

function served(...ops: ReturnType<typeof pendingOp>[]) {
  return {
    terms: TERMS,
    records: RECORDS,
    paused: false,
    pending_operations: ops,
  };
}

const READY_SET_TERMS = pendingOp({ operation_id: ID_READY });
const WAITING_RESOLVE = pendingOp({
  operation_id: ID_WAITING,
  function: "resolve_flag",
  args: [2, ["Escalated"], HASH_A],
  state: "waiting",
  ready_at: new Date((READY_AT + 100) * 1000).toISOString(),
});
const EXPIRED_RELEASE = pendingOp({
  operation_id: ID_EXPIRED,
  function: "release_with_consent",
  args: [1, HASH_B],
  state: "expired",
  ready_at: new Date((READY_AT + 200) * 1000).toISOString(),
});
const READY_RELEASE = pendingOp({
  operation_id: ID_RELEASE,
  function: "release_with_consent",
  args: [1, HASH_B],
  args_xdr: "RELEASEXDR",
});

describe("Security page — scheduled operations", () => {
  it("renders the card above Set terms with one row per operation", () => {
    setup(DELAYED, served(READY_SET_TERMS, WAITING_RESOLVE, EXPIRED_RELEASE));
    renderRoute();
    const card = screen.getByTestId(PENDING);
    const setTerms = screen.getByTestId("risk-council-security-set-terms");
    expect(card.compareDocumentPosition(setTerms)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(card).toHaveTextContent("Scheduled operations");
    const rows = screen.getAllByTestId(`${PENDING}-row`);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Set terms");
    expect(rows[0]).toHaveTextContent("Advance ratio70%");
    expect(rows[0]).toHaveTextContent("Payment termLetter of credit (Lc)");
    expect(rows[1]).toHaveTextContent("Resolve flag · record #2");
    expect(rows[1]).toHaveTextContent("OutcomeEscalated");
    expect(rows[1]).toHaveTextContent("Reason hashcdcdcdcdcd…");
    expect(rows[2]).toHaveTextContent("Release with consent · record #1");
    expect(rows[2]).toHaveTextContent("Consent hashefefefefef…");
  });

  it("shows who scheduled it and the state line of each row", () => {
    setup(DELAYED, served(READY_SET_TERMS, WAITING_RESOLVE, EXPIRED_RELEASE));
    renderRoute();
    expect(
      screen.getByTestId(`${PENDING}-${ID_READY}-caller`),
    ).toHaveTextContent("GSCHED…ABCD · this wallet");
    expect(screen.getByTestId(`${PENDING}-${ID_READY}-role`)).toHaveTextContent(
      "Ready · expires 2027-01-22 08:00 UTC",
    );
    expect(
      screen.getByTestId(`${PENDING}-${ID_WAITING}-role`),
    ).toHaveTextContent("Waiting · executable from 2027-01-15 08:01 UTC");
    expect(
      screen.getByTestId(`${PENDING}-${ID_EXPIRED}-role`),
    ).toHaveTextContent("Expired — schedule it again");
  });

  it("shows the empty copy with no rows or without the field", () => {
    setup(DELAYED, served());
    renderRoute();
    expect(screen.getByTestId(`${PENDING}-empty`)).toHaveTextContent(
      "No scheduled operations found.",
    );
    setup(DELAYED, { terms: TERMS, records: RECORDS, paused: false });
    renderRoute();
    expect(screen.getAllByTestId(`${PENDING}-empty`)).toHaveLength(2);
  });

  it("enables Execute only for the ready row of the connected wallet and sends the served args", () => {
    setup(DELAYED, served(READY_SET_TERMS, WAITING_RESOLVE, EXPIRED_RELEASE));
    renderRoute();
    expect(screen.getByTestId(`${PENDING}-${ID_READY}-button`)).toBeEnabled();
    expect(
      screen.getByTestId(`${PENDING}-${ID_WAITING}-button`),
    ).toBeDisabled();
    expect(
      screen.getByTestId(`${PENDING}-${ID_EXPIRED}-button`),
    ).toBeDisabled();
    fireEvent.click(screen.getByTestId(`${PENDING}-${ID_READY}-button`));
    expect(pendingExecute.mutateAsync).toHaveBeenCalledWith({
      chainId: STELLAR,
      operationId: ID_READY,
      caller: READY_SET_TERMS.caller,
      target: READY_SET_TERMS.target,
      fn: "set_terms",
      argsXdr: READY_SET_TERMS.args_xdr,
    });
  });

  it("shows the other-wallet copy and disables Execute for another wallet", () => {
    walletState.address = "GOTHERWALLETADDRESS1234567890XYZ";
    setup(DELAYED, served(READY_SET_TERMS));
    renderRoute();
    expect(screen.getByTestId(`${PENDING}-${ID_READY}-button`)).toBeDisabled();
    expect(
      screen.getByTestId(`${PENDING}-${ID_READY}-notice`),
    ).toHaveTextContent(
      "Only the scheduling wallet (GSCHED…ABCD) can execute this.",
    );
    expect(
      screen.getByTestId(`${PENDING}-${ID_READY}-caller`),
    ).not.toHaveTextContent("this wallet");
  });

  it("blocks Execute while the registry is paused", () => {
    setup(DELAYED, { ...served(READY_SET_TERMS), paused: true });
    renderRoute();
    expect(screen.getByTestId(`${PENDING}-${ID_READY}-button`)).toBeDisabled();
    expect(
      screen.getByTestId(`${PENDING}-${ID_READY}-notice`),
    ).toHaveTextContent("paused");
  });

  it("blocks a row that targets another SecurityRegistry", () => {
    setup(
      DELAYED,
      served(
        pendingOp({
          operation_id: ID_READY,
          target: "COTHERTARGET1234567890XYZ",
        }),
      ),
    );
    renderRoute();
    expect(screen.getByTestId(`${PENDING}-${ID_READY}-button`)).toBeDisabled();
    expect(
      screen.getByTestId(`${PENDING}-${ID_READY}-notice`),
    ).toHaveTextContent("targets another SecurityRegistry");
  });

  it("asks for confirmation before executing a release", () => {
    setup(DELAYED, served(READY_RELEASE));
    renderRoute();
    fireEvent.click(screen.getByTestId(`${PENDING}-${ID_RELEASE}-button`));
    expect(pendingExecute.mutateAsync).not.toHaveBeenCalled();
    expect(
      screen.getByTestId(`${PENDING}-${ID_RELEASE}-confirm-dialog`),
    ).toHaveTextContent("Release record #1?");
    fireEvent.click(
      screen.getByTestId(`${PENDING}-${ID_RELEASE}-confirm-dialog-confirm`),
    );
    expect(pendingExecute.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        fn: "release_with_consent",
        argsXdr: "RELEASEXDR",
      }),
    );
  });

  it("shows the no-longer-scheduled line after a cancelled operation", () => {
    pendingExecute = pendingExecuteResult(new NoLongerScheduledError());
    setup(DELAYED, served(READY_SET_TERMS));
    renderRoute();
    expect(
      screen.getByTestId(`${PENDING}-${ID_READY}-no-longer`),
    ).toHaveTextContent("No longer scheduled");
  });

  it("falls back to the raw arguments when they do not decode", () => {
    setup(
      DELAYED,
      served(pendingOp({ operation_id: ID_READY, args: [9, { weird: true }] })),
    );
    renderRoute();
    expect(screen.getByTestId(`${PENDING}-${ID_READY}-args`)).toHaveTextContent(
      'Arguments[9,{"weird":true}]',
    );
    expect(screen.getByTestId(`${PENDING}-${ID_READY}-button`)).toBeEnabled();
  });

  it("bridges an operation scheduled from this console until it is served", () => {
    recordScheduledOp({
      chainId: STELLAR,
      loanId: 4471,
      call: { fn: "release_with_consent", recordId: 1, consentHash: HASH_B },
      operationId: ID_RELEASE,
      readyAt: READY_AT,
      caller: SCHEDULER,
      target: READY_RELEASE.target,
      argsXdr: "RELEASEXDR",
    });
    setup(DELAYED, served());
    renderRoute();
    expect(
      screen.getByTestId(`${PENDING}-${ID_RELEASE}-session`),
    ).toHaveTextContent("Scheduled from this console.");
    expect(screen.getAllByTestId(`${PENDING}-row`)).toHaveLength(1);
  });

  it("drops the bridged row once the API serves the same operation", () => {
    recordScheduledOp({
      chainId: STELLAR,
      loanId: 4471,
      call: { fn: "release_with_consent", recordId: 1, consentHash: HASH_B },
      operationId: ID_RELEASE,
      readyAt: READY_AT,
      caller: SCHEDULER,
      target: READY_RELEASE.target,
      argsXdr: "RELEASEXDR",
    });
    setup(DELAYED, served(READY_RELEASE));
    renderRoute();
    expect(screen.getAllByTestId(`${PENDING}-row`)).toHaveLength(1);
    expect(
      screen.queryByTestId(`${PENDING}-${ID_RELEASE}-session`),
    ).not.toBeInTheDocument();
  });

  it("hides the card when /security fails", () => {
    setup(DELAYED, undefined);
    mockSecurity.mockReturnValue(
      securityResult({ data: undefined, error: new Error("boom") }),
    );
    renderRoute();
    expect(screen.queryByTestId(PENDING)).not.toBeInTheDocument();
  });
});

describe("Security page — scheduled terms notice", () => {
  const NOTICE = "risk-council-security-terms-pending-notice";

  it("warns while a set_terms operation waits or is ready", () => {
    setup(DELAYED, served(READY_SET_TERMS));
    renderRoute();
    expect(screen.getByTestId(NOTICE)).toHaveTextContent(
      "A terms change is already scheduled",
    );
    expect(
      screen.getByTestId("risk-council-security-terms-advanceRatio"),
    ).toBeEnabled();
    expect(
      screen.getByTestId("risk-council-security-terms-button"),
    ).toBeEnabled();
  });

  it("warns for a waiting set_terms too", () => {
    setup(DELAYED, served({ ...READY_SET_TERMS, state: "waiting" }));
    renderRoute();
    expect(screen.getByTestId(NOTICE)).toBeInTheDocument();
  });

  it("stays quiet for an expired operation, other functions or none", () => {
    setup(DELAYED, served({ ...READY_SET_TERMS, state: "expired" }));
    renderRoute();
    expect(screen.queryByTestId(NOTICE)).not.toBeInTheDocument();
    setup(DELAYED, served(WAITING_RESOLVE));
    renderRoute();
    expect(screen.queryByTestId(NOTICE)).not.toBeInTheDocument();
    setup(DELAYED, served());
    renderRoute();
    expect(screen.queryByTestId(NOTICE)).not.toBeInTheDocument();
  });
});
