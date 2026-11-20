// spec: docs/frontend/trustee-flows.md#settlement-bank-account
import { describe, it, expect } from "vitest";
import type { SettlementBankAccountDetails } from "@/api/useLp";
import {
  BANK_ACCOUNT_FIELDS,
  COPYABLE_BANK_FIELDS,
  bankAccountRows,
  wireOutBankAccountState,
} from "./settlementBankAccount";

const FULL: SettlementBankAccountDetails = {
  account_holder_name: "Acme Capital LP",
  bank_name: "Example Bank AG",
  bank_address: "1 Bahnhofstrasse, Zurich",
  iban: "ch93 0076 2011 6238 5295 7",
  account_number: "0012345678",
  swift_bic_code: "EXAMCHZZ",
  routing_number: "021000021",
};

describe("bankAccountRows", () => {
  it("keeps the field order and labels of the LP app", () => {
    expect(bankAccountRows(FULL).map((r) => [r.field, r.label])).toEqual([
      ["account_holder_name", "Account holder name"],
      ["bank_name", "Bank name"],
      ["bank_address", "Bank address"],
      ["iban", "IBAN"],
      ["account_number", "Account number"],
      ["swift_bic_code", "SWIFT/BIC code"],
      ["routing_number", "Routing number (ABA)"],
    ]);
    expect(BANK_ACCOUNT_FIELDS).toHaveLength(7);
  });

  it("passes values through verbatim", () => {
    const rows = bankAccountRows(FULL);
    expect(rows.find((r) => r.field === "iban")?.value).toBe(
      "ch93 0076 2011 6238 5295 7",
    );
  });

  it("gives null for null optional fields and marks them not copyable", () => {
    const rows = bankAccountRows({
      ...FULL,
      bank_address: null,
      iban: null,
      account_number: null,
      swift_bic_code: null,
      routing_number: null,
    });
    for (const field of [
      "bank_address",
      "iban",
      "account_number",
      "swift_bic_code",
      "routing_number",
    ]) {
      const row = rows.find((r) => r.field === field)!;
      expect(row.value).toBeNull();
      expect(row.copyable).toBe(false);
    }
  });

  it("makes exactly the four identifier fields copyable", () => {
    const copyable = bankAccountRows(FULL)
      .filter((r) => r.copyable)
      .map((r) => r.field);
    expect(copyable).toEqual([...COPYABLE_BANK_FIELDS]);
    expect(copyable).toEqual([
      "iban",
      "account_number",
      "swift_bic_code",
      "routing_number",
    ]);
  });
});

describe("wireOutBankAccountState", () => {
  it("is not-pending for Settled and Cancelled even with an account", () => {
    expect(
      wireOutBankAccountState({
        status: "Settled",
        lp_id: 1,
        bank_account: FULL,
      }),
    ).toBe("not-pending");
    expect(
      wireOutBankAccountState({
        status: "Cancelled",
        lp_id: 1,
        bank_account: FULL,
      }),
    ).toBe("not-pending");
  });

  it("is unresolved without an lp_id", () => {
    expect(wireOutBankAccountState({ status: "Pending" })).toBe("unresolved");
  });

  it("is served with an account", () => {
    expect(
      wireOutBankAccountState({
        status: "Pending",
        lp_id: 1,
        bank_account: FULL,
      }),
    ).toBe("served");
  });

  it("is missing for a resolved lender with no account or a null one", () => {
    expect(wireOutBankAccountState({ status: "Pending", lp_id: 1 })).toBe(
      "missing",
    );
    expect(
      wireOutBankAccountState({
        status: "Pending",
        lp_id: 1,
        bank_account: null,
      }),
    ).toBe("missing");
  });
});
