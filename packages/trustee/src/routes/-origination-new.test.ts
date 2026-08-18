/** Tests for -origination-new.ts pure transforms (#1100). */
import { describe, it, expect } from "vitest";
import {
  buildSubmitLoanInput,
  emptyFormValues,
  parseSubmissionJson,
} from "./-origination-new";

const EXAMPLE_JSON = JSON.stringify({
  to: "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU",
  metadata_uri: "https://example.com/ipfs/QmeaPY",
  originator: "Alan Walkovitz",
  borrower_id: "Open Mineral",
  commodity: "Jet fuel JET A-1",
  corridor: "South Korea → Mongolia",
  governing_law: "English law, LCIA London",
  protection: "LC at sight",
  secondary_metadata_uri: "https://example.com/ipfs/QmVYYN",
  documents: [
    { name: "Agreement", uri: "https://example.com/ipfs/QmPm7z" },
    { name: "License", uri: "https://example.com/ipfs/QmWaMy" },
  ],
  economics: {
    original_facility_size: "1200000.000000",
    original_senior_tranche: "1000000.000000",
    original_equity_tranche: "200000.000000",
    original_offtaker_price: "1200000.000000",
    senior_interest_rate_bps: 1000,
    origination_date: 1781806657,
    original_maturity_date: 1881806657,
  },
  initial_ccr: 1500000,
  initial_location: {
    location_type: "Vessel",
    location_identifier: "IMO 9834521",
    tracking_url: "https://track.example.com/IMO9834521",
    updated_at: 1781806657,
  },
});

function completeValues(): Record<string, string> {
  const parsed = parseSubmissionJson(EXAMPLE_JSON);
  if (!parsed.ok) throw new Error("example must parse");
  return {
    ...emptyFormValues(),
    ...parsed.values,
    "collateral_valuation.valuation_mode": "MetalConcentrate",
    "collateral_valuation.asset": "XAU",
    "collateral_valuation.price_provider": "coingecko",
    "collateral_valuation.haircut_pct": "0.15",
    "collateral_valuation.quantity_dmt": "620",
    "fee_schedule.mgmt_fee_rate_bps": "100",
    "fee_schedule.perf_fee_rate_bps": "2000",
    "fee_schedule.oet_alloc_rate_bps": "50",
  };
}

describe("parseSubmissionJson", () => {
  it("autofills every field present and lists exactly the missing required paths (issue example)", () => {
    const parsed = parseSubmissionJson(EXAMPLE_JSON);
    if (!parsed.ok) throw new Error(parsed.error);

    expect(parsed.values["to"]).toBe(
      "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU",
    );
    expect(parsed.values["economics.original_facility_size"]).toBe(
      "1200000.000000",
    );
    expect(parsed.values["economics.senior_interest_rate_bps"]).toBe("1000");
    expect(parsed.values["initial_ccr"]).toBe("1500000");
    expect(parsed.values["initial_location.location_identifier"]).toBe(
      "IMO 9834521",
    );

    expect(parsed.missingFields).toEqual([
      "collateral_valuation.valuation_mode",
      "collateral_valuation.asset",
      "collateral_valuation.price_provider",
      "collateral_valuation.haircut_pct",
      "collateral_valuation.quantity_dmt",
      "fee_schedule.mgmt_fee_rate_bps",
      "fee_schedule.perf_fee_rate_bps",
      "fee_schedule.oet_alloc_rate_bps",
    ]);
  });

  it("imports documents rows and drops malformed entries", () => {
    const parsed = parseSubmissionJson(EXAMPLE_JSON);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.documents).toEqual([
      { name: "Agreement", uri: "https://example.com/ipfs/QmPm7z" },
      { name: "License", uri: "https://example.com/ipfs/QmWaMy" },
    ]);

    const withBadDoc = parseSubmissionJson(
      JSON.stringify({
        documents: [{ name: "ok", uri: "u" }, { name: 3 }, "x"],
      }),
    );
    if (!withBadDoc.ok) throw new Error(withBadDoc.error);
    expect(withBadDoc.documents).toEqual([{ name: "ok", uri: "u" }]);
  });

  it("does not list optional fields (protection / secondary_metadata_uri) as missing", () => {
    const parsed = parseSubmissionJson("{}");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.missingFields).not.toContain("protection");
    expect(parsed.missingFields).not.toContain("secondary_metadata_uri");
    expect(parsed.missingFields).toContain("to");
    expect(parsed.missingFields).toContain("metadata_uri");
  });

  it("rejects malformed JSON with a parse error", () => {
    const parsed = parseSubmissionJson("{ nope");
    expect(parsed).toEqual({
      ok: false,
      error: "Not valid JSON — nothing was imported.",
    });
  });

  it("rejects a non-object root (arrays, strings) — single object only", () => {
    for (const text of ["[]", '"str"', "42", "null"]) {
      const parsed = parseSubmissionJson(text);
      expect(parsed.ok).toBe(false);
    }
  });
});

describe("buildSubmitLoanInput", () => {
  it("builds the full payload with verbatim amount strings and coerced numerics", () => {
    const built = buildSubmitLoanInput(completeValues(), [
      { name: "Agreement", uri: "ipfs://doc" },
    ]);
    if (!built.ok) throw new Error(JSON.stringify(built.fieldErrors));

    expect(built.input.economics.original_facility_size).toBe("1200000.000000");
    expect(built.input.economics.senior_interest_rate_bps).toBe(1000);
    expect(built.input.economics.origination_date).toBe(1781806657);
    expect(built.input.initial_ccr).toBe(1500000);
    expect(built.input.fee_schedule).toEqual({
      mgmt_fee_rate_bps: 100,
      perf_fee_rate_bps: 2000,
      oet_alloc_rate_bps: 50,
    });
    expect(built.input.collateral_valuation.haircut_pct).toBe("0.15");
    expect(built.input.documents).toEqual([
      { name: "Agreement", uri: "ipfs://doc" },
    ]);
    expect(built.input.secondary_metadata_uri).toBe(
      "https://example.com/ipfs/QmVYYN",
    );
  });

  it("omits secondary_metadata_uri when empty and keeps protection as an empty string", () => {
    const values = {
      ...completeValues(),
      secondary_metadata_uri: "",
      protection: "",
    };
    const built = buildSubmitLoanInput(values, []);
    if (!built.ok) throw new Error(JSON.stringify(built.fieldErrors));
    expect("secondary_metadata_uri" in built.input).toBe(false);
    expect(built.input.protection).toBe("");
  });

  it("flags empty required fields and non-numeric numeric fields, never building a payload", () => {
    const values = {
      ...completeValues(),
      to: "",
      "economics.senior_interest_rate_bps": "10.5",
    };
    const built = buildSubmitLoanInput(values, []);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.fieldErrors["to"]).toBe("Required.");
    expect(built.fieldErrors["economics.senior_interest_rate_bps"]).toBe(
      "Must be a whole non-negative number.",
    );
  });

  it("flags document rows with a missing name or URI", () => {
    const built = buildSubmitLoanInput(completeValues(), [
      { name: "", uri: "ipfs://x" },
    ]);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.fieldErrors["documents.0"]).toBe(
      "Both name and URI are required.",
    );
  });
});
