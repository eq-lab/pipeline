import React from "react";
import { EmptyState } from "@pipeline/ui";

/**
 * PanelEmpty — shared "empty" body for Protocol Dashboard panels.
 *
 * Thin wrapper over the `@pipeline/ui` `EmptyState` primitive (caption-only —
 * no illustration) so every panel's "nothing to show yet" state reads the
 * same. The placeholder panels shipped in #716 render this with a "Coming
 * soon" caption until follow-up sub-issues of #712 wire real data.
 *
 * Token discipline: all visual values come from `EmptyState`/theme tokens.
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
