/**
 * Tests for `originationRow.ts` — the In-Origination table's extractor
 * (`mapSubmissionToRow`, issue #814), mirroring
 * `packages/trustee/src/routes/-useOriginationTable.test.ts`'s
 * `mapSubmissionToRow` coverage.
 *
 * Covers:
 *   - A full fixture submission maps to correctly formatted fields.
 *   - Missing/malformed `loan_data`/`economics` fields render "—" (never
 *     throw, never fabricate).
 *   - The valuation sub-line is not part of the row shape at all (resolved
 *     Open Question — omitted entirely, mirroring #813).
 *   - Status is the raw lifecycle string (no discriminated pill/action —
 *     resolved Open Question, LP dashboard keeps its simple status label).
 */
import { describe, it, expect } from "vitest";
import { mapSubmissionToRow } from "./originationRow";
import type { SubmissionView } from "@/api/useLoanSubmissions";

const FULL_SUBMISSION: SubmissionView = {
  id: 1,
  status: "InReview",
  reason: null,
  originator: "GABCD1234EFGH5678IJKL9012MNOP3456QRST7890UVWX",
  created_at: "2026-06-18T10:00:00Z",
  updated_at: "2026-06-18T10:00:00Z",
  loan_data: {
    to: "G...",
    metadata_uri: "ipfs://...",
    originator: "Auric Andes",
    borrower_id: "borrower-1",
    commodity: "Gold pyrite concentrate",
    corridor: "PE-CN",
    governing_law: "England",
    economics: {
      original_facility_size: "3500000.000000",
      original_senior_tranche: "3000000.000000",
      original_equity_tranche: "500000.000000",
      original_offtaker_price: "3500000.000000",
      senior_interest_rate_bps: 1400,
      origination_date: 1_750_000_000,
      original_maturity_date: 1_797_292_800, // 2026-12-15T00:00:00Z
    },
    initial_ccr: 1_500_000,
    initial_location: {
      location_type: "Vessel",
      location_identifier: "MV Example",
      tracking_url: "https://example.com",
      updated_at: 1_750_000_000,
    },
  },
};

describe("mapSubmissionToRow", () => {
  it("maps a full fixture submission to correctly formatted fields", () => {
    const row = mapSubmissionToRow(FULL_SUBMISSION);
    expect(row.originator).toBe("Auric Andes");
    expect(row.commodity).toBe("Gold pyrite concentrate");
    expect(row.facility).toBe("$3,500,000");
    expect(row.corridor).toBe("PE → CN");
    expect(row.rate).toBe("14.0%");
    expect(row.maturity).toBe("15 Dec 2026");
    expect(row.submitted).toBe("18 Jun");
    expect(row.status).toBe("InReview");
  });

  it("does not include a valuation sub-line field on the row (resolved: omitted)", () => {
    const row = mapSubmissionToRow(FULL_SUBMISSION);
    expect(row).not.toHaveProperty("valuation");
  });

  it("uses loan_data.originator, not the top-level submitter address", () => {
    const row = mapSubmissionToRow(FULL_SUBMISSION);
    expect(row.originator).not.toBe(FULL_SUBMISSION.originator);
  });

  it("renders '—' for missing economics fields, never throwing", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        commodity: "",
        corridor: "",
        // @ts-expect-error — intentionally malformed for the defensive-read test
        economics: undefined,
      },
    };
    const row = mapSubmissionToRow(submission);
    expect(row.commodity).toBe("—");
    expect(row.corridor).toBe("—");
    expect(row.facility).toBe("—");
    expect(row.rate).toBe("—");
    expect(row.maturity).toBe("—");
  });

  it("renders '—' for a non-numeric senior_interest_rate_bps", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        economics: {
          ...FULL_SUBMISSION.loan_data.economics,
          // @ts-expect-error — intentionally malformed for the defensive-read test
          senior_interest_rate_bps: "not-a-number",
        },
      },
    };
    const row = mapSubmissionToRow(submission);
    expect(row.rate).toBe("—");
  });

  it("renders '—' for an entirely missing loan_data", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      // @ts-expect-error — intentionally malformed for the defensive-read test
      loan_data: undefined,
    };
    const row = mapSubmissionToRow(submission);
    expect(row.commodity).toBe("—");
    expect(row.facility).toBe("—");
  });

  it("passes through each lifecycle status as the raw string", () => {
    expect(
      mapSubmissionToRow({ ...FULL_SUBMISSION, status: "InReview" }).status,
    ).toBe("InReview");
    expect(
      mapSubmissionToRow({ ...FULL_SUBMISSION, status: "Approved" }).status,
    ).toBe("Approved");
    expect(
      mapSubmissionToRow({ ...FULL_SUBMISSION, status: "Rejected" }).status,
    ).toBe("Rejected");
  });

  it("maps an unknown/empty status string without throwing", () => {
    expect(
      mapSubmissionToRow({ ...FULL_SUBMISSION, status: "SomethingNew" }).status,
    ).toBe("SomethingNew");
    expect(
      mapSubmissionToRow({
        ...FULL_SUBMISSION,
        status: "" as SubmissionView["status"],
      }).status,
    ).toBe("—");
  });
});
