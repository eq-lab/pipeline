// spec: docs/frontend/trustee-flows.md#repayment-recovery-1711
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RepaymentRecoveryDialog } from "./-RepaymentRecoveryDialog";

const REPAYMENT = {
  offtaker_received: "1500000000000",
  senior_principal_repaid: "0",
  senior_interest: "1155000000000",
  equity_distributed: "345000000000",
  mgmt_fee: "0",
  perf_fee: "0",
  oet_alloc: "0",
};
const MINTER = {
  cash: "1155000000000",
  principal: "0",
  interestMinted: "1155000000000",
  feeShares: "345",
  carvedOut: false,
  saleId: 0,
  reversed: false,
};
const WATERFALL = {
  senior_principal_returned: "345000000000",
  senior_coupon_net: "1155000000000",
  management_fee: "0",
  performance_fee: "0",
  oet_allocation: "0",
};

function mutation() {
  return {
    mutateAsync: vi.fn(() => Promise.resolve({ hash: "txhash" })),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
    stage: null as string | null,
    reset: vi.fn(),
  };
}

const state = vi.hoisted(() => ({
  candidates: { data: undefined as unknown, isLoading: false, error: null },
  access: { data: undefined as unknown, isLoading: false },
  schedule: undefined as unknown,
  execute: undefined as unknown,
  record: undefined as unknown,
  financials: { data: undefined as unknown },
  waterfall: { data: undefined as unknown, error: null, isLoading: false },
  audit: { data: undefined as unknown },
}));

vi.mock("@/api/useRepaymentRecovery", () => ({
  RECOVERY_STATUSES: new Set(["Performing", "WatchList", "Default"]),
  useRecoveryCandidates: () => state.candidates,
  useReverseRepayAccess: () => state.access,
  useScheduleReverseRepay: () => state.schedule,
  useExecuteReverseRepay: () => state.execute,
}));
vi.mock("@/api/useRecordPayment", () => ({
  useRecordPayment: () => state.record,
}));
vi.mock("@/api/useLoanFinancials", () => ({
  useLoanFinancials: () => state.financials,
}));
vi.mock("@/api/useLoanWaterfall", () => ({
  useLoanWaterfall: () => state.waterfall,
}));
vi.mock("@/api/useAuditLog", () => ({ useAuditLog: () => state.audit }));
vi.mock("@/api/useLoanBook", () => ({
  useLoanBook: () => ({ data: undefined }),
}));

const CHAIN = 99_000_001;

type Mutation = ReturnType<typeof mutation>;
const sched = () => state.schedule as Mutation;
const exec = () => state.execute as Mutation;
const rec = () => state.record as Mutation;

function setRows(reversed: boolean) {
  state.candidates = {
    data: {
      rows: [
        { repaymentId: 1, repayment: REPAYMENT, minter: MINTER, reversed },
      ],
      latestReversed: reversed,
    },
    isLoading: false,
    error: null,
  };
}

function setAccess(
  canReverse: { immediate: boolean; delay: number },
  schedule: { operationId: string; readyAt: number } | null,
  canRepay = { immediate: true, delay: 0 },
) {
  state.access = {
    data: { canReverse, canRepay, schedule },
    isLoading: false,
  };
}

function renderDialog() {
  return render(
    <RepaymentRecoveryDialog
      open
      chainId={CHAIN}
      loanId="7"
      loanName="Helios Metals"
      onchainStatus="Performing"
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  state.schedule = mutation();
  state.execute = mutation();
  state.record = mutation();
  state.financials = { data: { offtaker_outstanding: "0.000000" } };
  state.waterfall = { data: undefined, error: null, isLoading: false };
  state.audit = {
    data: {
      items: [
        {
          chain_id: CHAIN,
          timestamp: "2026-10-01T00:00:00Z",
          action: "Cash repaid",
          scope: { loan_id: "7", label: "Loan #7" },
          reference: "",
          event_name: "CashRepaid",
          details: { repayment_id: "1", value_date: 1_793_059_200 },
        },
      ],
    },
  };
  setRows(false);
});

