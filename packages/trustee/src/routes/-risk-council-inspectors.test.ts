// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { describe, it, expect, vi } from "vitest";

vi.mock("@pipeline/wallet-connect", () => ({
  isInspectorAddress: (value: string) => /^G[A-Z0-9]{3,}$/.test(value),
}));
vi.mock("@/api/useRiskCouncil", () => ({ useSecurityInspectors: vi.fn() }));
vi.mock("@/auth/sessionStore", () => ({ useSessionState: vi.fn() }));
vi.mock("./-risk-council-shared", () => ({
  useRiskCouncilActionView: vi.fn(),
}));

import {
  applyInspectorEdits,
  buildInspectorsCall,
  DUPLICATE_ADDRESS,
  INVALID_ADDRESS,
  validateInspectorDraft,
} from "./-risk-council-inspectors";

describe("inspector list editing", () => {
  it("drops removed entries and appends new ones after the current order", () => {
    expect(
      applyInspectorEdits(["GAAA", "GBBB", "GCCC"], new Set(["GBBB"]), [
        "GDDD",
      ]),
    ).toEqual(["GAAA", "GCCC", "GDDD"]);
    expect(applyInspectorEdits([], new Set(), [])).toEqual([]);
  });

  it("does not duplicate an added address that is now on the current panel", () => {
    expect(
      applyInspectorEdits(["GAAA", "GDDD"], new Set(), ["GDDD", "GEEE"]),
    ).toEqual(["GAAA", "GDDD", "GEEE"]);
  });

  it("validates a draft against the Strkey rule and the existing list", () => {
    expect(validateInspectorDraft("", ["GAAA"])).toBeNull();
    expect(validateInspectorDraft("nope", ["GAAA"])).toBe(INVALID_ADDRESS);
    expect(validateInspectorDraft(" GAAA ", ["GAAA"])).toBe(DUPLICATE_ADDRESS);
    expect(validateInspectorDraft("GBBB", ["GAAA"])).toBeNull();
  });
});

describe("buildInspectorsCall", () => {
  it("builds set_inspectors from the resulting list", () => {
    expect(buildInspectorsCall(["GAAA"], ["GAAA", "GBBB"])).toEqual({
      fn: "set_inspectors",
      inspectors: ["GAAA", "GBBB"],
    });
  });

  it("allows an empty resulting list when it changes the panel", () => {
    expect(buildInspectorsCall(["GAAA"], [])).toEqual({
      fn: "set_inspectors",
      inspectors: [],
    });
  });

  it("is null while the panel is unread or nothing changes", () => {
    expect(buildInspectorsCall(undefined, ["GAAA"])).toBeNull();
    expect(buildInspectorsCall(["GAAA"], ["GAAA"])).toBeNull();
    expect(buildInspectorsCall([], [])).toBeNull();
  });
});
