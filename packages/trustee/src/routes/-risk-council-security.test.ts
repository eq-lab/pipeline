// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { describe, it, expect, vi } from "vitest";

vi.mock("@pipeline/wallet-connect", () => ({
  FLAG_OUTCOMES: ["Accepted", "TopUpRequired", "Escalated"],
  SECURITY_PAYMENT_TERMS: ["Lc", "Dp", "Da", "OpenAccount"],
  securityReasonHash: vi.fn(),
}));

const STELLAR = 99_000_001;
const EVM = 560048;

import { mapRelayError } from "./-risk-council-shared";
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
  ratioOrderErrorFor,
  releaseConfirmText,
  termsFieldEcho,
  termsFieldsFor,
  DEFAULT_RATIO_ORDER_ERROR,
  RATIO_ORDER_ERROR,
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
  defaultRatio: "",
  curePeriod: "7",
  priceStaleAfter: "24",
  gracePeriod: "3",
  defaultRate: "2",
  originatorFeeRate: "",
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
      defaultRatioBps: null,
      curePeriod: "604800",
      priceStaleAfter: "86400",
      gracePeriod: "259200",
      defaultRate: 20000,
      originatorFeeRate: null,
      attestationInterval: "2592000",
      inspectionInterval: "0",
      toleranceBps: 50,
      gradeToleranceBps: 25,
    });
  });

  it("prefills from served terms and reproduces them exactly", () => {
    const prefill = prefillTermsForm(SERVED_TERMS);
    expect(prefill).toEqual(FILLED);
    expect(buildSetTermsCall(4, prefill, STELLAR)).toEqual({
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
    expect(buildSetTermsCall(4, prefill, STELLAR)).toBeNull();
  });

  it("prefills nothing when the loan has no terms", () => {
    const prefill = prefillTermsForm(null);
    expect(Object.values(prefill).every((v) => v === "")).toBe(true);
    expect(buildSetTermsCall(4, prefill, STELLAR)).toBeNull();
  });
});

describe("buildSetTermsCall", () => {
  it("needs a loan id, a payment term and every field", () => {
    expect(buildSetTermsCall(null, FILLED, STELLAR)).toBeNull();
    expect(
      buildSetTermsCall(1, { ...FILLED, paymentTerm: "" }, STELLAR),
    ).toBeNull();
    expect(
      buildSetTermsCall(1, { ...FILLED, tolerance: "" }, STELLAR),
    ).toBeNull();
    expect(
      buildSetTermsCall(1, { ...FILLED, curePeriod: "x" }, STELLAR),
    ).toBeNull();
  });

  it("refuses a margin call ratio below the advance ratio", () => {
    const values = { ...FILLED, advanceRatio: "90", marginCallRatio: "80" };
    expect(ratioOrderInvalid(parseTermsForm(values))).toBe(true);
    expect(buildSetTermsCall(1, values, STELLAR)).toBeNull();
    expect(
      ratioOrderInvalid(parseTermsForm({ ...FILLED, marginCallRatio: "70" })),
    ).toBe(false);
  });
});

const EVM_SERVED_TERMS = {
  ...SERVED_TERMS,
  default_ratio_bps: 9000,
  originator_fee_rate: 10000,
};

const EVM_FILLED: TermsFormValues = {
  ...FILLED,
  defaultRatio: "90",
  originatorFeeRate: "1",
};

