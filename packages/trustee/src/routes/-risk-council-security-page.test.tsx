// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import {
  _resetRiskCouncilOpsForTests,
  markOperationExecuted,
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
  EVM,
  EVM_CALLDATA,
  EVM_OPERATION_ID,
  EVM_SCHEDULER,
  EVM_SECURITY_REGISTRY,
  EVM_SET_TERMS_F92D719_CALLDATA,
  accessResult,
  loanBookResult,
  loanEntry,
  loanRegistryOp,
  loanState,
  evmPendingOp,
  evmPendingOpF92d719,
  minterOp,
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

const walletState = vi.hoisted(() => ({
  address: null as string | null,
  evmAddress: undefined as string | undefined,
}));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  const { SECURITY_REGISTRY, EVM_SECURITY_REGISTRY } =
    await import("./-riskCouncilFixtures");
  return {
    ...actual,
    ENV: {
      ...actual.ENV,
      STELLAR_SECURITY_REGISTRY_ID: SECURITY_REGISTRY,
      EVM_SECURITY_REGISTRY_ADDRESS: EVM_SECURITY_REGISTRY,
    },
  };
});

const HASH = "cd".repeat(32);
vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: () => ({ address: walletState.address }),
  useEvmWallet: () => ({
    address: walletState.evmAddress,
    isConnected: walletState.evmAddress !== undefined,
  }),
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
    PendingTargetMismatchError: actual.PendingTargetMismatchError,
    RegistryPausedError: actual.RegistryPausedError,
    useEvmSecurityTermsShape: vi.fn(),
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
  useEvmSecurityTermsShape,
  usePendingOperationExecute,
  useRiskCouncilAccess,
  useRiskCouncilLoanState,
  useRiskCouncilRelay,
} from "@/api/useRiskCouncil";
import { Route } from "./risk-council.security.$id";

