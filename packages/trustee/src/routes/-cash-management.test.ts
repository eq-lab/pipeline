/**
 * Unit tests for the Cash Management presenter's pure helpers
 * (`-cash-management.ts`, issue #943). All pure — no DOM, no query layer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// The presenter statically imports the balance/address hooks, whose module
// graph reaches `@stellar/freighter-api` (CommonJS) and breaks under Vitest's
// ESM loader. These pure-helper tests never touch the hooks — stub the modules
// so importing `./-cash-management` doesn't pull that graph in.
vi.mock("@/api/useUsdcCustodyBalance", () => ({
  useUsdcCustodyBalance: vi.fn(),
}));
vi.mock("@/api/useRampAddresses", () => ({ useRampAddresses: vi.fn() }));
vi.mock("@/api/useRampEvents", () => ({ useRampEvents: vi.fn() }));
vi.mock("@/api/useReviewRampEvent", () => ({ useReviewRampEvent: vi.fn() }));

import { useRampEvents } from "@/api/useRampEvents";
import { useReviewRampEvent } from "@/api/useReviewRampEvent";
import { useRampAddresses } from "@/api/useRampAddresses";
import { useUsdcCustodyBalance } from "@/api/useUsdcCustodyBalance";
import {
  truncateStrkey,
  formatRelativeAge,
  formatUsdcAmount,
  useCashManagement,
} from "./-cash-management";

describe("truncateStrkey", () => {
  it("keeps the first 4 + last 4 with an ellipsis for a full Strkey", () => {
    expect(truncateStrkey("GABCD1234567890WXYZ")).toBe("GABC…WXYZ");
  });

  it("renders short addresses whole", () => {
    expect(truncateStrkey("GABC12")).toBe("GABC12");
  });

  it('returns "—" for missing/empty (never fabricated)', () => {
    expect(truncateStrkey(null)).toBe("—");
    expect(truncateStrkey(undefined)).toBe("—");
    expect(truncateStrkey("")).toBe("—");
  });
});

describe("formatRelativeAge", () => {
  const now = 1_800_000_000;

  it('formats sub-minute as "just now"', () => {
    expect(formatRelativeAge(now - 30, now)).toBe("just now");
  });

  it("formats minutes / hours / days", () => {
    expect(formatRelativeAge(now - 5 * 60, now)).toBe("5m ago");
    expect(formatRelativeAge(now - 3 * 3600, now)).toBe("3h ago");
    expect(formatRelativeAge(now - 2 * 86_400, now)).toBe("2d ago");
  });

  it("clamps a future timestamp to just now (never negative)", () => {
    expect(formatRelativeAge(now + 100, now)).toBe("just now");
  });

  it('returns "—" for a missing/invalid stamp', () => {
    expect(formatRelativeAge(null, now)).toBe("—");
    expect(formatRelativeAge(undefined, now)).toBe("—");
    expect(formatRelativeAge(NaN, now)).toBe("—");
  });
});

describe("formatUsdcAmount", () => {
  it("adds thousands separators", () => {
    expect(formatUsdcAmount(8400000)).toBe("8,400,000");
    expect(formatUsdcAmount(1234.5)).toBe("1,234.5");
  });

  it('returns "—" for null / non-finite (never fabricated)', () => {
    expect(formatUsdcAmount(null)).toBe("—");
    expect(formatUsdcAmount(undefined)).toBe("—");
    expect(formatUsdcAmount(NaN)).toBe("—");
  });
});

describe("useCashManagement chain scope", () => {
  beforeEach(() => {
    vi.mocked(useReviewRampEvent).mockReturnValue({
      review: vi.fn(),
      reviewAsync: vi.fn(),
      isPending: false,
      error: null,
      reset: vi.fn(),
      pendingId: null,
    });
    vi.mocked(useRampAddresses).mockReturnValue({
      data: { ramp_addresses: [] },
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    vi.mocked(useUsdcCustodyBalance).mockReturnValue({
      data: "8400000.0000000",
      isLoading: false,
      error: null,
    } as ReturnType<typeof useUsdcCustodyBalance>);
  });

  function withChain(chainId: number) {
    vi.mocked(useRampEvents).mockReturnValue({
      chainId,
      data: { events: [] },
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    return renderHook(() => useCashManagement()).result.current;
  }

  it("labels the Stellar session and shows the custody balance", () => {
    const view = withChain(99_000_001);
    expect(view.chainLabel).toBe("Stellar");
    expect(view.usdcBalanceValue).toBe(8_400_000);
  });

  it("labels an EVM session and never shows the Stellar custody balance", () => {
    const view = withChain(560048);
    expect(view.chainLabel).toBe("Hoodi");
    expect(view.usdcBalanceValue).toBeNull();
    expect(view.usdcBalanceDisplay).toBe("—");
  });
});
