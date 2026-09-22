// spec: docs/frontend/bank-transfers.md#fundingdetails
import { describe, it, expect } from "vitest";
import {
  FUNDING_DETAIL_LABELS,
  FUNDING_DETAILS_PLACEHOLDER,
  formatFundingDetailsForCopy,
} from "./fundingDetails";
import type { FundingDetailRow } from "./fundingDetails";

describe("formatFundingDetailsForCopy", () => {
  it("emits one label: value line per row, joined by newline, in frame order", () => {
    const rows: FundingDetailRow[] = [
      { label: "Company Name", value: "Pipeline Trust LLC" },
      { label: "Bank Name", value: "HSBC Bank" },
    ];
    expect(formatFundingDetailsForCopy(rows)).toBe(
      "Company Name: Pipeline Trust LLC\nBank Name: HSBC Bank",
    );
  });

  it("serializes — values verbatim, not skipped", () => {
    const rows: FundingDetailRow[] = [
      { label: "Company Name", value: "—" },
      { label: "Bank Name", value: "—" },
    ];
    expect(formatFundingDetailsForCopy(rows)).toBe(
      "Company Name: —\nBank Name: —",
    );
  });

  it("returns an empty string for an empty row list", () => {
    expect(formatFundingDetailsForCopy([])).toBe("");
  });
});

describe("FUNDING_DETAILS_PLACEHOLDER", () => {
  it("has exactly six rows whose labels equal FUNDING_DETAIL_LABELS", () => {
    expect(FUNDING_DETAILS_PLACEHOLDER).toHaveLength(6);
    expect(FUNDING_DETAILS_PLACEHOLDER.map((row) => row.label)).toEqual(
      FUNDING_DETAIL_LABELS,
    );
  });

  it("corrects the frame's company-name typo to Pipeline Trust LLC", () => {
    const companyRow = FUNDING_DETAILS_PLACEHOLDER.find(
      (row) => row.label === "Company Name",
    );
    expect(companyRow?.value).toBe("Pipeline Trust LLC");
  });
});
