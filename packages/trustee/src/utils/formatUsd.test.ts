/**
 * Unit tests for `formatRegistryFullUsd` (issue #782), the fully-expanded
 * whole-dollar sibling of `formatRegistryCompactUsd` / `formatRegistryCompact2dpUsd`
 * — applies the ×1000 `scaleRegistryAmount` #840 correction, then
 * `formatFullUsd`. The rest of this module's formatters predate this file and
 * are exercised indirectly via the pages that consume them
 * (`-useLoansTable.test.ts`, `-useLoanDetail.test.ts`).
 */
import { describe, it, expect } from "vitest";
import { formatRegistryFullUsd } from "./formatUsd";

describe("formatRegistryFullUsd", () => {
  it("scales ×1000 then formats as fully-expanded whole dollars", () => {
    // 2300.000000 on the wire ⇒ ×1000 ⇒ $2,300,000.
    expect(formatRegistryFullUsd("2300.000000")).toBe("$2,300,000");
    expect(formatRegistryFullUsd("1840.000000")).toBe("$1,840,000");
  });

  it("formats zero as $0", () => {
    expect(formatRegistryFullUsd("0.000000")).toBe("$0");
  });

  it('returns "—" for null/undefined/non-numeric input', () => {
    expect(formatRegistryFullUsd(null)).toBe("—");
    expect(formatRegistryFullUsd(undefined)).toBe("—");
    expect(formatRegistryFullUsd("not-a-number")).toBe("—");
  });
});
