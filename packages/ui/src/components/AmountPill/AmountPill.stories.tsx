import type { Meta, StoryObj } from "@storybook/react-vite";
import { AmountPill } from "./AmountPill";

const meta = {
  title: "Components/AmountPill",
  component: AmountPill,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Static, non-interactive ink-filled pill. Displays a formatted " +
          "amount string (e.g. `+500.00 USDC`) with white Body-Emphasized " +
          "text on an ink background. Used on the right side of success " +
          "transaction rows. Not clickable — use `Button` for interactive controls.",
      },
    },
  },
  args: {
    children: "+500.00 USDC",
  },
} satisfies Meta<typeof AmountPill>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Default                                                                    */
/* -------------------------------------------------------------------------- */

export const Default: Story = {
  name: "Default — deposit",
};

/* -------------------------------------------------------------------------- */
/*  Various amount formats                                                     */
/* -------------------------------------------------------------------------- */

export const PLUSD: Story = {
  name: "PLUS-D deposit",
  args: { children: "+1,000.00 PLUS-D" },
};

export const LargeAmount: Story = {
  name: "Large amount",
  args: { children: "+10,000.00 USDC" },
};

export const SmallAmount: Story = {
  name: "Small amount",
  args: { children: "+0.01 USDC" },
};

/* -------------------------------------------------------------------------- */
/*  Transaction row simulation                                                 */
/* -------------------------------------------------------------------------- */

export const InTransactionRow: Story = {
  name: "In a transaction row",
  render: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 16px",
        background: "var(--color-pipeline-surface)",
        borderRadius: "var(--radius-pipeline-card)",
        border: "1px solid var(--color-pipeline-line)",
        minWidth: 320,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-pipeline-body)",
          color: "var(--color-pipeline-ink)",
        }}
      >
        Deposit USDC
      </span>
      <AmountPill>+500.00 USDC</AmountPill>
    </div>
  ),
};
