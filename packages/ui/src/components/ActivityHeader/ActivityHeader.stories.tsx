import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActivityHeader } from "./ActivityHeader";

const meta = {
  title: "Components/ActivityHeader",
  component: ActivityHeader,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Centered header displayed above the transaction list on the Activity " +
          'page. Renders a `HeroIcon` with `icon=\\"arrow-clock\\"` (72×72 px ' +
          "muted-fill circle) stacked above a display-serif heading (`Activity` " +
          'by default). The `title` prop defaults to `\\"Activity\\"` so callers ' +
          "can override the copy. Matches Figma node 1497-94912.",
      },
    },
  },
  argTypes: {
    title: { control: "text" },
  },
  args: {
    title: "Activity",
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
} satisfies Meta<typeof ActivityHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Default — matches the Figma Activity page header                          */
/* -------------------------------------------------------------------------- */

export const Default: Story = {
  name: "Default (Activity)",
};

/* -------------------------------------------------------------------------- */
/*  Custom title                                                               */
/* -------------------------------------------------------------------------- */

export const CustomTitle: Story = {
  name: "Custom title",
  args: {
    title: "Transactions",
  },
  parameters: {
    docs: {
      description: {
        story:
          "The `title` prop accepts any string so the component can be reused " +
          "across different activity-style pages.",
      },
    },
  },
};

/* -------------------------------------------------------------------------- */
/*  Above a list — context preview                                             */
/* -------------------------------------------------------------------------- */

export const AboveList: Story = {
  name: "Above list (context preview)",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "Illustrates the typical usage: ActivityHeader sits directly above " +
          "the transaction list on the Activity page, matching the Figma " +
          "composition (node 1497-94912).",
      },
    },
  },
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
        padding: 32,
        background: "var(--color-pipeline-paper)",
        minHeight: "100vh",
        width: "100%",
      }}
    >
      <ActivityHeader />
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          height: 200,
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
        Transaction list placeholder
      </div>
    </div>
  ),
};
