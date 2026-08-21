import React from "react";
import { LinkCard } from "@pipeline/ui";

// spec: docs/frontend/dashboard-components.md#qnasection (composition, layout, accessibility, Figma frame 1497:94666).

export type QnaSectionProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  "children"
>;

// Stable id so the section's `aria-labelledby` points at the eyebrow heading.
const HEADING_ID = "qna-section-title";

const QUESTIONS: ReadonlyArray<{
  label: string;
  href: string;
  nodeId: string;
  testId: string;
}> = [
  {
    label: "How it works?",
    href: "https://docs.pipeline.one/how-it-works/",
    nodeId: "1497:94669",
    testId: "home-qna-how-it-works",
  },
  {
    label: "What is PLUSD?",
    href: "https://docs.pipeline.one/start-here/faqs/",
    nodeId: "1497:94671",
    testId: "home-qna-what-is-plusd",
  },
  {
    label: "What is sPLUSD?",
    href: "https://docs.pipeline.one/start-here/faqs/",
    nodeId: "1497:94673",
    testId: "home-qna-what-is-splusd",
  },
];

export const QnaSection = React.forwardRef<HTMLElement, QnaSectionProps>(
  function QnaSection({ className, ...rest }, ref) {
    const composed = ["flex flex-col gap-4", "w-full pt-4", className]
      .filter(Boolean)
      .join(" ");

    return (
      <section
        ref={ref}
        aria-labelledby={HEADING_ID}
        className={composed}
        data-node-id="1497:94666"
        data-testid="home-qna-section"
        {...rest}
      >
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
          data-testid="home-qna-heading"
        >
          Questions &amp; Answers
        </h2>

        <div
          className="flex w-full gap-4"
          data-node-id="1497:94668"
          data-testid="home-qna-cards-row"
        >
          {QUESTIONS.map(({ label, href, nodeId, testId }) => (
            <LinkCard
              key={label}
              href={href}
              label={label}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1"
              data-node-id={nodeId}
              data-testid={testId}
            />
          ))}
        </div>
      </section>
    );
  },
);

QnaSection.displayName = "QnaSection";

export default QnaSection;
