// spec: docs/frontend/trustee-flows.md#risk-council-pending-operations
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ExecutedOperation, ScheduledOp } from "@/lib/riskCouncilOps";
import {
  HASH_A,
  HASH_B,
  OPERATION_ID,
  READY_AT,
  SCHEDULER,
  SECONDS_PER_WEEK,
  SECURITY_REGISTRY,
  SET_TERMS_ARGS,
  STELLAR,
  OTHER_CHAIN,
  LOAN_REGISTRY,
  LOAN_REGISTRY_ARGS,
  MINTER,
  loanRegistryOp,
  minterOp,
  pendingOp,
} from "./-riskCouncilFixtures";

const mocks = vi.hoisted(() => ({
  wallet: { address: "GSCHEDULERADDRESS1234567890ABCD" as string | null },
  execute: vi.fn(),
}));

vi.mock("@pipeline/wallet-connect", () => ({
  FLAG_OUTCOMES: ["Accepted", "TopUpRequired", "Escalated"],
  SECURITY_PAYMENT_TERMS: ["Lc", "Dp", "Da", "OpenAccount"],
  useStellarWallet: () => ({ address: mocks.wallet.address }),
}));
vi.mock("@/api/useRiskCouncil", async () => {
  const actual = await vi.importActual<typeof import("@/api/useRiskCouncil")>(
    "@/api/useRiskCouncil",
  );
  return { ...actual, usePendingOperationExecute: () => mocks.execute() };
});

import {
  NoLongerScheduledError,
  PendingArgsMismatchError,
  PendingTargetMismatchError,
  RegistryPausedError,
} from "@/api/useRiskCouncil";
import {
  callerText,
  decodeLoanRegistryCall,
  decodePendingCall,
  decodeReverseRepayCall,
  decodeSecurityCall,
  fromServed,
  fromSession,
  mergePendingOps,
  pendingActionLabel,
  pendingArgRows,
  pendingOwner,
  pendingStateText,
  SET_TERMS_PENDING_NOTICE,
  usePendingOperationView,
} from "./-risk-council-pending";

const RESOLVE_ARGS = [3, ["Accepted"], HASH_A];
const RELEASE_ARGS = [3, HASH_B];

function sessionOp(overrides: Partial<ScheduledOp> = {}): ScheduledOp {
  return {
    chainId: STELLAR,
    call: { fn: "release_with_consent", recordId: 3, consentHash: HASH_B },
    loanId: 7,
    scheduledAt: 0,
    executedHere: false,
    operationId: "11".repeat(32),
    readyAt: READY_AT,
    caller: SCHEDULER,
    target: SECURITY_REGISTRY,
    argsXdr: "AAAA",
    ...overrides,
  };
}

function termsArgs(patch: Record<string, unknown>) {
  return [7, { ...(SET_TERMS_ARGS[1] as object), ...patch }];
}

beforeEach(() => {
  mocks.wallet.address = SCHEDULER;
  mocks.execute.mockReset();
  mocks.execute.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ hash: "H" }),
    isPending: false,
    error: null,
    hash: null,
    stage: null,
    reset: vi.fn(),
  });
});

