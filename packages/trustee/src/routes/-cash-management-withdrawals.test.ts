/**
 * Tests for the Withdrawal Queue presenter (`-cash-management-withdrawals.ts`,
 * #945). The API hook is mocked; the presenter maps served fields and renders
 * `"—"` for the unserved wallet balance — never a fabricated top-up alert.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WithdrawalQueueResponse } from "@/api/useWithdrawalQueue";
import { useWithdrawalQueueView } from "./-cash-management-withdrawals";

vi.mock("@/api/useWithdrawalQueue", () => ({ useWithdrawalQueue: vi.fn() }));
import { useWithdrawalQueue } from "@/api/useWithdrawalQueue";

const mockUseWithdrawalQueue = vi.mocked(useWithdrawalQueue);

const RESPONSE: WithdrawalQueueResponse = {
  summary: {
    in_queue_usd: "1200000.000000",
    requests_count: 6,
    estimated_wait_days: "3.2",
    liquid_cover: null,
  },
  items: [],
};

beforeEach(() => mockUseWithdrawalQueue.mockReset());

describe("useWithdrawalQueueView", () => {
  it("shows served total-claimable and requests; wallet balance is — and no top-up alert", () => {
    mockUseWithdrawalQueue.mockReturnValue({
      data: RESPONSE,
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    const v = useWithdrawalQueueView();
    expect(v.state).toBe("ready");
    expect(v.totalClaimableDisplay).toBe("$1,200,000");
    expect(v.requestsDisplay).toBe("6");
    // No served source for the wallet balance → never fabricated.
    expect(v.walletBalanceDisplay).toBe("—");
    // The alert compares against the (unserved) balance → never shown.
    expect(v.needsTopUp).toBe(false);
  });

  it("reports loading before data arrives", () => {
    mockUseWithdrawalQueue.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: () => {},
    });
    const v = useWithdrawalQueueView();
    expect(v.state).toBe("loading");
    expect(v.totalClaimableDisplay).toBe("—");
    expect(v.requestsDisplay).toBe("—");
  });

  it("surfaces the friendly error, raw text only in errorDetails (#1037)", () => {
    mockUseWithdrawalQueue.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
      refetch: () => {},
    });
    const v = useWithdrawalQueueView();
    expect(v.state).toBe("error");
    expect(v.errorMessage).toBe("Failed to load the withdrawal queue.");
    expect(v.errorDetails).toBe("boom");
  });
});
