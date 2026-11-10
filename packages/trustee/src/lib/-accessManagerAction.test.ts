// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect } from "vitest";
import {
  accessAction,
  amErrorCode,
  riskCouncilErrorCopy,
  riskCouncilRoleLine,
  RISK_COUNCIL_AM_ERROR_COPY,
} from "./accessManagerAction";
import { reverseAction } from "@/routes/-repayment-recovery";

const sched = (readyAt: number) => ({ operationId: "x", readyAt });

describe("accessAction", () => {
  it("returns all five outcomes", () => {
    expect(accessAction(undefined, undefined)).toBeNull();
    expect(accessAction({ immediate: true, delay: 0 }, undefined)).toBe(
      "execute-now",
    );
    expect(accessAction({ immediate: false, delay: 0 }, undefined)).toBe(
      "no-role",
    );
    expect(
      accessAction({ immediate: false, delay: 86400 }, undefined),
    ).toBeNull();
    expect(accessAction({ immediate: false, delay: 86400 }, sched(0))).toBe(
      "schedule",
    );
    expect(accessAction({ immediate: false, delay: 86400 }, sched(5))).toBe(
      "execute-scheduled",
    );
  });

  it("keeps reverseAction as the same function", () => {
    expect(reverseAction).toBe(accessAction);
  });
});

describe("riskCouncilRoleLine", () => {
  const noRole = "Declaring a default belongs to the Risk Council.";
  it("covers each state", () => {
    expect(riskCouncilRoleLine("execute-now", 0, null, noRole)).toBe(
      "Risk Council: this executes at once, with one signature.",
    );
    expect(riskCouncilRoleLine("schedule", 86400, null, noRole)).toBe(
      "Risk Council: this deployment applies a 24 h delay. Schedule it, then execute after the ready time. The Guardian or the Admin can cancel it during the wait.",
    );
    expect(
      riskCouncilRoleLine("execute-scheduled", 86400, 1_800_000_000, noRole),
    ).toBe("Scheduled. Executable from 2027-01-15 08:00 UTC.");
    expect(riskCouncilRoleLine("no-role", 0, null, noRole)).toBe(noRole);
    expect(riskCouncilRoleLine(null, null, null, noRole)).toBe(
      "Checking this wallet's permissions…",
    );
  });
});

describe("AM error copy", () => {
  it("extracts the code and maps it", () => {
    const details = "HostError: Error(Contract, #7)";
    expect(amErrorCode(details)).toBe("7");
    expect(amErrorCode("nope")).toBeNull();
    expect(riskCouncilErrorCopy("execute", details)).toBe(
      RISK_COUNCIL_AM_ERROR_COPY["execute:7"],
    );
    expect(riskCouncilErrorCopy("execute", "Error(Contract, #8)")).toMatch(
      /expired.*again/,
    );
    expect(riskCouncilErrorCopy("schedule", "Error(Contract, #9)")).toMatch(
      /already scheduled/,
    );
    expect(riskCouncilErrorCopy("execute", "Error(Contract, #99)")).toBeNull();
  });
});
