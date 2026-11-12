// spec: docs/frontend/trustee-flows.md#security-card
import { describe, it, expect } from "vitest";
import { ApiError } from "@/api/client";
import type { LoanSecurityResponse } from "@/api/useLoanSecurity";
import {
  buildSecurityCard,
  ltvRowText,
  REFRESH_FAILED_NOTE,
  formatLtvBps,
  formatLtvLine,
  formatMarginCall,
  ltvTone,
  priceStale,
  LTV_NO_VALUE_SENTINEL,
} from "./-loanSecurity";
import { securityResult } from "./-riskCouncilFixtures";

const TERMS = { advance_ratio_bps: 8000, margin_call_ratio_bps: 8500 };

describe("formatLtvBps", () => {
  it("formats one decimal and trims a trailing .0", () => {
    expect(formatLtvBps(8123)).toBe("81.3%");
    expect(formatLtvBps(8000)).toBe("80%");
  });

  it("renders the u32::MAX sentinel as 'No security value'", () => {
    expect(formatLtvBps(LTV_NO_VALUE_SENTINEL)).toBe("No security value");
  });

  it("dashes missing and non-finite values", () => {
    expect(formatLtvBps(null)).toBe("—");
    expect(formatLtvBps(undefined)).toBe("—");
    expect(formatLtvBps(Number.NaN)).toBe("—");
    expect(formatLtvBps("8000")).toBe("—");
  });
});

describe("ltvTone", () => {
  it("is negative when a margin call is open or LTV is above the ratio without an on-chain call", () => {
    expect(ltvTone({ margin_call: { open: true } })).toBe("negative");
    expect(
      ltvTone({ margin_call: { ltv_above_ratio_no_onchain_call: true } }),
    ).toBe("negative");
  });

  it("is attention when LTV exceeds the loan's own advance ratio", () => {
    expect(
      ltvTone({
        terms: TERMS,
        valuation: { ltv_bps: 8123 },
        margin_call: { open: false },
      }),
    ).toBe("attention");
  });

  it("is neutral at or below the advance ratio, on the sentinel, and on missing data", () => {
    expect(ltvTone({ terms: TERMS, valuation: { ltv_bps: 8000 } })).toBe(
      "neutral",
    );
    expect(ltvTone({ valuation: { ltv_bps: LTV_NO_VALUE_SENTINEL } })).toBe(
      "neutral",
    );
    expect(
      ltvTone({
        terms: TERMS,
        valuation: { ltv_bps: LTV_NO_VALUE_SENTINEL },
      }),
    ).toBe("neutral");
    expect(ltvTone({})).toBe("neutral");
    expect(ltvTone(undefined)).toBe("neutral");
  });
});

describe("formatMarginCall", () => {
  it("formats an open call with and without cure-by and overdue", () => {
    const opened = String(Date.UTC(2026, 5, 1) / 1000);
    const cure = String(Date.UTC(2026, 5, 10) / 1000);
    expect(formatMarginCall({ open: true, opened_at: opened })).toBe(
      "Open since 1 Jun 2026",
    );
    expect(
      formatMarginCall({ open: true, opened_at: opened, cure_by: cure }),
    ).toBe("Open since 1 Jun 2026 · cure by 10 Jun 2026");
    expect(
      formatMarginCall({
        open: true,
        opened_at: opened,
        cure_by: cure,
        cure_overdue: true,
      }),
    ).toBe("Open since 1 Jun 2026 · cure by 10 Jun 2026 (overdue)");
  });

  it("says None when closed and dashes otherwise", () => {
    expect(formatMarginCall({ open: false })).toBe("None");
    expect(formatMarginCall({ open: null })).toBe("—");
    expect(formatMarginCall(null)).toBe("—");
    expect(formatMarginCall({ open: true, opened_at: "not-a-number" })).toBe(
      "Open since —",
    );
  });
});

describe("priceStale", () => {
  it("is true through either the valuation or the prices flag", () => {
    expect(priceStale({ valuation: { price_stale: true } })).toBe(true);
    expect(priceStale({ prices: { price_stale: true } })).toBe(true);
    expect(priceStale({ valuation: { price_stale: false } })).toBe(false);
    expect(priceStale({})).toBe(false);
  });
});

