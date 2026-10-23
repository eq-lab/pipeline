import { describe, it, expect } from "vitest";
import {
  formatEpochDate,
  formatMaturityDate,
  formatSubmittedDate,
} from "./formatDate";

process.env.TZ = "America/New_York";

describe("calendar dates render in UTC under a negative-offset zone (#1626)", () => {
  it("runs under a non-UTC zone", () => {
    expect(new Date("2026-12-15T00:00:00Z").getDate()).toBe(14);
  });

  it("formatMaturityDate keeps the UTC day", () => {
    expect(formatMaturityDate(1_797_292_800)).toBe("15 Dec 2026");
  });

  it("formatEpochDate keeps the UTC day", () => {
    expect(formatEpochDate("2026-12-15T00:00:00Z")).toBe("15 Dec 2026");
  });

  it("formatSubmittedDate keeps the UTC day", () => {
    expect(formatSubmittedDate("2026-06-18T00:30:00Z")).toBe("18 Jun");
  });
});
