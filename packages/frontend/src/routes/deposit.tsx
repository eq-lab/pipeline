import { useState, useCallback, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Card,
  ConversionCard,
  DepositHeader,
  StepsCard,
  Button,
} from "@pipeline/ui";
import {
  useWallet,
  useDepositManagerAddresses,
  useDepositManagerMinDeposit,
  useRequestDeposit,
  useToken,
} from "@/wallet";
import { ENV } from "@/lib/env";
import { parseUsdc, formatUsdc, formatUsdcCurrency } from "@/lib/usdc";

/**
 * Deposit route — state-driven conversion page.
 *
 * Drives three Figma states from on-chain reads:
 *
 * 1. **Approve needed** (allowance < entered amount):
 *    Step 1 "Approve" enabled; step 2 "Convert" disabled.
 *    Figma: node 1498-99874
 *
 * 2. **Approved** (allowance ≥ entered amount):
 *    Step 1 shows green check badge; step 2 "Convert" enabled.
 *    Figma: node 1497-95272
 *
 * 3. **Insufficient balance** (balance < minDeposit):
 *    StepsCard replaced by a low-balance banner with "Copy Address" CTA.
 *    Figma: node 1825-10214
 *
 * State sources (all via `@/wallet` — no direct wagmi/viem imports):
 *   - `useWallet()` — address, isConnected
 *   - `useDepositManagerAddresses()` — usdc token address
 *   - `useDepositManagerMinDeposit()` — minimum deposit amount
 *   - `useToken({ token: usdc, spender: DEPOSIT_MANAGER_ADDRESS })` —
 *     balance + decimals + formattedBalance + allowance + approve surface
 *   - `useRequestDeposit()` — write + pending/success/error state
 *
 * Token discipline: no raw colors, fonts, sizes, or radii.
 * Everything goes through design tokens or component primitives from `@pipeline/ui`.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100130&m=dev
 */

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function Deposit() {
  // ── State sources ─────────────────────────────────────────────────────
  const { address, isConnected } = useWallet();
  const { usdc } = useDepositManagerAddresses();
  const { minDeposit } = useDepositManagerMinDeposit();

  // Fall back to zero-address when usdc is not yet loaded so the hook is
  // always called with a valid `0x${string}`.
  const usdcAddr = (usdc ?? ZERO_ADDRESS) as `0x${string}`;

  const {
    decimals,
    balance,
    formattedBalance,
    allowance,
    approve,
    isApprovePending,
    refetchBalance,
  } = useToken({ token: usdcAddr, spender: ENV.DEPOSIT_MANAGER_ADDRESS });

  const requestDeposit = useRequestDeposit();

  // ── Local state ───────────────────────────────────────────────────────
  const [amountInput, setAmountInput] = useState("");
  const [copied, setCopied] = useState(false);

  // ── Derived state ─────────────────────────────────────────────────────
  const amountBig = parseUsdc(amountInput, decimals);

  // All three data sources must be non-undefined before we can decide on state.
  const isReady =
    decimals !== undefined && balance !== undefined && minDeposit !== undefined;

  // hasBalance: undefined = loading; true = sufficient; false = insufficient
  const hasBalance = isReady ? balance >= minDeposit : undefined;

  const needsApproval =
    allowance !== undefined && amountBig > 0n && allowance < amountBig;

  // Amount must be a positive value AND at least the on-chain minDeposit.
  // While minDeposit is undefined (loading), meetsMin is false → both action
  // buttons stay disabled. This prevents submitting a requestDeposit tx that
  // would revert with DepositManagerLessThanMinAmount and trip the wallet's
  // gas-estimation fallback (see Issue #232 for the underlying error chain).
  const meetsMin =
    minDeposit !== undefined && amountBig > 0n && amountBig >= minDeposit;

  const canApprove =
    isConnected &&
    hasBalance === true &&
    meetsMin &&
    needsApproval &&
    !isApprovePending;

  const canConvert =
    isConnected &&
    hasBalance === true &&
    meetsMin &&
    !needsApproval &&
    !requestDeposit.isPending;

  // ── Refetch balance after a successful requestDeposit ─────────────────
  useEffect(() => {
    if (requestDeposit.isSuccess) refetchBalance();
  }, [requestDeposit.isSuccess, refetchBalance]);

  // ── Copy address handler (1.5s "Copied" affordance) ───────────────────
  const copyAddress = useCallback(() => {
    if (!address || typeof navigator === "undefined" || !navigator.clipboard)
      return;
    navigator.clipboard.writeText(address).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* Silently no-op when clipboard write fails (e.g. non-secure context). */
      },
    );
  }, [address]);

  // ── Quick-amount handlers ─────────────────────────────────────────────
  const onQuickAmount = useCallback(
    (idx: number) => {
      if (decimals === undefined) return;
      if (idx === 0 && minDeposit !== undefined) {
        // Min chip — use the live minDeposit value.
        // formatUsdc returns "1,000.00"; strip commas so parseUsdc gets a
        // clean decimal string on the next onChange → parseUsdc cycle.
        setAmountInput(formatUsdc(minDeposit, decimals).replace(/,/g, ""));
        return;
      }
      if (idx === 1) setAmountInput("5000");
      else if (idx === 2) setAmountInput("10000");
      else if (idx === 3 && balance !== undefined) {
        // Max chip — use the live balance.
        setAmountInput(formatUsdc(balance, decimals).replace(/,/g, ""));
      }
    },
    [decimals, minDeposit, balance],
  );

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
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
            // formattedBalance from useToken is "1,000.00" — no $ or suffix.
            // Fall back to "—" while loading.
            balanceLabel: formattedBalance ?? "—",
            placeholderValue: "0",
            // Controlled value state
            value: amountInput,
            onValueChange: setAmountInput,
            disabled: !isConnected || !isReady,
            quickAmounts: [
              {
                label:
                  minDeposit !== undefined && decimals !== undefined
                    ? `${formatUsdcCurrency(minDeposit, decimals)} (Min)`
                    : "Min",
              },
              { label: "$5,000" },
              { label: "$10,000" },
              { label: "Max" },
            ],
            onQuickAmountClick: onQuickAmount,
          }}
          output={{
            token: "plusd",
            tokenLabel: "PLUSD",
            balanceLabel: "0.00",
            // 1:1 conversion rate — echo the input (empty → "0")
            value: amountInput || "0",
          }}
          exchangeRate="1 USDC = 1 PLUSD"
          // Network fee is not estimated in this issue — leave as dash rather
          // than rendering stale/fake placeholder copy.
          networkFee="—"
        />

        {/* Conditional: low-balance banner OR two-step card */}
        {hasBalance === false ? (
          /* Insufficient-balance banner — replaces StepsCard.
             Figma: node 1825-10214 */
          <Card
            variant="muted"
            className="flex flex-col items-center gap-3 p-6 text-center"
          >
            <p className="font-[family-name:var(--font-display)] text-[length:var(--text-pipeline-heading-s)]">
              Add funds to your USDC balance
            </p>
            <p className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] text-[color:var(--color-pipeline-ink-muted)]">
              Minimum amount —{" "}
              {minDeposit !== undefined && decimals !== undefined
                ? `${formatUsdcCurrency(minDeposit, decimals)} USDC`
                : "—"}
            </p>
            <Button
              variant="primary-dark"
              onClick={copyAddress}
              disabled={!address}
            >
              {copied ? "Copied" : "Copy Address"}
            </Button>
          </Card>
        ) : (
          /* Two-step card: Approve + Convert
             Figma: node 1498-99874 (approve needed) / node 1497-95272 (approved) */
          <StepsCard
            steps={[
              {
                label: "Allow contract to use USDC",
                actionLabel: "Approve",
                // Step 1 is disabled when:
                //   - canApprove is false (loading, insufficient balance, etc.)
                // In success state the button is replaced by a badge anyway.
                disabled: !canApprove,
                loading: isApprovePending,
                // Flip to "success" once allowance covers the entered amount.
                state:
                  !needsApproval && amountBig > 0n && isConnected
                    ? "success"
                    : "idle",
                onAction: () => approve?.(amountBig),
              },
              {
                label: "Confirm and receive PLUSD",
                actionLabel: "Convert",
                disabled: !canConvert,
                loading: requestDeposit.isPending,
                onAction: () => requestDeposit.write(amountBig),
              },
            ]}
          />
        )}
      </main>
    </div>
  );
}

export const Route = createFileRoute("/deposit")({
  component: Deposit,
});
