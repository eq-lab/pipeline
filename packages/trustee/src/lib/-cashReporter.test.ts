// spec: docs/frontend/trustee-flows.md#cash-reporter-bookings
import { describe, it, expect } from "vitest";
import {
  CASH_REPORTER_NO_ROLE,
  cashReporterReason,
  type CashReporterFn,
} from "./cashReporter";

const FNS: CashReporterFn[] = ["record_wire_in", "repay", "record_income"];

describe("cashReporterReason", () => {
  it.each(FNS)("%s: enabled only on an immediate call", (fn) => {
    expect(
      cashReporterReason(fn, {
        access: { immediate: true, delay: 0 },
        isPending: false,
        isError: false,
      }),
    ).toBeNull();
  });

  it.each(FNS)("%s: pending read disables with the checking copy", (fn) => {
    expect(cashReporterReason(fn, { isPending: true, isError: false })).toBe(
      "Checking this wallet's Cash reporter role…",
    );
  });

  it.each(FNS)("%s: a read error fails closed", (fn) => {
    expect(cashReporterReason(fn, { isPending: false, isError: true })).toBe(
      "Could not verify this wallet's Cash reporter role.",
    );
  });

  it.each(FNS)("%s: a delayed grant is refused", (fn) => {
    expect(
      cashReporterReason(fn, {
        access: { immediate: false, delay: 86400 },
        isPending: false,
        isError: false,
      }),
    ).toBe(
      "This wallet holds the Cash reporter role with a 24 h delay; the minter accepts only immediate calls.",
    );
  });

  it.each(FNS)("%s: no role shows the per-function copy", (fn) => {
    expect(
      cashReporterReason(fn, {
        access: { immediate: false, delay: 0 },
        isPending: false,
        isError: false,
      }),
    ).toBe(CASH_REPORTER_NO_ROLE[fn]);
  });

  it("uses the documented wording", () => {
    expect(CASH_REPORTER_NO_ROLE).toEqual({
      record_wire_in: "Only the Cash reporter can book incoming wires.",
      repay: "Only the Cash reporter can book repayments.",
      record_income: "Only the Cash reporter can book bank income.",
    });
  });
});