describe("decodeSecurityCall", () => {
  it("decodes set_terms", () => {
    expect(decodeSecurityCall("set_terms", SET_TERMS_ARGS)).toEqual({
      fn: "set_terms",
      loanId: 7,
      terms: {
        advanceRatioBps: 7000,
        marginCallRatioBps: 8250,
        curePeriod: "604800",
        priceStaleAfter: "86400",
        paymentTerm: "Lc",
        gracePeriod: "259200",
        defaultRate: 20000,
        attestationInterval: "2592000",
        inspectionInterval: "0",
        toleranceBps: 50,
        gradeToleranceBps: 25,
      },
    });
  });

  it("decodes resolve_flag and release_with_consent", () => {
    expect(decodeSecurityCall("resolve_flag", RESOLVE_ARGS)).toEqual({
      fn: "resolve_flag",
      recordId: 3,
      outcome: "Accepted",
      reasonHash: HASH_A,
    });
    expect(decodeSecurityCall("release_with_consent", RELEASE_ARGS)).toEqual({
      fn: "release_with_consent",
      recordId: 3,
      consentHash: HASH_B,
    });
  });

  it.each([
    ["not an array", "set_terms", {}],
    ["wrong arity", "set_terms", [7]],
    ["string loan id", "set_terms", ["7", SET_TERMS_ARGS[1]]],
    ["negative u32", "set_terms", termsArgs({ default_rate: -1 })],
    ["float u32", "set_terms", termsArgs({ default_rate: 1.5 })],
    ["u32 above range", "set_terms", termsArgs({ default_rate: 2 ** 32 })],
    ["numeric u64", "set_terms", termsArgs({ cure_period: 604800 })],
    ["non-decimal u64", "set_terms", termsArgs({ cure_period: "7d" })],
    ["unknown payment term", "set_terms", termsArgs({ payment_term: ["Xx"] })],
    ["bare payment term", "set_terms", termsArgs({ payment_term: "Lc" })],
    [
      "non-zero margin_call_at",
      "set_terms",
      termsArgs({ margin_call_at: "5" }),
    ],
    ["extra key", "set_terms", termsArgs({ extra: 1 })],
    [
      "missing key",
      "set_terms",
      [7, { ...(SET_TERMS_ARGS[1] as object), tolerance_bps: undefined }],
    ],
    ["unknown outcome", "resolve_flag", [3, ["Nope"], HASH_A]],
    ["short hash", "resolve_flag", [3, ["Accepted"], "ab".repeat(31) + "a"]],
    ["upper-case hash", "release_with_consent", [3, "AB".repeat(32)]],
    ["extra arg", "release_with_consent", [3, HASH_B, 1]],
    ["set_inspectors", "set_inspectors", [["GABC"]]],
    ["unknown function", "pause", []],
  ])("returns null for %s", (_name, fn, args) => {
    expect(decodeSecurityCall(fn, args)).toBeNull();
  });
});

describe("fromServed", () => {
  it("maps times, state and the decoded call", () => {
    const item = fromServed(pendingOp({ state: "waiting" }));
    expect(item).toMatchObject({
      key: OPERATION_ID,
      operationId: OPERATION_ID,
      caller: SCHEDULER,
      target: SECURITY_REGISTRY,
      fn: "set_terms",
      readyAt: READY_AT,
      expiresAt: READY_AT + SECONDS_PER_WEEK,
      state: "waiting",
      source: "indexed",
      loanId: 7,
    });
    expect(item.call?.fn).toBe("set_terms");
  });

  it("keeps the raw args when they do not decode", () => {
    const item = fromServed(pendingOp({ args: [1, 2, 3] }));
    expect(item.call).toBeNull();
    expect(item.rawArgs).toEqual([1, 2, 3]);
    expect(item.loanId).toBeNull();
  });
});

describe("pendingActionLabel", () => {
  it("labels the supported functions", () => {
    expect(pendingActionLabel(fromServed(pendingOp()))).toBe("Set terms");
    expect(
      pendingActionLabel(
        fromServed(pendingOp({ function: "resolve_flag", args: RESOLVE_ARGS })),
      ),
    ).toBe("Resolve flag · record #3");
    expect(
      pendingActionLabel(
        fromServed(
          pendingOp({ function: "release_with_consent", args: RELEASE_ARGS }),
        ),
      ),
    ).toBe("Release with consent · record #3");
  });

  it("reads the record number from undecodable args and falls back to the function name", () => {
    expect(
      pendingActionLabel(
        fromServed(pendingOp({ function: "resolve_flag", args: [5, "bad"] })),
      ),
    ).toBe("Resolve flag · record #5");
    expect(
      pendingActionLabel(
        fromServed(pendingOp({ function: "resolve_flag", args: "bad" })),
      ),
    ).toBe("Resolve flag");
    expect(
      pendingActionLabel(
        fromServed(pendingOp({ function: "set_inspectors", args: [[]] })),
      ),
    ).toBe("set_inspectors");
  });
});

