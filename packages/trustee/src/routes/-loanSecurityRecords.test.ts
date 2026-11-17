// spec: docs/frontend/trustee-flows.md#security-records-card
import { describe, it, expect } from "vitest";
import type {
  LoanSecurityRecord,
  LoanSecurityResponse,
} from "@/api/useLoanSecurity";
import {
  buildSecurityRecords,
  formatActor,
  formatDecimal7,
  formatQuantity,
  formatVariance,
} from "./-loanSecurityRecords";
import { securityResult } from "./-riskCouncilFixtures";

const T0 = String(Date.UTC(2026, 5, 1) / 1000);
const T1 = String(Date.UTC(2026, 5, 10) / 1000);
const ADDR = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";

const GOODS: LoanSecurityRecord = {
  record_id: "7",
  lot_id: "3",
  protection: "warehouse_receipt",
  commodity: "Copper Cathode",
  unit: "MT",
  status: "Active",
  open: true,
  reference_quantity: "1250.0000000",
  attested_by: ADDR,
  attested_at: T0,
  counts_toward_value: true,
  attestation_stale: false,
  inspection_stale: null,
  mark_stale: false,
  flagged_by: null,
  mark: { value_per_unit: "9500.5000000", at: T1, benchmark: "LME Copper" },
  valuation: {
    counted_quantity: "1200.0000000",
    value_per_unit: "9500.5000000",
    mark_at: T1,
    value: "11400600.000000",
    stale: false,
    flagged: false,
  },
  inspections: [
    {
      inspection_id: "11",
      kind: "periodic",
      inspected_at: T0,
      quantity: "1200.0000000",
      grade: "A",
      entered_by: ADDR,
      entered_at: T0,
      approved_by: ADDR,
      approved_at: T1,
      variance_reference_bps: 120,
      variance_previous_bps: null,
      variance_grade_bps: 0,
      flagged: true,
      resolution: "pending",
      is_lot_latest: true,
      complete: true,
    },
  ],
};

function withRecords(records: LoanSecurityRecord[] | undefined) {
  const base = securityResult();
  const data: LoanSecurityResponse = { ...base.data, records };
  return securityResult({ data });
}

describe("formatDecimal7", () => {
  it("groups and trims a 7-decimal string", () => {
    expect(formatDecimal7("1250.0000000")).toBe("1,250");
    expect(formatDecimal7("12.5000000")).toBe("12.5");
    expect(formatDecimal7("0.5000000")).toBe("0.5");
    expect(formatDecimal7("-3.1000000")).toBe("-3.1");
    expect(formatDecimal7("1234567")).toBe("1,234,567");
  });

  it("dashes anything that is not a decimal string", () => {
    expect(formatDecimal7("1e5")).toBe("—");
    expect(formatDecimal7(null)).toBe("—");
    expect(formatDecimal7(12)).toBe("—");
    expect(formatDecimal7("")).toBe("—");
  });
});

describe("formatQuantity / formatVariance / formatActor", () => {
  it("appends the unit only when present and the value is served", () => {
    expect(formatQuantity("1250.0000000", "MT")).toBe("1,250 MT");
    expect(formatQuantity("1250.0000000", null)).toBe("1,250");
    expect(formatQuantity(null, "MT")).toBe("—");
  });

  it("formats variances in bps", () => {
    expect(formatVariance(120)).toBe("120 bps");
    expect(formatVariance(null)).toBe("—");
    expect(formatVariance("120")).toBe("—");
  });

  it("splits an actor into address and date", () => {
    expect(formatActor(ADDR, T0)).toEqual({
      address: ADDR,
      date: "1 Jun 2026",
    });
    expect(formatActor(null, undefined)).toEqual({ address: null, date: "—" });
  });
});

