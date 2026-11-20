// spec: docs/frontend/trustee-flows.md#cash-reporter-bookings
import { describe, it, expect } from "vitest";
import { dateInputToValueDate } from "@/utils/formatDate";
import {
  incomeError,
  incomeStageLabel,
  incomeValidationError,
} from "./-cash-management-income";

const TODAY = "2026-11-09";
const VALID = {
  amount: "1250.50",
  valueDateInput: TODAY,
  reference: "BANK-REF-1",
  today: TODAY,
};

describe("incomeValidationError", () => {
  it("accepts a complete entry", () => {
    expect(incomeValidationError(VALID)).toBeNull();
  });

  it("orders the messages amount, reference, date, future date", () => {
    expect(incomeValidationError({ ...VALID, amount: "0" })).toBe(
      "Enter an amount greater than 0 with at most 2 decimal places.",
    );
    expect(incomeValidationError({ ...VALID, amount: "1.234" })).toBe(
      "Enter an amount greater than 0 with at most 2 decimal places.",
    );
    expect(incomeValidationError({ ...VALID, reference: "  " })).toBe(
      "Enter the bank's reference for this income.",
    );
    expect(incomeValidationError({ ...VALID, valueDateInput: "" })).toBe(
      "Enter the value date.",
    );
    expect(
      incomeValidationError({ ...VALID, valueDateInput: "2026-11-10" }),
    ).toBe("The value date cannot be in the future.");
  });
});

describe("value date", () => {
  it("is UTC midnight in Unix seconds", () => {
    expect(dateInputToValueDate("2026-10-27")).toBe(1793059200);
  });
});

describe("incomeError", () => {
  it("maps RefHashSeen to the reference copy and keeps the details", () => {
    const mapped = incomeError(new Error("RefHashSeen: already consumed"));
    expect(mapped?.message).toBe(
      "This bank reference is already booked on-chain. Each bank record's reference can be used once.",
    );
    expect(mapped?.details).toContain("RefHashSeen");
  });

  it("returns null without an error", () => {
    expect(incomeError(null)).toBeNull();
  });
});

describe("incomeStageLabel", () => {
  it("labels each stage and defaults to Book income", () => {
    expect(incomeStageLabel("awaiting-signature")).toBe("Awaiting signature…");
    expect(incomeStageLabel("submitting")).toBe("Submitting…");
    expect(incomeStageLabel("confirming")).toBe("Confirming…");
    expect(incomeStageLabel(null)).toBe("Book income");
  });
});
