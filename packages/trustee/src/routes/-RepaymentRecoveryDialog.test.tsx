// spec: docs/frontend/trustee-flows.md#repayment-recovery-1711
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { RepaymentRecoveryDialog } from "./-RepaymentRecoveryDialog";
import {
  EVM,
  EVM_MINTER,
  EVM_SCHEDULER,
  MINTER as MINTER_ADDRESS,
  SCHEDULER,
  evmMinterOp,
  loanBookResult,
  loanEntry,
  loanRegistryOp,
  minterOp,
  pendingExecuteResult,
} from "./-riskCouncilFixtures";
import { ApiError } from "@/api/client";
import type { PendingOperation } from "@/api/pendingOperations";
import { _resetRiskCouncilOpsForTests } from "@/lib/riskCouncilOps";

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
  loanBook: { data: undefined as unknown },
  walletAddress: null as string | null,
  evmAddress: undefined as string | undefined,
  pendingExecute: undefined as unknown,
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
  useLoanBook: () => state.loanBook,
}));
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
vi.mock("@pipeline/wallet-connect", () => ({
  FLAG_OUTCOMES: ["Accepted", "TopUpRequired", "Escalated"],
  SECURITY_PAYMENT_TERMS: ["Lc", "Dp", "Da", "OpenAccount"],
  useStellarWallet: () => ({ address: state.walletAddress }),
  useEvmWallet: () => ({
    address: state.evmAddress,
    isConnected: state.evmAddress !== undefined,
  }),
}));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  const { MINTER, EVM_MINTER } = await import("./-riskCouncilFixtures");
  return {
    ...actual,
    ENV: {
      ...actual.ENV,
      STELLAR_YIELD_MINTER_ID: MINTER,
      EVM_MINTER_ADDRESS: EVM_MINTER,
    },
  };
});
vi.mock("@/api/useRiskCouncil", async () => {
  const actual = await vi.importActual<typeof import("@/api/useRiskCouncil")>(
    "@/api/useRiskCouncil",
  );
  return {
    NoLongerScheduledError: actual.NoLongerScheduledError,
    PendingArgsMismatchError: actual.PendingArgsMismatchError,
    PendingTargetMismatchError: actual.PendingTargetMismatchError,
    RegistryPausedError: actual.RegistryPausedError,
    usePendingOperationExecute: () => state.pendingExecute,
  };
});

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

function renderDialog(onClose: () => void = vi.fn(), chainId: number = CHAIN) {
  return render(
    <RepaymentRecoveryDialog
      open
      chainId={chainId}
      loanId="7"
      loanName="Helios Metals"
      onchainStatus="Performing"
      onClose={onClose}
    />,
  );
}

