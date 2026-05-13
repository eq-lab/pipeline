import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActivityRow } from "./ActivityRow";

const meta = {
  title: "Components/ActivityRow",
  component: ActivityRow,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Single row in the activity list. Leads with an `ActivityIcon`, " +
          "shows a two-line content block (title + timestamp), and a " +
          "right-aligned `amount` slot. The `amount` prop is a `ReactNode` " +
          "so callers can pass an `<AmountPill>` (success rows) or a custom " +
          "two-line block (stake / unstake / convert / pending rows). " +
          "Figma reference: node 1497-94912.",
      },
    },
  },
  argTypes: {
    icon: {
      control: "select",
      options: [
        "check-circle",
        "clock-pending",
        "arrow-up-circle",
        "arrow-down-circle",
        "exchange",
      ],
    },
    title: { control: "text" },
    timestamp: { control: "text" },
    amount: { control: false },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 24,
          background: "var(--color-pipeline-paper)",
          width: 360,
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ActivityRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Amount slot helpers (inline markup — no AmountPill dependency)            */
/* -------------------------------------------------------------------------- */

/**
 * SuccessPill — simulates an <AmountPill> for success rows.
 * Uses inline styles with design tokens to avoid any external dependency.
 */
const SuccessPill = ({ children }: { children: React.ReactNode }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "2px 8px",
      borderRadius: "var(--radius-pipeline-pill)",
      background: "var(--color-pipeline-promo)",
      fontFamily: "var(--font-body)",
      fontSize: "var(--text-pipeline-caption)",
      lineHeight: "var(--text-pipeline-caption--line-height)",
      color: "var(--color-pipeline-ink)",
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
);

/** Two-line amount block used for stake / unstake / convert / pending rows. */
const TwoLineAmount = ({
  primary,
  secondary,
}: {
  primary: string;
  secondary: string;
}) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-end",
      gap: 2,
      fontFamily: "var(--font-body)",
    }}
  >
    <span
      style={{
        fontSize: "var(--text-pipeline-body)",
        lineHeight: "var(--text-pipeline-body--line-height)",
        color: "var(--color-pipeline-ink)",
        whiteSpace: "nowrap",
      }}
    >
      {primary}
    </span>
    <span
      style={{
        fontSize: "var(--text-pipeline-caption)",
        lineHeight: "var(--text-pipeline-caption--line-height)",
        color: "var(--color-pipeline-ink-muted)",
        whiteSpace: "nowrap",
      }}
    >
      {secondary}
    </span>
  </div>
);

/* -------------------------------------------------------------------------- */
/*  Individual Figma row variants                                              */
/* -------------------------------------------------------------------------- */

/** Variant 1 — Success row: completed conversion with an AmountPill. */
export const SuccessRow: Story = {
  name: "Success (conversion complete)",
  args: {
    icon: "check-circle",
    title: "PLUSD → USDC",
    timestamp: "Apr 17, 2:17 PM",
    amount: <SuccessPill>+1,000.00 USDC</SuccessPill>,
  },
};

/** Variant 2 — Pending row: transaction in progress. */
export const PendingRow: Story = {
  name: "Pending (in progress)",
  args: {
    icon: "clock-pending",
    title: "PLUSD → USDC",
    timestamp: "Apr 17, 2:17 PM",
    amount: (
      <TwoLineAmount primary="+1,000.00 PLUSD" secondary="−1,000.00 sPLUSD" />
    ),
  },
};

/** Variant 3 — Unstake row: sPLUSD redeemed for PLUSD. */
export const UnstakeRow: Story = {
  name: "Unstake (sPLUSD → PLUSD)",
  args: {
    icon: "arrow-down-circle",
    title: "Unstake sPLUSD",
    timestamp: "Apr 17, 2:17 PM",
    amount: (
      <TwoLineAmount primary="+1,000.00 PLUSD" secondary="−1,000.00 sPLUSD" />
    ),
  },
};

/** Variant 4 — Stake row: PLUSD staked for sPLUSD. */
export const StakeRow: Story = {
  name: "Stake (PLUSD → sPLUSD)",
  args: {
    icon: "arrow-up-circle",
    title: "Stake PLUSD",
    timestamp: "Apr 17, 2:17 PM",
    amount: (
      <TwoLineAmount primary="+1,000.00 sPLUSD" secondary="−1,000.00 PLUSD" />
    ),
  },
};

/** Variant 5 — Convert row: USDC exchanged for PLUSD. */
export const ConvertRow: Story = {
  name: "Convert (USDC → PLUSD)",
  args: {
    icon: "exchange",
    title: "USDC → PLUSD",
    timestamp: "Apr 17, 2:17 PM",
    amount: (
      <TwoLineAmount primary="+1,000.00 PLUSD" secondary="−1,000.00 USDC" />
    ),
  },
};

/* -------------------------------------------------------------------------- */
/*  All five Figma variants together                                           */
/* -------------------------------------------------------------------------- */

export const AllVariants: Story = {
  name: "All five Figma variants",
  args: {
    icon: "check-circle",
    title: "",
    timestamp: "",
    amount: null,
  },
  parameters: {
    docs: {
      description: {
        story:
          "All five Figma row variants stacked as they appear in the " +
          "activity list (Figma node 1497-94912).",
      },
    },
  },
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--color-pipeline-paper)",
        padding: 24,
        width: 360,
      }}
    >
      <ActivityRow
        icon="check-circle"
        title="PLUSD → USDC"
        timestamp="Apr 17, 2:17 PM"
        amount={<SuccessPill>+1,000.00 USDC</SuccessPill>}
      />
      <ActivityRow
        icon="clock-pending"
        title="PLUSD → USDC"
        timestamp="Apr 17, 2:17 PM"
        amount={
          <TwoLineAmount
            primary="+1,000.00 PLUSD"
            secondary="−1,000.00 sPLUSD"
          />
        }
      />
      <ActivityRow
        icon="arrow-down-circle"
        title="Unstake sPLUSD"
        timestamp="Apr 17, 2:17 PM"
        amount={
          <TwoLineAmount
            primary="+1,000.00 PLUSD"
            secondary="−1,000.00 sPLUSD"
          />
        }
      />
      <ActivityRow
        icon="arrow-up-circle"
        title="Stake PLUSD"
        timestamp="Apr 17, 2:17 PM"
        amount={
          <TwoLineAmount
            primary="+1,000.00 sPLUSD"
            secondary="−1,000.00 PLUSD"
          />
        }
      />
      <ActivityRow
        icon="exchange"
        title="USDC → PLUSD"
        timestamp="Apr 17, 2:17 PM"
        amount={
          <TwoLineAmount primary="+1,000.00 PLUSD" secondary="−1,000.00 USDC" />
        }
      />
    </div>
  ),
};

/* -------------------------------------------------------------------------- */
/*  Title truncation                                                           */
/* -------------------------------------------------------------------------- */

export const TitleTruncation: Story = {
  name: "Title truncation (long title)",
  parameters: {
    docs: {
      description: {
        story:
          "When the title is very long it truncates with an ellipsis so the " +
          "amount slot is never displaced.",
      },
    },
  },
  args: {
    icon: "exchange",
    title: "USDC → PLUSD via a very long bridge protocol name that overflows",
    timestamp: "Apr 17, 2:17 PM",
    amount: <SuccessPill>+1,000.00 PLUSD</SuccessPill>,
  },
};
