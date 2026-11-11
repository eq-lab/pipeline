/** Tests for -origination-new.ts pure transforms (#1100). */
import { describe, it, expect } from "vitest";
import {
  buildSubmitLoanInput,
  emptyFormValues,
  parseSubmissionJson,
} from "./-origination-new";

const EXAMPLE_JSON = JSON.stringify({
  metadata_uri: "https://example.com/ipfs/QmeaPY",
  data_room_id: "DR-0001",
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
});

function completeValues(): Record<string, string> {
  const parsed = parseSubmissionJson(EXAMPLE_JSON, OFFERED);
  if (!parsed.ok) throw new Error("example must parse");
  return {
    ...emptyFormValues(),
    target_chain_id: "99000001",
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

const OFFERED = [99_000_001, 560048];

describe("parseSubmissionJson", () => {
  it("autofills every field present and lists exactly the missing required paths (issue example)", () => {
    const parsed = parseSubmissionJson(EXAMPLE_JSON, OFFERED);
    if (!parsed.ok) throw new Error(parsed.error);

    expect(parsed.values["data_room_id"]).toBe("DR-0001");
    expect(parsed.values["economics.original_facility_size"]).toBe(
      "1200000.000000",
    );
    expect(parsed.values["economics.senior_interest_rate_bps"]).toBe("1000");

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

  it("imports a legacy payload: ignores to / initial_* and lists data_room_id as missing", () => {
    const legacy = JSON.parse(EXAMPLE_JSON);
    delete legacy.data_room_id;
    const parsed = parseSubmissionJson(
      JSON.stringify({
        ...legacy,
        to: "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU",
        initial_ccr: 1500000,
        initial_location: { location_type: "Vessel" },
      }),
      OFFERED,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.values["metadata_uri"]).toBe(
      "https://example.com/ipfs/QmeaPY",
    );
    expect("to" in parsed.values).toBe(false);
    expect("initial_ccr" in parsed.values).toBe(false);
    expect(parsed.missingFields).toContain("data_room_id");
  });

  it("imports documents rows and drops malformed entries", () => {
    const parsed = parseSubmissionJson(EXAMPLE_JSON, OFFERED);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.documents).toEqual([
      { name: "Agreement", uri: "https://example.com/ipfs/QmPm7z" },
      { name: "License", uri: "https://example.com/ipfs/QmWaMy" },
    ]);

    const withBadDoc = parseSubmissionJson(
      JSON.stringify({
        documents: [{ name: "ok", uri: "u" }, { name: 3 }, "x"],
      }),
      OFFERED,
    );
    if (!withBadDoc.ok) throw new Error(withBadDoc.error);
    expect(withBadDoc.documents).toEqual([{ name: "ok", uri: "u" }]);
  });

  it("does not list optional fields (protection / secondary_metadata_uri) as missing", () => {
    const parsed = parseSubmissionJson("{}", OFFERED);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.missingFields).not.toContain("protection");
    expect(parsed.missingFields).not.toContain("secondary_metadata_uri");
    expect(parsed.missingFields).toContain("data_room_id");
    expect(parsed.missingFields).toContain("metadata_uri");
  });

  it("rejects malformed JSON with a parse error", () => {
    const parsed = parseSubmissionJson("{ nope", OFFERED);
    expect(parsed).toEqual({
      ok: false,
      error: "Not valid JSON — nothing was imported.",
    });
  });

  it("rejects a non-object root (arrays, strings) — single object only", () => {
    for (const text of ["[]", '"str"', "42", "null"]) {
      const parsed = parseSubmissionJson(text, OFFERED);
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
    expect(built.input.data_room_id).toBe("DR-0001");
    expect("to" in built.input).toBe(false);
    expect("initial_ccr" in built.input).toBe(false);
    expect("initial_location" in built.input).toBe(false);
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
      data_room_id: "   ",
      "economics.senior_interest_rate_bps": "10.5",
    };
    const built = buildSubmitLoanInput(values, []);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.fieldErrors["data_room_id"]).toBe("Required.");
    expect(built.fieldErrors["economics.senior_interest_rate_bps"]).toBe(
      "Must be a whole non-negative number.",
    );
  });

  it("trims data_room_id in the built input", () => {
    const built = buildSubmitLoanInput(
      { ...completeValues(), data_room_id: "  DR-0002  " },
      [],
    );
    if (!built.ok) throw new Error(JSON.stringify(built.fieldErrors));
    expect(built.input.data_room_id).toBe("DR-0002");
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

describe("target chain (#1536)", () => {
  it("starts with no chosen chain, and sends the chosen one as chainId, not in the body", () => {
    expect(emptyFormValues().target_chain_id).toBe("");
    const built = buildSubmitLoanInput(
      { ...completeValues(), target_chain_id: "99000001" },
      [],
    );
    if (!built.ok) throw new Error(JSON.stringify(built.fieldErrors));
    expect(built.chainId).toBe(99_000_001);
    expect("target_chain_id" in built.input).toBe(false);
  });

  it("rejects an empty target chain as Required.", () => {
    const built = buildSubmitLoanInput(
      { ...completeValues(), target_chain_id: "" },
      [],
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.fieldErrors.target_chain_id).toBe("Required.");
  });

  it("uses the selected EVM chain id", () => {
    const built = buildSubmitLoanInput(
      { ...completeValues(), target_chain_id: "560048" },
      [],
    );
    if (!built.ok) throw new Error(JSON.stringify(built.fieldErrors));
    expect(built.chainId).toBe(560048);
  });

  it("JSON import: a target_chain_id that is not offered is ignored", () => {
    const parsed = parseSubmissionJson(
      JSON.stringify({ ...JSON.parse(EXAMPLE_JSON), target_chain_id: 560048 }),
      [99_000_001],
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect("target_chain_id" in parsed.values).toBe(false);
    expect(parsed.missingFields).not.toContain("target_chain_id");
  });

  it("JSON import: an offered target_chain_id sets the selector, anything else leaves it alone, and it is never 'missing'", () => {
    const withEvm = parseSubmissionJson(
      JSON.stringify({ ...JSON.parse(EXAMPLE_JSON), target_chain_id: 560048 }),
      OFFERED,
    );
    if (!withEvm.ok) throw new Error(withEvm.error);
    expect(withEvm.values.target_chain_id).toBe("560048");
    expect(withEvm.missingFields).not.toContain("target_chain_id");

    const unknown = parseSubmissionJson(
      JSON.stringify({ ...JSON.parse(EXAMPLE_JSON), target_chain_id: 5 }),
      OFFERED,
    );
    if (!unknown.ok) throw new Error(unknown.error);
    expect("target_chain_id" in unknown.values).toBe(false);

    const absent = parseSubmissionJson(EXAMPLE_JSON, OFFERED);
    if (!absent.ok) throw new Error(absent.error);
    expect("target_chain_id" in absent.values).toBe(false);
    expect(absent.missingFields).not.toContain("target_chain_id");
  });
});

describe("USDC amount fields (#1620)", () => {
  function withEconomics(overrides: Record<string, string>) {
    return { ...completeValues(), ...overrides };
  }

  it("accepts human-unit USDC with up to 6 decimals and passes the string through unchanged", () => {
    for (const value of ["1200000.000000", "1200000", "100.5", "0.000001"]) {
      const built = buildSubmitLoanInput(
        withEconomics({
          "economics.original_facility_size": value,
          "economics.original_senior_tranche": value,
          "economics.original_equity_tranche": "0",
          "economics.original_offtaker_price": value,
        }),
        [],
      );
      expect(built.ok).toBe(true);
      if (built.ok)
        expect(built.input.economics.original_facility_size).toBe(value);
    }
  });

  it("rejects more than 6 decimals or a non-decimal instead of truncating", () => {
    for (const value of ["0.1234567", "1,200,000", "$1200000", "abc", "-1"]) {
      const built = buildSubmitLoanInput(
        withEconomics({ "economics.original_facility_size": value }),
        [],
      );
      expect(built.ok).toBe(false);
      if (!built.ok)
        expect(built.fieldErrors["economics.original_facility_size"]).toMatch(
          /at most 6 decimals/,
        );
    }
  });
});
