import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConversionCard } from "./ConversionCard";

const USDC_QUICK_AMOUNTS = [
  { label: "$1,000 (Min)" },
  { label: "$5,000", selected: true },
  { label: "$10,000" },
  { label: "Max" },
];

const meta = {
  title: "Components/ConversionCard",
  component: ConversionCard,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Full conversion card (Figma node 1498-100130). Composes a white " +
          "`Card` → `TokenInput` (top) → swap-vertical icon divider → " +
          "`TokenAmountDisplay` (bottom) → two `InfoRow`s for exchange rate " +
          "and network fee. No new colors or sizes — everything via design tokens.",
      },
    },
  },
  argTypes: {
    exchangeRate: { control: "text" },
    networkFee: { control: "text" },
  },
  args: {
    input: {
      token: "usdc",
      tokenLabel: "USDC",
      balanceLabel: "10,000.00",
      placeholderValue: "0",
      quickAmounts: USDC_QUICK_AMOUNTS,
    },
    output: {
      token: "plusd",
      tokenLabel: "PLUSD",
      balanceLabel: "0.00",
      value: "0",
    },
    exchangeRate: "1 USDC = 1 PLUSD",
    networkFee: "~$1.20",
  },
  decorators: [
    (Story) => (
      <div style={{ width: 448, maxWidth: "100%", padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConversionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Default — matches the Figma example (USDC → PLUSD, 1:1 rate, ~$1.20 fee) */
/* -------------------------------------------------------------------------- */

export const Default: Story = {
  name: "Default — USDC → PLUSD (matches Figma)",
};

/* -------------------------------------------------------------------------- */
/*  With a selected amount                                                     */
/* -------------------------------------------------------------------------- */

export const WithSelectedAmount: Story = {
  name: "With $5,000 chip selected",
  args: {
    input: {
      token: "usdc",
      tokenLabel: "USDC",
      balanceLabel: "10,000.00",
      placeholderValue: "5,000",
      quickAmounts: USDC_QUICK_AMOUNTS,
    },
    output: {
      token: "plusd",
      tokenLabel: "PLUSD",
      balanceLabel: "0.00",
      value: "5,000",
    },
    exchangeRate: "1 USDC = 1 PLUSD",
    networkFee: "~$1.20",
  },
};

/* -------------------------------------------------------------------------- */
/*  Max amount selected                                                        */
/* -------------------------------------------------------------------------- */

export const MaxSelected: Story = {
  name: "Max amount selected",
  args: {
    input: {
      token: "usdc",
      tokenLabel: "USDC",
      balanceLabel: "10,000.00",
      placeholderValue: "10,000",
      quickAmounts: [
        { label: "$1,000 (Min)" },
        { label: "$5,000" },
        { label: "$10,000" },
        { label: "Max", selected: true },
      ],
    },
    output: {
      token: "plusd",
      tokenLabel: "PLUSD",
      balanceLabel: "0.00",
      value: "10,000",
    },
    exchangeRate: "1 USDC = 1 PLUSD",
    networkFee: "~$1.20",
  },
};
