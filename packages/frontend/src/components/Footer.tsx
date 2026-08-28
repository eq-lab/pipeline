import React from "react";
import { Logo } from "@pipeline/ui";

// spec: docs/frontend/dashboard-components.md#footer (two-row structure, Figma frame 3283:13463).

const FOOTER_LINKS: ReadonlyArray<{
  label: string;
  href: string;
  testId: string;
}> = [
  {
    label: "Docs",
    href: "https://docs.pipeline.one/",
    testId: "footer-link-docs",
  },
  { label: "White Paper", href: "#", testId: "footer-link-white-paper" },
  {
    label: "GitHub",
    href: "https://github.com/eq-lab/pipeline/",
    testId: "footer-link-github",
  },
  { label: "X (Twitter)", href: "#", testId: "footer-link-x-twitter" },
  { label: "Telegram", href: "#", testId: "footer-link-telegram" },
];

// Body type token classes — matches the pattern used by QnaSection and dashboard.tsx.
const bodyTokenClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

// Caption type token classes — matches the pattern used for eyebrows throughout the app.
const captionTokenClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

export type FooterProps = Omit<React.HTMLAttributes<HTMLElement>, "children">;

export const Footer = React.forwardRef<HTMLElement, FooterProps>(
  function Footer({ className, ...rest }, ref) {
    const composed = [
      "flex flex-col gap-12",
      "p-8 md:p-24",
      // The footer is mounted globally in __root.tsx *outside* each route's own
      // paper wrapper, so it must carry the paper background itself — otherwise
      // it falls back to the bare body background.
      "bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <footer
        ref={ref}
        className={composed}
        data-node-id="3283:13463"
        data-testid="site-footer"
        {...rest}
      >
        <div
          className={[
            "flex flex-col gap-4",
            "md:flex-row md:items-center md:justify-between md:gap-0",
            "border-y border-[color:var(--color-pipeline-ink)]",
            "py-4",
          ].join(" ")}
          data-node-id="3283:13464"
          data-testid="footer-row-links"
        >
          {/* Logo default is brand navy — override to primary ink via currentColor. */}
          <Logo
            width={232}
            className="shrink-0 text-[color:var(--color-pipeline-ink)]"
            aria-label="Pipeline"
          />

          {/* spec: docs/frontend/dashboard-components.md#footer (mobile nav stack, Figma node 3283:74414). */}
          <nav
            aria-label="Footer"
            className="flex flex-col gap-6 md:flex-row md:flex-wrap md:items-center"
            data-testid="footer-nav"
          >
            {FOOTER_LINKS.map(({ label, href, testId }) => {
              const isStub = href === "#";
              return (
                <a
                  key={label}
                  href={href}
                  target={isStub ? undefined : "_blank"}
                  rel={isStub ? undefined : "noopener noreferrer"}
                  aria-disabled={isStub ? "true" : undefined}
                  className={[
                    bodyTokenClasses,
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                    "focus-visible:outline-[var(--color-pipeline-ink)]",
                    isStub
                      ? "cursor-default"
                      : "cursor-pointer underline-offset-2 hover:underline",
                  ].join(" ")}
                  data-testid={testId}
                >
                  {label}
                </a>
              );
            })}
          </nav>
        </div>

        <div
          className={[
            "flex flex-col gap-2",
            "md:flex-row md:items-end md:justify-between md:gap-0",
          ].join(" ")}
          data-node-id="3283:13472"
          data-testid="footer-row-disclaimer"
        >
          <p
            className={[captionTokenClasses, "m-0 max-w-[480px]"].join(" ")}
            data-node-id="3283:13473"
            data-testid="footer-disclaimer"
          >
            Pipeline is a decentralized on-chain protocol. This interface is
            provided for informational purposes only and does not constitute
            financial advice.
            <br />
            Past performance is not indicative of future results. Participation
            involves risk, including possible loss of principal.
            <br />
            Always conduct your own due diligence before participating.
          </p>

          <p
            className={[
              captionTokenClasses,
              "m-0 text-right whitespace-nowrap",
            ].join(" ")}
            data-node-id="3283:13474"
            data-testid="footer-copyright"
          >
            © 2026 Pipeline Trust Company
          </p>
        </div>
      </footer>
    );
  },
);

Footer.displayName = "Footer";

export default Footer;
