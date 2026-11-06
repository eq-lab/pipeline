// spec: packages/frontend/src/wallet/README.md#settlement-address-format
import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { isStellarSettlementAddress } from "./settlementAddressFormat";

const G = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const C = StrKey.encodeContract(Buffer.alloc(32));

describe("isStellarSettlementAddress", () => {
  it("accepts a G… account and a C… contract", () => {
    expect(isStellarSettlementAddress(G)).toBe(true);
    expect(isStellarSettlementAddress(C)).toBe(true);
  });

  it("rejects a bad checksum", () => {
    const bad = `${G.slice(0, -1)}${G.endsWith("A") ? "B" : "A"}`;
    expect(isStellarSettlementAddress(bad)).toBe(false);
  });

  it("rejects muxed M… and secret S… strkeys", () => {
    const muxed = StrKey.encodeMed25519PublicKey(Buffer.alloc(40));
    const secret = StrKey.encodeEd25519SecretSeed(Buffer.alloc(32));
    expect(muxed.startsWith("M")).toBe(true);
    expect(isStellarSettlementAddress(muxed)).toBe(false);
    expect(isStellarSettlementAddress(secret)).toBe(false);
  });

  it("rejects wrong length, empty and lowercase input", () => {
    expect(isStellarSettlementAddress(G.slice(0, 55))).toBe(false);
    expect(isStellarSettlementAddress("")).toBe(false);
    expect(isStellarSettlementAddress(G.toLowerCase())).toBe(false);
  });
});
