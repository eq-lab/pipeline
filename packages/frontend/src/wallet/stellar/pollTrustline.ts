// spec: docs/frontend/wallet-flows.md#design-choices--invariants (post-changeTrust
// bounded trustline poll, #1127).

export interface PollTrustlineOptions {
  attempts?: number;
  intervalMs?: number;
}

export async function pollTrustlineUntilPresent(
  refetch: () => Promise<{ hasTrustline: boolean } | undefined>,
  { attempts = 8, intervalMs = 1500 }: PollTrustlineOptions = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    const snapshot = await refetch();
    if (snapshot?.hasTrustline) return true;
  }
  return false;
}