describe("pendingArgRows", () => {
  it("shows set_terms in the form's units", () => {
    const rows = Object.fromEntries(
      pendingArgRows(fromServed(pendingOp()), STELLAR).map((r) => [
        r.label,
        r.value,
      ]),
    );
    expect(rows).toMatchObject({
      "Advance ratio": "70%",
      "Margin call ratio": "82.5%",
      "Cure period": "7 d",
      "Price stale after": "1 d",
      "Payment term": "Letter of credit (Lc)",
      "Grace period": "3 d",
      "Default rate": "2%",
      "Attestation interval": "30 d",
      "Inspection interval": "0 s",
      "Quantity tolerance": "0.5%",
      "Grade tolerance": "0.25%",
    });
  });

  it("shows hours and seconds when a duration is not whole days", () => {
    const rows = Object.fromEntries(
      pendingArgRows(
        fromServed(
          pendingOp({
            args: termsArgs({ price_stale_after: "7200", cure_period: "90" }),
          }),
        ),
        STELLAR,
      ).map((r) => [r.label, r.value]),
    );
    expect(rows["Price stale after"]).toBe("2 h");
    expect(rows["Cure period"]).toBe("90 s");
  });

  it("shows the outcome and shortened hashes", () => {
    expect(
      pendingArgRows(
        fromServed(pendingOp({ function: "resolve_flag", args: RESOLVE_ARGS })),
        STELLAR,
      ),
    ).toEqual([
      { label: "Outcome", value: "Accepted" },
      { label: "Reason hash", value: "cdcdcdcdcd…" },
    ]);
    expect(
      pendingArgRows(
        fromServed(
          pendingOp({ function: "release_with_consent", args: RELEASE_ARGS }),
        ),
        STELLAR,
      ),
    ).toEqual([{ label: "Consent hash", value: "efefefefef…" }]);
  });

  it("falls back to one raw JSON row", () => {
    expect(
      pendingArgRows(
        fromServed(pendingOp({ args: [9, { weird: true }] })),
        STELLAR,
      ),
    ).toEqual([{ label: "Arguments", value: '[9,{"weird":true}]' }]);
  });
});

const RATE_ARGS = LOAN_REGISTRY_ARGS.amend_economics;

describe("decodeLoanRegistryCall", () => {
  it("decodes every reference shape", () => {
    expect(decodeLoanRegistryCall("set_default", [7])).toEqual({
      fn: "set_default",
      loanId: 7,
    });
    expect(decodeLoanRegistryCall("cure", [7])).toEqual({
      fn: "cure",
      loanId: 7,
    });
    expect(decodeLoanRegistryCall("amend_economics", RATE_ARGS)).toEqual({
      fn: "amend_economics",
      loanId: 7,
      rateBps: 1450,
      maturity: 1_816_128_000,
    });
    expect(
      decodeLoanRegistryCall("adjust_interest", [7, "-1000000", HASH_A]),
    ).toEqual({
      fn: "adjust_interest",
      loanId: 7,
      delta: "-1000000",
      reasonHash: HASH_A,
    });
    expect(decodeLoanRegistryCall("write_down", [7, "5000000"])).toEqual({
      fn: "write_down",
      loanId: 7,
      amount: "5000000",
    });
    expect(
      decodeLoanRegistryCall("close_defaulted", [7, ["OtherWriteDown"]]),
    ).toEqual({ fn: "close_defaulted", loanId: 7, reason: "OtherWriteDown" });
  });

  it.each([
    ["rate not a multiple of 100", "amend_economics", [7, 145_050, "100"]],
    ["rate zero", "amend_economics", [7, 0, "100"]],
    ["rate above 1 000 000", "amend_economics", [7, 1_000_100, "100"]],
    ["zero maturity", "amend_economics", [7, 145_000, "0"]],
    ["numeric maturity", "amend_economics", [7, 145_000, 100]],
    ["unsafe maturity", "amend_economics", [7, 145_000, "9".repeat(20)]],
    ["non-decimal amount", "write_down", [7, "5.5"]],
    ["negative amount", "write_down", [7, "-5"]],
    ["non-numeric delta", "adjust_interest", [7, "1e5", HASH_A]],
    ["63-hex reason hash", "adjust_interest", [7, "5", "ab".repeat(31) + "a"]],
    ["unknown variant", "close_defaulted", [7, ["Nope"]]],
    ["bare variant", "close_defaulted", [7, "Default"]],
    ["wrong length", "set_default", [7, 1]],
    ["string loan id", "cure", ["7"]],
    ["not an array", "cure", {}],
    ["unknown function", "pause", [7]],
  ])("returns null for %s", (_name, fn, args) => {
    expect(decodeLoanRegistryCall(fn, args)).toBeNull();
  });
});

describe("decodeReverseRepayCall and decodePendingCall", () => {
  it("decodes reverse_repay", () => {
    expect(decodeReverseRepayCall("reverse_repay", [3, 2, HASH_B])).toEqual({
      fn: "reverse_repay",
      loanId: 3,
      repaymentId: 2,
      refHash: HASH_B,
    });
  });

  it.each([
    ["63-hex hash", [3, 2, "cd".repeat(31) + "c"]],
    ["wrong length", [3, 2]],
    ["string repayment id", [3, "2", HASH_B]],
  ])("rejects reverse_repay with %s", (_name, args) => {
    expect(decodeReverseRepayCall("reverse_repay", args)).toBeNull();
  });

  it("dispatches on the function name across the three contracts", () => {
    expect(decodePendingCall("set_terms", SET_TERMS_ARGS)?.fn).toBe(
      "set_terms",
    );
    expect(decodePendingCall("write_down", [3, "5"])?.fn).toBe("write_down");
    expect(decodePendingCall("reverse_repay", [3, 2, HASH_B])?.fn).toBe(
      "reverse_repay",
    );
    expect(decodePendingCall("set_inspectors", [[]])).toBeNull();
  });
});

