import type { Meta, StoryObj } from "@storybook/react-vite";
import { WalletPill } from "./WalletPill";

const meta = {
  title: "Components/WalletPill",
  component: WalletPill,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Top-right connected-wallet chip. Displays a small CoinIcon " +
          "alongside a formatted balance string inside a rounded white pill " +
          "with a subtle border. Purely visual — click handling comes later.",
      },
    },
  },
  argTypes: {
    token: { control: "select", options: ["usdc", "plusd"] },
    balance: { control: "text" },
  },
  args: {
    token: "usdc",
    balance: "$10,000.00",
  },
} satisfies Meta<typeof WalletPill>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Default                                                                    */
/* -------------------------------------------------------------------------- */

export const Default: Story = {
  name: "USDC — default balance",
};

/* -------------------------------------------------------------------------- */
/*  Both tokens                                                                */
/* -------------------------------------------------------------------------- */

export const PLUSD: Story = {
  name: "PLUS-D token",
  args: { token: "plusd", balance: "$10,000.00" },
};

/* -------------------------------------------------------------------------- */
/*  Various balances                                                           */
/* -------------------------------------------------------------------------- */

export const SmallBalance: Story = {
  name: "Small balance",
  args: { token: "usdc", balance: "$1.00" },
};

export const LargeBalance: Story = {
  name: "Large balance",
  args: { token: "usdc", balance: "$1,234,567.89" },
};

/* -------------------------------------------------------------------------- */
/*  Both tokens side-by-side (header simulation)                              */
/* -------------------------------------------------------------------------- */

export const BothTokens: Story = {
  name: "Both tokens — side-by-side",
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <WalletPill token="usdc" balance="$10,000.00" />
      <WalletPill token="plusd" balance="$5,432.10" />
    </div>
  ),
};
