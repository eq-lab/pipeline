// spec: docs/product-specs/staking.md#default-pockets
import { Button, Card, InfoRow, InlineError } from "@pipeline/ui";
import { useDefaultPocketsCard } from "./useDefaultPocketsCard";

interface DefaultPocketsCardProps {
  claimBlocked?: boolean;
}

const headingClasses =
  "m-0 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] font-[var(--font-weight-emphasized)] text-[color:var(--color-pipeline-ink)]";

const helperClasses =
  "m-0 font-[family-name:var(--font-body)] text-[13px] leading-[18px] text-[color:var(--color-pipeline-ink-muted)]";

export function DefaultPocketsCard({
  claimBlocked = false,
}: DefaultPocketsCardProps) {
  const view = useDefaultPocketsCard(claimBlocked);
  if (!view.visible) return null;

  return (
    <Card
      variant="white"
      data-testid="default-pockets-card"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className={headingClasses}>Default pockets</h2>
        <p className={helperClasses}>
          Recovered proceeds from a defaulted loan go to its pocket. You can
          claim your share each time more is recovered.
        </p>
      </div>
      <div className="flex flex-col gap-[2px]">
        {view.rows.map((row) => (
          <Card
            key={row.loanId}
            variant="plain"
            padding="none"
            data-testid={`default-pocket-row-${row.loanId}`}
            className="flex flex-col gap-3 px-4 py-4"
          >
            <div className="flex flex-col gap-0.5">
              <p className={headingClasses}>{row.title}</p>
              <p className={helperClasses}>{row.commodity}</p>
            </div>
            <InfoRow
              data-testid={`default-pocket-balance-${row.loanId}`}
              label="Pocket balance"
              value={row.balance}
            />
            <InfoRow
              data-testid={`default-pocket-claimable-${row.loanId}`}
              label="Claimable"
              value={row.claimable}
            />
            <InfoRow
              data-testid={`default-pocket-claimed-${row.loanId}`}
              label="Claimed"
              value={row.claimed}
            />
            <Button
              variant="primary-dark"
              size="compact"
              data-testid={`default-pocket-claim-${row.loanId}`}
              disabled={!row.canClaim}
              onClick={row.claim}
            >
              {row.isClaiming ? "Claiming…" : "Claim"}
            </Button>
          </Card>
        ))}
      </div>
      {view.error && (
        <InlineError
          message={view.error.message}
          details={view.error.details}
        />
      )}
    </Card>
  );
}
