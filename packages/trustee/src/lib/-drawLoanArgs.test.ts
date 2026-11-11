import { describe, it, expect } from "vitest";
import type { ServedDrawLoanArgs } from "@/api/useLoanSubmissions";
import {
  borrowerRefFull,
  drawLoanBlockedReason,
  formatBorrowerRef,
  readyDrawLoanArgs,
} from "./drawLoanArgs";

const REF = "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12";

const FULL: ServedDrawLoanArgs = {
  metadata_uri: "ipfs://x",
  economics: {
    borrower_ref: REF,
    original_facility_size: "12000000000000",
    original_senior_tranche: "10000000000000",
    original_equity_tranche: "2000000000000",
    original_offtaker_price: "12500000000000",
    senior_interest_rate: 100000,
    origination_date: 1_750_000_000,
    original_maturity_date: 1_780_000_000,
  },
  missing_inputs: [],
};

const MISSING_DATA_ROOM: ServedDrawLoanArgs = {
  ...FULL,
  economics: { ...FULL.economics, borrower_ref: null },
  missing_inputs: ["data_room_id"],
};

describe("readyDrawLoanArgs", () => {
  it("returns the args verbatim for a full block", () => {
    expect(readyDrawLoanArgs(FULL)).toEqual({
      metadata_uri: "ipfs://x",
      economics: FULL.economics,
    });
  });

  it("returns null for a null or undefined block", () => {
    expect(readyDrawLoanArgs(null)).toBeNull();
    expect(readyDrawLoanArgs(undefined)).toBeNull();
  });

  it("returns null when missing_inputs is non-empty even if every field is set", () => {
    expect(
      readyDrawLoanArgs({ ...FULL, missing_inputs: ["metadata_uri"] }),
    ).toBeNull();
  });

  it("returns null when any field is null", () => {
    expect(readyDrawLoanArgs({ ...FULL, metadata_uri: null })).toBeNull();
    for (const key of Object.keys(FULL.economics)) {
      expect(
        readyDrawLoanArgs({
          ...FULL,
          economics: { ...FULL.economics, [key]: null },
        }),
      ).toBeNull();
    }
  });
});

describe("readyDrawLoanArgs formats", () => {
  const withEcon = (patch: Partial<ServedDrawLoanArgs["economics"]>) => ({
    ...FULL,
    economics: { ...FULL.economics, ...patch },
  });

  it("rejects a malformed borrower_ref, non-digit or oversized amounts, and bad rate/dates", () => {
    expect(readyDrawLoanArgs(withEcon({ borrower_ref: "nothex" }))).toBeNull();
    expect(
      readyDrawLoanArgs(withEcon({ original_facility_size: "1000.50" })),
    ).toBeNull();
    expect(
      readyDrawLoanArgs(withEcon({ original_senior_tranche: "-5" })),
    ).toBeNull();
    expect(
      readyDrawLoanArgs(withEcon({ original_equity_tranche: "1e6" })),
    ).toBeNull();
    expect(
      readyDrawLoanArgs(withEcon({ original_offtaker_price: "9".repeat(40) })),
    ).toBeNull();
    expect(
      readyDrawLoanArgs(withEcon({ senior_interest_rate: 1.5 })),
    ).toBeNull();
    expect(
      readyDrawLoanArgs(withEcon({ senior_interest_rate: 2 ** 32 })),
    ).toBeNull();
    expect(readyDrawLoanArgs(withEcon({ origination_date: -1 }))).toBeNull();
    expect(readyDrawLoanArgs({ ...FULL, metadata_uri: "  " })).toBeNull();
  });

  it("makes drawLoanBlockedReason non-null for a malformed block", () => {
    expect(
      drawLoanBlockedReason(withEcon({ borrower_ref: "nothex" })),
    ).toContain("not available");
  });
});

describe("drawLoanBlockedReason", () => {
  it("covers the unavailable, data-room and other-missing copies", () => {
    expect(drawLoanBlockedReason(null)).toContain("not available");
    expect(drawLoanBlockedReason(undefined)).toContain("not available");
    expect(drawLoanBlockedReason(MISSING_DATA_ROOM)).toContain(
      "Data room ID missing",
    );
    expect(
      drawLoanBlockedReason({
        ...FULL,
        missing_inputs: ["economics.origination_date", "metadata_uri"],
      }),
    ).toContain("economics.origination_date, metadata_uri");
  });

  it("is null for a ready block", () => {
    expect(drawLoanBlockedReason(FULL)).toBeNull();
  });
});

describe("formatBorrowerRef / borrowerRefFull", () => {
  it("shortens a 64-char hex and exposes the full value", () => {
    expect(formatBorrowerRef(FULL)).toBe("ab12cd…ab12");
    expect(borrowerRefFull(FULL)).toBe(REF);
  });

  it("shows the data-room-missing copy", () => {
    expect(formatBorrowerRef(MISSING_DATA_ROOM)).toBe("Data room ID missing");
    expect(borrowerRefFull(MISSING_DATA_ROOM)).toBeNull();
  });

  it("falls back to the data room id, then a dash", () => {
    expect(formatBorrowerRef(null, " room-1 ")).toBe("Data room ID room-1");
    expect(formatBorrowerRef(MISSING_DATA_ROOM, "room-1")).toBe(
      "Data room ID room-1",
    );
    expect(formatBorrowerRef(null, "")).toBe("—");
    expect(formatBorrowerRef(null, 5)).toBe("—");
  });

  it("falls back to a dash for an absent block or a malformed ref", () => {
    expect(formatBorrowerRef(null)).toBe("—");
    expect(formatBorrowerRef(undefined)).toBe("—");
    expect(
      formatBorrowerRef({
        ...FULL,
        economics: { ...FULL.economics, borrower_ref: "nothex" },
      }),
    ).toBe("—");
  });
});
