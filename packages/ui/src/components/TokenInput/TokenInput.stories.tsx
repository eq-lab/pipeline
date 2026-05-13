import type { Meta, StoryObj } from "@storybook/react-vite";
import { TokenInput } from "./TokenInput";

const USDC_QUICK_AMOUNTS = [
  { label: "$1,000 (Min)" },
  { label: "$5,000", selected: true },
  { label: "$10,000" },
  { label: "Max" },
];

const PLUSD_QUICK_AMOUNTS = [
  { label: "$1,000 (Min)" },
  { label: "$5,000" },
  { label: "$10,000" },
  { label: "Max" },
];

const meta = {
  title: "Components/TokenInput",
  component: TokenInput,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Top half of the conversion card: coin icon + token label + balance subtitle + " +
          "large display-serif numeric input + row of QuickAmountChips. " +
          "Styling only — the `<input>` is rendered but no controlled-value logic, " +
          "validation, or formatting is included in this issue. " +
          "Figma reference: node 1498-100136.",
      },
    },
  },
  argTypes: {
    token: { control: "select", options: ["usdc", "plusd"] },
    tokenLabel: { control: "text" },
    balanceLabel: { control: "text" },
    placeholderValue: { control: "text" },
  },
  args: {
    token: "usdc",
    tokenLabel: "USDC",
    balanceLabel: "10,000.00",
    placeholderValue: "0",
    quickAmounts: USDC_QUICK_AMOUNTS,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 448, maxWidth: "100%" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TokenInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  USDC side (default — matches Figma conversion card verbatim)              */
/* -------------------------------------------------------------------------- */

export const USDC: Story = {
  name: "USDC — default (matches Figma)",
  args: {
    token: "usdc",
    tokenLabel: "USDC",
    balanceLabel: "10,000.00",
    quickAmounts: USDC_QUICK_AMOUNTS,
  },
};

/* -------------------------------------------------------------------------- */
/*  PLUS-D side                                                                */
/* -------------------------------------------------------------------------- */

export const PLUSD: Story = {
  name: "PLUS-D",
  args: {
    token: "plusd",
    tokenLabel: "PLUSD",
    balanceLabel: "0.00",
    quickAmounts: PLUSD_QUICK_AMOUNTS,
  },
};

/* -------------------------------------------------------------------------- */
/*  No chip selected                                                           */
/* -------------------------------------------------------------------------- */

export const NoneSelected: Story = {
  name: "No chip selected",
  args: {
    token: "usdc",
    tokenLabel: "USDC",
    balanceLabel: "10,000.00",
    quickAmounts: [
      { label: "$1,000 (Min)" },
      { label: "$5,000" },
      { label: "$10,000" },
      { label: "Max" },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/*  Max chip selected                                                          */
/* -------------------------------------------------------------------------- */

export const MaxSelected: Story = {
  name: "Max chip selected",
  args: {
    token: "usdc",
    tokenLabel: "USDC",
    balanceLabel: "10,000.00",
    quickAmounts: [
      { label: "$1,000 (Min)" },
      { label: "$5,000" },
      { label: "$10,000" },
      { label: "Max", selected: true },
    ],
  },
};
