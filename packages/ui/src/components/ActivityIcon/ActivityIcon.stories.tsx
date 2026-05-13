import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActivityIcon } from "./ActivityIcon";

const meta = {
  title: "Components/ActivityIcon",
  component: ActivityIcon,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "40 × 40 ink-filled tile that leads every transaction row. " +
          "Holds a 20 px white icon, `rounded-pipeline-card`. " +
          'Decorative by default (`aria-hidden="true"`); pass `aria-label` ' +
          "to make it meaningful to assistive tech.",
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
    "aria-label": { control: "text" },
  },
  args: {
    icon: "check-circle",
  },
} satisfies Meta<typeof ActivityIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Individual icon variants                                                   */
/* -------------------------------------------------------------------------- */

export const CheckCircle: Story = {
  name: "check-circle — completed",
  args: { icon: "check-circle", "aria-label": "Completed" },
};

export const ClockPending: Story = {
  name: "clock-pending — pending",
  args: { icon: "clock-pending", "aria-label": "Pending" },
};

export const ArrowUpCircle: Story = {
  name: "arrow-up-circle — sent",
  args: { icon: "arrow-up-circle", "aria-label": "Sent" },
};

export const ArrowDownCircle: Story = {
  name: "arrow-down-circle — received",
  args: { icon: "arrow-down-circle", "aria-label": "Received" },
};

export const Exchange: Story = {
  name: "exchange — swap",
  args: { icon: "exchange", "aria-label": "Exchange" },
};

/* -------------------------------------------------------------------------- */
/*  All variants together                                                      */
/* -------------------------------------------------------------------------- */

export const AllVariants: Story = {
  name: "All variants",
  parameters: {
    docs: {
      description: {
        story:
          "All five icon variants displayed side-by-side on a light background.",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <ActivityIcon icon="check-circle" aria-label="Completed" />
      <ActivityIcon icon="clock-pending" aria-label="Pending" />
      <ActivityIcon icon="arrow-up-circle" aria-label="Sent" />
      <ActivityIcon icon="arrow-down-circle" aria-label="Received" />
      <ActivityIcon icon="exchange" aria-label="Exchange" />
    </div>
  ),
};

/* -------------------------------------------------------------------------- */
/*  Decorative (aria-hidden)                                                   */
/* -------------------------------------------------------------------------- */

export const Decorative: Story = {
  name: "Decorative (aria-hidden, no aria-label)",
  args: { icon: "check-circle" },
  parameters: {
    docs: {
      description: {
        story:
          "When no `aria-label` is provided the tile is hidden from " +
          'assistive tech (`aria-hidden="true"`).',
      },
    },
  },
};
