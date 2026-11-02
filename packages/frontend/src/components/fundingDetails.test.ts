// spec: docs/frontend/bank-transfers.md#fundingdetails
import { describe, it, expect } from "vitest";
import { ApiError } from "@/api";
import * as fundingDetails from "./fundingDetails";
import {
  displayValue,
  formatFundingDetailsForCopy,
  toFundingDetailsView,
  toUnavailableView,
} from "./fundingDetails";
import type { FundingDetailRow } from "./fundingDetails";

const RESPONSE = {
  company_name: "Example Trust LLC",
  bank_name: "Example Bank",
  bank_address: "1 Example Street",
  account_number: "00000000",
  iban: "XX00 TEST 0000 0000 0000 00",
  swift_bic_code: "TESTXXXXXXX",
  payment_details: "PL-0000-0000-0000",
  chain_id: 99000001,
  receiver_address: "GAAA",
};

describe("formatFundingDetailsForCopy", () => {
  it("emits one label: value line per row, joined by newline", () => {
    const rows: FundingDetailRow[] = [
      { label: "Company Name", value: "Example Trust LLC" },
      { label: "Bank Name", value: "—" },
    ];
    expect(formatFundingDetailsForCopy(rows)).toBe(
      "Company Name: Example Trust LLC\nBank Name: —",
    );
  });

  it("returns an empty string for an empty row list", () => {
    expect(formatFundingDetailsForCopy([])).toBe("");
  });
});

describe("toFundingDetailsView", () => {
  it("maps the served fields in label order plus the reference row", () => {
    const view = toFundingDetailsView(RESPONSE, "stellar");
    expect(view.rows.map((r) => r.label)).toEqual([
      "Company Name",
      "Bank Name",
      "Bank Address",
      "Account Number",
      "IBAN",
      "SWIFT / BIC code",
      "Payment reference",
    ]);
    expect(view.rows[5]?.value).toBe("TESTXXXXXXX");
    expect(view.paymentReference).toBe("PL-0000-0000-0000");
    expect(view.receiverAddress).toBe("GAAA");
    expect(view.network).toBe("Stellar");
  });

  it("copy text is seven lines ending with the reference", () => {
    const lines = formatFundingDetailsForCopy(
      toFundingDetailsView(RESPONSE, "stellar").rows,
    ).split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[6]).toBe("Payment reference: PL-0000-0000-0000");
  });

  it("renders empty fields as — per field and for the receiver address", () => {
    const view = toFundingDetailsView(
      {
        ...RESPONSE,
        company_name: "",
        iban: "",
        payment_details: "",
        receiver_address: "",
      },
      "stellar",
    );
    expect(view.rows[0]?.value).toBe("—");
    expect(view.rows[4]?.value).toBe("—");
    expect(view.paymentReference).toBe("—");
    expect(view.receiverAddress).toBe("—");
  });

  it("names the network from the served chain_id for both kinds", () => {
    expect(toFundingDetailsView(RESPONSE, "stellar").network).toBe("Stellar");
    expect(
      toFundingDetailsView({ ...RESPONSE, chain_id: 123456789 }, "evm").network,
    ).toBe("chain 123456789");
  });
});

describe("displayValue", () => {
  it("returns — for empty, null and undefined and verbatim otherwise", () => {
    expect(displayValue("")).toBe("—");
    expect(displayValue(null)).toBe("—");
    expect(displayValue(undefined)).toBe("—");
    expect(displayValue(" a b ")).toBe(" a b ");
  });
});

describe("toUnavailableView", () => {
  it("maps 409 to not-linked", () => {
    expect(toUnavailableView(new ApiError(409, "x"), "Stellar")).toEqual({
      status: "unavailable",
      reason: "not-linked",
      chainName: "Stellar",
    });
  });

  it.each([400, 404, 500])("maps %i to error", (code) => {
    expect(toUnavailableView(new ApiError(code, "x"), "Stellar").reason).toBe(
      "error",
    );
  });

  it("maps a network TypeError to error", () => {
    expect(toUnavailableView(new TypeError("fail"), "Stellar").reason).toBe(
      "error",
    );
  });
});

describe("module surface", () => {
  it("no longer exports the scratch placeholder", () => {
    expect("FUNDING_DETAILS_PLACEHOLDER" in fundingDetails).toBe(false);
  });
});
