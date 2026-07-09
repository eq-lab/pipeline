/**
 * Tests for `CapitalAllocationCard` (issue #797, extended in #807 and #805).
 *
 * The `useCapitalAllocationCard` hook is mocked so these are pure render
 * tests with no network / QueryClient involved. The on-chain Capital-Wallet
 * fold-in sum logic and the percentage-pill computation (issue #805) are
 * covered by `-useCapitalAllocationCard.test.ts` — this file only asserts
 * the card renders whatever total/legend/percentDisplay the hook returns.
 *
 * `@pipeline/wallet-connect` is also mocked (even though this file never
 * calls it directly) because `./useCapitalAllocationCard` statically imports
 * `useCapitalWalletBalance`, which statically imports `@pipeline/wallet-connect`
 * — without this mock, `vi.spyOn`-ing the view hook still pulls in the real
 * module graph (down to `@creit.tech/stellar-wallets-kit`'s `defaultModules()`
 * / `@stellar/freighter-api`), which can fail to resolve in some sandboxes.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CapitalAllocationCard } from "./CapitalAllocationCard";
import * as hookModule from "./useCapitalAllocationCard";
import type { UseCapitalAllocationCardResult } from "./useCapitalAllocationCard";

vi.mock("@pipeline/wallet-connect", () => ({
  getSacBalance: vi.fn(),
}));

function mockHook(overrides: Partial<UseCapitalAllocationCardResult>) {
  const base: UseCapitalAllocationCardResult = {
    isLoading: false,
    isError: false,
    errorMessage: null,
    totalDisplay: "—",
    legend: [
      {
        key: "capital_wallet",
        label: "Capital Wallet",
        value: "—",
        color: "var(--color-pipeline-brand)",
        percentDisplay: null,
      },
      {
        key: "in_transit",
        label: "In transit",
        value: "—",
        color: "#c9a200",
        percentDisplay: null,
      },
      {
        key: "trust_account",
        label: "Trust account",
        value: "—",
        color: "rgba(56, 55, 53, 0.35)",
        percentDisplay: null,
      },
      {
        key: "deployed",
        label: "Deployed",
        value: "—",
        color: "var(--color-pipeline-positive-primary)",
        percentDisplay: null,
      },
      {
        key: "tbills",
        label: "T-Bills (USYC)",
        value: "—",
        color: "#6666b3",
        percentDisplay: null,
      },
    ],
  };
  vi.spyOn(hookModule, "useCapitalAllocationCard").mockReturnValue({
    ...base,
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CapitalAllocationCard", () => {
  it("renders the formatted total and all five legend values with full data", () => {
    mockHook({
      totalDisplay: "$115,190,000",
      legend: [
        {
          key: "capital_wallet",
          label: "Capital Wallet",
          value: "$8.4M",
          color: "var(--color-pipeline-brand)",
          percentDisplay: "7%",
        },
        {
          key: "in_transit",
          label: "In transit",
          value: "$4.95M",
          color: "#c9a200",
          percentDisplay: "4%",
        },
        {
          key: "trust_account",
          label: "Trust account",
          value: "$1.2M",
          color: "rgba(56, 55, 53, 0.35)",
          percentDisplay: "1%",
        },
        {
          key: "deployed",
          label: "Deployed",
          value: "$96M",
          color: "var(--color-pipeline-positive-primary)",
          percentDisplay: "83%",
        },
        {
          key: "tbills",
          label: "T-Bills (USYC)",
          value: "$4.64M",
          color: "#6666b3",
          percentDisplay: "4%",
        },
      ],
    });

    render(<CapitalAllocationCard />);

    expect(screen.getByText("$115,190,000")).toBeInTheDocument();
    expect(screen.getByText("Capital Wallet $8.4M")).toBeInTheDocument();
    expect(screen.getByText("In transit $4.95M")).toBeInTheDocument();
    expect(screen.getByText("Trust account $1.2M")).toBeInTheDocument();
    expect(screen.getByText("Deployed $96M")).toBeInTheDocument();
    expect(screen.getByText("T-Bills (USYC) $4.64M")).toBeInTheDocument();
    expect(
      screen.getByText("RECONCILES TO PLUSD BACKING · DRIFT < 0.01%"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("capital-allocation-drift")).toBeInTheDocument();
  });

  it("renders the four provenance chips (#807, static mock)", () => {
    mockHook({
      totalDisplay: "$115,190,000",
      legend: [
        {
          key: "capital_wallet",
          label: "Capital Wallet",
          value: "$8.4M",
          color: "var(--color-pipeline-brand)",
          percentDisplay: "7%",
        },
        {
          key: "in_transit",
          label: "In transit",
          value: "$4.95M",
          color: "#c9a200",
          percentDisplay: "4%",
        },
        {
          key: "trust_account",
          label: "Trust account",
          value: "$1.2M",
          color: "rgba(56, 55, 53, 0.35)",
          percentDisplay: "1%",
        },
        {
          key: "deployed",
          label: "Deployed",
          value: "$96M",
          color: "var(--color-pipeline-positive-primary)",
          percentDisplay: "83%",
        },
        {
          key: "tbills",
          label: "T-Bills (USYC)",
          value: "$4.64M",
          color: "#6666b3",
          percentDisplay: "4%",
        },
      ],
    });

    render(<CapitalAllocationCard />);

    expect(
      screen.getByText("on-chain balance · current block"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Relayer API · refreshed 2m ago"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Trustee feed · reconciled today"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("stale values are labeled inline"),
    ).toBeInTheDocument();

    const chipContainer = screen.getByTestId("capital-allocation-provenance");
    expect(chipContainer.children).toHaveLength(4);
  });

  it("renders em-dash for null buckets (partial/deployed-only data)", () => {
    mockHook({
      totalDisplay: "$96,000,000",
      legend: [
        {
          key: "capital_wallet",
          label: "Capital Wallet",
          value: "—",
          color: "var(--color-pipeline-brand)",
          percentDisplay: null,
        },
        {
          key: "in_transit",
          label: "In transit",
          value: "—",
          color: "#c9a200",
          percentDisplay: null,
        },
        {
          key: "trust_account",
          label: "Trust account",
          value: "—",
          color: "rgba(56, 55, 53, 0.35)",
          percentDisplay: null,
        },
        {
          key: "deployed",
          label: "Deployed",
          value: "$96M",
          color: "var(--color-pipeline-positive-primary)",
          percentDisplay: "100%",
        },
        {
          key: "tbills",
          label: "T-Bills (USYC)",
          value: "—",
          color: "#6666b3",
          percentDisplay: null,
        },
      ],
    });

    render(<CapitalAllocationCard />);

    expect(screen.getByText("Capital Wallet —")).toBeInTheDocument();
    expect(screen.getByText("In transit —")).toBeInTheDocument();
    expect(screen.getByText("Trust account —")).toBeInTheDocument();
    expect(screen.getByText("Deployed $96M")).toBeInTheDocument();
    expect(screen.getByText("T-Bills (USYC) —")).toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    mockHook({ isLoading: true });

    render(<CapitalAllocationCard />);

    expect(
      screen.getByTestId("capital-allocation-skeleton"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Capital Wallet")).not.toBeInTheDocument();

    // Drift text lives in the always-rendered header row (#807) — it shows
    // even while the rest of the card is loading.
    expect(
      screen.getByText("RECONCILES TO PLUSD BACKING · DRIFT < 0.01%"),
    ).toBeInTheDocument();

    // Provenance chips live only in the loaded branch, under the legend.
    expect(
      screen.queryByTestId("capital-allocation-provenance"),
    ).not.toBeInTheDocument();
  });

  it("shows an inline error surface on error", () => {
    mockHook({ isError: true, errorMessage: "Network error" });

    render(<CapitalAllocationCard />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("renders a Capital Wallet value and total sourced from the on-chain fold-in (#805)", () => {
    // Represents the guarded interim sum: backend total ($96M, deployed-only)
    // + on-chain Capital Wallet balance ($8.4M) = $104,400,000. The card only
    // renders whatever the hook returns — the sum itself is computed and
    // tested in `-useCapitalAllocationCard.test.ts`.
    mockHook({
      totalDisplay: "$104,400,000",
      legend: [
        {
          key: "capital_wallet",
          label: "Capital Wallet",
          value: "$8.4M",
          color: "var(--color-pipeline-brand)",
          percentDisplay: "8%",
        },
        {
          key: "in_transit",
          label: "In transit",
          value: "—",
          color: "#c9a200",
          percentDisplay: null,
        },
        {
          key: "trust_account",
          label: "Trust account",
          value: "—",
          color: "rgba(56, 55, 53, 0.35)",
          percentDisplay: null,
        },
        {
          key: "deployed",
          label: "Deployed",
          value: "$96M",
          color: "var(--color-pipeline-positive-primary)",
          percentDisplay: "92%",
        },
        {
          key: "tbills",
          label: "T-Bills (USYC)",
          value: "—",
          color: "#6666b3",
          percentDisplay: null,
        },
      ],
    });

    render(<CapitalAllocationCard />);

    expect(screen.getByText("$104,400,000")).toBeInTheDocument();
    expect(screen.getByText("Capital Wallet $8.4M")).toBeInTheDocument();
    expect(screen.getByText("8%")).toBeInTheDocument();
  });

  describe("percentage pills (#805 scope addition, Figma 4116:8961)", () => {
    it("renders a percentage pill per bucket with the right value", () => {
      mockHook({
        totalDisplay: "$115,190,000",
        legend: [
          {
            key: "capital_wallet",
            label: "Capital Wallet",
            value: "$8.4M",
            color: "var(--color-pipeline-brand)",
            percentDisplay: "7%",
          },
          {
            key: "in_transit",
            label: "In transit",
            value: "$4.95M",
            color: "#c9a200",
            percentDisplay: "4%",
          },
          {
            key: "trust_account",
            label: "Trust account",
            value: "$1.2M",
            color: "rgba(56, 55, 53, 0.35)",
            percentDisplay: "1%",
          },
          {
            key: "deployed",
            label: "Deployed",
            value: "$96M",
            color: "var(--color-pipeline-positive-primary)",
            percentDisplay: "83%",
          },
          {
            key: "tbills",
            label: "T-Bills (USYC)",
            value: "$4.64M",
            color: "#6666b3",
            percentDisplay: "4%",
          },
        ],
      });

      render(<CapitalAllocationCard />);

      expect(
        screen.getByTestId("capital-allocation-percent-capital_wallet"),
      ).toHaveTextContent("7%");
      expect(
        screen.getByTestId("capital-allocation-percent-in_transit"),
      ).toHaveTextContent("4%");
      expect(
        screen.getByTestId("capital-allocation-percent-trust_account"),
      ).toHaveTextContent("1%");
      expect(
        screen.getByTestId("capital-allocation-percent-deployed"),
      ).toHaveTextContent("83%");
      expect(
        screen.getByTestId("capital-allocation-percent-tbills"),
      ).toHaveTextContent("4%");
      // Percentages are independently rounded and deliberately NOT
      // normalized to sum to 100 (7+4+1+83+4 = 99, matching Figma).
    });

    it("renders no percentage pill for a null/unknown bucket", () => {
      mockHook({
        totalDisplay: "$96,000,000",
        legend: [
          {
            key: "capital_wallet",
            label: "Capital Wallet",
            value: "—",
            color: "var(--color-pipeline-brand)",
            percentDisplay: null,
          },
          {
            key: "in_transit",
            label: "In transit",
            value: "—",
            color: "#c9a200",
            percentDisplay: null,
          },
          {
            key: "trust_account",
            label: "Trust account",
            value: "—",
            color: "rgba(56, 55, 53, 0.35)",
            percentDisplay: null,
          },
          {
            key: "deployed",
            label: "Deployed",
            value: "$96M",
            color: "var(--color-pipeline-positive-primary)",
            percentDisplay: "100%",
          },
          {
            key: "tbills",
            label: "T-Bills (USYC)",
            value: "—",
            color: "#6666b3",
            percentDisplay: null,
          },
        ],
      });

      render(<CapitalAllocationCard />);

      // Never a fabricated 0% — no pill at all for null-bucket rows.
      expect(
        screen.queryByTestId("capital-allocation-percent-capital_wallet"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("capital-allocation-percent-in_transit"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("capital-allocation-percent-trust_account"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("capital-allocation-percent-tbills"),
      ).not.toBeInTheDocument();
      // The only known bucket still gets its pill.
      expect(
        screen.getByTestId("capital-allocation-percent-deployed"),
      ).toHaveTextContent("100%");
    });
  });
});
