// spec: docs/frontend/trustee-flows.md#risk-council-pending-operations
import { describe, it, expect } from "vitest";
import {
  canonicalPendingFunction,
  EVM_PENDING_FUNCTIONS,
} from "./pendingOperations";

describe("canonicalPendingFunction", () => {
  it("maps every EVM camelCase name to the canonical snake_case name", () => {
    expect(canonicalPendingFunction("setDefault")).toBe("set_default");
    expect(canonicalPendingFunction("amendEconomics")).toBe("amend_economics");
    expect(canonicalPendingFunction("adjustInterest")).toBe("adjust_interest");
    expect(canonicalPendingFunction("writeDown")).toBe("write_down");
    expect(canonicalPendingFunction("closeDefaulted")).toBe("close_defaulted");
    expect(canonicalPendingFunction("reverseRepay")).toBe("reverse_repay");
    expect(canonicalPendingFunction("setTerms")).toBe("set_terms");
    expect(canonicalPendingFunction("resolveFlag")).toBe("resolve_flag");
    expect(canonicalPendingFunction("releaseWithConsent")).toBe(
      "release_with_consent",
    );
    expect(canonicalPendingFunction("setInspectors")).toBe("set_inspectors");
    expect(Object.keys(EVM_PENDING_FUNCTIONS)).toHaveLength(11);
  });

  it("keeps cure and every Stellar name unchanged", () => {
    expect(canonicalPendingFunction("cure")).toBe("cure");
    expect(canonicalPendingFunction("set_default")).toBe("set_default");
    expect(canonicalPendingFunction("reverse_repay")).toBe("reverse_repay");
  });

  it("passes a raw selector and an unknown name through", () => {
    expect(canonicalPendingFunction("0x1234abcd")).toBe("0x1234abcd");
    expect(canonicalPendingFunction("somethingElse")).toBe("somethingElse");
    expect(canonicalPendingFunction("constructor")).toBe("constructor");
  });
});
