// spec: docs/frontend/wallet-flows.md#trustee-evm-contract-client
import { describe, expect, it } from "vitest";
import { requireAddress } from "./args";

const LOWER = "0x52908400098527886e0f7030069857d2e4169ee7";
const CHECKSUMMED = "0x52908400098527886E0F7030069857D2E4169EE7";

describe("requireAddress", () => {
  it("rejects an empty value", () => {
    expect(() => requireAddress("who", "registry", "")).toThrow(
      "who: registry must not be empty",
    );
  });

  it("rejects an invalid value", () => {
    expect(() => requireAddress("who", "registry", "0xnope")).toThrow(
      "who: invalid registry 0xnope",
    );
  });

  it("returns lowercase and checksummed addresses unchanged", () => {
    expect(requireAddress("who", "registry", LOWER)).toBe(LOWER);
    expect(requireAddress("who", "registry", CHECKSUMMED)).toBe(CHECKSUMMED);
  });
});
