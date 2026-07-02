import React from "react";
import { Logo } from "@pipeline/ui";

/**
 * Footer — global page footer, mounted once in the root layout (`__root.tsx`).
 *
 * Implements Figma frame `3283-13463` ("Footer") — the two-row strip that
 * renders on the page background (`--color-pipeline-paper`), outside/below
 * every route's content container (Figma `3283:12101`).
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  [Pipeline logo]        Docs  White Paper  GitHub  X (Twitter)       │
 *   │                                                          Telegram     │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │  [Disclaimer text, 3 lines]          © 2026 Pipeline Trust Company  │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Structure (Figma `3283-13463`):
 *   - Row 1 ("Footer links container", node `3283:13464`): flex row,
 *     `items-center justify-between`, `border-y` in primary ink, `py-4` (16px,
 *     gap-s). Left: `Logo` at 232px width. Right: nav links row, `gap-6` (24px,
 *     gap-m), Body 16px, primary ink.
 *   - Row 2 ("Footer Container", node `3283:13472`): flex row,
 *     `items-end justify-between`, Caption 12px, muted ink. Left: 3-line
 *     disclaimer, `max-w-[480px]` (node `3283:13473`). Right: copyright (node
 *     `3283:13474`), `text-right whitespace-nowrap`.
 *   - Outer: flex column, `gap-12` (48px, gap-xl) between rows, `p-8 md:p-24`
 *     (32px mobile → 96px desktop, layout sizing — not a token, same pattern as
 *     `dashboard.tsx`).
 *
 * Responsive: rows stack vertically below `md`; rows are side-by-side at `md+`.
 *
 * Links: all five are placeholder stubs (`href="#"`, `aria-disabled="true"`)
 * pending real URL decisions — see TD-29 in tech-debt-tracker.md.
 *
 * Figma reference (Issue #746, epic #712):
 *   https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-13463&m=dev
 */

// Footer nav links — all stubbed per resolved Open Question 1 (Issue #746).
// Real URLs to be wired in a follow-up (TD-29).
const FOOTER_LINKS: ReadonlyArray<{
  label: string;
  href: string;
  testId: string;
}> = [
  { label: "Docs", href: "#", testId: "footer-link-docs" },
  { label: "White Paper", href: "#", testId: "footer-link-white-paper" },
  { label: "GitHub", href: "#", testId: "footer-link-github" },
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
      // Outer flex column: rows stacked with 48px gap (gap-xl), desktop padding
      // 96px (p-24) reducing to 32px (p-8) on mobile — pixel hints, not tokens.
      "flex flex-col gap-12",
      "p-8 md:p-24",
      // Page background (`--color-pipeline-paper`, #F8F7F6). The footer is mounted
      // globally in __root.tsx *outside* each route's own paper wrapper, so it must
      // carry the paper background itself — otherwise it falls back to the bare body
      // background (Figma 3283-13463; Issue #746).
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
        {/*
         * Row 1: "Footer links container" — logo left, nav links right.
         * Figma node 3283:13464 — border top + bottom in primary ink, 16px vertical
         * padding (py-4 = gap-s).
         *
         * Responsive: stacks to single column below md (logo on top, links below),
         * restores to side-by-side row at md+.
         */}
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
          {/* Left: Pipeline wordmark at 232×64 (2× the 116×32 intrinsic), primary ink.
              Logo default is brand navy — override to primary ink via currentColor. */}
          <Logo
            width={232}
            className="shrink-0 text-[color:var(--color-pipeline-ink)]"
            aria-label="Pipeline"
          />

          {/* Right: nav links — vertically stacked on mobile (Figma XS node 3283:74414
              shows flex-col, gap-[24px]), horizontal flex-wrap row on desktop.
              All hrefs are stubs (href="#", aria-disabled) — see TD-29. */}
          <nav
            aria-label="Footer"
            className="flex flex-col gap-6 md:flex-row md:flex-wrap md:items-center"
            data-testid="footer-nav"
          >
            {FOOTER_LINKS.map(({ label, href, testId }) => (
              <a
                key={label}
                href={href}
                aria-disabled="true"
                className={[
                  bodyTokenClasses,
                  // Focus ring for keyboard navigation.
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                  "focus-visible:outline-[var(--color-pipeline-ink)]",
                  // Visually signal that these are non-navigating stubs.
                  "cursor-default",
                ].join(" ")}
                data-testid={testId}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        {/*
         * Row 2: "Footer Container" — disclaimer left, copyright right.
         * Figma node 3283:13472 — Caption type tokens, muted ink (`--color-pipeline-ink-muted`).
         *
         * Responsive: stacks to single column below md, restores to side-by-side at md+.
         * On mobile the copyright sits below the disclaimer (natural DOM order).
         */}
        <div
          className={[
            "flex flex-col gap-2",
            "md:flex-row md:items-end md:justify-between md:gap-0",
          ].join(" ")}
          data-node-id="3283:13472"
          data-testid="footer-row-disclaimer"
        >
          {/* Left: 3-line disclaimer. max-w-[480px] matches Figma node 3283:13473. */}
          <p
            className={[captionTokenClasses, "m-0 max-w-[480px]"].join(" ")}
            data-node-id="3283:13473"
            data-testid="footer-disclaimer"
          >
            Pipeline is a financial protocol. This interface is provided for
            informational purposes only and does not constitute financial
            advice.
            <br />
            Past performance is not indicative of future results. Participation
            involves risk, including possible loss of principal.
            <br />
            Always conduct your own due diligence before participating.
          </p>

          {/* Right: copyright. text-right + whitespace-nowrap keeps it on one line. */}
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
