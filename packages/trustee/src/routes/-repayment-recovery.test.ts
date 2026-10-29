// spec: docs/frontend/trustee-flows.md#repayment-recovery-1711
import { describe, it, expect } from "vitest";
import type { MinterRepayment, RepaymentInput } from "@pipeline/wallet-connect";
import type { AuditLogItem } from "@/api/useAuditLog";
import type { RecoveryRow } from "@/api/useRepaymentRecovery";
import { buildRepaymentInput } from "./-record-repayment";
import {
  candidateRows,
  correctedRepaymentInput,
  defaultSelection,
  formatChainAmount,
  formatDelayHours,
  formatReadyAt,
  isRecoveryEligible,
  originalValueDate,
  preselectedRepaymentId,
  recoveryCardState,
  recoveryErrorCopy,
  reverseAction,
  reversalEffects,
  roleLine,
} from "./-repayment-recovery";

const STELLAR = 99_000_001;
const EVM = 560_048;

const SUSPECT: RepaymentInput = {
  offtaker_received: "1500000000000",
  senior_principal_repaid: "0",
  senior_interest: "1155000000000",
  equity_distributed: "345000000000",
  mgmt_fee: "0",
  perf_fee: "0",
  oet_alloc: "0",
};
const HEALTHY: RepaymentInput = {
  ...SUSPECT,
  senior_principal_repaid: "100",
  equity_distributed: "0",
};
const MINTER: MinterRepayment = {
  cash: "1155000000000",
  principal: "400",
  interestMinted: "1155000000000",
  feeShares: "345",
  carvedOut: false,
  saleId: 0,
  reversed: false,
};

function row(
  repaymentId: number,
  repayment: RepaymentInput,
  reversed = false,
): RecoveryRow {
  return { repaymentId, repayment, minter: MINTER, reversed };
}

describe("isRecoveryEligible", () => {
  const base = {
    offtakerOutstanding: "0",
    seniorOutstanding: "4800000",
    onchainStatus: "Performing",
  };

  it("is true for offtaker 0, senior > 0 and a live status", () => {
    expect(isRecoveryEligible(base)).toBe(true);
    expect(
      isRecoveryEligible({ ...base, offtakerOutstanding: "0.000000" }),
    ).toBe(true);
    expect(isRecoveryEligible({ ...base, onchainStatus: "Default" })).toBe(
      true,
    );
  });

  it("is false when the offtaker still owes, senior is 0, or the status is out of range", () => {
    expect(isRecoveryEligible({ ...base, offtakerOutstanding: "10" })).toBe(
      false,
    );
    expect(isRecoveryEligible({ ...base, seniorOutstanding: "0" })).toBe(false);
    expect(isRecoveryEligible({ ...base, seniorOutstanding: "0.000000" })).toBe(
      false,
    );
    expect(isRecoveryEligible({ ...base, onchainStatus: "Closed" })).toBe(
      false,
    );
    expect(isRecoveryEligible({ ...base, onchainStatus: "Approved" })).toBe(
      false,
    );
    expect(
      isRecoveryEligible({ ...base, offtakerOutstanding: undefined }),
    ).toBe(false);
  });
});

describe("recoveryCardState", () => {
  const base = {
    eligible: true,
    onchainStatus: "Performing",
    latestReversed: false,
    evmBlocked: false,
  };

  it("maps each state", () => {
    expect(recoveryCardState(base)).toBe("eligible");
    expect(recoveryCardState({ ...base, eligible: false })).toBe("hidden");
    expect(
      recoveryCardState({ ...base, eligible: false, latestReversed: true }),
    ).toBe("awaiting-corrected-repayment");
    expect(recoveryCardState({ ...base, evmBlocked: true })).toBe(
      "blocked-evm",
    );
    expect(
      recoveryCardState({ ...base, evmBlocked: true, eligible: false }),
    ).toBe("hidden");
    expect(recoveryCardState({ ...base, onchainStatus: "Closed" })).toBe(
      "hidden",
    );
  });
});

describe("candidateRows", () => {
  const rows = [
    row(0, HEALTHY),
    row(1, SUSPECT),
    row(2, SUSPECT, true),
    row(3, HEALTHY),
  ];

  it("drops reversed rows and lists suspected mis-splits first", () => {
    const out = candidateRows(rows, STELLAR);
    expect(out.map((r) => r.repaymentId)).toEqual([1, 0, 3]);
    expect(out[0]!.suspect).toBe(true);
    expect(out[1]!.suspect).toBe(false);
  });

  it("preselects the first suspect, or nothing", () => {
    expect(preselectedRepaymentId(candidateRows(rows, STELLAR))).toBe(1);
    expect(
      preselectedRepaymentId(candidateRows([row(0, HEALTHY)], STELLAR)),
    ).toBeNull();
  });

  it("formats raw units by the chain's decimals without rescaling", () => {
    const [first] = candidateRows([row(1, SUSPECT)], STELLAR);
    expect(first!.fields[0]).toEqual({
      label: "Offtaker received",
      value: "$150,000.00",
    });
    const [evm] = candidateRows([row(1, SUSPECT)], EVM);
    expect(evm!.fields[0]!.value).toBe("$1,500,000.00");
  });
});

describe("defaultSelection", () => {
  it("selects the latest reversed repayment when awaiting the corrected one", () => {
    expect(
      defaultSelection([row(0, HEALTHY), row(1, SUSPECT, true)], STELLAR),
    ).toBe(1);
  });

  it("selects the first suspect otherwise", () => {
    expect(defaultSelection([row(0, HEALTHY), row(1, SUSPECT)], STELLAR)).toBe(
      1,
    );
    expect(defaultSelection([], STELLAR)).toBeNull();
  });
});

