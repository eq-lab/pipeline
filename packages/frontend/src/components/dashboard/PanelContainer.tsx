import React from "react";
import { Card } from "@pipeline/ui";
import { PanelLoading } from "./PanelLoading";
import { PanelError } from "./PanelError";
import { PanelEmpty } from "./PanelEmpty";

/**
 * PanelContainer — shared surface for the four Protocol Dashboard panels
 * (A Balance Sheet, B Deployment Monitor, C Withdrawal Queue, D Yield
 * History). Wraps the `@pipeline/ui` `Card` (`white` variant) with an optional
 * panel title header and a body region.
 *
 * State handling: a single `state` discriminator selects which body renders,
 * so all four panels share one loading/empty/error treatment:
 *   - `"ready"` (default) — renders `children` (the panel's real content).
 *   - `"loading"`        — renders `<PanelLoading/>`.
 *   - `"empty"`          — renders `<PanelEmpty caption={emptyCaption}/>`.
 *   - `"error"`          — renders `<PanelError onRetry={onRetry}/>`.
 *
 * In #716 the panels are placeholders that pass `state="empty"`; follow-up
 * sub-issues of #712 flip them to `"loading"`/`"error"`/`"ready"` as they wire
 * real data. Pure/presentational — no data fetching here.
 *
 * `title` is optional: panels that correspond to a Figma section with no
 * heading (e.g. Panel D Yield History — `3283:67619`) omit it. When absent,
 * no `<h2>` is rendered.
 *
 * Token discipline: title uses display-font + heading tokens; the surface
 * chrome comes from `Card`. No raw colors/sizes.
 */
export type PanelState = "ready" | "loading" | "empty" | "error";

export interface PanelContainerProps {
  /**
   * Panel heading, e.g. "Balance Sheet". Optional — omit for panels whose
   * Figma section has no heading (e.g. Panel D Yield History).
   */
  title?: string;
  /** Which body to render. Defaults to `"ready"` (renders `children`). */
  state?: PanelState;
  /** Retry handler passed to `PanelError` when `state === "error"`. */
  onRetry?: () => void;
  /** Caption passed to `PanelEmpty` when `state === "empty"`. */
  emptyCaption?: React.ReactNode;
  /** Message passed to `PanelError` when `state === "error"`. */
  errorMessage?: React.ReactNode;
  /** Real content, rendered when `state === "ready"`. */
  children?: React.ReactNode;
  className?: string;
  /**
   * When `true` the outer `Card` surface (border + background) is suppressed.
   * Use for the Loan Book (DeploymentMonitorPanel) whose Figma section frame
   * `3283:14431` is borderless — the visual chrome lives on the inner
   * summary cards and the table-container card instead.
   * All other panels keep the default bordered white Card.
   */
  borderless?: boolean;
  "data-testid"?: string;
  "data-node-id"?: string;
}

// Panel heading — display serif at heading-m (28px), stepping down to
// heading-m-mobile (20px) below md, matching the home page's responsive
// type-scale step-down (FRONTEND.md "Responsive behavior").
const titleClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[length:var(--text-pipeline-heading-m-mobile)]",
  "leading-[var(--text-pipeline-heading-m-mobile--line-height)]",
  "md:text-[length:var(--text-pipeline-heading-m)]",
  "md:leading-[var(--text-pipeline-heading-m--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

function PanelBody({
  state,
  onRetry,
  emptyCaption,
  errorMessage,
  children,
}: Pick<
  PanelContainerProps,
  "state" | "onRetry" | "emptyCaption" | "errorMessage" | "children"
>) {
  switch (state) {
    case "loading":
      return <PanelLoading data-testid="panel-loading" />;
    case "error":
      return (
        <PanelError
          data-testid="panel-error"
          onRetry={onRetry}
          message={errorMessage}
        />
      );
    case "empty":
      return <PanelEmpty data-testid="panel-empty" caption={emptyCaption} />;
    case "ready":
    default:
      return <>{children}</>;
  }
}

export function PanelContainer({
  title,
  state = "ready",
  onRetry,
  emptyCaption,
  errorMessage,
  children,
  className,
  borderless = false,
  ...rest
}: PanelContainerProps) {
  const body = (
    <>
      {title !== undefined && title !== "" && (
        <h2 className={titleClasses}>{title}</h2>
      )}
      <div className="min-h-[120px]">
        <PanelBody
          state={state}
          onRetry={onRetry}
          emptyCaption={emptyCaption}
          errorMessage={errorMessage}
        >
          {children}
        </PanelBody>
      </div>
    </>
  );

  if (borderless) {
    // Borderless mode: no Card surface — no border, no background fill.
    // The Loan Book section frame (Figma 3283:14431) is unstyled; chrome lives
    // on the inner summary cards and table-container card.
    return (
      <div
        className={["flex flex-col gap-4", className].filter(Boolean).join(" ")}
        {...rest}
      >
        {body}
      </div>
    );
  }

  return (
    <Card
      variant="white"
      className={["flex flex-col gap-4", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {body}
    </Card>
  );
}

export default PanelContainer;
