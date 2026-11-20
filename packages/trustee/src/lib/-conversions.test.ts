// spec: docs/frontend/trustee-flows.md#cash-management--conversions-and-bank-charges
import { describe, it, expect } from "vitest";
import {
  closeFormError,
  conversionAccessReason,
  conversionErrorCopy,
  expenseFormError,
  openFormError,
  parseReceivedRaw,
  rampRowState,
  rampStateLabel,
  rampStateReason,
  RAMP_DIRECTION_LABEL,
} from "./conversions";

const RAMP = {
  id: 0,
  direction: "BankToUsdc" as const,
  amount: "100",
  openedAt: 1,
  closed: false,
  closedAt: 0,
  received: "0",
};

describe("conversionAccessReason", () => {
  const base = { access: undefined, isPending: false, isError: false };

  it("is null for an immediate grant", () => {
    expect(
      conversionAccessReason("open_ramp", {
        ...base,
        access: { immediate: true, delay: 0 },
      }),
    ).toBeNull();
  });

  it("covers pending, error, delay and no role for each fn", () => {
    expect(
      conversionAccessReason("open_ramp", { ...base, isPending: true }),
    ).toBe("Checking this wallet's Trustee role…");
    expect(
      conversionAccessReason("open_ramp", { ...base, isError: true }),
    ).toBe("Could not verify this wallet's Trustee role.");
    expect(conversionAccessReason("close_ramp", base)).toBe(
      "Could not verify this wallet's Trustee role.",
    );
    const noRole = { immediate: false, delay: 0 };
    expect(
      conversionAccessReason("open_ramp", { ...base, access: noRole }),
    ).toBe("Only the Trustee role can open conversions.");
    expect(
      conversionAccessReason("close_ramp", { ...base, access: noRole }),
    ).toBe("Only the Trustee role can close conversions.");
    expect(
      conversionAccessReason("record_expense", { ...base, access: noRole }),
    ).toBe("Only the Trustee role can record bank charges.");
    expect(
      conversionAccessReason("open_ramp", {
        ...base,
        access: { immediate: false, delay: 7200 },
      }),
    ).toBe(
      "This wallet holds the Trustee role with a 2 h delay; the app does not schedule cash-book bookings.",
    );
  });
});

describe("rampRowState and labels", () => {
  it("maps chain reads to states", () => {
    expect(
      rampRowState("Open", { data: RAMP, isPending: false, isError: false }),
    ).toBe("confirmed");
    expect(
      rampRowState("Open", {
        data: { ...RAMP, closed: true },
        isPending: false,
        isError: false,
      }),
    ).toBe("closed-pending-index");
    expect(
      rampRowState("Closed", {
        data: { ...RAMP, closed: true },
        isPending: false,
        isError: false,
      }),
    ).toBe("mismatch");
    expect(
      rampRowState("Open", {
        data: undefined,
        isPending: true,
        isError: false,
      }),
    ).toBe("reading");
    expect(
      rampRowState("Open", { data: undefined, isPending: true, isError: true }),
    ).toBe("read-error");
    expect(
      rampRowState("Open", {
        data: undefined,
        isPending: false,
        isError: false,
      }),
    ).toBe("read-error");
  });

  it("labels every state and gives a reason for all but confirmed", () => {
    expect(rampStateLabel("confirmed")).toBe("Open (confirmed on-chain)");
    expect(rampStateLabel("closed-pending-index")).toBe(
      "Closed on-chain — waiting for the indexer",
    );
    expect(rampStateLabel("mismatch")).toBe(
      "On-chain status differs from the cash book",
    );
    expect(rampStateLabel("read-error")).toBe("Could not confirm on-chain");
    expect(rampStateLabel("reading")).toBe("Confirming on-chain…");
    expect(rampStateReason("confirmed")).toBeNull();
    for (const state of [
      "reading",
      "read-error",
      "closed-pending-index",
      "mismatch",
    ] as const) {
      expect(rampStateReason(state)).toEqual(expect.any(String));
    }
  });

  it("labels the directions", () => {
    expect(RAMP_DIRECTION_LABEL.UsdcToBank).toBe("USDC → USD");
    expect(RAMP_DIRECTION_LABEL.BankToUsdc).toBe("USD → USDC");
  });
});

describe("parseReceivedRaw", () => {
  it("allows a literal zero and parses other amounts exactly", () => {
    expect(parseReceivedRaw("0")).toBe(0n);
    expect(parseReceivedRaw("0.00")).toBe(0n);
    expect(parseReceivedRaw(" 0.0000000 ")).toBe(0n);
    expect(parseReceivedRaw("1.5")).toBe(15000000n);
    expect(parseReceivedRaw("abc")).toBeNull();
    expect(parseReceivedRaw("")).toBeNull();
    expect(parseReceivedRaw("-1")).toBeNull();
    expect(parseReceivedRaw("1.12345678")).toBeNull();
  });
});

