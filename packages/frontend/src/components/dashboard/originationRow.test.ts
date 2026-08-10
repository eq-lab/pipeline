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
      // 7-decimal on-chain base-unit strings (issue #912) — displayed ÷10^7,
      // so this facility value renders "$3.5M".
      original_facility_size: "35000000000000.000000",
      original_senior_tranche: "30000000000000.000000",
      original_equity_tranche: "5000000000000.000000",
      original_offtaker_price: "35000000000000.000000",
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
    expect(row.facility).toBe("$3.5M"); // compact, matching Active Loans (#841)
    expect(row.corridor).toBe("PE → CN");
    expect(row.rate).toBe("14.0%");
    expect(row.maturity).toBe("15 Dec 2026");
    expect(row.submitted).toBe("18 Jun");
    expect(row.status).toBe("InReview");
  });

  it("divides the facility by the FULL 10^7 (issue #912 regression) — 10000000000 base units -> $1,000, not $1M", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        economics: {
          ...FULL_SUBMISSION.loan_data.economics,
          original_facility_size: "10000000000.000000",
        },
      },
    };
    const row = mapSubmissionToRow(submission);
    // 10000000000 / 10^7 = 1000 -> formatCompactUsd("1000.0000000") = "$1.0K".
    // A partial (e.g. 10^4) divisor would wrongly produce "$1M".
    expect(row.facility).toBe("$1.0K");
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

  it("normalizes the status and derives a human-readable label (#1053)", () => {
    const inReview = mapSubmissionToRow({
      ...FULL_SUBMISSION,
      status: "InReview",
    });
    expect(inReview.status).toBe("InReview");
    expect(inReview.statusLabel).toBe("In review");

    const changes = mapSubmissionToRow({
      ...FULL_SUBMISSION,
      status: "ChangesRequested",
    });
    expect(changes.status).toBe("ChangesRequested");
    expect(changes.statusLabel).toBe("Changes requested");

    const rejected = mapSubmissionToRow({
      ...FULL_SUBMISSION,
      status: "Rejected",
    });
    expect(rejected.status).toBe("Rejected");
    expect(rejected.statusLabel).toBe("Rejected");
  });

  it("normalizes merged lifecycle / unknown / empty statuses to Approved without throwing (#892, #1053)", () => {
    expect(
      mapSubmissionToRow({ ...FULL_SUBMISSION, status: "Performing" }).status,
    ).toBe("Approved");
    expect(
      mapSubmissionToRow({ ...FULL_SUBMISSION, status: "SomethingNew" }).status,
    ).toBe("Approved");
    const empty = mapSubmissionToRow({
      ...FULL_SUBMISSION,
      status: "" as SubmissionView["status"],
    });
    expect(empty.status).toBe("Approved");
    expect(empty.statusLabel).toBe("Approved");
  });
});