beforeEach(() => {
  _resetRiskCouncilOpsForTests();
  state.loanBook = { data: undefined };
  state.walletAddress = SCHEDULER;
  state.evmAddress = undefined;
  state.pendingExecute = pendingExecuteResult();
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
      chainId: CHAIN,
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
      chainId: CHAIN,
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
      chainId: CHAIN,
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

  it("shows the status-specific copy when the waterfall refuses the loan status", () => {
    setRows(true);
    setAccess({ immediate: true, delay: 0 }, null);
    state.financials = { data: { offtaker_outstanding: "150000.000000" } };
    state.waterfall = {
      data: undefined,
      error: new ApiError(
        "loan status is Closed: a repayment can only be recorded while the loan is Performing, WatchList or Default",
        400,
      ),
      isLoading: false,
    };
    renderDialog();
    expect(
      screen.getByTestId("repayment-recovery-step2-blocked"),
    ).toHaveTextContent("can't take a repayment in its current status");
  });

  it("keeps the generic copy for other waterfall errors", () => {
    setRows(true);
    setAccess({ immediate: true, delay: 0 }, null);
    state.financials = { data: { offtaker_outstanding: "150000.000000" } };
    state.waterfall = {
      data: undefined,
      error: new ApiError("boom", 500),
      isLoading: false,
    };
    renderDialog();
    expect(
      screen.getByTestId("repayment-recovery-step2-blocked"),
    ).toHaveTextContent("The corrected split could not be computed.");
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
      chainId: CHAIN,
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

describe("RepaymentRecoveryDialog scheduled operations", () => {
  const PENDING = "repayment-recovery-pending";
  const REVERSE = minterOp({
    args: [7, 2, "cd".repeat(32)],
    args_xdr: "REVERSEXDR",
  });
  const AMEND = loanRegistryOp("amend_economics", {
    args: [7, 145_000, "1816128000"],
  });
  const id = (op: PendingOperation) => `${PENDING}-${op.operation_id}`;

  function serve(...ops: PendingOperation[]) {
    state.loanBook = loanBookResult([
      loanEntry({
        loan_id: "7",
        chain_id: CHAIN,
        pending_operations: ops,
      }),
    ]);
    setAccess({ immediate: false, delay: 86400 }, null);
  }

  it("shows the Scheduled operations title and the empty state", () => {
    serve();
    renderDialog();
    expect(screen.getByTestId("repayment-recovery-step1")).toHaveTextContent(
      "Scheduled operations",
    );
    expect(screen.getByTestId(`${PENDING}-empty`)).toHaveTextContent(
      "No scheduled operations found.",
    );
  });

  it("lists a reverse_repay scheduled by another wallet with its arguments", () => {
    serve({ ...REVERSE, caller: "GOTHERSCHEDULERADDRESS1234XYZ" });
    renderDialog();
    const row = screen.getByTestId(`${PENDING}-row`);
    expect(row).toHaveTextContent("Reverse repayment · repayment #2");
    expect(screen.getByTestId(`${id(REVERSE)}-args`)).toHaveTextContent(
      "Repayment#2",
    );
    expect(screen.getByTestId(`${id(REVERSE)}-args`)).toHaveTextContent(
      "Reference hashcdcdcdcdcd…",
    );
    expect(screen.getByTestId(`${id(REVERSE)}-caller`)).toHaveTextContent(
      "GOTHER…4XYZ",
    );
    expect(screen.getByTestId(`${id(REVERSE)}-button`)).toBeDisabled();
    expect(screen.getByTestId(`${id(REVERSE)}-notice`)).toHaveTextContent(
      "Only the scheduling wallet (GOTHER…4XYZ) can execute this.",
    );
  });

  it("links a LoanRegistry operation of the same loan to its page instead of Execute", () => {
    serve(REVERSE, AMEND);
    renderDialog();
    expect(screen.queryByTestId(`${id(AMEND)}-button`)).toBeNull();
    expect(screen.getByTestId(`${id(AMEND)}-link`)).toHaveTextContent(
      "Open Amend economics",
    );
    expect(screen.getByTestId(`${id(AMEND)}-link`)).toHaveAttribute(
      "href",
      `/risk-council/reterm/7?chain=${CHAIN}`,
    );
    const amendRow = screen
      .getAllByTestId(`${PENDING}-row`)
      .find((row) => row.textContent?.includes("Amend economics"))!;
    expect(within(amendRow).queryAllByRole("button")).toHaveLength(0);
  });

  it("enables Execute for the scheduler on a ready row and sends the served args", () => {
    serve(REVERSE);
    renderDialog();
    expect(screen.getByTestId(`${id(REVERSE)}-button`)).toBeEnabled();
    fireEvent.click(screen.getByTestId(`${id(REVERSE)}-button`));
    expect(
      (state.pendingExecute as ReturnType<typeof pendingExecuteResult>)
        .mutateAsync,
    ).toHaveBeenCalledWith({
      chainId: CHAIN,
      operationId: REVERSE.operation_id,
      caller: SCHEDULER,
      target: MINTER_ADDRESS,
      expectedTarget: MINTER_ADDRESS,
      paused: false,
      fn: "reverse_repay",
      argsXdr: "REVERSEXDR",
      calldata: null,
      targetKind: "minter",
    });
  });

  it("treats an in-flight row execute as busy: Escape, backdrop, Close and Execute reversal are blocked", () => {
    serve(REVERSE);
    setAccess({ immediate: true, delay: 0 }, null);
    (
      state.pendingExecute as ReturnType<typeof pendingExecuteResult>
    ).isPending = true;
    const onClose = vi.fn();
    renderDialog(onClose);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByTestId("repayment-recovery-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("repayment-recovery-close")).toBeDisabled();
    expect(screen.getByTestId("repayment-recovery-reverse")).toBeDisabled();
  });

  it("closes with Escape when no execute is in flight", () => {
    serve(REVERSE);
    const onClose = vi.fn();
    renderDialog(onClose);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables the row Execute while the reversal is in flight", () => {
    serve(REVERSE);
    setAccess({ immediate: true, delay: 0 }, null);
    exec().isPending = true;
    renderDialog();
    expect(screen.getByTestId(`${id(REVERSE)}-button`)).toBeDisabled();
  });

  it("disables Execute with the Minter copy when the row targets another Minter", () => {
    serve({ ...REVERSE, target: "COTHERMINTER12345678901" });
    renderDialog();
    expect(screen.getByTestId(`${id(REVERSE)}-button`)).toBeDisabled();
    expect(screen.getByTestId(`${id(REVERSE)}-notice`)).toHaveTextContent(
      "targets another Minter (COTHER…8901)",
    );
  });

  it("keeps the deterministic Execute reversal button beside the block", () => {
    serve(REVERSE);
    setRows(false);
    renderDialog();
    expect(
      screen.getByTestId("repayment-recovery-reverse"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("repayment-recovery-radio-1")).toBeChecked();
  });
});

describe("RepaymentRecoveryDialog on EVM", () => {
  const PENDING = "repayment-recovery-pending";
  const EVM_REPAYMENT = {
    offtaker_received: "1500000000",
    senior_principal_repaid: "0",
    senior_interest: "1155000000",
    equity_distributed: "345000000",
    mgmt_fee: "0",
    perf_fee: "0",
    oet_alloc: "0",
  };
  const EVM_EFFECTS = {
    cash: "1155000000",
    principal: "345000000",
    interestMinted: "1155000000",
    feeShares: "345",
    carvedOut: true,
    saleId: 0,
    reversed: false,
  };

  function setEvmRows(reversed: boolean) {
    state.candidates = {
      data: {
        rows: [
          {
            repaymentId: 1,
            repayment: EVM_REPAYMENT,
            minter: { ...EVM_EFFECTS, reversed },
            reversed,
          },
        ],
        latestReversed: reversed,
      },
      isLoading: false,
      error: null,
    };
  }

  beforeEach(() => {
    state.evmAddress = EVM_SCHEDULER;
    setEvmRows(false);
    state.audit = { data: { items: [] } };
    state.financials = { data: { offtaker_outstanding: "0.000000" } };
  });

  it("lists the candidates at 6 dp, preselects the mis-split one and shows the Pocket unrelease from released", () => {
    setAccess({ immediate: true, delay: 0 }, null);
    renderDialog(vi.fn(), EVM);
    expect(screen.getByTestId("repayment-recovery-radio-1")).toBeChecked();
    expect(screen.getByTestId("repayment-recovery-split")).toHaveTextContent(
      "Equity distributed$345.00",
    );
    expect(screen.getByTestId("repayment-recovery-effects")).toHaveTextContent(
      "Pocket unrelease: principal / interest$345.00 / $1,155.00",
    );
  });

  it("reverses through the EVM mutation with the chain id", () => {
    setAccess({ immediate: true, delay: 0 }, null);
    renderDialog(vi.fn(), EVM);
    fireEvent.click(screen.getByTestId("repayment-recovery-reverse"));
    expect(exec().mutateAsync).toHaveBeenCalledWith({
      loanId: 7,
      repaymentId: 1,
      chainId: EVM,
    });
    expect(sched().mutateAsync).not.toHaveBeenCalled();
  });

  it("executes a reverseRepay pending row with the served calldata against the configured Minter", () => {
    const row = evmMinterOp({ args: ["7", "2", "cd".repeat(32)] });
    state.loanBook = loanBookResult([
      loanEntry({ loan_id: "7", chain_id: EVM, pending_operations: [row] }),
    ]);
    setAccess({ immediate: false, delay: 0 }, null);
    renderDialog(vi.fn(), EVM);
    const testId = `${PENDING}-${row.operation_id}`;
    expect(screen.getByTestId(`${testId}-args`)).toHaveTextContent(
      "Repayment#2",
    );
    expect(screen.getByTestId(`${testId}-button`)).toBeEnabled();
    fireEvent.click(screen.getByTestId(`${testId}-button`));
    expect(
      (state.pendingExecute as ReturnType<typeof pendingExecuteResult>)
        .mutateAsync,
    ).toHaveBeenCalledWith({
      chainId: EVM,
      operationId: row.operation_id,
      caller: EVM_SCHEDULER,
      target: EVM_MINTER,
      expectedTarget: EVM_MINTER,
      paused: false,
      fn: "reverse_repay",
      argsXdr: null,
      calldata: row.calldata,
      targetKind: "minter",
    });
  });

  it("maps a Minter revert to the recovery copy", () => {
    setAccess(
      { immediate: false, delay: 86400 },
      { operationId: "ab", readyAt: 1_800_000_000 },
    );
    exec().error = new Error(
      "reverted: MinterInsufficientBankCash(uint256,uint256)",
    );
    renderDialog(vi.fn(), EVM);
    expect(
      screen.getByTestId("repayment-recovery-reverse-error"),
    ).toHaveTextContent(/bank cash/);
  });

  const EVM_WATERFALL = {
    senior_principal_returned: "345000000",
    senior_coupon_net: "1155000000",
    management_fee: "0",
    performance_fee: "0",
    oet_allocation: "0",
  };

  function readyStep2() {
    setEvmRows(true);
    setAccess({ immediate: true, delay: 0 }, null);
    state.financials = { data: { offtaker_outstanding: "150.000000" } };
    state.waterfall = { data: EVM_WATERFALL, error: null, isLoading: false };
    state.audit = {
      data: {
        items: [
          {
            chain_id: EVM,
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
  }

  it("enables step 2 on EVM once reversed, indexed, valued and the wallet can repay, and records with the chain id", () => {
    readyStep2();
    renderDialog(vi.fn(), EVM);
    expect(
      screen.queryByTestId("repayment-recovery-step2-blocked"),
    ).not.toBeInTheDocument();
    const button = screen.getByTestId("repayment-recovery-record");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(rec().mutateAsync).toHaveBeenCalledWith({
      loanId: 7,
      repayment: {
        offtaker_received: "1500000000",
        senior_principal_repaid: "345000000",
        senior_interest: "1155000000",
        equity_distributed: "0",
        mgmt_fee: "0",
        perf_fee: "0",
        oet_alloc: "0",
      },
      valueDate: 1_793_059_200,
      chainId: EVM,
    });
  });

  it("keeps step 2 blocked on EVM until the reversal is done", () => {
    readyStep2();
    setEvmRows(false);
    renderDialog(vi.fn(), EVM);
    expect(
      screen.getByTestId("repayment-recovery-step2-blocked"),
    ).toHaveTextContent("Reverse the repayment first.");
    expect(rec().mutateAsync).not.toHaveBeenCalled();
  });

  it("keeps the Stellar-only copy on step 2 for an unknown chain", () => {
    readyStep2();
    renderDialog(vi.fn(), 1234);
    expect(screen.getByTestId("repayment-recovery-record")).toBeDisabled();
    expect(
      screen.getByTestId("repayment-recovery-step2-blocked"),
    ).toHaveTextContent(/Stellar only/);
    expect(rec().mutateAsync).not.toHaveBeenCalled();
  });
});
