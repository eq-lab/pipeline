// spec: docs/frontend/trustee-flows.md#risk-council-pending-operations
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ScheduledOp } from "@/lib/riskCouncilOps";
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
} from "@/api/useRiskCouncil";
import {
  callerText,
  decodeSecurityCall,
  fromServed,
  fromSession,
  mergePendingOps,
  pendingActionLabel,
  pendingArgRows,
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
      pendingArgRows(fromServed(pendingOp())).map((r) => [r.label, r.value]),
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
      ).map((r) => [r.label, r.value]),
    );
    expect(rows["Price stale after"]).toBe("2 h");
    expect(rows["Cure period"]).toBe("90 s");
  });

  it("shows the outcome and shortened hashes", () => {
    expect(
      pendingArgRows(
        fromServed(pendingOp({ function: "resolve_flag", args: RESOLVE_ARGS })),
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
      ),
    ).toEqual([{ label: "Consent hash", value: "efefefefef…" }]);
  });

  it("falls back to one raw JSON row", () => {
    expect(
      pendingArgRows(fromServed(pendingOp({ args: [9, { weird: true }] }))),
    ).toEqual([{ label: "Arguments", value: '[9,{"weird":true}]' }]);
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

  it("requires every chain field and skips executed ops", () => {
    expect(fromSession(sessionOp({ operationId: undefined }), 0)).toBeNull();
    expect(fromSession(sessionOp({ readyAt: 0 }), 0)).toBeNull();
    expect(fromSession(sessionOp({ readyAt: undefined }), 0)).toBeNull();
    expect(fromSession(sessionOp({ caller: undefined }), 0)).toBeNull();
    expect(fromSession(sessionOp({ target: undefined }), 0)).toBeNull();
    expect(fromSession(sessionOp({ argsXdr: undefined }), 0)).toBeNull();
    expect(fromSession(sessionOp({ executedHere: true }), 0)).toBeNull();
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

describe("mergePendingOps", () => {
  const base = {
    session: [] as ScheduledOp[],
    executedIds: new Set<string>(),
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

  it("hides executed ids from both sources", () => {
    const sessionId = "11".repeat(32);
    const keepId = "22".repeat(32);
    const items = mergePendingOps({
      ...base,
      served: [pendingOp(), pendingOp({ operation_id: keepId })],
      session: [sessionOp({ operationId: sessionId })],
      executedIds: new Set([OPERATION_ID, sessionId]),
    });
    expect(items.map((i) => i.operationId)).toEqual([keepId]);
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
      fn: "set_terms",
      argsXdr: "SERVEDXDR",
    });
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

  it("maps AccessManager and SecurityRegistry contract errors", () => {
    withError(new Error("simulation failed: Error(Contract, #8)"));
    expect(view().error?.message).toMatch(/expired/);
    withError(new Error("simulation failed: Error(Contract, #14)"));
    expect(view().error?.message).toMatch(/no security terms/);
  });

  it("exports the Set terms notice copy", () => {
    expect(SET_TERMS_PENDING_NOTICE).toMatch(/already scheduled/);
  });
});
