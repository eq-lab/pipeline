/**
 * Unit tests for the network-switcher helpers (issue #1032).
 *
 * Covers:
 *   - `networkIdFromPassphrase`: testnet / mainnet / unknown passphrases.
 *   - `parseNetworkLinks`: happy path, empty/unset, malformed entries
 *     dropped, order preserved.
 *   - `navigateToNetworkLink`: mainnet asks `window.confirm` before
 *     navigating; non-mainnet navigates directly; declining the confirm
 *     does not navigate.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  networkIdFromPassphrase,
  parseNetworkLinks,
  navigateToNetworkLink,
  MAINNET_CONFIRM_MESSAGE,
  type NetworkLink,
} from "./links";

describe("networkIdFromPassphrase", () => {
  it("maps the testnet passphrase to testnet/Testnet", () => {
    expect(
      networkIdFromPassphrase("Test SDF Network ; September 2015"),
    ).toEqual({
      id: "testnet",
      label: "Testnet",
    });
  });

  it("maps the public/mainnet passphrase to mainnet/Mainnet", () => {
    expect(
      networkIdFromPassphrase("Public Global Stellar Network ; September 2015"),
    ).toEqual({ id: "mainnet", label: "Mainnet" });
  });

  it("treats an unknown passphrase as testnet-styled with the raw passphrase as the label", () => {
    expect(
      networkIdFromPassphrase("Test SDF Future Network ; October 2022"),
    ).toEqual({
      id: "testnet",
      label: "Test SDF Future Network ; October 2022",
    });
  });
});

describe("parseNetworkLinks", () => {
  it("parses a happy-path comma-separated list, preserving order", () => {
    const result = parseNetworkLinks(
      "mainnet=https://app.pipeline.one,testnet=https://pipeline.stage.eqlab.net",
    );
    expect(result).toEqual<NetworkLink[]>([
      { id: "mainnet", label: "Mainnet", url: "https://app.pipeline.one" },
      {
        id: "testnet",
        label: "Testnet",
        url: "https://pipeline.stage.eqlab.net",
      },
    ]);
  });

  it("returns an empty array when unset", () => {
    expect(parseNetworkLinks(undefined)).toEqual([]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseNetworkLinks("")).toEqual([]);
  });

  it("labels an unknown network id by capitalizing it", () => {
    expect(
      parseNetworkLinks("futurenet=https://futurenet.example.com"),
    ).toEqual([
      {
        id: "futurenet",
        label: "Futurenet",
        url: "https://futurenet.example.com",
      },
    ]);
  });

  it("drops entries missing '='", () => {
    expect(
      parseNetworkLinks("mainnet=https://app.pipeline.one,garbage"),
    ).toEqual([
      { id: "mainnet", label: "Mainnet", url: "https://app.pipeline.one" },
    ]);
  });

  it("drops entries with an empty id", () => {
    expect(
      parseNetworkLinks(
        "=https://app.pipeline.one,testnet=https://t.example.com",
      ),
    ).toEqual([
      { id: "testnet", label: "Testnet", url: "https://t.example.com" },
    ]);
  });

  it("drops entries with an empty url", () => {
    expect(parseNetworkLinks("mainnet=,testnet=https://t.example.com")).toEqual(
      [{ id: "testnet", label: "Testnet", url: "https://t.example.com" }],
    );
  });

  it("drops entries whose url fails to parse as absolute", () => {
    expect(
      parseNetworkLinks("mainnet=not-a-url,testnet=https://t.example.com"),
    ).toEqual([
      { id: "testnet", label: "Testnet", url: "https://t.example.com" },
    ]);
  });

  it("drops entries whose url is not http(s) (e.g. javascript:)", () => {
    expect(
      parseNetworkLinks(
        "mainnet=javascript:alert(1),testnet=https://t.example.com",
      ),
    ).toEqual([
      { id: "testnet", label: "Testnet", url: "https://t.example.com" },
    ]);
  });

  it("trims whitespace around ids and urls", () => {
    expect(parseNetworkLinks(" mainnet = https://app.pipeline.one ")).toEqual([
      { id: "mainnet", label: "Mainnet", url: "https://app.pipeline.one" },
    ]);
  });
});

describe("navigateToNetworkLink", () => {
  const testnetLink: NetworkLink = {
    id: "testnet",
    label: "Testnet",
    url: "https://pipeline.stage.eqlab.net",
  };
  const mainnetLink: NetworkLink = {
    id: "mainnet",
    label: "Mainnet",
    url: "https://app.pipeline.one",
  };

  const originalLocation = window.location;

  // jsdom's `Location.prototype.assign` is non-configurable, so `vi.spyOn`
  // cannot redefine it directly — replace `window.location` itself with a
  // stand-in object for the duration of the test instead.
  function mockLocationAssign() {
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign },
      configurable: true,
      writable: true,
    });
    return assign;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      value: originalLocation,
      configurable: true,
      writable: true,
    });
  });

  it("navigates directly for a non-mainnet link (no confirm)", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const assignSpy = mockLocationAssign();

    navigateToNetworkLink(testnetLink);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(assignSpy).toHaveBeenCalledWith(testnetLink.url);
  });

  it("asks for confirmation before navigating to a mainnet link", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const assignSpy = mockLocationAssign();

    navigateToNetworkLink(mainnetLink);

    expect(confirmSpy).toHaveBeenCalledWith(MAINNET_CONFIRM_MESSAGE);
    expect(assignSpy).toHaveBeenCalledWith(mainnetLink.url);
  });

  it("does not navigate when the mainnet confirm is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const assignSpy = mockLocationAssign();

    navigateToNetworkLink(mainnetLink);

    expect(assignSpy).not.toHaveBeenCalled();
  });
});