describe("fromServed and fromSession for LoanRegistry and Minter rows", () => {
  it("takes the target kind from the served value and decodes the call", () => {
    const item = fromServed(loanRegistryOp("amend_economics"));
    expect(item).toMatchObject({
      targetKind: "loan_registry",
      target: LOAN_REGISTRY,
      loanId: 7,
    });
    expect(item.call).toMatchObject({ fn: "amend_economics", rateBps: 1450 });
    expect(fromServed(minterOp())).toMatchObject({
      targetKind: "minter",
      target: MINTER,
      loanId: 7,
    });
  });

  it("prefers the loan id argument over the call", () => {
    expect(fromServed(loanRegistryOp("cure"), 9).loanId).toBe(9);
    expect(fromServed(loanRegistryOp("cure"), null).loanId).toBe(7);
    expect(fromServed(pendingOp({ args: [1, 2, 3] })).loanId).toBeNull();
  });

  it("derives the loan id and the target kind of a LoanRegistry session op from its call", () => {
    const item = fromSession(
      sessionOp({
        call: { fn: "write_down", loanId: 7, amount: "5" },
        loanId: undefined,
      }),
      READY_AT,
    )!;
    expect(item).toMatchObject({ loanId: 7, targetKind: "loan_registry" });
    expect(fromSession(sessionOp(), READY_AT)!.targetKind).toBe(
      "security_registry",
    );
  });
});

describe("pendingOwner", () => {
  it.each([
    ["set_default", "escalate"],
    ["amend_economics", "reterm"],
    ["adjust_interest", "reterm"],
    ["write_down", "writedown"],
    ["close_defaulted", "writedown"],
    ["cure", "writedown"],
    ["set_terms", "security"],
    ["resolve_flag", "security"],
    ["release_with_consent", "security"],
    ["reverse_repay", "recovery"],
  ])("maps %s to %s", (fn, owner) => {
    expect(pendingOwner(fn)).toBe(owner);
  });

  it("has no owner for set_inspectors or unknown functions", () => {
    expect(pendingOwner("set_inspectors")).toBeNull();
    expect(pendingOwner("pause")).toBeNull();
    expect(pendingOwner("constructor")).toBeNull();
  });
});

describe("labels and rows for the LoanRegistry and Minter functions", () => {
  const rows = (item: ReturnType<typeof fromServed>) =>
    pendingArgRows(item, STELLAR).map((r) => [r.label, r.value]);

  it("labels the seven new functions", () => {
    const labels = [
      "set_default",
      "cure",
      "amend_economics",
      "adjust_interest",
      "write_down",
      "close_defaulted",
    ].map((fn) =>
      pendingActionLabel(
        fromServed(loanRegistryOp(fn as keyof typeof LOAN_REGISTRY_ARGS)),
      ),
    );
    expect(labels).toEqual([
      "Declare default",
      "Cure",
      "Amend economics",
      "Adjust interest",
      "Write down",
      "Close defaulted loan",
    ]);
    expect(pendingActionLabel(fromServed(minterOp()))).toBe(
      "Reverse repayment · repayment #2",
    );
    expect(
      pendingActionLabel(fromServed(minterOp({ args: [7, 5, "bad"] }))),
    ).toBe("Reverse repayment · repayment #5");
    expect(pendingActionLabel(fromServed(minterOp({ args: "bad" })))).toBe(
      "Reverse repayment",
    );
  });

  it("shows no argument rows for set_default and cure", () => {
    expect(rows(fromServed(loanRegistryOp("set_default")))).toEqual([]);
    expect(rows(fromServed(loanRegistryOp("cure")))).toEqual([]);
  });

  it("shows the rate in percent and bps and the maturity date", () => {
    expect(rows(fromServed(loanRegistryOp("amend_economics")))).toEqual([
      ["New rate", "14.5% (1450 bps)"],
      ["New maturity", "21 Jul 2027"],
    ]);
  });

  it("shows a signed delta and a shortened reason hash", () => {
    expect(rows(fromServed(loanRegistryOp("adjust_interest")))).toEqual([
      ["Delta", "-$0.10"],
      ["Reason hash", "ababababab…"],
    ]);
  });

  it("shows the write-down amount and the closure reason", () => {
    expect(rows(fromServed(loanRegistryOp("write_down")))).toEqual([
      ["Amount", "$0.50"],
    ]);
    expect(rows(fromServed(loanRegistryOp("close_defaulted")))).toEqual([
      ["Closure reason", "Other write-down"],
    ]);
  });

  it("shows the repayment number and a shortened reference hash", () => {
    expect(rows(fromServed(minterOp()))).toEqual([
      ["Repayment", "#2"],
      ["Reference hash", "cdcdcdcdcd…"],
    ]);
  });

  it("falls back to the raw JSON row for an undecodable LoanRegistry shape", () => {
    expect(
      rows(fromServed(loanRegistryOp("write_down", { args: [7, 5] }))),
    ).toEqual([["Arguments", "[7,5]"]]);
  });
});

