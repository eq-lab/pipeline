import React from "react";
import { Card } from "@pipeline/ui";

/**
 * EarnedCard — Disconnected-state "Earned" placeholder card.
 *
 * Smallest card in the left column of the Disconnected dashboard (Figma frame
 * `1497:94556`, node `1497:94691` `card-horizontal` → child `1497:94692`
 * "Earned Balance"). It announces a not-yet-shipped surface and reserves the
 * footprint so the dashboard composition reads complete:
 *
 *   ┌─────────────────────────┐
 *   │  Earned                 │
 *   │  Coming soon            │
 *   └─────────────────────────┘
 *
 * Composition:
 *   - {@link Card} `variant="white"` paints the paper surface, hairline border,
 *     4px radius, and the design system's 24px interior padding. No raw colors
 *     are introduced — every surface value is owned by the Card primitive.
 *
 * Typography:
 *   - Label "Earned" — Body token (16 / 22) in Graphik LC, primary ink
 *     (`--color-pipeline-ink`). Mirrors Figma node `1497:94693`.
 *   - Value placeholder "Coming soon" — Besley display at 20 / 28 ("Heading
 *     20" in the Figma type styles, see node `1497:94698`). It uses the
 *     `--color-pipeline-ink-subtle` (content-test/tertiary, 30% alpha) token
 *     to read as muted/disabled, signalling the surface is reserved.
 *
 * Italics: the Figma source is `Besley Regular` — not italic — so the
 * placeholder renders upright. The Issue's acceptance criterion allows italics
 * "per Figma if applicable"; here Figma does not call for italics, so the
 * component intentionally omits them.
 *
 * Accessibility:
 *   - The Card renders a `<div>`; we promote it to a region with
 *     `role="region"` + `aria-labelledby` referencing the "Earned" label so
 *     assistive tech announces "Earned, region".
 *   - The "Coming soon" value carries `aria-live="off"` semantics implicitly
 *     (it never changes). It is announced as part of the region's contents.
 *
 * Reuse: this composite belongs to the Disconnected home view alongside
 * {@link ConnectWalletPromoCard}. It is intentionally page-local — not
 * hoisted into `@pipeline/ui` — because the muted-placeholder framing is
 * specific to the wallet-less dashboard state. Once an Earned balance becomes
 * available the surface will be replaced by a value-bearing card, so the
 * "coming soon" framing has a bounded lifetime.
 */

export type EarnedCardProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
>;

// Stable id so the region's `aria-labelledby` reference always resolves even
// when several cards mount in a Storybook / preview composition.
const LABEL_ID = "earned-card-label";

// Label row — Body token (16/22) in Graphik LC, primary ink. Mirrors Figma
// node `1497:94693` "Earned" string.
const labelClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink)]",
  "m-0",
].join(" ");

// Value row — Besley display at 20 / 28 ("Heading 20" style), tertiary ink
// to read as muted/disabled. Mirrors Figma node `1497:94698` "Coming soon".
const valueClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-s)]",
  "leading-[var(--text-pipeline-heading-s--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink-subtle)]",
  "m-0",
].join(" ");

export const EarnedCard = React.forwardRef<HTMLDivElement, EarnedCardProps>(
  function EarnedCard({ className, ...rest }, ref) {
    const composed = [
      // Figma asymmetric elevation border: 1px top/left, 3px right/bottom.
      "!border-t !border-r-[3px] !border-b-[3px] !border-l",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <Card
        ref={ref}
        variant="white"
        role="region"
        aria-labelledby={LABEL_ID}
        className={composed}
        data-node-id="1497:94691"
        {...rest}
      >
        {/* Inner stack — label on top, value below. The two rows align with
            Figma node `1497:94692` "Earned Balance" which is a flex column
            with no gap (each row owns its own line-height). */}
        <div className="flex flex-col" data-node-id="1497:94692">
          <p id={LABEL_ID} className={labelClasses} data-node-id="1497:94693">
            Earned
          </p>
          <p className={valueClasses} data-node-id="1497:94698">
            Coming soon
          </p>
        </div>
      </Card>
    );
  },
);

EarnedCard.displayName = "EarnedCard";

export default EarnedCard;