describe("buildSecurityCard", () => {
  it("is hidden when not configured and loading while loading", () => {
    expect(
      buildSecurityCard(
        securityResult({ data: undefined, notConfigured: true }),
      ).state,
    ).toBe("hidden");
    expect(
      buildSecurityCard(securityResult({ data: undefined, isLoading: true }))
        .state,
    ).toBe("loading");
  });

  it("maps a non-404 error to a friendly message with the raw text in details", () => {
    const card = buildSecurityCard(
      securityResult({ data: undefined, error: new ApiError("raw boom", 500) }),
    );
    expect(card.state).toBe("error");
    expect(card.errorMessage).not.toContain("raw boom");
    expect(card.errorDetails).toContain("raw boom");
  });

  it("maps terms: null to no-terms with a note", () => {
    const card = buildSecurityCard(
      securityResult({ data: { terms: null, valuation: null } }),
    );
    expect(card.state).toBe("no-terms");
    expect(card.notes).toEqual(["No security terms are set for this loan."]);
    expect(card.rows).toEqual([]);
  });

  it("builds the ready rows from a full snapshot", () => {
    const card = buildSecurityCard(securityResult());
    expect(card.state).toBe("ready");
    expect(card.ltv).toBe("81.3%");
    expect(card.ltvTone).toBe("attention");
    expect(card.rows).toEqual([
      { label: "Advance ratio", value: "80%" },
      { label: "Margin-call ratio", value: "85%" },
      { label: "Security value", value: "$2,106,000" },
      { label: "Amount owed", value: "$1,710,000" },
      { label: "Margin call", value: "None" },
    ]);
    expect(card.priceStale).toBe(false);
    expect(card.refreshPending).toBe(false);
    expect(card.notes).toEqual([]);
  });

  it("dashes the value rows and notes 'No valuation yet.' when valuation is null", () => {
    const card = buildSecurityCard(
      securityResult({
        data: { terms: TERMS, valuation: null, margin_call: null },
      }),
    );
    expect(card.ltv).toBe("—");
    expect(card.rows.find((r) => r.label === "Security value")?.value).toBe(
      "—",
    );
    expect(card.rows.find((r) => r.label === "Amount owed")?.value).toBe("—");
    expect(card.rows.find((r) => r.label === "Margin call")?.value).toBe("—");
    expect(card.notes).toEqual(["No valuation yet."]);
  });

  it("carries refresh_pending and the stale flag from either source", () => {
    const card = buildSecurityCard(
      securityResult({
        data: {
          terms: TERMS,
          refresh_pending: true,
          prices: { price_stale: true },
        },
      }),
    );
    expect(card.refreshPending).toBe(true);
    expect(card.priceStale).toBe(true);
  });

  it("does not throw on a partial 200", () => {
    const empty: LoanSecurityResponse = {};
    expect(() =>
      buildSecurityCard(securityResult({ data: empty })),
    ).not.toThrow();
    expect(buildSecurityCard(securityResult({ data: empty })).state).toBe(
      "no-terms",
    );
    expect(buildSecurityCard(securityResult({ data: undefined })).state).toBe(
      "no-terms",
    );
  });
});

function line(result: Parameters<typeof buildSecurityCard>[0]) {
  return formatLtvLine(buildSecurityCard(result), result.data);
}

describe("formatLtvLine", () => {
  it("is null when not ready or without terms", () => {
    expect(
      line(securityResult({ data: undefined, notConfigured: true })),
    ).toBeNull();
    expect(line(securityResult({ data: { terms: null } }))).toBeNull();
    expect(
      line(securityResult({ data: undefined, isLoading: true })),
    ).toBeNull();
  });

  it("appends the margin-call ratio, open call or above-ratio clause", () => {
    expect(line(securityResult())).toBe("81.3% — margin call at 85%");
    expect(
      line(
        securityResult({
          data: {
            terms: TERMS,
            valuation: { ltv_bps: 9000 },
            margin_call: { open: true },
          },
        }),
      ),
    ).toBe("90% — margin call open");
    expect(
      line(
        securityResult({
          data: {
            terms: TERMS,
            valuation: { ltv_bps: 9000 },
            margin_call: { open: false, ltv_above_ratio_no_onchain_call: true },
          },
        }),
      ),
    ).toBe("90% — above the 85% margin-call ratio");
  });

  it("falls back to the bare LTV without a served margin-call ratio", () => {
    expect(
      line(
        securityResult({
          data: { terms: {}, valuation: { ltv_bps: 7000 } },
        }),
      ),
    ).toBe("70%");
  });

  it("does not print a bare dash when there is no valuation", () => {
    expect(line(securityResult({ data: { terms: TERMS } }))).toBe(
      "No valuation yet — margin call at 85%",
    );
  });
});

describe("ltvRowText", () => {
  it("distinguishes loading and error from hidden", () => {
    const text = (r: Parameters<typeof buildSecurityCard>[0]) =>
      ltvRowText(buildSecurityCard(r), r.data);
    expect(text(securityResult({ data: undefined, isLoading: true }))).toBe(
      "Loading…",
    );
    expect(
      text(securityResult({ data: undefined, error: new Error("boom") })),
    ).toBe("Couldn't load");
    expect(
      text(securityResult({ data: undefined, notConfigured: true })),
    ).toBeNull();
  });
});

describe("rounding and refresh failure", () => {
  it("rounds the LTV up so the percentage never contradicts the tone", () => {
    expect(formatLtvBps(8001)).toBe("80.1%");
    expect(formatLtvBps(8501)).toBe("85.1%");
    expect(formatLtvBps(8000)).toBe("80%");
  });

  it("keeps the loaded card and adds a note when a refresh fails", () => {
    const card = buildSecurityCard(securityResult({ error: new Error("502") }));
    expect(card.state).toBe("ready");
    expect(card.notes).toContain(REFRESH_FAILED_NOTE);
  });

  it("shows the error state only when there is no data", () => {
    expect(
      buildSecurityCard(
        securityResult({ data: undefined, error: new Error("502") }),
      ).state,
    ).toBe("error");
  });
});
