import type { Meta, StoryObj } from "@storybook/react-vite";
import { StakeHeader } from "./StakeHeader";

const meta = {
  title: "Components/StakeHeader",
  component: StakeHeader,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Centered header displayed above the stake card. " +
          'Renders a `HeroIcon` with `icon=\\"chart\\"` (72×72 px ' +
          "muted-fill circle) stacked above a display-serif heading " +
          '(`"Earn 8.42% p.a."` by default). The `title` prop defaults to ' +
          '`\\"Earn 8.42% p.a.\\"` so callers can override the copy. ' +
          "Matches Figma node 1497-95313.",
      },
    },
  },
  argTypes: {
    title: { control: "text" },
  },
  args: {
    title: "Earn 8.42% p.a.",
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
} satisfies Meta<typeof StakeHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Default — matches the Figma stake page header                             */
/* -------------------------------------------------------------------------- */

export const Default: Story = {
  name: "Default (Earn 8.42% p.a.)",
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
          "The `title` prop accepts any string so the component can be reused " +
          "across different staking-style pages.",
      },
    },
  },
};

/* -------------------------------------------------------------------------- */
/*  Above a card — context preview                                             */
/* -------------------------------------------------------------------------- */

export const AboveCard: Story = {
  name: "Above card (context preview)",
  parameters: {
    docs: {
      description: {
        story:
          "Illustrates the typical usage: StakeHeader sits directly above " +
          "the stake card, matching the Figma composition (node 1497-95313).",
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
      <StakeHeader />
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
        Stake card placeholder
      </div>
    </div>
  ),
};
