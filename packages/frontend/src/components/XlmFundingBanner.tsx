/**
 * "Add funds to your XLM balance" banner — replaces the StepsCard when the
 * Stellar account cannot pay network fees (Figma 6090-8741 / card 6093-75787).
 * spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
 */

import { useState, useCallback } from "react";
import { Card, Button } from "@pipeline/ui";

function CopyGlyph() {
  return (
    <svg
      viewBox="-2.75 -2.75 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={22}
      height={22}
      aria-hidden="true"
      className="-ml-1 shrink-0"
    >
      <path
        d="M2.29167 9.89982C2.29167 10.3904 2.29063 10.8411 2.32121 11.2157C2.35313 11.6065 2.42655 12.0342 2.64168 12.4565C2.94927 13.0601 3.43991 13.5507 4.04354 13.8583C4.46576 14.0735 4.89352 14.1469 5.28426 14.1788C5.65888 14.2094 6.10965 14.2083 6.60018 14.2083H12.8306C12.8223 14.8271 12.7868 15.1988 12.6337 15.4992C12.458 15.8441 12.1774 16.1246 11.8325 16.3004C11.4403 16.5002 10.9266 16.5 9.89982 16.5H2.93351C1.90675 16.5 1.39299 16.5002 1.00081 16.3004C0.655915 16.1246 0.375382 15.8441 0.199626 15.4992C-0.000195739 15.107 0 14.5933 0 13.5665V6.60018C0 5.57342 -0.000195739 5.05965 0.199626 4.66748C0.375382 4.32258 0.655915 4.04205 1.00081 3.86629C1.30119 3.71324 1.67286 3.67684 2.29167 3.66846V9.89982Z"
        fill="currentColor"
      />
      <path
        d="M13.5665 0C14.5933 0 15.107 -0.000195739 15.4992 0.199626C15.8441 0.375382 16.1246 0.655915 16.3004 1.00081C16.5002 1.39299 16.5 1.90675 16.5 2.93351V9.89982C16.5 10.9266 16.5002 11.4403 16.3004 11.8325C16.1246 12.1774 15.8441 12.458 15.4992 12.6337C15.107 12.8335 14.5933 12.8333 13.5665 12.8333H6.60018C5.70184 12.8333 5.19647 12.8329 4.82145 12.6991L4.81519 12.6964C4.80386 12.6923 4.79227 12.6891 4.78117 12.6847L4.66748 12.6337L4.54126 12.563C4.25411 12.3869 4.02009 12.1343 3.86629 11.8325C3.66647 11.4403 3.66667 10.9266 3.66667 9.89982V2.93351C3.66667 1.90675 3.66647 1.39299 3.86629 1.00081C4.04205 0.655915 4.32258 0.375382 4.66748 0.199626C5.05965 -0.000195739 5.57342 0 6.60018 0H13.5665Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function XlmFundingBanner({ address }: { address: string | undefined }) {
  const [copied, setCopied] = useState(false);

  const copyAddress = useCallback(() => {
    if (!address || typeof navigator === "undefined" || !navigator.clipboard)
      return;
    navigator.clipboard.writeText(address).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* Silently no-op when clipboard write fails. */
      },
    );
  }, [address]);

  return (
    <Card
      variant="yellow"
      padding="md"
      data-testid="xlm-funding-banner"
      className="flex flex-row items-center gap-3 !border-t !border-r-[3px] !border-b-[3px] !border-l shadow-sm"
    >
      <div
        data-testid="xlm-funding-banner-text"
        className="flex min-w-0 flex-1 flex-col items-start"
      >
        <div className="flex min-h-6 items-center">
          <p
            data-testid="xlm-funding-banner-title"
            className="truncate font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)]"
          >
            Add funds to your XLM balance
          </p>
        </div>
        <p
          data-testid="xlm-funding-banner-subtitle"
          className="truncate font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] text-[color:var(--color-pipeline-ink-muted)]"
        >
          You need XLM to pay the network fee
        </p>
      </div>
      <Button
        data-testid="xlm-funding-banner-action"
        variant="primary-dark"
        size="compact"
        className="whitespace-nowrap"
        onClick={copyAddress}
        disabled={!address}
      >
        <CopyGlyph />
        <span className="pl-1">{copied ? "Copied" : "Copy Address"}</span>
      </Button>
    </Card>
  );
}