describe("formatChainAmount", () => {
  it("keeps the served fractional digits", () => {
    expect(formatChainAmount("12345678", STELLAR)).toBe("$1.2345678");
    expect(formatChainAmount("12345678", EVM)).toBe("$12.345678");
    expect(formatChainAmount("x", STELLAR)).toBe("—");
  });
});

describe("reversalEffects", () => {
  it("lists cash, fee shares and the vault interest for a non-carved-out loan", () => {
    expect(reversalEffects(MINTER, STELLAR)).toEqual([
      { label: "Cash removed from bank", value: "$115,500.00" },
      { label: "Treasury fee shares burned", value: "345" },
      { label: "Interest absorbed from the vault", value: "$115,500.00" },
    ]);
  });

  it("lists the Pocket principal and interest for a carved-out loan, nothing summed", () => {
    const effects = reversalEffects(
      { ...MINTER, carvedOut: true, principal: "10000000" },
      STELLAR,
    );
    expect(effects[2]).toEqual({
      label: "Pocket unrelease: principal / interest",
      value: "$1.00 / $115,500.00",
    });
    expect(effects).toHaveLength(3);
  });
});

describe("reverseAction", () => {
  const none = { operationId: "ab", readyAt: 0 };

  it("executes at once when can_call is immediate", () => {
    expect(reverseAction({ immediate: true, delay: 0 }, undefined)).toBe(
      "execute-now",
    );
  });

  it("schedules on a delayed deployment, then executes once scheduled", () => {
    const delayed = { immediate: false, delay: 86400 };
    expect(reverseAction(delayed, none)).toBe("schedule");
    expect(
      reverseAction(delayed, { operationId: "ab", readyAt: 1_800_000_000 }),
    ).toBe("execute-scheduled");
    expect(reverseAction(delayed, undefined)).toBeNull();
  });

  it("reports no-role for a non-member wallet and null while loading", () => {
    expect(reverseAction({ immediate: false, delay: 0 }, undefined)).toBe(
      "no-role",
    );
    expect(reverseAction(undefined, undefined)).toBeNull();
  });
});

describe("role copy", () => {
  it("renders the delay and ready time verbatim", () => {
    expect(formatDelayHours(86400)).toBe("24 h");
    expect(formatReadyAt(1_800_000_000)).toBe("2027-01-15 08:00 UTC");
    expect(roleLine("schedule", 86400, null)).toContain("24 h");
    expect(roleLine("execute-scheduled", 86400, 1_800_000_000)).toContain(
      "2027-01-15 08:00 UTC",
    );
    expect(roleLine("no-role", null, null)).toBe(
      "Only the Risk Council can reverse a repayment.",
    );
    expect(roleLine("execute-now", 0, null)).toContain("at once");
  });
});

describe("recoveryErrorCopy", () => {
  it("maps the AccessManager and Minter codes for the relay step", () => {
    const err = (n: number) =>
      `execute simulation error: Error(Contract, #${n})`;
    expect(recoveryErrorCopy("execute", err(7))).toMatch(/not ready/);
    expect(recoveryErrorCopy("execute", err(6))).toMatch(/Schedule it first/);
    expect(recoveryErrorCopy("execute", err(8))).toMatch(/expired/);
    expect(recoveryErrorCopy("execute", err(25))).toMatch(/already reversed/);
    expect(recoveryErrorCopy("schedule", "Error(Contract, #9)")).toMatch(
      /already scheduled/,
    );
    expect(recoveryErrorCopy("execute", err(99))).toBeNull();
    expect(recoveryErrorCopy("execute", "boom")).toBeNull();
  });
});

describe("originalValueDate", () => {
  const item = (over: Partial<AuditLogItem> = {}): AuditLogItem => ({
    chain_id: STELLAR,
    timestamp: "2026-10-01T00:00:00Z",
    action: "Cash repaid",
    scope: { loan_id: "7", label: "Loan #7" },
    reference: "",
    event_name: "CashRepaid",
    details: { repayment_id: "1", value_date: 1_793_059_200 },
    ...over,
  });

  it("finds the CashRepaid value date for the repayment", () => {
    expect(originalValueDate([item()], STELLAR, "7", 1)).toBe(1_793_059_200);
    expect(
      originalValueDate(
        [item({ details: { repayment_id: 1, value_date: "1793059200" } })],
        STELLAR,
        "7",
        1,
      ),
    ).toBe(1_793_059_200);
  });

  it("returns null when missing or for another repayment, loan or chain", () => {
    expect(originalValueDate([item()], STELLAR, "7", 2)).toBeNull();
    expect(originalValueDate([item()], STELLAR, "8", 1)).toBeNull();
    expect(originalValueDate([item()], EVM, "7", 1)).toBeNull();
    expect(originalValueDate(undefined, STELLAR, "7", 1)).toBeNull();
    expect(
      originalValueDate(
        [item({ event_name: "CashRepaymentReversed" })],
        STELLAR,
        "7",
        1,
      ),
    ).toBeNull();
    expect(
      originalValueDate(
        [item({ details: { repayment_id: 1 } })],
        STELLAR,
        "7",
        1,
      ),
    ).toBeNull();
  });
});

describe("correctedRepaymentInput", () => {
  it("equals buildRepaymentInput at the original offtaker_received", () => {
    const waterfall = {
      senior_principal_returned: "400",
      senior_coupon_net: "1155000000000",
      management_fee: "1",
      performance_fee: "2",
      oet_allocation: "3",
    };
    expect(correctedRepaymentInput(SUSPECT, waterfall)).toEqual(
      buildRepaymentInput(SUSPECT.offtaker_received, waterfall),
    );
    expect(correctedRepaymentInput(SUSPECT, undefined)).toBeNull();
  });
});
