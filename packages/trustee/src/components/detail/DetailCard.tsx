// spec: docs/frontend/trustee-flows.md#shared-detail-primitives
import { CARD_CLASS, cardStyle } from "./detailTokens";

export function DetailCard({
  className,
  testId,
  ariaLabel,
  ariaLabelledBy,
  children,
}: {
  className?: string;
  testId?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  children: React.ReactNode;
}) {
  const composed = className ? `${CARD_CLASS} ${className}` : CARD_CLASS;
  if (ariaLabel || ariaLabelledBy) {
    return (
      <section
        className={composed}
        style={cardStyle()}
        data-testid={testId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
      >
        {children}
      </section>
    );
  }
  return (
    <div className={composed} style={cardStyle()} data-testid={testId}>
      {children}
    </div>
  );
}

export function CardTitle({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="font-[family-name:var(--font-display)] text-[26px] leading-[33.28px] text-[#262524]"
    >
      {children}
    </h2>
  );
}
