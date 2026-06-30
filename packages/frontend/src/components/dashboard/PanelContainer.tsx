import React from "react";
import { Card } from "@pipeline/ui";
import { PanelLoading } from "./PanelLoading";
import { PanelError } from "./PanelError";
import { PanelEmpty } from "./PanelEmpty";

/**
 * PanelContainer — shared surface for the four Protocol Dashboard panels
 * (A Balance Sheet, B Deployment Monitor, C Withdrawal Queue, D Yield
 * History). Wraps the `@pipeline/ui` `Card` (`white` variant) with a panel
 * title header and a body region.
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
 * Token discipline: title uses display-font + heading tokens; the surface
 * chrome comes from `Card`. No raw colors/sizes.
 */
export type PanelState = "ready" | "loading" | "empty" | "error";

export interface PanelContainerProps {
  /** Panel heading, e.g. "Balance Sheet". */
  title: string;
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
  ...rest
}: PanelContainerProps) {
  return (
    <Card
      variant="white"
      className={["flex flex-col gap-4", className].filter(Boolean).join(" ")}
      {...rest}
    >
      <h2 className={titleClasses}>{title}</h2>
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
    </Card>
  );
}

export default PanelContainer;