describe("pendingStateText", () => {
  it("formats the three states in UTC", () => {
    expect(pendingStateText(fromServed(pendingOp({ state: "waiting" })))).toBe(
      "Waiting · executable from 2027-01-15 08:00 UTC",
    );
    expect(pendingStateText(fromServed(pendingOp({ state: "ready" })))).toBe(
      "Ready · expires 2027-01-22 08:00 UTC",
    );
    expect(pendingStateText(fromServed(pendingOp({ state: "expired" })))).toBe(
      "Expired — schedule it again",
    );
  });
});

describe("callerText", () => {
  it("marks the connected wallet", () => {
    const item = fromServed(pendingOp());
    expect(callerText(item, SCHEDULER)).toBe("GSCHED…ABCD · this wallet");
    expect(callerText(item, "GOTHER")).toBe("GSCHED…ABCD");
    expect(callerText(item, undefined)).toBe("GSCHED…ABCD");
  });
});

describe("fromSession", () => {
  it("derives the state from the local clock", () => {
    const at = (now: number) => fromSession(sessionOp(), now)!.state;
    expect(at(READY_AT - 1)).toBe("waiting");
    expect(at(READY_AT)).toBe("ready");
    expect(at(READY_AT + SECONDS_PER_WEEK - 1)).toBe("ready");
    expect(at(READY_AT + SECONDS_PER_WEEK)).toBe("expired");
  });

  it("requires every chain field", () => {
    expect(fromSession(sessionOp({ operationId: undefined }), 0)).toBeNull();
    expect(fromSession(sessionOp({ readyAt: 0 }), 0)).toBeNull();
    expect(fromSession(sessionOp({ readyAt: undefined }), 0)).toBeNull();
    expect(fromSession(sessionOp({ caller: undefined }), 0)).toBeNull();
    expect(fromSession(sessionOp({ target: undefined }), 0)).toBeNull();
    expect(fromSession(sessionOp({ argsXdr: undefined }), 0)).toBeNull();
  });

  it("builds an item from the stored call", () => {
    const item = fromSession(sessionOp(), READY_AT)!;
    expect(item).toMatchObject({
      source: "session",
      fn: "release_with_consent",
      loanId: 7,
      expiresAt: READY_AT + SECONDS_PER_WEEK,
    });
    expect(pendingActionLabel(item)).toBe("Release with consent · record #3");
  });
});

function executedMap(
  entry: Partial<ExecutedOperation> & { operationId: string },
): ReadonlyMap<string, ExecutedOperation> {
  return new Map([
    [entry.operationId, { hash: "EH", readyAt: null, executedAt: 0, ...entry }],
  ]);
}

