import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";

/* -------------------------------------------------------------------------- */
/*  Type scale tokens from the Figma frame (1497-94556)                       */
/* -------------------------------------------------------------------------- */

interface TokenRowProps {
  label: string;
  size: number;
  lineHeight: number;
  weight: number;
  letterSpacing?: number;
  family: "display" | "body";
  sample: string;
}

function TokenRow({
  label,
  size,
  lineHeight,
  weight,
  letterSpacing,
  family,
  sample,
}: TokenRowProps) {
  return (
    <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
      <td
        style={{
          padding: "8px 16px 8px 0",
          fontSize: 12,
          color: "#6b7280",
          whiteSpace: "nowrap",
          verticalAlign: "middle",
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: "8px 16px 8px 0",
          fontSize: 11,
          color: "#9ca3af",
          whiteSpace: "nowrap",
          verticalAlign: "middle",
        }}
      >
        {size}/{lineHeight} · w{weight}
        {letterSpacing ? ` · ls ${letterSpacing}` : ""}
      </td>
      <td style={{ padding: "8px 0", verticalAlign: "middle" }}>
        <span
          style={{
            fontFamily:
              family === "display" ? "var(--font-display)" : "var(--font-body)",
            fontSize: size,
            lineHeight: `${lineHeight}px`,
            fontWeight: weight,
            letterSpacing: letterSpacing ? `${letterSpacing}px` : undefined,
          }}
        >
          {sample}
        </span>
      </td>
    </tr>
  );
}

function TypographyScale() {
  return (
    <div style={{ padding: 32, background: "#fff", minWidth: 640 }}>
      <h2
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "#6b7280",
          marginBottom: 24,
        }}
      >
        Type scale — Figma frame 1497-94556
      </h2>

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
            <th
              style={{
                padding: "4px 16px 8px 0",
                textAlign: "left",
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 500,
                color: "#374151",
              }}
            >
              Token
            </th>
            <th
              style={{
                padding: "4px 16px 8px 0",
                textAlign: "left",
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 500,
                color: "#374151",
              }}
            >
              Spec
            </th>
            <th
              style={{
                padding: "4px 0 8px 0",
                textAlign: "left",
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 500,
                color: "#374151",
              }}
            >
              Sample
            </th>
          </tr>
        </thead>
        <tbody>
          {/* Display / Besley */}
          <TokenRow
            label="Title"
            size={64}
            lineHeight={64}
            weight={700}
            family="display"
            sample="Pipeline Finance"
          />
          <TokenRow
            label="Heading M"
            size={28}
            lineHeight={36}
            weight={700}
            family="display"
            sample="Total Value Locked"
          />
          <TokenRow
            label="Heading 20"
            size={20}
            lineHeight={28}
            weight={400}
            family="display"
            sample="Deposit Summary"
          />

          {/* Body / Graphik LC */}
          <TokenRow
            label="Body"
            size={16}
            lineHeight={22}
            weight={400}
            family="body"
            sample="Your position earns yield continuously."
          />
          <TokenRow
            label="Body Emphasized"
            size={16}
            lineHeight={22}
            weight={500}
            family="body"
            sample="Confirm transaction details before signing."
          />
          <TokenRow
            label="Caption"
            size={12}
            lineHeight={16}
            weight={400}
            family="body"
            sample="Last updated 3 minutes ago"
          />
          <TokenRow
            label="Label"
            size={12}
            lineHeight={16}
            weight={500}
            letterSpacing={7}
            family="body"
            sample="APY"
          />
        </tbody>
      </table>

      {/* Italic sample */}
      <div style={{ marginTop: 32 }}>
        <h3
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: "#6b7280",
            marginBottom: 12,
          }}
        >
          Graphik LC — italic (400 italic)
        </h3>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 16,
            lineHeight: "22px",
            fontWeight: 400,
            fontStyle: "italic",
            color: "#374151",
          }}
        >
          Note: collateral is held in escrow until settlement.
        </p>
      </div>

      {/* CSS variable reference */}
      <div
        style={{
          marginTop: 32,
          padding: 16,
          background: "#f9fafb",
          borderRadius: 8,
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 500,
            color: "#6b7280",
            margin: 0,
          }}
        >
          CSS vars: <code>--font-display</code> (Besley) ·{" "}
          <code>--font-body</code> (Graphik LC)
        </p>
      </div>
    </div>
  );
}

const meta: Meta = {
  title: "Foundation/Typography",
  component: TypographyScale,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Self-hosted type scale. Display face: Besley (serif). Body face: Graphik LC (sans). Fonts served as `.woff2` from `packages/ui/src/assets/fonts/`.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Scale: Story = {
  name: "Type Scale",
};
