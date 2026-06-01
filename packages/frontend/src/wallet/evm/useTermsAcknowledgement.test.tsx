/**
 * The terms-acknowledgement tests have moved to `src/wallet/useTermsAcknowledgement.test.tsx`.
 *
 * The address-scoped EVM implementation (`src/wallet/evm/useTermsAcknowledgement.ts`)
 * has been superseded by a single chain-agnostic flat flag in
 * `src/wallet/useTermsAcknowledgement.ts`. All test cases for the new
 * implementation live there, including migration coverage.
 *
 * This stub satisfies vitest's "at least one describe" requirement while keeping
 * the file discoverable for any tooling that scans the evm/ directory.
 */
import { describe, it } from "vitest";

// Tests migrated — see src/wallet/useTermsAcknowledgement.test.tsx
describe("useTermsAcknowledgement (evm) — migrated", () => {
  it("stub: tests have moved to src/wallet/useTermsAcknowledgement.test.tsx", () => {
    // intentionally empty — see migration note above
  });
});
