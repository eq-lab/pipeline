// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { describe, it, expect, vi } from "vitest";

vi.mock("@pipeline/wallet-connect", () => ({
  FLAG_OUTCOMES: ["Accepted", "TopUpRequired", "Escalated"],
  SECURITY_PAYMENT_TERMS: ["Lc", "Dp", "Da", "OpenAccount"],
  securityReasonHash: vi.fn(),
}));

import {
  buildReleaseCall,
  buildResolveFlagCall,
  buildSetTermsCall,
  flaggedRows,
  flaggingInspection,
  formatTermsRows,
  openRecordOptions,
  parseTermsForm,
  prefillTermsForm,
  ratioOrderInvalid,
  releaseConfirmText,
  termsFieldEcho,
  type TermsFormValues,
} from "./-risk-council-security";

const SERVED_TERMS = {
  advance_ratio_bps: 7000,
  margin_call_ratio_bps: 8250,
  cure_period: "604800",
  price_stale_after: "86400",
  payment_term: "Da",
  grace_period: "259200",
  default_rate: 20000,
  attestation_interval: "2592000",
  inspection_interval: "0",
  tolerance_bps: 50,
  grade_tolerance_bps: 25,
};

const FILLED: TermsFormValues = {
  advanceRatio: "70",
  marginCallRatio: "82.5",
  curePeriod: "7",
  priceStaleAfter: "24",
  gracePeriod: "3",
  defaultRate: "2",
  attestationInterval: "30",
  inspectionInterval: "0",
  tolerance: "0.5",
  gradeTolerance: "0.25",
  paymentTerm: "Da",
};

describe("terms form conversions", () => {
  it("parses % to bps, % to default-rate scale and days/hours to seconds", () => {
    expect(parseTermsForm(FILLED)).toEqual({
      advanceRatioBps: 7000,
      marginCallRatioBps: 8250,
      curePeriod: "604800",
      priceStaleAfter: "86400",
      gracePeriod: "259200",
      defaultRate: 20000,
      attestationInterval: "2592000",
      inspectionInterval: "0",
      toleranceBps: 50,
      gradeToleranceBps: 25,
    });
  });

  it("prefills from served terms and reproduces them exactly", () => {
    const prefill = prefillTermsForm(SERVED_TERMS);
    expect(prefill).toEqual(FILLED);
    expect(buildSetTermsCall(4, prefill)).toEqual({
      fn: "set_terms",
      loanId: 4,
      terms: {
        advanceRatioBps: 7000,
        marginCallRatioBps: 8250,
        curePeriod: SERVED_TERMS.cure_period,
        priceStaleAfter: SERVED_TERMS.price_stale_after,
        paymentTerm: "Da",
        gracePeriod: SERVED_TERMS.grace_period,
        defaultRate: 20000,
        attestationInterval: SERVED_TERMS.attestation_interval,
        inspectionInterval: "0",
        toleranceBps: 50,
        gradeToleranceBps: 25,
      },
    });
  });

  it("leaves a non-representable served duration empty", () => {
    const prefill = prefillTermsForm({ ...SERVED_TERMS, grace_period: "1" });
    expect(prefill.gracePeriod).toBe("");
    expect(buildSetTermsCall(4, prefill)).toBeNull();
  });

  it("prefills nothing when the loan has no terms", () => {
    const prefill = prefillTermsForm(null);
    expect(Object.values(prefill).every((v) => v === "")).toBe(true);
    expect(buildSetTermsCall(4, prefill)).toBeNull();
  });
});

describe("buildSetTermsCall", () => {
  it("needs a loan id, a payment term and every field", () => {
    expect(buildSetTermsCall(null, FILLED)).toBeNull();
    expect(buildSetTermsCall(1, { ...FILLED, paymentTerm: "" })).toBeNull();
    expect(buildSetTermsCall(1, { ...FILLED, tolerance: "" })).toBeNull();
    expect(buildSetTermsCall(1, { ...FILLED, curePeriod: "x" })).toBeNull();
  });

  it("refuses a margin call ratio below the advance ratio", () => {
    const values = { ...FILLED, advanceRatio: "90", marginCallRatio: "80" };
    expect(ratioOrderInvalid(parseTermsForm(values))).toBe(true);
    expect(buildSetTermsCall(1, values)).toBeNull();
    expect(
      ratioOrderInvalid(parseTermsForm({ ...FILLED, marginCallRatio: "70" })),
    ).toBe(false);
  });
});

