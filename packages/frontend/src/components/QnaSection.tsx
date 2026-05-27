import React from "react";
import { LinkCard } from "@pipeline/ui";

/**
 * QnaSection — Questions & Answers row at the bottom of the dashboard.
 *
 * Implements Figma frame `1497:94666` ("FAQ") — the narrow strip that sits
 * below the main Disconnected dashboard grid. It is the page's last block
 * before the footer area and acts as the secondary navigation into the help
 * content.
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  QUESTIONS & ANSWERS                                                │
 *   │  ─────────────────────  ─────────────────────  ─────────────────────│
 *   │  How it works?       ↗  What is PLUSD?     ↗  What is sPLUSD?    ↗  │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Composition:
 *   - An all-caps micro-label eyebrow ("QUESTIONS & ANSWERS") in caption
 *     typography with medium weight, the brand label tracking token
 *     (`--tracking-pipeline-label`, 7px) and the muted ink-subtle colour —
 *     matches the Figma `heading` instance `1497:94667` which renders the
 *     Label style (caption + 500 + uppercase + 0.84px tracking).
 *   - A row of three {@link LinkCard} primitives from `@pipeline/ui`, one per
 *     question. The LinkCard primitive already owns the hairline top border,
 *     the 40px row height, the muted-to-ink hover transition, and the
 *     arrow-up-right icon — this composer only supplies the labels, the hrefs,
 *     and the row layout.
 *
 * Layout:
 *   - Outer flex column with a 16px gap between the eyebrow and the cards row
 *     (Figma `gap-s` on node 1497:94666).
 *   - Inner row is a 3-column flex layout with 16px gaps (Figma `gap-16` on
 *     node 1497:94668). Each LinkCard wrapper uses `flex-1` so the three
 *     cards share width evenly across the section.
 *   - The section spans the full width of its container; the page-level
 *     route is responsible for clamping it to the 1200px grid that the rest
 *     of the dashboard uses.
 *
 * Typography:
 *   - Eyebrow uses the Caption type token (`--text-pipeline-caption` 12/16)
 *     in Graphik LC, medium weight, uppercase, with the brand label tracking
 *     and `--color-pipeline-ink-subtle`.
 *   - Link labels are rendered by `LinkCard`, which already pulls from the
 *     Body type token and the ink-muted colour. No raw font sizes here.
 *
 * Links:
 *   - Each card targets the corresponding docs.pipeline.one URL and opens in
 *     a new tab with `target="_blank" rel="noopener noreferrer"`. The hrefs are
 *     wired through the `LinkCard` `href` prop so they remain anchors and
 *     keep the existing focus-visible ring.
 *
 * Accessibility:
 *   - The section is wrapped in a `<section>` landmark with `aria-labelledby`
 *     pointing at the eyebrow so assistive tech announces "Questions &
 *     Answers, region". Using `aria-labelledby` reuses the visible heading
 *     text rather than introducing a hidden duplicate.
 *   - The eyebrow is rendered as a real `<h2>` so it shows up in the document
 *     outline; CSS handles the visual uppercase + tracking so the underlying
 *     text remains case-correct for screen readers ("Questions & Answers"
 *     rather than the all-caps glyph stream).
 *
 * Reuse: this composite belongs to the Disconnected dashboard view (and any
 * future view that wants the same FAQ strip). It is page-level and stays in
 * `packages/frontend/src/components/`, not hoisted into `@pipeline/ui` —
 * the reusable atom is `LinkCard`.
 */

export type QnaSectionProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  "children"
>;

// Stable id so the section's `aria-labelledby` points at the eyebrow heading.
const HEADING_ID = "qna-section-title";

// Static question / link pairs — three rows mirroring the Figma `Cell` strip
// on node `1497:94668`. Each href points to the corresponding docs.pipeline.one
// page; all three open in a new tab with noopener noreferrer for security.
const QUESTIONS: ReadonlyArray<{
  label: string;
  href: string;
  nodeId: string;
}> = [
  {
    label: "How it works?",
    href: "https://docs.pipeline.one/how-it-works/",
    nodeId: "1497:94669",
  },
  {
    label: "What is PLUSD?",
    href: "https://docs.pipeline.one/start-here/faqs/",
    nodeId: "1497:94671",
  },
  {
    label: "What is sPLUSD?",
    href: "https://docs.pipeline.one/start-here/faqs/",
    nodeId: "1497:94673",
  },
];

export const QnaSection = React.forwardRef<HTMLElement, QnaSectionProps>(
  function QnaSection({ className, ...rest }, ref) {
    const composed = [
      // Vertical stack — eyebrow on top, row of cards below, 16px gap.
      "flex flex-col gap-4",
      "w-full",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <section
        ref={ref}
        aria-labelledby={HEADING_ID}
        className={composed}
        data-node-id="1497:94666"
        {...rest}
      >
        {/* Eyebrow — all-caps micro-label. Caption type token in Graphik LC,
            medium weight, uppercase, brand label tracking, ink-subtle colour.
            Mirrors the Figma `Label` style on node `I1497:94667;6539:2336`. */}
        <h2
          id={HEADING_ID}
          className={[
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-caption)]",
            "leading-[var(--text-pipeline-caption--line-height)]",
            "font-[var(--font-weight-medium)]",
            "tracking-[var(--tracking-pipeline-label)]",
            "uppercase",
            "text-[color:var(--color-pipeline-ink-subtle)]",
            "m-0",
          ].join(" ")}
          data-node-id="I1497:94667;6539:2336"
        >
          Questions &amp; Answers
        </h2>

        {/* Row of three LinkCards. Each cell takes equal width via flex-1 so
            the strip fills the available section width — matches the Figma
            `Cell` frame `1497:94668` which uses three flex-1 cells with a
            16px gap. */}
        <div className="flex w-full gap-4" data-node-id="1497:94668">
          {QUESTIONS.map(({ label, href, nodeId }) => (
            <LinkCard
              key={label}
              href={href}
              label={label}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1"
              data-node-id={nodeId}
            />
          ))}
        </div>
      </section>
    );
  },
);

QnaSection.displayName = "QnaSection";

export default QnaSection;