describe("EVM terms form", () => {
  it("lists 12 fields with the two EVM fields after their neighbours", () => {
    expect(termsFieldsFor(STELLAR).map((f) => f.key)).toHaveLength(10);
    const keys = termsFieldsFor(EVM).map((f) => f.key);
    expect(keys).toHaveLength(12);
    expect(keys.indexOf("defaultRatio")).toBe(
      keys.indexOf("marginCallRatio") + 1,
    );
    expect(keys.indexOf("originatorFeeRate")).toBe(
      keys.indexOf("defaultRate") + 1,
    );
    expect(termsFieldsFor(EVM).find((f) => f.key === "defaultRatio")).toEqual({
      key: "defaultRatio",
      label: "Default ratio (%)",
      placeholder: "e.g. 90",
    });
    expect(
      termsFieldsFor(EVM).find((f) => f.key === "originatorFeeRate")?.label,
    ).toBe("Originator fee rate (%)");
  });

  it("prefills both fields from the served terms", () => {
    expect(prefillTermsForm(EVM_SERVED_TERMS)).toEqual(EVM_FILLED);
  });

  it("builds set_terms with both fields on EVM and never on Stellar", () => {
    expect(buildSetTermsCall(4, EVM_FILLED, EVM)).toMatchObject({
      fn: "set_terms",
      loanId: 4,
      terms: { defaultRatioBps: 9000, originatorFeeRate: 10000 },
    });
    const stellar = buildSetTermsCall(4, EVM_FILLED, STELLAR);
    expect(stellar).not.toBeNull();
    expect(
      (stellar as unknown as { terms: Record<string, unknown> }).terms,
    ).not.toHaveProperty("defaultRatioBps");
    expect(
      (stellar as unknown as { terms: Record<string, unknown> }).terms,
    ).not.toHaveProperty("originatorFeeRate");
  });

  it("requires both fields on EVM", () => {
    expect(buildSetTermsCall(4, FILLED, EVM)).toBeNull();
    expect(
      buildSetTermsCall(4, { ...EVM_FILLED, defaultRatio: "" }, EVM),
    ).toBeNull();
    expect(
      buildSetTermsCall(4, { ...EVM_FILLED, originatorFeeRate: "x" }, EVM),
    ).toBeNull();
  });

  it("refuses both ratio-order violations with their own message", () => {
    const belowMargin = { ...EVM_FILLED, defaultRatio: "80" };
    expect(buildSetTermsCall(4, belowMargin, EVM)).toBeNull();
    expect(ratioOrderErrorFor(parseTermsForm(belowMargin), EVM)).toBe(
      DEFAULT_RATIO_ORDER_ERROR,
    );
    const marginBelowAdvance = {
      ...EVM_FILLED,
      advanceRatio: "90",
      marginCallRatio: "80",
    };
    expect(buildSetTermsCall(4, marginBelowAdvance, EVM)).toBeNull();
    expect(ratioOrderErrorFor(parseTermsForm(marginBelowAdvance), EVM)).toBe(
      RATIO_ORDER_ERROR,
    );
    expect(ratioOrderErrorFor(parseTermsForm(EVM_FILLED), EVM)).toBeNull();
    expect(ratioOrderErrorFor(parseTermsForm(belowMargin), STELLAR)).toBeNull();
  });

  it("echoes both fields in their raw units", () => {
    expect(termsFieldEcho("defaultRatio", EVM_FILLED)).toEqual({
      echo: "= 9000 bps",
      invalid: false,
    });
    expect(termsFieldEcho("originatorFeeRate", EVM_FILLED).echo).toBe(
      "= 10000 (1e6 scale)",
    );
    expect(
      termsFieldEcho("originatorFeeRate", {
        ...EVM_FILLED,
        originatorFeeRate: "abc",
      }),
    ).toEqual({ echo: null, invalid: true });
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

describe("formatTermsRows EVM", () => {
  it("adds the default ratio and originator fee rate rows only when served", () => {
    const labels = formatTermsRows(EVM_SERVED_TERMS).map((r) => r.label);
    expect(labels).toEqual([
      "Advance ratio",
      "Margin call ratio",
      "Default ratio",
      "Cure period",
      "Price stale after",
      "Payment term",
      "Grace period",
      "Default rate",
      "Originator fee rate",
      "Attestation interval",
      "Inspection interval",
      "Quantity tolerance",
      "Grade tolerance",
    ]);
    const rows = Object.fromEntries(
      formatTermsRows(EVM_SERVED_TERMS).map((r) => [r.label, r.value]),
    );
    expect(rows["Default ratio"]).toBe("90%");
    expect(rows["Originator fee rate"]).toBe("1%");
    expect(
      formatTermsRows({ ...EVM_SERVED_TERMS, default_ratio_bps: null }).map(
        (r) => r.label,
      ),
    ).not.toContain("Default ratio");
    expect(formatTermsRows(SERVED_TERMS)).toHaveLength(11);
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
    flagged_by: "8",
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

  it("finds the flagging inspection by flagged_by even after an Escalated resolution", () => {
    const record = {
      record_id: "2",
      flagged_by: "8",
      inspections: [
        { inspection_id: "7", flagged: false, kind: "StockCount" },
        {
          inspection_id: "8",
          inspector: "GINSPECTOR",
          kind: "StockCount",
          quantity: "90.0000000",
          flagged: true,
          resolution: "Escalated",
        },
        { inspection_id: "9", flagged: false, kind: "QualityCheck" },
      ],
    };
    expect(flaggingInspection(record)?.inspection_id).toBe("8");
    const flag = flaggedRows([record])[0]!.flag;
    expect(flag.find((r) => r.label === "Inspector")?.value).toBe("GINSPECTOR");
    expect(flag.find((r) => r.label === "Quantity")?.value).toBe("90.0000000");
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

describe("mapRelayError", () => {
  it("maps a decoded EVM custom error by name", () => {
    const mapped = mapRelayError(
      "execute",
      new Error("reverted: SecurityRegistryInvalidRatio()"),
      "set_terms",
      EVM,
    );
    expect(mapped.message).toBe(
      "The ratios must be in order: advance ≤ margin call ≤ default.",
    );
    expect(mapped.isSpecific).toBe(true);
  });

  it("keeps the Stellar code mapping on Stellar", () => {
    const mapped = mapRelayError(
      "execute",
      new Error("Error(Contract, #14)"),
      "set_terms",
      STELLAR,
    );
    expect(mapped.message).toContain("no security terms");
    const evm = mapRelayError(
      "execute",
      new Error("Error(Contract, #14)"),
      "set_terms",
      EVM,
    );
    expect(evm.message).not.toContain("no security terms");
  });
});
