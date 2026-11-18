// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { describe, it, expect, vi } from "vitest";

vi.mock("@pipeline/wallet-connect", () => ({
  isInspectorAddress: (value: string) => /^G[A-Z0-9]{3,}$/.test(value),
  isEvmInspectorAddress: (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value),
  normalizeEvmAddress: (value: string) => `0x${value.slice(2).toUpperCase()}`,
}));

const STELLAR = 99_000_001;
const EVM = 560048;
const EVM_A = `0x${"a".repeat(40)}`;
const EVM_B = `0x${"b".repeat(40)}`;
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
  INVALID_EVM_ADDRESS,
  inspectorAddressField,
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
    expect(validateInspectorDraft("", ["GAAA"], STELLAR)).toBeNull();
    expect(validateInspectorDraft("nope", ["GAAA"], STELLAR)).toBe(
      INVALID_ADDRESS,
    );
    expect(validateInspectorDraft(" GAAA ", ["GAAA"], STELLAR)).toBe(
      DUPLICATE_ADDRESS,
    );
    expect(validateInspectorDraft("GBBB", ["GAAA"], STELLAR)).toBeNull();
  });

  it("validates an EVM draft as a 0x address and dedups case-insensitively", () => {
    expect(validateInspectorDraft("", [EVM_A], EVM)).toBeNull();
    expect(validateInspectorDraft("GAAA", [EVM_A], EVM)).toBe(
      INVALID_EVM_ADDRESS,
    );
    expect(INVALID_EVM_ADDRESS).toBe("Enter a valid EVM address (0x…).");
    expect(
      validateInspectorDraft(
        EVM_A.toUpperCase().replace("0X", "0x"),
        [EVM_A],
        EVM,
      ),
    ).toBe(DUPLICATE_ADDRESS);
    expect(validateInspectorDraft(EVM_B, [EVM_A], EVM)).toBeNull();
  });

  it("words the address field per chain", () => {
    expect(inspectorAddressField(STELLAR).placeholder).toBe("G… or C…");
    expect(inspectorAddressField(EVM).placeholder).toBe("0x…");
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