describe("RepaymentRecoveryDialog step 1", () => {
  it("preselects the mis-split repayment and shows its split and the reversal effects", () => {
    setAccess({ immediate: true, delay: 0 }, null);
    renderDialog();
    expect(screen.getByTestId("repayment-recovery-radio-1")).toBeChecked();
    expect(screen.getByTestId("repayment-recovery-split")).toHaveTextContent(
      "Equity distributed$34,500.00",
    );
    expect(screen.getByTestId("repayment-recovery-effects")).toHaveTextContent(
      "Capital wallet fee shares burned345",
    );
  });

  it("immediate path: one Reverse repayment click executes with no schedule call", () => {
    setAccess({ immediate: true, delay: 0 }, null);
    renderDialog();
    expect(screen.getByTestId("repayment-recovery-role")).toHaveTextContent(
      "executes at once",
    );
    fireEvent.click(screen.getByTestId("repayment-recovery-reverse"));
    expect(exec().mutateAsync).toHaveBeenCalledWith({
      loanId: 7,
      repaymentId: 1,
    });
    expect(sched().mutateAsync).not.toHaveBeenCalled();
  });

  it("renders the stage text while the reversal is in flight", () => {
    setAccess({ immediate: true, delay: 0 }, null);
    exec().isPending = true;
    exec().stage = "submitting";
    renderDialog();
    expect(screen.getByTestId("repayment-recovery-reverse")).toHaveTextContent(
      "Submitting on-chain…",
    );
    expect(screen.getByTestId("repayment-recovery-reverse")).toBeDisabled();
  });

  it("delayed path: schedules first, then executes once the schedule is on chain", () => {
    setAccess(
      { immediate: false, delay: 86400 },
      { operationId: "ab", readyAt: 0 },
    );
    const { unmount } = renderDialog();
    expect(screen.getByTestId("repayment-recovery-role")).toHaveTextContent(
      "24 h delay",
    );
    const button = screen.getByTestId("repayment-recovery-reverse");
    expect(button).toHaveTextContent("Schedule reversal");
    fireEvent.click(button);
    expect(sched().mutateAsync).toHaveBeenCalledWith({
      loanId: 7,
      repaymentId: 1,
    });
    expect(exec().mutateAsync).not.toHaveBeenCalled();
    unmount();

    setAccess(
      { immediate: false, delay: 86400 },
      { operationId: "ab", readyAt: 1_800_000_000 },
    );
    renderDialog();
    expect(screen.getByTestId("repayment-recovery-role")).toHaveTextContent(
      "Scheduled. Executable from 2027-01-15 08:00 UTC.",
    );
    const execute = screen.getByTestId("repayment-recovery-reverse");
    expect(execute).toHaveTextContent("Execute reversal");
    fireEvent.click(execute);
    expect(exec().mutateAsync).toHaveBeenCalledWith({
      loanId: 7,
      repaymentId: 1,
    });
  });

  it("a Trustee-only wallet sees the Risk Council line and a disabled reverse button", () => {
    setAccess({ immediate: false, delay: 0 }, null, {
      immediate: false,
      delay: 0,
    });
    renderDialog();
    expect(screen.getByTestId("repayment-recovery-role")).toHaveTextContent(
      "Only the Risk Council can reverse a repayment.",
    );
    expect(screen.getByTestId("repayment-recovery-reverse")).toBeDisabled();
  });

  it("maps AccessManager #7 to the not-ready copy", () => {
    setAccess(
      { immediate: false, delay: 86400 },
      { operationId: "ab", readyAt: 1_800_000_000 },
    );
    exec().error = new Error(
      "execute simulation error: HostError: Error(Contract, #7)",
    );
    renderDialog();
    expect(
      screen.getByTestId("repayment-recovery-reverse-error"),
    ).toHaveTextContent("not ready yet");
  });
});

describe("RepaymentRecoveryDialog step 2", () => {
  it("is blocked until the repayment is reversed on chain", () => {
    setAccess({ immediate: true, delay: 0 }, null);
    renderDialog();
    expect(screen.getByTestId("repayment-recovery-record")).toBeDisabled();
    expect(
      screen.getByTestId("repayment-recovery-step2-blocked"),
    ).toHaveTextContent("Reverse the repayment first.");
  });

  it("waits for the backend to reflect the reversal", () => {
    setRows(true);
    setAccess({ immediate: true, delay: 0 }, null);
    state.waterfall = { data: WATERFALL, error: null, isLoading: false };
    renderDialog();
    expect(screen.getByTestId("repayment-recovery-record")).toBeDisabled();
    expect(
      screen.getByTestId("repayment-recovery-step2-blocked"),
    ).toHaveTextContent("Waiting for the backend");
  });

  it("records the corrected repayment with the waterfall split and the original value date", () => {
    setRows(true);
    setAccess({ immediate: true, delay: 0 }, null);
    state.financials = { data: { offtaker_outstanding: "150000.000000" } };
    state.waterfall = { data: WATERFALL, error: null, isLoading: false };
    renderDialog();
    expect(
      screen.getByTestId("repayment-recovery-corrected"),
    ).toHaveTextContent("Senior principal repaid$34,500.00");
    expect(
      screen.getByTestId("repayment-recovery-corrected"),
    ).toHaveTextContent("Value date2026-10-27");
    const button = screen.getByTestId("repayment-recovery-record");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(rec().mutateAsync).toHaveBeenCalledWith({
      loanId: 7,
      repayment: {
        offtaker_received: "1500000000000",
        senior_principal_repaid: "345000000000",
        senior_interest: "1155000000000",
        equity_distributed: "0",
        mgmt_fee: "0",
        perf_fee: "0",
        oet_alloc: "0",
      },
      valueDate: 1_793_059_200,
    });
  });

  it("shows the transaction hash after the corrected repayment is recorded", async () => {
    setRows(true);
    setAccess({ immediate: true, delay: 0 }, null);
    state.financials = { data: { offtaker_outstanding: "150000.000000" } };
    state.waterfall = { data: WATERFALL, error: null, isLoading: false };
    renderDialog();
    fireEvent.click(screen.getByTestId("repayment-recovery-record"));
    expect(
      await screen.findByTestId("repayment-recovery-hash"),
    ).toHaveTextContent("txhash");
  });

  it("is disabled for a wallet without the Cash reporter role", () => {
    setRows(true);
    setAccess({ immediate: true, delay: 0 }, null, {
      immediate: false,
      delay: 0,
    });
    state.financials = { data: { offtaker_outstanding: "150000.000000" } };
    state.waterfall = { data: WATERFALL, error: null, isLoading: false };
    renderDialog();
    expect(screen.getByTestId("repayment-recovery-record")).toBeDisabled();
    expect(
      screen.getByTestId("repayment-recovery-step2-blocked"),
    ).toHaveTextContent("Only the Cash reporter can record");
  });

  it("is disabled with an explanation when the original value date is missing", () => {
    setRows(true);
    setAccess({ immediate: true, delay: 0 }, null);
    state.audit = { data: { items: [] } };
    state.financials = { data: { offtaker_outstanding: "150000.000000" } };
    state.waterfall = { data: WATERFALL, error: null, isLoading: false };
    renderDialog();
    expect(screen.getByTestId("repayment-recovery-record")).toBeDisabled();
    expect(
      screen.getByTestId("repayment-recovery-step2-blocked"),
    ).toHaveTextContent("value date was not found");
  });
});
