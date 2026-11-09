// spec: docs/frontend/trustee-flows.md#cash-management--bank-wire-outs
import { describe, it, expect } from "vitest";
import {
  rawToDecimal7,
  settleFormError,
  todayUtcDateInput,
  valueDateSeconds,
  wireOutAccessReason,
  wireOutErrorCopy,
  wireOutRowState,
  wireOutStateLabel,
  wireOutStateReason,
} from "./wireOut";

describe("wireOutAccessReason", () => {
  const base = { access: undefined, isPending: false, isError: false };

  it("is null for an immediate grant", () => {
    expect(
      wireOutAccessReason("settle_wire_out", {
        ...base,
        access: { immediate: true, delay: 0 },
      }),
    ).toBeNull();
  });

  it("covers pending, error, delay and no role", () => {
    expect(
      wireOutAccessReason("settle_wire_out", { ...base, isPending: true }),
    ).toBe("Checking this wallet's Trustee role…");
    expect(
      wireOutAccessReason("settle_wire_out", { ...base, isError: true }),
    ).toBe("Could not verify this wallet's Trustee role.");
    expect(wireOutAccessReason("cancel_wire_out", base)).toBe(
      "Could not verify this wallet's Trustee role.",
    );
    expect(
      wireOutAccessReason("settle_wire_out", {
        ...base,
        access: { immediate: false, delay: 3600 },
      }),
    ).toBe(
      "This wallet holds the Trustee role with a 1 h delay; the app does not schedule wire-out settlements.",
    );
    expect(
      wireOutAccessReason("settle_wire_out", {
        ...base,
        access: { immediate: false, delay: 0 },
      }),
    ).toBe("Only the Trustee role can settle bank wire-outs.");
    expect(
      wireOutAccessReason("cancel_wire_out", {
        ...base,
        access: { immediate: false, delay: 0 },
      }),
    ).toBe("Only the Trustee role can cancel bank wire-outs.");
  });
});

describe("wireOutRowState and labels", () => {
  const record = (status: "Pending" | "Settled" | "Cancelled") => ({
    data: {
      id: 1,
      lp: "GLP",
      amount: "10",
      requestedAt: 1,
      status,
      refHash: "00",
    },
    isPending: false,
    isError: false,
  });

  it("maps every state", () => {
    expect(
      wireOutRowState("Pending", {
        data: undefined,
        isPending: true,
        isError: false,
      }),
    ).toBe("reading");
    expect(
      wireOutRowState("Pending", {
        data: undefined,
        isPending: false,
        isError: false,
      }),
    ).toBe("read-error");
    expect(
      wireOutRowState("Pending", {
        data: undefined,
        isPending: false,
        isError: true,
      }),
    ).toBe("read-error");
    expect(wireOutRowState("Pending", record("Pending"))).toBe("confirmed");
    expect(wireOutRowState("Pending", record("Settled"))).toBe(
      "settled-pending-index",
    );
    expect(wireOutRowState("Pending", record("Cancelled"))).toBe(
      "cancelled-pending-index",
    );
    expect(wireOutRowState("Settled", record("Cancelled"))).toBe("mismatch");
  });

  it("labels and reasons", () => {
    expect(wireOutStateLabel("confirmed", "Pending")).toBe(
      "Pending (confirmed on-chain)",
    );
    expect(wireOutStateLabel("settled-pending-index", "Settled")).toBe(
      "Settled on-chain — waiting for the indexer",
    );
    expect(wireOutStateLabel("cancelled-pending-index", "Cancelled")).toBe(
      "Cancelled on-chain — waiting for the indexer",
    );
    expect(wireOutStateLabel("mismatch", "Settled")).toBe(
      "On-chain status Settled differs from the cash book",
    );
    expect(wireOutStateLabel("read-error", undefined)).toBe(
      "Could not confirm on-chain",
    );
    expect(wireOutStateLabel("reading", undefined)).toBe(
      "Confirming on-chain…",
    );
    expect(wireOutStateReason("confirmed", "Pending")).toBeNull();
    expect(wireOutStateReason("reading", undefined)).toMatch(/Confirming/);
    expect(wireOutStateReason("read-error", undefined)).toMatch(/Try again/);
    expect(wireOutStateReason("settled-pending-index", "Settled")).toMatch(
      /waiting for the indexer/,
    );
    expect(wireOutStateReason("mismatch", "Settled")).toBe(
      "This wire-out is Settled on-chain, not pending.",
    );
  });
});

