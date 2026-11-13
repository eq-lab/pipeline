// spec: docs/frontend/account-page.md#settlement-bank-account-1885
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api";
import {
  BANK_FIELDS,
  EMPTY_BANK_DRAFT,
  bankAccountDetail,
  bankDraftDirty,
  bankDraftPayload,
  parseBankAccountError,
} from "./settlementBankAccount";

const bad = (message: string, status = 400) => new ApiError(status, message);

describe("bankDraftDirty", () => {
  it("treats whitespace as blank", () => {
    expect(bankDraftDirty(EMPTY_BANK_DRAFT)).toBe(false);
    expect(bankDraftDirty({ ...EMPTY_BANK_DRAFT, iban: "   " })).toBe(false);
    expect(bankDraftDirty({ ...EMPTY_BANK_DRAFT, iban: " x " })).toBe(true);
  });
});

describe("bankDraftPayload", () => {
  it("trims values and nulls blank optionals", () => {
    expect(
      bankDraftPayload({
        ...EMPTY_BANK_DRAFT,
        account_holder_name: "  Acme Ltd ",
        iban: " GB82 ",
        bank_address: "   ",
      }),
    ).toEqual({
      account_holder_name: "Acme Ltd",
      bank_name: "",
      bank_address: null,
      account_number: null,
      iban: "GB82",
      swift_bic_code: null,
      routing_number: null,
    });
  });
});

describe("parseBankAccountError", () => {
  const cases: Array<[string, string, string]> = [
    ["account_holder_name", "is required", "Account holder name is required."],
    ["bank_name", "is required", "Bank name is required."],
    [
      "account_holder_name",
      "is too long",
      "Account holder name is too long (140 characters max).",
    ],
    ["bank_name", "is too long", "Bank name is too long (140 characters max)."],
    [
      "bank_address",
      "is too long",
      "Bank address is too long (280 characters max).",
    ],
    ["iban", "is not a valid IBAN", "Enter a valid IBAN."],
    [
      "account_number",
      "is not a valid account number",
      "Enter a valid account number (letters and digits only).",
    ],
    [
      "swift_bic_code",
      "is not a valid SWIFT/BIC code",
      "Enter a valid SWIFT/BIC code (8 or 11 characters).",
    ],
    [
      "routing_number",
      "is not a valid routing number",
      "Enter a valid 9-digit ABA routing number.",
    ],
    [
      "account_number",
      "or iban is required",
      "Enter an IBAN or an account number.",
    ],
    [
      "swift_bic_code",
      "or routing_number is required",
      "Enter a SWIFT/BIC code or a routing number.",
    ],
  ];

  it.each(cases)("maps %s %s", (field, reason, copy) => {
    expect(
      parseBankAccountError(bad(`settlement_bank_account.${field}: ${reason}`)),
    ).toEqual({
      field,
      message: copy,
    });
  });

  it("falls back to the label and reason for an unknown reason", () => {
    expect(
      parseBankAccountError(bad("settlement_bank_account.bank_name: is odd")),
    ).toEqual({ field: "bank_name", message: "Bank name is odd" });
  });

  it("ignores everything else", () => {
    expect(
      parseBankAccountError(
        bad("settlement_bank_account.iban: is required", 409),
      ),
    ).toBeNull();
    expect(
      parseBankAccountError(new Error("settlement_bank_account.iban: x")),
    ).toBeNull();
    expect(
      parseBankAccountError(bad("settlement_bank_account.nope: x")),
    ).toBeNull();
    expect(parseBankAccountError(bad("legal_name: is required"))).toBeNull();
  });

  it("covers every field in the tuple", () => {
    expect(BANK_FIELDS).toHaveLength(7);
  });
});

describe("bankAccountDetail", () => {
  it("shows the last four when served and the bank alone otherwise", () => {
    expect(
      bankAccountDetail({
        account_holder_name: "H",
        bank_name: "Bank",
        account_last4: "5432",
      }),
    ).toBe("Bank · ending 5432");
    expect(
      bankAccountDetail({
        account_holder_name: "H",
        bank_name: "Bank",
        account_last4: null,
      }),
    ).toBe("Bank");
  });
});