describe("form validators", () => {
  it("openFormError returns the first failing check", () => {
    const ok = {
      direction: "UsdcToBank" as const,
      amountInput: "10",
      reference: "WIRE-1",
    };
    expect(openFormError(ok)).toBeNull();
    expect(openFormError({ ...ok, direction: null })).toBe(
      "Choose a direction.",
    );
    expect(openFormError({ ...ok, amountInput: "0" })).toBe(
      "Enter the amount to convert.",
    );
    expect(openFormError({ ...ok, amountInput: "x" })).toBe(
      "Enter the amount to convert.",
    );
    expect(openFormError({ ...ok, reference: "  " })).toBe(
      "Enter the transfer reference.",
    );
    expect(openFormError({ ...ok, reference: "a".repeat(141) })).toBe(
      "The reference can be at most 140 characters.",
    );
  });

  it("closeFormError compares with the on-chain raw amount", () => {
    const ok = { receivedInput: "0", amountRaw: "100000000", reference: "R" };
    expect(closeFormError(ok)).toBeNull();
    expect(closeFormError({ ...ok, receivedInput: "10" })).toBeNull();
    expect(closeFormError({ ...ok, receivedInput: "10.0000001" })).toBe(
      "The amount received cannot exceed the opened amount (10).",
    );
    expect(closeFormError({ ...ok, receivedInput: "" })).toBe(
      "Enter the amount received.",
    );
    expect(closeFormError({ ...ok, reference: "" })).toBe(
      "Enter the closing reference.",
    );
  });

  it("expenseFormError checks amount, date, future date and reference", () => {
    const ok = {
      amountInput: "5.25",
      valueDateInput: "2026-11-09",
      today: "2026-11-09",
      reference: "FEE",
    };
    expect(expenseFormError(ok)).toBeNull();
    expect(expenseFormError({ ...ok, amountInput: "0" })).toBe(
      "Enter the charge amount.",
    );
    expect(expenseFormError({ ...ok, valueDateInput: "" })).toBe(
      "Enter the value date.",
    );
    expect(expenseFormError({ ...ok, valueDateInput: "2026-11-10" })).toBe(
      "The value date cannot be in the future.",
    );
    expect(expenseFormError({ ...ok, reference: " " })).toBe(
      "Enter the bank reference.",
    );
  });
});

describe("conversionErrorCopy", () => {
  const sim = (code: number) =>
    `simulation error: HostError: Error(Contract, #${code})`;

  it("keeps the wallet rejection copy", () => {
    expect(
      conversionErrorCopy("open_ramp", new Error("User rejected the request"))
        .message,
    ).toBe("You cancelled the transaction in your wallet.");
  });

  it.each([
    [
      "open_ramp",
      7,
      "This bank reference is already recorded on-chain. Use the outgoing wire's own reference.",
    ],
    [
      "open_ramp",
      1000,
      "The minter is paused. Conversions cannot be opened until it is unpaused.",
    ],
    [
      "record_expense",
      8,
      "The minter's booked bank cash is below this amount.",
    ],
    ["open_ramp", 18, "Custody USDC on-chain is below this amount."],
    ["close_ramp", 19, "The amount received cannot exceed the opened amount."],
    ["close_ramp", 20, "This conversion is already closed. Refresh the list."],
    ["close_ramp", 11, "The minter has no conversion with this id."],
    ["open_ramp", 6, "The amount must be greater than zero."],
  ] as const)(
    "maps %s #%i and keeps the details verbatim",
    (fn, code, copy) => {
      const raw = sim(code);
      const result = conversionErrorCopy(fn, new Error(raw));
      expect(result.message).toBe(copy);
      expect(result.details).toBe(raw);
    },
  );

  it("maps the RefHashSeen and EnforcedPause names without a code", () => {
    expect(
      conversionErrorCopy("record_expense", new Error("RefHashSeen")).message,
    ).toMatch(/already recorded on-chain/);
    expect(
      conversionErrorCopy(
        "open_ramp",
        new Error("PausableError::EnforcedPause"),
      ).message,
    ).toMatch(/minter is paused/);
  });

  it("does not map pause or custody codes outside open and leaves #2 unmapped", () => {
    const generic = "Could not verify this action on-chain.";
    for (const [fn, code] of [
      ["close_ramp", 1000],
      ["record_expense", 18],
      ["record_expense", 2],
    ] as const) {
      const raw = sim(code);
      const result = conversionErrorCopy(fn, new Error(raw));
      expect(result.message).toMatch(generic);
      expect(result.details).toBe(raw);
    }
    expect(conversionErrorCopy("open_ramp", new Error("boom")).message).toBe(
      "Could not open this conversion. Please try again.",
    );
  });
});
