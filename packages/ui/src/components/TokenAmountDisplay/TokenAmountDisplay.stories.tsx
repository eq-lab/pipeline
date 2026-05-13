import type { Meta, StoryObj } from "@storybook/react-vite";
import { TokenAmountDisplay } from "./TokenAmountDisplay";

const meta = {
  title: "Components/TokenAmountDisplay",
  component: TokenAmountDisplay,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Read-only counterpart to `TokenInput`. Renders coin icon + token label + " +
          "balance subtitle + large display-serif numeric value. No interactive elements, " +
          "no `<input>`. Intended for the PLUS-D (output) side of the conversion card " +
          "where the amount is computed, not entered. " +
          "Figma reference: node 1498-100130.",
      },
    },
  },
  argTypes: {
    token: { control: "select", options: ["usdc", "plusd"] },
    tokenLabel: { control: "text" },
    balanceLabel: { control: "text" },
    value: { control: "text" },
  },
  args: {
    token: "plusd",
    tokenLabel: "PLUSD",
    balanceLabel: "0.00",
    value: "0",
  },
  decorators: [
    (Story) => (
      <div style={{ width: 448, maxWidth: "100%" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TokenAmountDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  PLUS-D side — matches the Figma conversion card                           */
/* -------------------------------------------------------------------------- */

export const PLUSD: Story = {
  name: "PLUS-D — default (matches Figma conversion card)",
  args: {
    token: "plusd",
    tokenLabel: "PLUSD",
    balanceLabel: "0.00",
    value: "0",
  },
};

/* -------------------------------------------------------------------------- */
/*  USDC side (for completeness)                                               */
/* -------------------------------------------------------------------------- */

export const USDC: Story = {
  name: "USDC",
  args: {
    token: "usdc",
    tokenLabel: "USDC",
    balanceLabel: "10,000.00",
    value: "5,000",
  },
};

/* -------------------------------------------------------------------------- */
/*  Large numeric value                                                        */
/* -------------------------------------------------------------------------- */

export const LargeValue: Story = {
  name: "Large numeric value",
  args: {
    token: "plusd",
    tokenLabel: "PLUSD",
    balanceLabel: "0.00",
    value: "100,000.00",
  },
};

/* -------------------------------------------------------------------------- */
/*  Side-by-side with a TokenInput placeholder                                 */
/*  (demonstrates that the two components stack cleanly in ConversionCard)    */
/* -------------------------------------------------------------------------- */

export const StackedWithTokenInputPlaceholder: Story = {
  name: "Stacked with TokenInput placeholder (ConversionCard preview)",
  parameters: {
    docs: {
      description: {
        story:
          "Two `TokenAmountDisplay` instances stacked to illustrate the vertical " +
          "rhythm inside a `ConversionCard`. Replace the top one with `TokenInput` " +
          "when building the card.",
      },
    },
  },
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: 448,
        maxWidth: "100%",
      }}
    >
      {/* Simulated TokenInput top-half (USDC) */}
      <TokenAmountDisplay
        token="usdc"
        tokenLabel="USDC"
        balanceLabel="10,000.00"
        value="5,000"
      />
      {/* TokenAmountDisplay (PLUSD) */}
      <TokenAmountDisplay
        token="plusd"
        tokenLabel="PLUSD"
        balanceLabel="0.00"
        value="5,000"
      />
    </div>
  ),
};
