// spec: docs/FRONTEND.md#design-tokens
import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import themeCss from "../styles/theme.css?raw";

interface Token {
  name: string;
  value: string;
}

interface TextToken {
  name: string;
  size: string;
  lineHeight: string;
}

type Family = "color" | "text" | "radius";

const LINE_HEIGHT_SUFFIX = "--line-height";

function parseTokens(css: string, family: Family): Token[] {
  const start = css.indexOf("@theme");
  const block = start === -1 ? "" : css.slice(start);
  const stripped = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern = new RegExp(
    `(--${family}-pipeline-[a-z0-9-]+)\\s*:\\s*([^;]+);`,
    "g",
  );
  const tokens: Token[] = [];
  for (const [, name = "", raw = ""] of stripped.matchAll(pattern)) {
    const value = raw
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .trim();
    tokens.push({ name, value });
  }
  return tokens;
}

function parseTextTokens(css: string): TextToken[] {
  const all = parseTokens(css, "text");
  const lineHeights = new Map(
    all
      .filter((t) => t.name.endsWith(LINE_HEIGHT_SUFFIX))
      .map((t) => [t.name.slice(0, -LINE_HEIGHT_SUFFIX.length), t.value]),
  );
  return all
    .filter((t) => !t.name.endsWith(LINE_HEIGHT_SUFFIX))
    .map((t) => ({
      name: t.name,
      size: t.value,
      lineHeight: lineHeights.get(t.name) ?? "normal",
    }));
}

const mono = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
} as const;

const cellStyle = {
  padding: "8px 16px 8px 0",
  verticalAlign: "middle",
} as const;

const rowStyle = {
  borderBottom: "1px solid var(--color-pipeline-line)",
} as const;

const checkerboard = {
  backgroundColor: "var(--color-pipeline-surface)",
  backgroundImage:
    "linear-gradient(45deg, #d9d9d9 25%, transparent 25%, transparent 75%, #d9d9d9 75%), linear-gradient(45deg, #d9d9d9 25%, transparent 25%, transparent 75%, #d9d9d9 75%)",
  backgroundSize: "12px 12px",
  backgroundPosition: "0 0, 6px 6px",
} as const;

function Page({ title, count, children }: PageProps) {
  return (
    <div
      style={{
        fontFamily: "var(--font-body)",
        color: "var(--color-pipeline-ink)",
        background: "var(--color-pipeline-paper)",
        padding: 24,
      }}
    >
      <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>{title}</h2>
      <p
        style={{
          margin: "0 0 16px",
          fontSize: 12,
          color: "var(--color-pipeline-ink-muted)",
        }}
      >
        {count} tokens
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

interface PageProps {
  title: string;
  count: number;
  children: React.ReactNode;
}

function ColorRow({ name, value }: Token) {
  const swatchRef = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState("");
  const isAlias = value.startsWith("var(");

  useEffect(() => {
    if (isAlias && swatchRef.current) {
      setResolved(getComputedStyle(swatchRef.current).backgroundColor);
    }
  }, [isAlias]);

  return (
    <tr style={rowStyle}>
      <td style={cellStyle}>
        <div
          style={{
            ...checkerboard,
            width: 64,
            height: 32,
            borderRadius: 4,
            border: "1px solid var(--color-pipeline-line)",
            overflow: "hidden",
          }}
        >
          <div
            ref={swatchRef}
            style={{
              width: "100%",
              height: "100%",
              background: `var(${name})`,
            }}
          />
        </div>
      </td>
      <td style={{ ...cellStyle, ...mono }}>{name}</td>
      <td
        style={{
          ...cellStyle,
          ...mono,
          color: "var(--color-pipeline-ink-muted)",
        }}
      >
        {value}
        {resolved ? ` → ${resolved}` : ""}
      </td>
    </tr>
  );
}

function TypeRow({ name, size, lineHeight }: TextToken) {
  return (
    <tr style={rowStyle}>
      <td style={{ ...cellStyle, ...mono, whiteSpace: "nowrap" }}>{name}</td>
      <td
        style={{
          ...cellStyle,
          ...mono,
          whiteSpace: "nowrap",
          color: "var(--color-pipeline-ink-muted)",
        }}
      >
        {size} / {lineHeight}
      </td>
      <td style={{ ...cellStyle, padding: "8px 0" }}>
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: `var(${name})`,
            lineHeight: `var(${name}${LINE_HEIGHT_SUFFIX})`,
          }}
        >
          Pipeline private credit
        </span>
      </td>
    </tr>
  );
}

function RadiusRow({ name, value }: Token) {
  return (
    <tr style={rowStyle}>
      <td style={cellStyle}>
        <div
          style={{
            width: 96,
            height: 48,
            background: "var(--color-pipeline-surface)",
            border: "1px solid var(--color-pipeline-ink)",
            borderRadius: `var(${name})`,
          }}
        />
      </td>
      <td style={{ ...cellStyle, ...mono }}>{name}</td>
      <td
        style={{
          ...cellStyle,
          ...mono,
          color: "var(--color-pipeline-ink-muted)",
        }}
      >
        {value}
      </td>
    </tr>
  );
}

const meta = {
  title: "Foundation/Tokens",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const colors = parseTokens(themeCss, "color");
const textTokens = parseTextTokens(themeCss);
const radii = parseTokens(themeCss, "radius");

export const Colors: Story = {
  render: () => (
    <Page title="--color-pipeline-*" count={colors.length}>
      {colors.map((t) => (
        <ColorRow key={t.name} {...t} />
      ))}
    </Page>
  ),
};

export const TypeRamp: Story = {
  render: () => (
    <Page title="--text-pipeline-*" count={textTokens.length}>
      {textTokens.map((t) => (
        <TypeRow key={t.name} {...t} />
      ))}
    </Page>
  ),
};

export const Radii: Story = {
  render: () => (
    <Page title="--radius-pipeline-*" count={radii.length}>
      {radii.map((t) => (
        <RadiusRow key={t.name} {...t} />
      ))}
    </Page>
  ),
};