describe("termsFieldEcho", () => {
  it("echoes the raw contract value per unit", () => {
    expect(termsFieldEcho("advanceRatio", FILLED)).toEqual({
      echo: "= 7000 bps",
      invalid: false,
    });
    expect(termsFieldEcho("defaultRate", FILLED).echo).toBe(
      "= 20000 (1e6 scale)",
    );
    expect(termsFieldEcho("curePeriod", FILLED).echo).toBe("= 604800 s");
    expect(termsFieldEcho("priceStaleAfter", FILLED).echo).toBe("= 86400 s");
  });

  it("is silent when empty and flags invalid input", () => {
    expect(termsFieldEcho("tolerance", { ...FILLED, tolerance: "" })).toEqual({
      echo: null,
      invalid: false,
    });
    expect(
      termsFieldEcho("curePeriod", { ...FILLED, curePeriod: "abc" }),
    ).toEqual({ echo: null, invalid: true });
  });
});

describe("formatTermsRows", () => {
  it("shows served terms verbatim with units", () => {
    const rows = Object.fromEntries(
      formatTermsRows(SERVED_TERMS).map((r) => [r.label, r.value]),
    );
    expect(rows["Advance ratio"]).toBe("70%");
    expect(rows["Margin call ratio"]).toBe("82.5%");
    expect(rows["Cure period"]).toBe("7 d");
    expect(rows["Price stale after"]).toBe("1 d");
    expect(rows["Payment term"]).toBe("Da");
    expect(rows["Default rate"]).toBe("2%");
    expect(rows["Inspection interval"]).toBe("0 s");
  });

  it("is empty for a loan without terms and dashes unserved fields", () => {
    expect(formatTermsRows(null)).toEqual([]);
    expect(formatTermsRows({}).every((row) => row.value === "—")).toBe(true);
  });
});

const RECORDS = [
  {
    record_id: "1",
    lot_id: "5",
    protection: "WarehousePledge",
    commodity: "Coffee",
    status: "Active",
    open: true,
    flagged_by: null,
    inspections: [],
  },
  {
    record_id: "2",
    lot_id: "5",
    protection: "WarehousePledge",
    commodity: "Coffee",
    status: "Active",
    open: true,
    flagged_by: "GINSPECTOR",
    inspections: [
      { inspection_id: "7", flagged: false, kind: "StockCount" },
      {
        inspection_id: "8",
        inspector: "GINSPECTOR",
        kind: "StockCount",
        quantity: "90.0000000",
        grade: "2.5000000",
        variance_reference_bps: -1000,
        variance_previous_bps: -400,
        variance_grade_bps: 0,
        flagged: true,
        resolution: null,
      },
    ],
  },
  {
    record_id: "3",
    lot_id: "6",
    protection: "Cash",
    status: "Released",
    open: false,
    flagged_by: null,
  },
];

describe("record lists", () => {
  it("lists records with flagged_by set and shows the flagging inspection", () => {
    const rows = flaggedRows(RECORDS);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recordId).toBe("2");
    expect(rows[0]!.recordNumber).toBe(2);
    const flag = Object.fromEntries(
      rows[0]!.flag.map((r) => [r.label, r.value]),
    );
    expect(flag["Inspector"]).toBe("GINSPECTOR");
    expect(flag["Quantity"]).toBe("90.0000000");
    expect(flag["Variance vs reference"]).toBe("-1000 bps");
    expect(flag["Variance vs previous"]).toBe("-400 bps");
    expect(flaggingInspection(RECORDS[1]!)?.inspection_id).toBe("8");
  });

  it("returns no flagged rows without records and dashes a missing inspection", () => {
    expect(flaggedRows(undefined)).toEqual([]);
    const rows = flaggedRows([{ record_id: "9", flagged_by: "G" }]);
    expect(rows[0]!.flag.find((r) => r.label === "Inspector")?.value).toBe("—");
  });

  it("lists only open records for release", () => {
    expect(openRecordOptions(RECORDS).map((o) => o.recordId)).toEqual([
      "1",
      "2",
    ]);
    expect(openRecordOptions(undefined)).toEqual([]);
  });
});

describe("call builders", () => {
  const HASH = "ab".repeat(32);

  it("builds resolve_flag and release_with_consent from record ids", () => {
    expect(buildResolveFlagCall(2, "Escalated", HASH)).toEqual({
      fn: "resolve_flag",
      recordId: 2,
      outcome: "Escalated",
      reasonHash: HASH,
    });
    expect(buildResolveFlagCall(null, "Accepted", HASH)).toBeNull();
    expect(buildResolveFlagCall(2, "Accepted", null)).toBeNull();
    expect(buildReleaseCall("3", HASH)).toEqual({
      fn: "release_with_consent",
      recordId: 3,
      consentHash: HASH,
    });
    expect(buildReleaseCall("", HASH)).toBeNull();
    expect(buildReleaseCall("3", null)).toBeNull();
  });

  it("words the release confirmation", () => {
    expect(releaseConfirmText("3")).toBe(
      "Release record #3? This burns the record NFT and cannot be undone.",
    );
  });
});
