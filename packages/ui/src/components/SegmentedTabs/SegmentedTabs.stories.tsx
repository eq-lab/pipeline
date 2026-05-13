import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SegmentedTabs } from "./SegmentedTabs";

const meta = {
  title: "Components/SegmentedTabs",
  component: SegmentedTabs,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pipeline UI SegmentedTabs primitive. A presentational segmented-control " +
          "filter bar — muted-fill pill container, equal-width tabs, active tab on " +
          "`--color-pipeline-surface` (paper-white). The page owns active state; " +
          "this component is purely visual. Matches Figma node 1497-94917.",
      },
    },
  },
  argTypes: {
    activeId: { control: "text" },
  },
} satisfies Meta<typeof SegmentedTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Four-tab story — All / Convert / Stake / Unstake                          */
/* -------------------------------------------------------------------------- */

const FOUR_TABS = [
  { id: "all", label: "All" },
  { id: "convert", label: "Convert" },
  { id: "stake", label: "Stake" },
  { id: "unstake", label: "Unstake" },
];

function FourTabInteractive() {
  const [active, setActive] = useState("all");
  return (
    <div
      style={{
        width: 360,
        padding: 16,
        background: "var(--color-pipeline-paper)",
        borderRadius: 4,
      }}
    >
      <SegmentedTabs tabs={FOUR_TABS} activeId={active} onSelect={setActive} />
    </div>
  );
}

export const FourTabs: Story = {
  name: "4-tab — All / Convert / Stake / Unstake",
  parameters: {
    docs: {
      description: {
        story:
          "Primary acceptance story. Four equal-width tabs; active tab carries " +
          "paper background + primary-ink label. Inactive tabs use secondary-ink. " +
          "Click any tab to transfer the active state.",
      },
    },
  },
  render: () => <FourTabInteractive />,
  // Provide minimal args so Meta<typeof meta> is satisfied even with a custom render.
  args: {
    tabs: FOUR_TABS,
    activeId: "all",
  },
};

/* -------------------------------------------------------------------------- */
/*  Two-tab story — proving genericity                                        */
/* -------------------------------------------------------------------------- */

const TWO_TABS = [
  { id: "deposit", label: "Deposit" },
  { id: "withdraw", label: "Withdraw" },
];

function TwoTabInteractive() {
  const [active, setActive] = useState("deposit");
  return (
    <div
      style={{
        width: 280,
        padding: 16,
        background: "var(--color-pipeline-paper)",
        borderRadius: 4,
      }}
    >
      <SegmentedTabs tabs={TWO_TABS} activeId={active} onSelect={setActive} />
    </div>
  );
}

export const TwoTabs: Story = {
  name: "2-tab — Deposit / Withdraw (genericity proof)",
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates that the component is not hard-coded to 4 tabs. " +
          "Two tabs still use `flex-1` equal width with no overflow.",
      },
    },
  },
  render: () => <TwoTabInteractive />,
  args: {
    tabs: TWO_TABS,
    activeId: "deposit",
  },
};

/* -------------------------------------------------------------------------- */
/*  Static / snapshot story — all tabs shown at each active index             */
/* -------------------------------------------------------------------------- */

const ACTIVITY_TABS = [
  { id: "all", label: "All" },
  { id: "buy", label: "Buy" },
  { id: "sell", label: "Sell" },
  { id: "stake", label: "Stake" },
  { id: "unstake", label: "Unstake" },
];

export const StaticMatrix: Story = {
  name: "Static matrix — each tab active",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "Non-interactive matrix showing every tab in the active position. " +
          "Useful for visual regression testing.",
      },
    },
  },
  render: () => (
    <div
      style={{
        padding: 32,
        background: "var(--color-pipeline-paper)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {ACTIVITY_TABS.map((tab) => (
        <div key={tab.id} style={{ width: 420 }}>
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: "var(--color-pipeline-ink-muted)",
              marginBottom: 8,
            }}
          >
            active: {tab.label}
          </p>
          <SegmentedTabs tabs={ACTIVITY_TABS} activeId={tab.id} />
        </div>
      ))}
    </div>
  ),
  args: {
    tabs: ACTIVITY_TABS,
    activeId: "all",
  },
};