describe("mergePendingOps", () => {
  const base = {
    session: [] as ScheduledOp[],
    executed: new Map<string, ExecutedOperation>(),
    everServed: new Set<string>(),
    chainId: STELLAR,
    loanId: 7,
    nowSec: READY_AT,
  };

  it("returns served rows", () => {
    const items = mergePendingOps({ ...base, served: [pendingOp()] });
    expect(items.map((i) => i.operationId)).toEqual([OPERATION_ID]);
  });

  it("adds a session row that is not served yet", () => {
    const items = mergePendingOps({
      ...base,
      served: [],
      session: [sessionOp()],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("session");
  });

  it("drops a session row whose id was served earlier and is no longer served", () => {
    const items = mergePendingOps({
      ...base,
      served: [],
      session: [sessionOp()],
      everServed: new Set(["11".repeat(32)]),
    });
    expect(items).toEqual([]);
  });

  it("keeps a session row whose id was never served", () => {
    const items = mergePendingOps({
      ...base,
      served: [],
      session: [sessionOp()],
      everServed: new Set(["99".repeat(32)]),
    });
    expect(items).toHaveLength(1);
  });

  it("drops the session row once the API serves the same id", () => {
    const id = "11".repeat(32);
    const items = mergePendingOps({
      ...base,
      served: [pendingOp({ operation_id: id })],
      session: [sessionOp({ operationId: id })],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("indexed");
  });

  it("keeps executed rows visible with their hash while the API still serves them", () => {
    const keepId = "22".repeat(32);
    const items = mergePendingOps({
      ...base,
      served: [pendingOp(), pendingOp({ operation_id: keepId })],
      executed: executedMap({ operationId: OPERATION_ID, readyAt: READY_AT }),
    });
    expect(items.map((i) => [i.operationId, i.executed])).toEqual([
      [keepId, null],
      [OPERATION_ID, { hash: "EH" }],
    ]);
  });

  it("marks an executed session row", () => {
    const sessionId = "11".repeat(32);
    const items = mergePendingOps({
      ...base,
      served: [],
      session: [sessionOp({ operationId: sessionId, executedHere: true })],
      executed: executedMap({ operationId: sessionId, readyAt: READY_AT }),
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.executed).toEqual({ hash: "EH" });
  });

  it("drops an executed session row that has no executed record", () => {
    const items = mergePendingOps({
      ...base,
      served: [],
      session: [sessionOp({ executedHere: true })],
    });
    expect(items).toEqual([]);
  });

  it("shows a re-scheduled operation with the same id but another ready time", () => {
    const items = mergePendingOps({
      ...base,
      served: [
        pendingOp({
          ready_at: new Date((READY_AT + 500) * 1000).toISOString(),
        }),
      ],
      executed: executedMap({ operationId: OPERATION_ID, readyAt: READY_AT }),
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.executed).toBeNull();
  });

  it("matches an executed record without a ready time by id alone", () => {
    const items = mergePendingOps({
      ...base,
      served: [pendingOp()],
      executed: executedMap({ operationId: OPERATION_ID, readyAt: null }),
    });
    expect(items[0]!.executed).toEqual({ hash: "EH" });
  });

  it("lists operations of every contract and stamps the given loan id", () => {
    const items = mergePendingOps({
      ...base,
      served: [pendingOp(), loanRegistryOp("set_default"), minterOp()],
    });
    expect(items.map((i) => [i.fn, i.targetKind, i.loanId])).toEqual(
      expect.arrayContaining([
        ["set_terms", "security_registry", 7],
        ["set_default", "loan_registry", 7],
        ["reverse_repay", "minter", 7],
      ]),
    );
    expect(items).toHaveLength(3);
  });

  it("de-duplicates served lists from two sources, keeping the first copy", () => {
    const first = pendingOp({ args_xdr: "FIRST" });
    const second = pendingOp({ args_xdr: "SECOND" });
    const items = mergePendingOps({ ...base, served: [first, second] });
    expect(items).toHaveLength(1);
    expect(items[0]!.argsXdr).toBe("FIRST");
  });

  it("shows a LoanRegistry session row of the loan taken from its call", () => {
    const items = mergePendingOps({
      ...base,
      served: [],
      session: [
        sessionOp({
          call: { fn: "write_down", loanId: 7, amount: "5" },
          loanId: undefined,
          target: LOAN_REGISTRY,
        }),
        sessionOp({
          operationId: "22".repeat(32),
          call: { fn: "write_down", loanId: 8, amount: "5" },
          loanId: undefined,
          target: LOAN_REGISTRY,
        }),
      ],
    });
    expect(items.map((i) => [i.fn, i.loanId, i.targetKind])).toEqual([
      ["write_down", 7, "loan_registry"],
    ]);
  });

  it("ignores session rows of another chain or loan or without an id", () => {
    const items = mergePendingOps({
      ...base,
      served: [],
      session: [
        sessionOp({ chainId: OTHER_CHAIN }),
        sessionOp({ loanId: 8 }),
        sessionOp({ loanId: undefined }),
        sessionOp({ operationId: undefined }),
        sessionOp({ readyAt: 0 }),
      ],
    });
    expect(items).toEqual([]);
    expect(
      mergePendingOps({
        ...base,
        loanId: null,
        served: [],
        session: [sessionOp()],
      }),
    ).toEqual([]);
  });

  it("sorts by ready time, then by operation id", () => {
    const items = mergePendingOps({
      ...base,
      served: [
        pendingOp({ operation_id: "bb".repeat(32) }),
        pendingOp({
          operation_id: "ff".repeat(32),
          ready_at: new Date((READY_AT - 10) * 1000).toISOString(),
        }),
        pendingOp({ operation_id: "aa".repeat(32) }),
      ],
    });
    expect(items.map((i) => i.operationId)).toEqual([
      "ff".repeat(32),
      "aa".repeat(32),
      "bb".repeat(32),
    ]);
  });
});

describe("usePendingOperationView", () => {
  function view(
    overrides: Partial<Parameters<typeof usePendingOperationView>[0]> = {},
    served = {},
  ) {
    return renderHook(() =>
      usePendingOperationView({
        chainId: STELLAR,
        item: fromServed(pendingOp(served)),
        executeGate: null,
        expectedTarget: SECURITY_REGISTRY,
        ...overrides,
      }),
    ).result.current;
  }

  it("enables Execute only for a ready row of the connected scheduler", () => {
    const v = view();
    expect(v.disabled).toBe(false);
    expect(v.buttonLabel).toBe("Execute");
    expect(v.roleLine).toBe("Ready · expires 2027-01-22 08:00 UTC");
    expect(v.notice).toBeNull();
    expect(v.chip).toBeNull();
  });

  it("disables waiting and expired rows", () => {
    expect(view({}, { state: "waiting" }).disabled).toBe(true);
    expect(view({}, { state: "expired" }).disabled).toBe(true);
  });

  it("shows the other-wallet copy for another or no wallet", () => {
    mocks.wallet.address = "GOTHERWALLETADDRESS1234567890XYZ";
    const other = view();
    expect(other.disabled).toBe(true);
    expect(other.notice).toBe(
      "Only the scheduling wallet (GSCHED…ABCD) can execute this.",
    );
    mocks.wallet.address = null;
    expect(view().disabled).toBe(true);
    expect(view().notice).toMatch(/Only the scheduling wallet/);
  });

  it("blocks on a paused registry only for a ready row", () => {
    const paused = view({ executeGate: "paused" });
    expect(paused.disabled).toBe(true);
    expect(paused.notice).toBe("paused");
    expect(view({ executeGate: "paused" }, { state: "waiting" }).notice).toBe(
      null,
    );
  });

  it("blocks a row that targets another registry", () => {
    const v = view({}, { target: "COTHERREGISTRY1234567890XYZ" });
    expect(v.disabled).toBe(true);
    expect(v.notice).toBe(
      "This operation targets another SecurityRegistry (COTHER…0XYZ) than this console is configured for.",
    );
  });

  it("blocks on an EVM chain", () => {
    const v = view({ chainId: OTHER_CHAIN });
    expect(v.disabled).toBe(true);
    expect(v.notice).not.toBeNull();
  });

  it("disables while an execute is in flight", () => {
    mocks.execute.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
      error: null,
      hash: null,
      stage: "submitting",
      reset: vi.fn(),
    });
    const v = view();
    expect(v.disabled).toBe(true);
    expect(v.pending).toBe(true);
    expect(v.stageText).toBe("Submitting on-chain…");
  });

  it("runs with the served arguments verbatim", () => {
    const mutateAsync = vi.fn().mockResolvedValue({ hash: "H" });
    mocks.execute.mockReturnValue({
      mutateAsync,
      isPending: false,
      error: null,
      hash: null,
      stage: null,
      reset: vi.fn(),
    });
    view({}, { args_xdr: "SERVEDXDR" }).run();
    expect(mutateAsync).toHaveBeenCalledWith({
      chainId: STELLAR,
      operationId: OPERATION_ID,
      caller: SCHEDULER,
      target: SECURITY_REGISTRY,
      expectedTarget: SECURITY_REGISTRY,
      paused: false,
      fn: "set_terms",
      argsXdr: "SERVEDXDR",
    });
  });

  it("passes the paused flag to the hook", () => {
    const mutateAsync = vi.fn().mockResolvedValue({ hash: "H" });
    mocks.execute.mockReturnValue({
      mutateAsync,
      isPending: false,
      error: null,
      hash: null,
      stage: null,
      reset: vi.fn(),
    });
    view({ executeGate: "paused" }).run();
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ paused: true }),
    );
  });

  it("shows an executed row with its hash and a disabled button", () => {
    const item = {
      ...fromServed(pendingOp()),
      executed: { hash: "EXECHASH" },
    };
    const v = view({ item });
    expect(v.disabled).toBe(true);
    expect(v.roleLine).toBe("Executed");
    expect(v.hash).toBe("EXECHASH");
    expect(v.notice).toBeNull();
  });

  function withError(error: Error) {
    mocks.execute.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      error,
      hash: null,
      stage: null,
      reset: vi.fn(),
    });
  }

  it("maps a no-longer-scheduled error to its own line", () => {
    withError(new NoLongerScheduledError());
    const v = view();
    expect(v.noLongerScheduled).toMatch(/No longer scheduled/);
    expect(v.error).toBeNull();
  });

  it("maps an argument mismatch", () => {
    withError(new PendingArgsMismatchError());
    expect(view().error?.message).toMatch(/do not match this operation/);
  });

  it("maps the hook's target and paused guards", () => {
    withError(new PendingTargetMismatchError("COTHERREGISTRY1234567890XYZ"));
    expect(view().error?.message).toBe(
      "This operation targets another SecurityRegistry (COTHER…0XYZ) than this console is configured for.",
    );
    withError(new RegistryPausedError());
    expect(view().error?.message).toMatch(/paused/);
  });

  it("maps AccessManager and SecurityRegistry contract errors", () => {
    withError(new Error("simulation failed: Error(Contract, #8)"));
    expect(view().error?.message).toMatch(/expired/);
    withError(new Error("simulation failed: Error(Contract, #14)"));
    expect(view().error?.message).toMatch(/no security terms/);
  });

  it("names the contract in the target-mismatch copy", () => {
    const loan = view({
      item: fromServed(
        loanRegistryOp("write_down", { target: "COTHERLOANREGISTRY1234567" }),
      ),
      expectedTarget: LOAN_REGISTRY,
    });
    expect(loan.disabled).toBe(true);
    expect(loan.notice).toBe(
      "This operation targets another LoanRegistry (COTHER…4567) than this console is configured for.",
    );
    const minter = view({
      item: fromServed(minterOp({ target: "COTHERMINTER12345678901" })),
      expectedTarget: MINTER,
    });
    expect(minter.notice).toBe(
      "This operation targets another Minter (COTHER…8901) than this console is configured for.",
    );
  });

  it("maps Minter errors with the recovery copy and LoanRegistry errors with the Risk Council copy", () => {
    const item = fromServed(minterOp());
    withError(new Error("simulation failed: Error(Contract, #25)"));
    expect(view({ item, expectedTarget: MINTER }).error?.message).toBe(
      "This repayment is already reversed.",
    );
    withError(new Error("simulation failed: Error(Contract, #8)"));
    const minterCopy = view({ item, expectedTarget: MINTER }).error?.message;
    const loanCopy = view({
      item: fromServed(loanRegistryOp("cure")),
      expectedTarget: LOAN_REGISTRY,
    }).error?.message;
    expect(minterCopy).toMatch(/expired/);
    expect(loanCopy).toMatch(/expired/);
    withError(new Error("simulation failed: Error(Contract, #14)"));
    expect(
      view({
        item: fromServed(loanRegistryOp("cure")),
        expectedTarget: LOAN_REGISTRY,
      }).error?.message,
    ).not.toMatch(/no security terms/);
  });

  it("applies a gate to a ready LoanRegistry row only and never marks it paused", () => {
    const mutateAsync = vi.fn().mockResolvedValue({ hash: "H" });
    mocks.execute.mockReturnValue({
      mutateAsync,
      isPending: false,
      error: null,
      hash: null,
      stage: null,
      reset: vi.fn(),
    });
    const item = fromServed(loanRegistryOp("write_down"));
    const gated = view({
      item,
      expectedTarget: LOAN_REGISTRY,
      executeGate: "This loan is not in Default.",
    });
    expect(gated.disabled).toBe(true);
    expect(gated.notice).toBe("This loan is not in Default.");
    const waiting = view({
      item: fromServed(loanRegistryOp("write_down", { state: "waiting" })),
      expectedTarget: LOAN_REGISTRY,
      executeGate: "This loan is not in Default.",
    });
    expect(waiting.notice).toBeNull();
    const open = view({ item, expectedTarget: LOAN_REGISTRY });
    expect(open.disabled).toBe(false);
    open.run();
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        paused: false,
        expectedTarget: LOAN_REGISTRY,
        argsXdr: "AAAAEAAAAAA=",
        fn: "write_down",
      }),
    );
  });

  it("exports the Set terms notice copy", () => {
    expect(SET_TERMS_PENDING_NOTICE).toMatch(/already scheduled/);
  });
});