const mockLoanBook = vi.mocked(useLoanBook);
const mockSecurity = vi.mocked(useLoanSecurity);
const mockTermsShape = vi.mocked(useEvmSecurityTermsShape);
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
  walletState.evmAddress = undefined;
  mockTermsShape.mockReturnValue({ data: undefined } as never);
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
      expectedTarget: READY_SET_TERMS.target,
      paused: false,
      fn: "set_terms",
      argsXdr: READY_SET_TERMS.args_xdr,
      calldata: null,
      targetKind: "security_registry",
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

  it("asks for confirmation for a release whose arguments do not decode", () => {
    setup(
      DELAYED,
      served(
        pendingOp({
          operation_id: ID_RELEASE,
          function: "release_with_consent",
          args: [1, "NOT-A-HASH"],
        }),
      ),
    );
    renderRoute();
    fireEvent.click(screen.getByTestId(`${PENDING}-${ID_RELEASE}-button`));
    expect(pendingExecute.mutateAsync).not.toHaveBeenCalled();
    expect(
      screen.getByTestId(`${PENDING}-${ID_RELEASE}-confirm-dialog`),
    ).toHaveTextContent("Release record #1?");
    fireEvent.click(
      screen.getByTestId(`${PENDING}-${ID_RELEASE}-confirm-dialog-confirm`),
    );
    expect(pendingExecute.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("asks for a generic confirmation when the release record number is unknown", () => {
    setup(
      DELAYED,
      served(
        pendingOp({
          operation_id: ID_RELEASE,
          function: "release_with_consent",
          args: "garbage",
        }),
      ),
    );
    renderRoute();
    fireEvent.click(screen.getByTestId(`${PENDING}-${ID_RELEASE}-button`));
    expect(pendingExecute.mutateAsync).not.toHaveBeenCalled();
    expect(
      screen.getByTestId(`${PENDING}-${ID_RELEASE}-confirm-dialog`),
    ).toHaveTextContent("Release this record?");
  });

  it("lists other contracts' operations with an owner link instead of Execute", () => {
    setup(
      DELAYED,
      served(
        READY_SET_TERMS,
        pendingOp({
          operation_id: ID_WAITING,
          target_kind: "loan_registry",
          function: "set_default",
          args: [4471],
        }),
      ),
    );
    renderRoute();
    expect(screen.getAllByTestId(`${PENDING}-row`)).toHaveLength(2);
    expect(
      screen.queryByTestId(`${PENDING}-${ID_WAITING}-button`),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(`${PENDING}-${ID_WAITING}-link`)).toHaveAttribute(
      "href",
      `/risk-council/escalate/4471?chain=${STELLAR}`,
    );
    expect(
      screen.getByTestId(`${PENDING}-${ID_WAITING}-link`),
    ).toHaveTextContent("Open Escalate to Default");
    expect(screen.getByTestId(`${PENDING}-${ID_READY}-button`)).toBeEnabled();
  });

  it("does not execute a security function served with another target kind", () => {
    setup(
      DELAYED,
      served(
        pendingOp({
          operation_id: ID_WAITING,
          target_kind: "other",
          function: "set_terms",
        }),
      ),
    );
    renderRoute();
    expect(
      screen.queryByTestId(`${PENDING}-${ID_WAITING}-button`),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`${PENDING}-${ID_WAITING}-link`),
    ).toHaveTextContent("Open Security");
  });

  it("adds the loan-book operations of the loan with their owner links", () => {
    setup(DELAYED, served(READY_SET_TERMS));
    mockLoanBook.mockReturnValue(
      loanBookResult([
        loanEntry({
          pending_operations: [
            loanRegistryOp("write_down", { args: [4471, "5000000"] }),
            minterOp({ args: [4471, 2, HASH_A] }),
          ],
        }),
      ]) as never,
    );
    renderRoute();
    expect(screen.getAllByTestId(`${PENDING}-row`)).toHaveLength(3);
    const writeDownId = loanRegistryOp("write_down").operation_id;
    const minterId = minterOp().operation_id;
    expect(
      screen.getByTestId(`${PENDING}-${writeDownId}-link`),
    ).toHaveAttribute("href", `/risk-council/writedown/4471?chain=${STELLAR}`);
    expect(
      screen.getByTestId(`${PENDING}-${writeDownId}-link`),
    ).toHaveTextContent("Open Default resolution");
    expect(screen.getByTestId(`${PENDING}-${minterId}-link`)).toHaveAttribute(
      "href",
      `/loans/4471?chain=${STELLAR}`,
    );
    expect(
      screen.queryByTestId(`${PENDING}-${writeDownId}-button`),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(`${PENDING}-${ID_READY}-button`)).toBeEnabled();
  });

  it("lists an operation served by both sources once and keeps the security copy", () => {
    setup(DELAYED, served({ ...READY_SET_TERMS, args_xdr: "SECURITYCOPY" }));
    mockLoanBook.mockReturnValue(
      loanBookResult([
        loanEntry({
          pending_operations: [{ ...READY_SET_TERMS, args_xdr: "BOOKCOPY" }],
        }),
      ]) as never,
    );
    renderRoute();
    expect(screen.getAllByTestId(`${PENDING}-row`)).toHaveLength(1);
    fireEvent.click(screen.getByTestId(`${PENDING}-${ID_READY}-button`));
    expect(pendingExecute.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ argsXdr: "SECURITYCOPY" }),
    );
  });

  it("keeps an executed row with its hash until the API stops serving it", () => {
    setup(DELAYED, served(READY_SET_TERMS));
    const view = renderRoute();
    act(() => markOperationExecuted(STELLAR, ID_READY, "EXECHASH", READY_AT));
    expect(screen.getAllByTestId(`${PENDING}-row`)).toHaveLength(1);
    expect(screen.getByTestId(`${PENDING}-${ID_READY}-role`)).toHaveTextContent(
      "Executed",
    );
    expect(screen.getByTestId(`${PENDING}-${ID_READY}-hash`)).toHaveTextContent(
      "EXECHASH",
    );
    expect(screen.getByTestId(`${PENDING}-${ID_READY}-button`)).toBeDisabled();
    const Page = Route.options.component as React.ComponentType;
    mockSecurity.mockReturnValue(
      securityResult({
        data: served() as never,
        dataUpdatedAt: Date.now() + 60_000,
      }),
    );
    view.rerender(<Page />);
    expect(screen.queryByTestId(`${PENDING}-row`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`${PENDING}-empty`)).toBeInTheDocument();
  });

  it("shows the same operation again once it is re-scheduled with a new ready time", () => {
    setup(DELAYED, served(READY_SET_TERMS));
    const view = renderRoute();
    act(() => markOperationExecuted(STELLAR, ID_READY, "EXECHASH", READY_AT));
    const Page = Route.options.component as React.ComponentType;
    mockSecurity.mockReturnValue(
      securityResult({
        data: served(
          pendingOp({
            operation_id: ID_READY,
            ready_at: new Date((READY_AT + 900) * 1000).toISOString(),
          }),
        ) as never,
        dataUpdatedAt: Date.now() + 60_000,
      }),
    );
    view.rerender(<Page />);
    expect(screen.getByTestId(`${PENDING}-${ID_READY}-button`)).toBeEnabled();
    expect(
      screen.queryByTestId(`${PENDING}-${ID_READY}-hash`),
    ).not.toBeInTheDocument();
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

describe("Security page — EVM loan", () => {
  const EVM_TERMS = {
    ...TERMS,
    default_ratio_bps: 9000,
    originator_fee_rate: 10000,
  };
  const evmServed = (...ops: ReturnType<typeof pendingOp>[]) => ({
    terms: EVM_TERMS,
    records: RECORDS,
    paused: false,
    pending_operations: ops,
  });

  beforeEach(() => {
    chain = EVM;
    walletState.evmAddress = EVM_SCHEDULER.toLowerCase();
    mockTermsShape.mockReturnValue({ data: "terms15" } as never);
  });

  it("shows 12 term inputs and the two EVM rows in the current terms", () => {
    setup(IMMEDIATE, evmServed(), EVM);
    const { container } = renderRoute();
    expect(
      container.querySelectorAll(
        'input[data-testid^="risk-council-security-terms-"]',
      ),
    ).toHaveLength(12);
    expect(
      screen.getByTestId("risk-council-security-terms-defaultRatio"),
    ).toHaveValue("90");
    expect(
      screen.getByTestId("risk-council-security-terms-originatorFeeRate"),
    ).toHaveValue("1");
    const terms = screen.getByTestId("risk-council-security-terms");
    expect(terms).toHaveTextContent("Default ratio90%");
    expect(terms).toHaveTextContent("Originator fee rate1%");
  });

  it("keeps the Stellar form at 10 inputs", () => {
    chain = STELLAR;
    setup(IMMEDIATE);
    const { container } = renderRoute();
    expect(
      container.querySelectorAll(
        'input[data-testid^="risk-council-security-terms-"]',
      ),
    ).toHaveLength(10);
  });

  it("enables Set terms per access and sends both EVM fields", () => {
    setup(IMMEDIATE, evmServed(), EVM);
    renderRoute();
    const button = screen.getByTestId("risk-council-security-terms-button");
    expect(button).toHaveTextContent("Set terms");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(relay.mutateAsync).toHaveBeenCalledWith({
      mode: "execute",
      call: expect.objectContaining({
        fn: "set_terms",
        terms: expect.objectContaining({
          defaultRatioBps: 9000,
          originatorFeeRate: 10000,
        }),
      }),
      chainId: EVM,
      loanId: 4471,
    });
  });

  it("flags a default ratio below the margin call ratio", () => {
    setup(IMMEDIATE, evmServed(), EVM);
    renderRoute();
    fireEvent.change(
      screen.getByTestId("risk-council-security-terms-defaultRatio"),
      { target: { value: "80" } },
    );
    expect(
      screen.getByTestId("risk-council-security-terms-ratio-error"),
    ).toHaveTextContent(
      "The default ratio must be at least the margin call ratio.",
    );
    expect(
      screen.getByTestId("risk-council-security-terms-button"),
    ).toBeDisabled();
  });

  it("lists the EVM row with decoded args, this wallet, and executes with the calldata", () => {
    setup(DELAYED, evmServed(evmPendingOp()), EVM);
    renderRoute();
    const args = screen.getByTestId(`${PENDING}-${EVM_OPERATION_ID}-args`);
    expect(args).toHaveTextContent("Default ratio90%");
    expect(args).toHaveTextContent("Originator fee rate1%");
    expect(
      screen.getByTestId(`${PENDING}-${EVM_OPERATION_ID}-caller`),
    ).toHaveTextContent("this wallet");
    const button = screen.getByTestId(`${PENDING}-${EVM_OPERATION_ID}-button`);
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(pendingExecute.mutateAsync).toHaveBeenCalledWith({
      chainId: EVM,
      operationId: EVM_OPERATION_ID,
      caller: EVM_SCHEDULER,
      target: EVM_SECURITY_REGISTRY,
      expectedTarget: EVM_SECURITY_REGISTRY,
      paused: false,
      fn: "set_terms",
      argsXdr: null,
      calldata: EVM_CALLDATA,
      targetKind: "security_registry",
    });
  });

  it("shows the other-wallet copy for another wallet", () => {
    walletState.evmAddress = "0x0000000000000000000000000000000000000001";
    setup(DELAYED, evmServed(evmPendingOp()), EVM);
    renderRoute();
    expect(
      screen.getByTestId(`${PENDING}-${EVM_OPERATION_ID}-button`),
    ).toBeDisabled();
    expect(
      screen.getByTestId(`${PENDING}-${EVM_OPERATION_ID}-notice`),
    ).toHaveTextContent("Only the scheduling wallet");
  });

  it("still asks for confirmation before executing a release", () => {
    setup(
      DELAYED,
      evmServed(
        evmPendingOp({
          function: "releaseWithConsent",
          args: ["1", HASH_B],
        }),
      ),
      EVM,
    );
    renderRoute();
    fireEvent.click(
      screen.getByTestId(`${PENDING}-${EVM_OPERATION_ID}-button`),
    );
    expect(pendingExecute.mutateAsync).not.toHaveBeenCalled();
    expect(
      screen.getByTestId(`${PENDING}-${EVM_OPERATION_ID}-confirm-dialog`),
    ).toHaveTextContent("Release record #1?");
    fireEvent.click(
      screen.getByTestId(
        `${PENDING}-${EVM_OPERATION_ID}-confirm-dialog-confirm`,
      ),
    );
    expect(pendingExecute.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        fn: "release_with_consent",
        calldata: EVM_CALLDATA,
      }),
    );
  });

  it("links an EVM setDefault row to Escalate without an Execute button", () => {
    setup(
      DELAYED,
      evmServed(
        evmPendingOp({
          function: "setDefault",
          target_kind: "loan_registry",
          args: ["4471"],
        }),
      ),
      EVM,
    );
    renderRoute();
    expect(
      screen.queryByTestId(`${PENDING}-${EVM_OPERATION_ID}-button`),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`${PENDING}-${EVM_OPERATION_ID}-link`),
    ).toHaveTextContent("Open Escalate to Default");
  });
});

