import React, { useState } from "react";
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
          "Full conversion card (Figma node 1498-100130). Composes two white " +
          "`Card`s stacked with a 2px gap: Card A (`TokenInput`, top) and " +
          "Card B (`TokenAmountDisplay` + `Exchange rate` / `Network fee` " +
          "details, bottom). The swap-vertical icon button is absolutely " +
          "positioned over the seam between the two cards. No raw colors or " +
          "sizes — everything via design tokens.",
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

/* -------------------------------------------------------------------------- */
/*  Interactive — swap button wired to flip direction                          */
/* -------------------------------------------------------------------------- */

export const Interactive: StoryObj<typeof ConversionCard> = {
  name: "Interactive — swap button toggles direction",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [direction, setDirection] = useState<"deposit" | "withdraw">(
      "deposit",
    );
    const isDeposit = direction === "deposit";
    return (
      <div style={{ width: 448, maxWidth: "100%", padding: 24 }}>
        <p
          style={{
            marginBottom: 12,
            fontFamily: "monospace",
            fontSize: 12,
            color: "#666",
          }}
        >
          direction: <strong>{direction}</strong> — click the swap button to
          toggle
        </p>
        <ConversionCard
          input={{
            token: isDeposit ? "usdc" : "plusd",
            tokenLabel: isDeposit ? "USDC" : "PLUSD",
            balanceLabel: "10,000.00",
            placeholderValue: "0",
            quickAmounts: isDeposit
              ? [
                  { label: "$1,000 (Min)" },
                  { label: "$5,000" },
                  { label: "$10,000" },
                  { label: "Max" },
                ]
              : [
                  { label: "25%" },
                  { label: "50%" },
                  { label: "75%" },
                  { label: "Max" },
                ],
          }}
          output={{
            token: isDeposit ? "plusd" : "usdc",
            tokenLabel: isDeposit ? "PLUSD" : "USDC",
            balanceLabel: "0.00",
            value: "0",
          }}
          exchangeRate={isDeposit ? "1 USDC = 1 PLUSD" : "1 PLUSD = 1 USDC"}
          networkFee="~$1.20"
          onSwap={() =>
            setDirection((d) => (d === "deposit" ? "withdraw" : "deposit"))
          }
        />
      </div>
    );
  },
};
