// spec: docs/frontend/trustee-flows.md#loan-detail (`chain` search param, (chain_id, loan_id) identity).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  ENV: { STELLAR_CHAIN_ID: 99_000_001, EVM_CHAIN_ID: 560048 },
}));

import type { LoanBookEntry } from "@/api/useLoanBook";
import { findLoanEntry, loanRowKey, parseLoanRouteSearch } from "./loanRoute";

function entry(chain_id: number, loan_id: string): LoanBookEntry {
  return { chain_id, loan_id, originator: `o-${chain_id}` } as LoanBookEntry;
}

describe("parseLoanRouteSearch", () => {
  it("defaults to the Stellar chain when `chain` is absent", () => {
    expect(parseLoanRouteSearch({})).toEqual({ chain: 99_000_001 });
  });

  it("accepts a numeric or numeric-string `chain`", () => {
    expect(parseLoanRouteSearch({ chain: 560048 })).toEqual({ chain: 560048 });
    expect(parseLoanRouteSearch({ chain: "560048" })).toEqual({
      chain: 560048,
    });
  });

  it("falls back to the Stellar chain for junk values", () => {
    expect(parseLoanRouteSearch({ chain: "abc" }).chain).toBe(99_000_001);
    expect(parseLoanRouteSearch({ chain: -4 }).chain).toBe(99_000_001);
    expect(parseLoanRouteSearch({ chain: 1.5 }).chain).toBe(99_000_001);
    expect(parseLoanRouteSearch({ chain: null }).chain).toBe(99_000_001);
  });
});

describe("findLoanEntry", () => {
  const loans = [
    entry(99_000_001, "4"),
    entry(560048, "4"),
    entry(560048, "7"),
  ];

  it("matches on both chain and loan id", () => {
    expect(findLoanEntry(loans, 560048, "4")?.originator).toBe("o-560048");
    expect(findLoanEntry(loans, 99_000_001, "4")?.originator).toBe(
      "o-99000001",
    );
  });

  it("returns undefined for a missing pair or no data", () => {
    expect(findLoanEntry(loans, 99_000_001, "7")).toBeUndefined();
    expect(findLoanEntry(undefined, 99_000_001, "4")).toBeUndefined();
  });
});

describe("loanRowKey", () => {
  it("joins chain and loan id", () => {
    expect(loanRowKey(560048, "7")).toBe("560048:7");
  });
});
