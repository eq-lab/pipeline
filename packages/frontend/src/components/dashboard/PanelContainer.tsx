import React from "react";
import { Card } from "@pipeline/ui";
import { PanelLoading } from "./PanelLoading";
import { PanelError } from "./PanelError";
import { PanelEmpty } from "./PanelEmpty";

/**
 * PanelContainer — shared surface for the four Protocol Dashboard panels
 * (A Balance Sheet, B Deployment Monitor, C Withdrawal Queue, D Yield
 * History).
 *
 * spec: docs/frontend/dashboard-components.md#panel-states
 * (state discriminator, title/borderless behavior).
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
  /** Suppresses the outer `Card` surface. spec: docs/frontend/dashboard-components.md#panel-states */
  borderless?: boolean;
  "data-testid"?: string;
  "data-node-id"?: string;
}

// spec: docs/frontend/dashboard-components.md#panel-states (panel heading Figma tokens)
const titleClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "md:text-[length:var(--text-pipeline-heading-l)]",
  "md:leading-[var(--text-pipeline-heading-l--line-height)]",
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
    // spec: docs/frontend/dashboard-components.md#panel-states (borderless mode)
    return (
      <div
        className={["flex flex-col gap-8", className].filter(Boolean).join(" ")}
        {...rest}
      >
        {body}
      </div>
    );
  }

  return (
    <Card
      variant="white"
      className={["flex flex-col gap-8", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {body}
    </Card>
  );
}

export default PanelContainer;
