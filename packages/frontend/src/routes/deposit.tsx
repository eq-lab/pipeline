import { createFileRoute } from "@tanstack/react-router";
import { ConversionCard, DepositHeader, StepsCard } from "@pipeline/ui";
import { TopBar } from "@/components/TopBar";
import { useWallet, useUsdcBalance } from "@/wallet";

/**
 * Deposit route — full page composition.
 *
 * Layout matches Figma node 1498-100130:
 *   1. Sticky `TopBar` with connected-wallet state and active deposit nav.
 *   2. Centred narrow column (max-w-lg) stacking:
 *      - `DepositHeader` with "1:1 Conversion" title
 *      - `ConversionCard` populated with USDC → PLUSD conversion data
 *      - `StepsCard` with two disabled steps (Approve + Convert)
 *
 * Token discipline: no raw colors, fonts, sizes, or radii.  Everything goes
 * through design tokens or component primitives from `@pipeline/ui`.
 *
 * Responsive behaviour: the narrow column is capped at `max-w-lg` (512px) and
 * centred with `mx-auto`. At 1280–1728px the outer page background fills the
 * remaining space with `--color-pipeline-paper`.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100130&m=dev
 */
function Deposit() {
  const { isConnected, connect } = useWallet();
  const { formatted } = useUsdcBalance();

  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      <TopBar
        onConnectWallet={connect}
        wallet={isConnected ? { balance: formatted ?? "—" } : undefined}
        activeNav="deposit"
      />

      {/* Centred narrow column — mirrors Figma's centred single-column layout
          for the deposit / conversion screen. py-12 gives breathing room under
          the TopBar; gap-6 (24px) matches the vertical spacing between sections. */}
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
        {/* Section header: PLUSD coin icon + "1:1 Conversion" heading */}
        <DepositHeader title="1:1 Conversion" />

        {/* Conversion card: USDC input + PLUSD output + info rows */}
        <ConversionCard
          input={{
            token: "usdc",
            tokenLabel: "USDC",
            balanceLabel: "10,000.00",
            placeholderValue: "0",
            quickAmounts: [
              { label: "$1,000 (Min)", selected: true },
              { label: "$5,000" },
              { label: "$10,000" },
              { label: "Max" },
            ],
          }}
          output={{
            token: "plusd",
            tokenLabel: "PLUSD",
            balanceLabel: "0.00",
            value: "0",
          }}
          exchangeRate="1 USDC = 1 PLUSD"
          networkFee="~$0.00053 ETH ($1.20)"
        />

        {/* Steps card: two disabled on-chain steps — Approve then Convert */}
        <StepsCard
          steps={[
            {
              label: "Allow contract to use USDC",
              actionLabel: "Approve",
              disabled: true,
            },
            {
              label: "Confirm and receive PLUSD",
              actionLabel: "Convert",
              disabled: true,
            },
          ]}
        />
      </main>
    </div>
  );
}

export const Route = createFileRoute("/deposit")({
  component: Deposit,
});
