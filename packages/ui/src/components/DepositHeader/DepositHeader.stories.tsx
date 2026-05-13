import type { Meta, StoryObj } from "@storybook/react-vite";
import { DepositHeader } from "./DepositHeader";

const meta = {
  title: "Components/DepositHeader",
  component: DepositHeader,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Centered header displayed above the deposit / conversion card. " +
          "Renders a large PLUSD coin icon (40 px) stacked above a display-serif " +
          "heading (`1:1 Conversion` by default). The `title` prop defaults to " +
          '`"1:1 Conversion"` so callers can override the copy without extra wiring. ' +
          "Matches Figma node 1498-100130.",
      },
    },
  },
  argTypes: {
    title: { control: "text" },
  },
  args: {
    title: "1:1 Conversion",
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 32,
          background: "var(--color-pipeline-paper)",
          minWidth: 320,
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DepositHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Default — matches the Figma deposit screen header                         */
/* -------------------------------------------------------------------------- */

export const Default: Story = {
  name: "Default (1:1 Conversion)",
};

/* -------------------------------------------------------------------------- */
/*  Custom title                                                               */
/* -------------------------------------------------------------------------- */

export const CustomTitle: Story = {
  name: "Custom title",
  args: {
    title: "Stake PLUSD",
  },
  parameters: {
    docs: {
      description: {
        story:
          "The `title` prop accepts any string so the component can be " +
          "reused across deposit, staking, and withdrawal flows.",
      },
    },
  },
};

/* -------------------------------------------------------------------------- */
/*  Inline with a card — context preview                                      */
/* -------------------------------------------------------------------------- */

export const AboveCard: Story = {
  name: "Above card (context preview)",
  parameters: {
    docs: {
      description: {
        story:
          "Illustrates the typical usage: DepositHeader sits directly above " +
          "the conversion card surface in the deposit flow.",
      },
    },
  },
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        padding: 32,
        background: "var(--color-pipeline-paper)",
        width: 400,
      }}
    >
      <DepositHeader />
      <div
        style={{
          width: "100%",
          height: 120,
          background: "var(--color-pipeline-surface)",
          border: "1px solid var(--color-pipeline-line)",
          borderRadius: "var(--radius-pipeline-card)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-pipeline-ink-muted)",
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-pipeline-caption)",
        }}
      >
        Conversion card placeholder
      </div>
    </div>
  ),
};
