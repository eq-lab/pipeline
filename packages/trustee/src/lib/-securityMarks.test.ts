// spec: docs/frontend/trustee-flows.md#security-marks-1859
import { describe, it, expect } from "vitest";
import {
  accessState,
  consentFormError,
  formatMoveBps,
  markDueReasonsText,
  newMaturitySeconds,
  reportHashFor,
  revalueFormError,
  revalueNeedsEvidence,
  securityMarksErrorCopy,
  suggestionStatusLabel,
  type RevalueSeed,
} from "./securityMarks";

const HASH = "ab".repeat(32);
const EVIDENCE_HASH = "cd".repeat(32);
const SEED: RevalueSeed = {
  recordId: 7,
  title: "Record #7",
  suggestedValue: "9600.0000000",
  suggestedBenchmark: "LME_Cu",
  suggestedHash: HASH,
  currentBenchmark: "LME_Cu",
};
const ACCEPTED = { value: "9600.0000000", benchmark: "LME_Cu", evidence: "" };

describe("mark view helpers", () => {
  it("maps statuses, reasons and the served move", () => {
    expect(suggestionStatusLabel("ok")).toBeNull();
    expect(suggestionStatusLabel(null)).toBeNull();
    expect(suggestionStatusLabel("no_price")).toBe(
      "No recent price is available",
    );
    expect(suggestionStatusLabel("brand_new")).toBe("brand_new");
    expect(markDueReasonsText(["missing"])).toBe("No mark set");
    expect(markDueReasonsText([])).toBe("—");
    expect(markDueReasonsText(null)).toBe("—");
    expect(markDueReasonsText(["odd"])).toBe("odd");
    expect(formatMoveBps(-120)).toBe("-120 bps");
    expect(formatMoveBps(0)).toBe("0 bps");
    expect(formatMoveBps(null)).toBe("—");
  });

  it("derives the access state from the served can_call", () => {
    expect(accessState(undefined)).toBe("checking");
    expect(accessState({ immediate: true, delay: 0 })).toBe("ok");
    expect(accessState({ immediate: false, delay: 0 })).toBe("no-role");
    expect(accessState({ immediate: false, delay: 3600 })).toBe("no-role");
  });
});

describe("revalue form", () => {
  it("accepts the unchanged suggestion without evidence", () => {
    expect(revalueNeedsEvidence(ACCEPTED, SEED)).toBe(false);
    expect(revalueFormError(ACCEPTED, SEED)).toBeNull();
  });

  it("requires evidence when the value or benchmark changes", () => {
    const changed = { ...ACCEPTED, value: "9700" };
    expect(revalueNeedsEvidence(changed, SEED)).toBe(true);
    expect(revalueFormError(changed, SEED)).toBe(
      "Describe the source of your price.",
    );
    expect(
      revalueFormError({ ...changed, evidence: "LME 14:00" }, SEED),
    ).toBeNull();
    expect(
      revalueNeedsEvidence({ ...ACCEPTED, benchmark: "OTHER" }, SEED),
    ).toBe(true);
  });

  it("requires evidence when nothing was suggested", () => {
    const empty = { ...SEED, suggestedValue: null, suggestedHash: null };
    expect(revalueNeedsEvidence(ACCEPTED, empty)).toBe(true);
  });

  it("allows zero and rejects negatives, 8 dp, text, empty and a bad benchmark", () => {
    const base = { ...ACCEPTED, evidence: "x" };
    expect(revalueFormError({ ...base, value: "0" }, SEED)).toBeNull();
    expect(revalueFormError({ ...base, value: "-1" }, SEED)).toBe(
      "The price can't be negative.",
    );
    expect(revalueFormError({ ...base, value: "1.12345678" }, SEED)).toMatch(
      /7 decimals/,
    );
    expect(revalueFormError({ ...base, value: "abc" }, SEED)).toMatch(
      /7 decimals/,
    );
    expect(revalueFormError({ ...base, value: " " }, SEED)).toBe(
      "Enter the price per unit.",
    );
    expect(revalueFormError({ ...base, benchmark: "bad name" }, SEED)).toMatch(
      /underscores/,
    );
    expect(revalueFormError({ ...base, benchmark: "" }, SEED)).toBe(
      "Enter the benchmark.",
    );
  });

  it("uses the served hash when accepted and the evidence hash when overridden", () => {
    expect(reportHashFor(ACCEPTED, SEED, null)).toBe(HASH);
    const changed = { ...ACCEPTED, value: "1", evidence: "x" };
    expect(reportHashFor(changed, SEED, EVIDENCE_HASH)).toBe(EVIDENCE_HASH);
    expect(reportHashFor(changed, SEED, null)).toBeNull();
  });
});

describe("extension consent form", () => {
  const today = "2026-11-18";

  it("validates the date and the reference", () => {
    expect(consentFormError({ dateInput: "", reference: "x" }, today)).toBe(
      "Pick the new maturity date.",
    );
    expect(
      consentFormError({ dateInput: "2026-11-18", reference: "x" }, today),
    ).toBe("Pick a date after today (UTC).");
    expect(
      consentFormError({ dateInput: "2027-01-01", reference: " " }, today),
    ).toBe("Enter the buyers' consent reference.");
    expect(
      consentFormError(
        { dateInput: "2027-01-01", reference: "email-1" },
        today,
      ),
    ).toBeNull();
  });

  it("converts the picked date to 00:00 UTC seconds", () => {
    expect(newMaturitySeconds("2027-01-01")).toBe(1798761600);
  });
});

describe("securityMarksErrorCopy", () => {
  it("maps known registry codes and keeps the raw details", () => {
    const err = new Error("simulation error: HostError: Error(Contract, #14)");
    const copy = securityMarksErrorCopy(err, "fallback");
    expect(copy.message).toBe(
      "This loan has no security terms yet. Set them first.",
    );
    expect(copy.details).toContain("#14");
  });

  it("falls back for an unknown code and keeps wallet rejections", () => {
    expect(
      securityMarksErrorCopy(new Error("Error(Contract, #999)"), "fallback")
        .message,
    ).toBe("fallback");
    expect(
      securityMarksErrorCopy(new Error("User rejected the request"), "x")
        .message,
    ).toMatch(/cancelled/);
  });
});
