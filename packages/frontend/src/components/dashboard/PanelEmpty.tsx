import React from "react";
import { EmptyState } from "@pipeline/ui";

/**
 * PanelEmpty — shared "empty" body for Protocol Dashboard panels.
 * spec: docs/frontend/dashboard-components.md#panel-states
 */
export interface PanelEmptyProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Caption rendered below the (absent) illustration. */
  caption?: React.ReactNode;
}

export function PanelEmpty({
  caption = "Nothing to show yet",
  ...rest
}: PanelEmptyProps) {
  return <EmptyState caption={caption} {...rest} />;
}

export default PanelEmpty;
