/**
 * Tests for the Risk Council "Escalate to Default" presenter's pure helpers
 * (`-risk-council-escalate.ts`, issue #782). All pure — no DOM, no query
 * layer, no `renderHook` (mirrors `-useLoanDetail.test.ts` / `-record-coupon.test.ts`'s
 * convention: the hook's own wiring is exercised end-to-end via the page
 * render test, `-risk-council-escalate-page.test.tsx`).
 *
 * Covers the CCR next-alert threshold math, the registry ×1000 (#840) full-USD
 * facility/repaid/collateral formatting, the real-7d (never-"30d") collateral
 * label, the at-risk line (real current % + MOCK projection), and the
 * commodity-concentration match/no-match logic.
 */
import { describe, it, expect } from "vitest";
import type { TopConcentration } from "@/api/useLoanBook";
import {
  buildAtRiskLine,
  buildCollateralLabel,
  buildConcentration,
  buildRepaidToDate,
  formatCcrLine,
  formatFacilityLine,
  nextCcrAlertPct,
  MOCK_AT_RISK_PROJECTED_PCT,
  MOCK_DAYS_ON_WATCHLIST,
} from "./-risk-council-escalate";

describe("nextCcrAlertPct", () => {
  it("returns 110 for a CCR between 110% and 120% (pre-default band)", () => {
    expect(nextCcrAlertPct(11_400)).toBe(110);
  });

  it("returns 120 for a CCR between 120% and 130% (attention band)", () => {
    expect(nextCcrAlertPct(12_500)).toBe(120);
  });

  it("returns null for a CCR at/above the 130% healthy floor", () => {
    expect(nextCcrAlertPct(13_500)).toBeNull();
    expect(nextCcrAlertPct(13_000)).toBe(120);
  });

  it("returns null at/below the 110% margin-call floor (no lower alert to name)", () => {
    expect(nextCcrAlertPct(11_000)).toBeNull();
    expect(nextCcrAlertPct(9_000)).toBeNull();
  });

  it("returns null for null/non-finite input (never fabricates)", () => {
    expect(nextCcrAlertPct(null)).toBeNull();
    expect(nextCcrAlertPct(Number.NaN)).toBeNull();
  });
});

describe("formatCcrLine", () => {
  it('formats "114% — next alert at 110%" for a declining pre-default CCR', () => {
    expect(formatCcrLine(11_400)).toBe("114% — next alert at 110%");
  });

  it("omits the alert clause once there is no further threshold to name", () => {
    expect(formatCcrLine(10_500)).toBe("105%");
  });

  it('returns "—" for null/non-finite CCR', () => {
    expect(formatCcrLine(null)).toBe("—");
    expect(formatCcrLine(Number.NaN)).toBe("—");
  });
});

describe("formatFacilityLine", () => {
  it("scales both amounts ×1000 (#840) and formats as full USD", () => {
    // 2300.000000 / 1840.000000 on the wire ⇒ ×1000 ⇒ $2,300,000 / $1,840,000.
    expect(formatFacilityLine("2300.000000", "1840.000000")).toBe(
      "$2,300,000 / $1,840,000",
    );
  });

  it('renders "—" for missing amounts', () => {
    expect(formatFacilityLine(null, null)).toBe("— / —");
  });
});

describe("buildRepaidToDate", () => {
  it("computes offtaker − offtaker_outstanding, both registry-scaled (#840)", () => {
    // 2000.000000 / 1200.000000 on the wire ⇒ ×1000 ⇒ $2,000,000 − $1,200,000.
    expect(buildRepaidToDate("2000.000000", "1200.000000")).toBe("$800,000");
  });

  it("clamps at $0 (never negative)", () => {
    expect(buildRepaidToDate("1000.000000", "1500.000000")).toBe("$0");
  });

  it('returns "—" when either financials field is unavailable', () => {
    expect(buildRepaidToDate(null, "1200.000000")).toBe("—");
    expect(buildRepaidToDate("2000.000000", undefined)).toBe("—");
  });
});

describe("buildCollateralLabel", () => {
  it('uses the REAL 7-day basis, never a fabricated "30d" relabel (exec-plan RISK 3)', () => {
    expect(buildCollateralLabel("Coffee", "-0.18")).toBe(
      "Collateral (coffee −18% 7d)",
    );
  });

  it("renders a positive change with the + sign", () => {
    expect(buildCollateralLabel("Copper Concentrate", "0.05")).toBe(
      "Collateral (copper concentrate +5% 7d)",
    );
  });

  it("omits the parenthetical entirely when no spot change is served (never fabricated)", () => {
    expect(buildCollateralLabel("Coffee", null)).toBe("Collateral");
    expect(buildCollateralLabel("Coffee", undefined)).toBe("Collateral");
  });
});

describe("buildAtRiskLine", () => {
  it("formats the real current at-risk % and pairs it with the MOCK projection", () => {
    const line = buildAtRiskLine("0.0210");
    expect(line.current).toBe("2.1%");
    expect(line.projected).toBe(MOCK_AT_RISK_PROJECTED_PCT);
  });

  it('renders "—" for the current % when unavailable', () => {
    expect(buildAtRiskLine(null).current).toBe("—");
  });
});

describe("buildConcentration", () => {
  const topConcentration: TopConcentration = {
    commodity: "Coffee",
    share: "0.0390",
  };

  it("renders the served share when the top concentration names THIS loan's commodity", () => {
    const result = buildConcentration("Coffee", topConcentration);
    expect(result).toEqual({ label: "Coffee concentration", value: "3.9%" });
  });

  it("matches case-insensitively", () => {
    const result = buildConcentration("coffee", topConcentration);
    expect(result.value).toBe("3.9%");
  });

  it("renders — when the top concentration names a different commodity (never fabricated)", () => {
    const result = buildConcentration("Lithium", topConcentration);
    expect(result).toEqual({ label: "Lithium concentration", value: "—" });
  });

  it("renders — when no top concentration is served", () => {
    expect(buildConcentration("Coffee", null)).toEqual({
      label: "Coffee concentration",
      value: "—",
    });
  });
});

describe("mock constants (issue #782 — no backend source, not per-loan)", () => {
  it("are documented, stable Figma literals", () => {
    expect(MOCK_DAYS_ON_WATCHLIST).toBe("18");
    expect(MOCK_AT_RISK_PROJECTED_PCT).toBe("4.3%");
  });
});
