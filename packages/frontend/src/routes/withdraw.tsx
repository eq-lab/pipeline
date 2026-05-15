import { createFileRoute } from "@tanstack/react-router";
import { ConversionCard, DepositHeader, StepsCard } from "@pipeline/ui";
import { TopBar } from "@/components/TopBar";
import { useWallet, useToken, useDepositManagerAddresses } from "@/wallet";

/**
 * Withdraw route — full page composition.
 *
 * Layout matches Figma node 1498-100351:
 *   1. Sticky `TopBar` with connected-wallet state and active deposit nav
 *      (the single dollar icon covers both deposit and withdraw flows).
 *   2. Centred narrow column (max-w-lg) stacking:
 *      - `DepositHeader` with "1:1 Conversion" title (PLUSD hero icon)
 *      - `ConversionCard` populated with PLUSD → USDC conversion data (reversed)
 *      - `StepsCard` with two disabled steps (Approve + Convert)
 *
 * Token discipline: no raw colors, fonts, sizes, or radii.  Everything goes
 * through design tokens or component primitives from `@pipeline/ui`.
 *
 * Responsive behaviour: the narrow column is capped at `max-w-lg` (512px) and
 * centred with `mx-auto`. At 1280–1728px the outer page background fills the
 * remaining space with `--color-pipeline-paper`.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100351&m=dev
 */
function Withdraw() {
  const { isConnected, connect } = useWallet();
  const { usdc } = useDepositManagerAddresses();
  const { formattedBalance } = useToken({
    token: usdc ?? "0x0000000000000000000000000000000000000000",
  });

  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      {/* The dollar nav icon covers both deposit and withdraw — pass "deposit"
          so the correct icon renders as active. */}
      <TopBar
        onConnectWallet={connect}
        wallet={isConnected ? { balance: formattedBalance ?? "—" } : undefined}
        activeNav="deposit"
      />

      {/* Centred narrow column — mirrors Figma's centred single-column layout
          for the withdraw / conversion screen. py-12 gives breathing room under
          the TopBar; gap-6 (24px) matches the vertical spacing between sections. */}
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
        {/* Section header: PLUSD coin icon + "1:1 Conversion" heading */}
        <DepositHeader title="1:1 Conversion" />

        {/* Conversion card: PLUSD input + USDC output + info rows (reversed vs deposit) */}
        <ConversionCard
          input={{
            token: "plusd",
            tokenLabel: "PLUSD",
            balanceLabel: "1,000.00",
            placeholderValue: "0",
            quickAmounts: [
              { label: "25%" },
              { label: "50%" },
              { label: "75%" },
              { label: "Max" },
            ],
          }}
          output={{
            token: "usdc",
            tokenLabel: "USDC",
            balanceLabel: "9,000.00",
            value: "0",
          }}
          exchangeRate="1 PLUSD = 1 USDC"
          networkFee="~$1.20"
        />

        {/* Steps card: two disabled on-chain steps — Approve then Convert */}
        <StepsCard
          steps={[
            {
              label: "Allow contract to use PLUSD",
              actionLabel: "Approve",
              disabled: true,
            },
            {
              label: "Confirm and receive USDC",
              actionLabel: "Convert",
              disabled: true,
            },
          ]}
        />
      </main>
    </div>
  );
}

export const Route = createFileRoute("/withdraw")({
  component: Withdraw,
});