describe("buildSecurityRecords", () => {
  it("is hidden when the summary card is not ready", () => {
    expect(
      buildSecurityRecords(
        securityResult({ data: undefined, notConfigured: true }),
      ).state,
    ).toBe("hidden");
    expect(
      buildSecurityRecords(securityResult({ data: undefined, isLoading: true }))
        .state,
    ).toBe("hidden");
    expect(
      buildSecurityRecords(
        securityResult({ data: undefined, error: new Error("x") }),
      ).state,
    ).toBe("hidden");
    expect(
      buildSecurityRecords(securityResult({ data: { terms: null } })).state,
    ).toBe("hidden");
  });

  it("is empty for [] and for a missing records field", () => {
    expect(buildSecurityRecords(withRecords([])).state).toBe("empty");
    expect(buildSecurityRecords(withRecords(undefined)).state).toBe("empty");
  });

  it("keeps the served order", () => {
    const view = buildSecurityRecords(
      withRecords([{ record_id: "9" }, { record_id: "2" }]),
    );
    expect(view.state).toBe("ready");
    expect(view.records.map((r) => r.recordId)).toEqual(["9", "2"]);
  });

  it("maps a goods record from the spec shape", () => {
    const [record] = buildSecurityRecords(withRecords([GOODS])).records;
    expect(record?.title).toBe("Record #7 · warehouse_receipt");
    expect(record?.status).toBe("Active");
    expect(record?.rows).toEqual([
      { label: "Commodity", value: "Copper Cathode" },
      { label: "Document quantity", value: "1,250 MT" },
      { label: "Counted quantity", value: "1,200 MT" },
      { label: "Value", value: "$11,400,600" },
      { label: "Price", value: "LME Copper · $9,500.5 per MT" },
      { label: "Price updated", value: "10 Jun 2026" },
      { label: "Attested", value: "1 Jun 2026" },
    ]);
    expect(record?.attestedBy).toBe(ADDR);
    expect(record?.chips).toEqual([]);
  });

  it("dashes price, counted quantity and value for a cash-cover record", () => {
    const [record] = buildSecurityRecords(
      withRecords([
        {
          record_id: "1",
          protection: "cash_cover",
          mark: null,
          valuation: null,
          counts_toward_value: false,
        },
      ]),
    ).records;
    const value = (label: string) =>
      record?.rows.find((r) => r.label === label)?.value;
    expect(value("Price")).toBe("—");
    expect(value("Counted quantity")).toBe("—");
    expect(value("Value")).toBe("—");
    expect(record?.chips).toEqual([{ label: "Not counted", tone: "neutral" }]);
  });

  it("shows each chip only on the exact served flag", () => {
    const chips = (r: LoanSecurityRecord) =>
      buildSecurityRecords(withRecords([r])).records[0]?.chips.map(
        (c) => c.label,
      );
    expect(
      chips({
        flagged_by: ADDR,
        attestation_stale: true,
        inspection_stale: true,
        mark_stale: true,
        open: false,
      }),
    ).toEqual([
      "Flagged",
      "Attestation stale",
      "Inspection stale",
      "Price stale",
      "Closed",
    ]);
    expect(chips({ valuation: { flagged: true, stale: true } })).toEqual([
      "Flagged",
      "Price stale",
    ]);
    expect(
      chips({
        attestation_stale: null,
        inspection_stale: null,
        mark_stale: null,
        counts_toward_value: true,
      }),
    ).toEqual([]);
  });

  it("maps inspections: approved, awaiting, none, variances, flag, latest", () => {
    const [inspection] =
      buildSecurityRecords(withRecords([GOODS])).records[0]?.inspections ?? [];
    expect(inspection).toMatchObject({
      id: "11",
      kind: "periodic",
      inspected: "1 Jun 2026",
      quantity: "1,200 MT",
      grade: "A",
      entered: { address: ADDR, date: "1 Jun 2026" },
      approved: { address: ADDR, date: "10 Jun 2026" },
      varianceReference: "120 bps",
      variancePrevious: "—",
      varianceGrade: "0 bps",
      flagged: true,
      resolution: "pending",
      latest: true,
    });
    const approvedOf = (i: object) =>
      buildSecurityRecords(withRecords([{ inspections: [i] }])).records[0]
        ?.inspections[0]?.approved;
    expect(approvedOf({ approved_by: null, complete: true })).toBe("awaiting");
    expect(approvedOf({ approved_by: null })).toBe("awaiting");
    expect(approvedOf({ approved_by: null, complete: false })).toBeNull();
  });

  it("does not throw on an empty record or inspection", () => {
    expect(() =>
      buildSecurityRecords(withRecords([{ inspections: [{}] }, {}])),
    ).not.toThrow();
    const [record] = buildSecurityRecords(withRecords([{}])).records;
    expect(record?.title).toBe("Record #— · —");
  });
});