describe("Security page — EVM loan on an f92d719 registry", () => {
  const served = (...ops: ReturnType<typeof pendingOp>[]) => ({
    terms: TERMS,
    records: RECORDS,
    paused: false,
    pending_operations: ops,
  });
  const termsInputs = (container: HTMLElement) =>
    container.querySelectorAll(
      'input[data-testid^="risk-council-security-terms-"]',
    );

  beforeEach(() => {
    chain = EVM;
    walletState.evmAddress = EVM_SCHEDULER.toLowerCase();
    mockTermsShape.mockReturnValue({ data: "terms12" } as never);
  });

  it("shows the 10 Stellar inputs and none of the EVM-only ones", () => {
    setup(IMMEDIATE, served(), EVM);
    const { container } = renderRoute();
    expect(termsInputs(container)).toHaveLength(10);
    expect(
      screen.queryByTestId("risk-council-security-terms-defaultRatio"),
    ).toBeNull();
    expect(
      screen.queryByTestId("risk-council-security-terms-originatorFeeRate"),
    ).toBeNull();
    expect(
      screen.queryByTestId("risk-council-security-terms-ratio-error"),
    ).toBeNull();
    const terms = screen.getByTestId("risk-council-security-terms");
    expect(terms).not.toHaveTextContent("Default ratio");
    expect(terms).not.toHaveTextContent("Originator fee rate");
  });

  it("relays set_terms without the extras", () => {
    setup(IMMEDIATE, served(), EVM);
    renderRoute();
    const button = screen.getByTestId("risk-council-security-terms-button");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    const call = relay.mutateAsync.mock.calls[0]![0].call;
    expect(call.fn).toBe("set_terms");
    expect(call.terms).not.toHaveProperty("defaultRatioBps");
    expect(call.terms).not.toHaveProperty("originatorFeeRate");
  });

  it("still flags a margin call ratio below the advance ratio", () => {
    setup(IMMEDIATE, served(), EVM);
    renderRoute();
    fireEvent.change(
      screen.getByTestId("risk-council-security-terms-marginCallRatio"),
      { target: { value: "60" } },
    );
    expect(
      screen.getByTestId("risk-council-security-terms-ratio-error"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("risk-council-security-terms-button"),
    ).toBeDisabled();
  });

  it("renders a served 12-key row like Stellar and executes the served calldata", () => {
    setup(DELAYED, served(evmPendingOpF92d719()), EVM);
    renderRoute();
    const args = screen.getByTestId(`${PENDING}-${EVM_OPERATION_ID}-args`);
    expect(args).toHaveTextContent("Advance ratio70%");
    expect(args).not.toHaveTextContent("Default ratio");
    expect(args).not.toHaveTextContent("Originator fee rate");
    fireEvent.click(
      screen.getByTestId(`${PENDING}-${EVM_OPERATION_ID}-button`),
    );
    expect(pendingExecute.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        fn: "set_terms",
        calldata: EVM_SET_TERMS_F92D719_CALLDATA,
      }),
    );
  });

  it("shows 10 inputs and disables Set terms while the build is unknown", () => {
    mockTermsShape.mockReturnValue({ data: undefined } as never);
    setup(IMMEDIATE, served(), EVM);
    const { container } = renderRoute();
    expect(termsInputs(container)).toHaveLength(10);
    expect(
      screen.getByTestId("risk-council-security-terms-button"),
    ).toBeDisabled();
  });
});
