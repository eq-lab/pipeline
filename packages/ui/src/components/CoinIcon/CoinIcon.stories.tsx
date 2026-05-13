import type { Meta, StoryObj } from "@storybook/react-vite";
import { CoinIcon } from "./CoinIcon";

const meta = {
  title: "Components/CoinIcon",
  component: CoinIcon,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Displays a USDC or PLUS-D coin icon at one of three sizes. " +
          'Decorative by default (`aria-hidden="true"`); pass `aria-label` ' +
          "to make it meaningful to assistive tech. " +
          "Sizes: sm (20 px) — wallet pill / conversion-card row; " +
          "md (24 px) — default; lg (40 px) — DepositHeader.",
      },
    },
  },
  argTypes: {
    token: { control: "select", options: ["usdc", "plusd"] },
    size: { control: "select", options: ["sm", "md", "lg"] },
    "aria-label": { control: "text" },
  },
  args: {
    token: "usdc",
    size: "md",
  },
} satisfies Meta<typeof CoinIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Individual token stories                                                   */
/* -------------------------------------------------------------------------- */

export const USDC: Story = {
  name: "USDC — md (default)",
  args: { token: "usdc", size: "md" },
};

export const PLUSD: Story = {
  name: "PLUS-D — md (default)",
  args: { token: "plusd", size: "md" },
};

/* -------------------------------------------------------------------------- */
/*  All sizes — USDC                                                           */
/* -------------------------------------------------------------------------- */

export const AllSizesUSC: Story = {
  name: "USDC — all sizes",
  parameters: {
    docs: {
      description: {
        story: "sm (20 px), md (24 px), lg (40 px) — left to right.",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <CoinIcon token="usdc" size="sm" aria-label="USDC coin, small" />
      <CoinIcon token="usdc" size="md" aria-label="USDC coin, medium" />
      <CoinIcon token="usdc" size="lg" aria-label="USDC coin, large" />
    </div>
  ),
};

/* -------------------------------------------------------------------------- */
/*  All sizes — PLUS-D                                                         */
/* -------------------------------------------------------------------------- */

export const AllSizesPLUSD: Story = {
  name: "PLUS-D — all sizes",
  parameters: {
    docs: {
      description: {
        story: "sm (20 px), md (24 px), lg (40 px) — left to right.",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <CoinIcon token="plusd" size="sm" aria-label="PLUS-D coin, small" />
      <CoinIcon token="plusd" size="md" aria-label="PLUS-D coin, medium" />
      <CoinIcon token="plusd" size="lg" aria-label="PLUS-D coin, large" />
    </div>
  ),
};

/* -------------------------------------------------------------------------- */
/*  Both tokens side-by-side                                                   */
/* -------------------------------------------------------------------------- */

export const BothTokens: Story = {
  name: "Both tokens — lg",
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      <CoinIcon token="usdc" size="lg" aria-label="USDC" />
      <CoinIcon token="plusd" size="lg" aria-label="PLUS-D" />
    </div>
  ),
};

/* -------------------------------------------------------------------------- */
/*  Decorative (aria-hidden)                                                   */
/* -------------------------------------------------------------------------- */

export const Decorative: Story = {
  name: "Decorative (aria-hidden, no aria-label)",
  args: { token: "usdc", size: "md" },
  parameters: {
    docs: {
      description: {
        story:
          "When no `aria-label` is provided the icon is hidden from " +
          'assistive tech (`aria-hidden="true"`).',
      },
    },
  },
};