describe("rawToDecimal7", () => {
  it("formats exactly", () => {
    expect(rawToDecimal7("10000000")).toBe("1");
    expect(rawToDecimal7("12345678")).toBe("1.2345678");
    expect(rawToDecimal7("5")).toBe("0.0000005");
    expect(rawToDecimal7("12345670")).toBe("1.234567");
    expect(rawToDecimal7("0")).toBe("0");
  });
});

describe("settleFormError", () => {
  const ok = {
    amountInput: "1.234567",
    amountRaw: "12345670",
    valueDateInput: "2026-11-05",
    today: "2026-11-09",
    reference: "WIRE-OUT-9",
  };

  it("passes a valid form, including trailing zeros at 7 dp", () => {
    expect(settleFormError(ok)).toBeNull();
    expect(settleFormError({ ...ok, amountInput: "1.2345670" })).toBeNull();
    expect(settleFormError({ ...ok, valueDateInput: "2026-11-09" })).toBeNull();
  });

  it("reports the first failing check", () => {
    expect(settleFormError({ ...ok, amountInput: "" })).toBe(
      "Enter the amount wired.",
    );
    expect(settleFormError({ ...ok, amountInput: "abc" })).toBe(
      "Enter the amount wired.",
    );
    expect(settleFormError({ ...ok, amountInput: "1.2345671" })).toBe(
      "The minter settles only the full requested amount (1.234567 PLUSD). If a different amount was wired, cancel this request instead.",
    );
    expect(settleFormError({ ...ok, valueDateInput: "" })).toBe(
      "Enter the value date.",
    );
    expect(settleFormError({ ...ok, valueDateInput: "2026-11-10" })).toBe(
      "The value date cannot be in the future.",
    );
    expect(settleFormError({ ...ok, reference: "   " })).toBe(
      "Enter the outgoing wire's bank reference.",
    );
    expect(settleFormError({ ...ok, reference: "x".repeat(141) })).toBe(
      "The reference can be at most 140 characters.",
    );
  });
});

describe("date helpers", () => {
  it("converts a UTC date to Unix seconds", () => {
    expect(valueDateSeconds("2023-11-14")).toBe(1_699_920_000);
  });

  it("formats today in UTC", () => {
    expect(todayUtcDateInput(new Date("2026-11-09T23:59:00Z"))).toBe(
      "2026-11-09",
    );
  });
});

describe("wireOutErrorCopy", () => {
  it("keeps the wallet rejection copy", () => {
    expect(
      wireOutErrorCopy(
        "settle_wire_out",
        new Error("User rejected the request"),
      ).message,
    ).toBe("You cancelled the transaction in your wallet.");
  });

  it.each([
    [
      "settle_wire_out",
      7,
      "This bank reference is already recorded on-chain. Use the outgoing wire's own reference.",
    ],
    [
      "settle_wire_out",
      17,
      "The minter settles only the full requested amount.",
    ],
    [
      "settle_wire_out",
      8,
      "The minter's bank cash is below this amount. Book the incoming wires first.",
    ],
    [
      "cancel_wire_out",
      16,
      "This lender's address is not authorised to hold PLUSD, so the PLUSD cannot be returned.",
    ],
    [
      "cancel_wire_out",
      14,
      "This wire-out is no longer pending. Refresh the list.",
    ],
    ["settle_wire_out", 10, "The minter has no wire-out with this id."],
  ] as const)(
    "maps %s #%i and keeps the details verbatim",
    (fn, code, copy) => {
      const raw = `settle simulation error: HostError: Error(Contract, #${code})`;
      const result = wireOutErrorCopy(fn, new Error(raw));
      expect(result.message).toBe(copy);
      expect(result.details).toBe(raw);
    },
  );

  it("maps a RefHashSeen name without a code", () => {
    expect(
      wireOutErrorCopy("settle_wire_out", new Error("RefHashSeen")).message,
    ).toMatch(/already recorded on-chain/);
  });

  it("does not map settle-only codes on cancel and falls back otherwise", () => {
    expect(wireOutErrorCopy("cancel_wire_out", new Error("boom")).message).toBe(
      "Could not cancel this wire-out. Please try again.",
    );
    expect(wireOutErrorCopy("settle_wire_out", new Error("boom")).message).toBe(
      "Could not settle this wire-out. Please try again.",
    );
  });
});
