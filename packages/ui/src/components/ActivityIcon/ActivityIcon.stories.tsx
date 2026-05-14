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
          "40 × 40 tonal tile that leads every transaction row. " +
          "Holds a 20 px icon, `rounded-pipeline-card`. " +
          "Three tones: `success` (green tile, white glyph), " +
          "`warning` (amber tile, white glyph), " +
          "`neutral` (muted gray tile, dark glyph — default). " +
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
    tone: {
      control: "select",
      options: ["success", "warning", "neutral"],
    },
    "aria-label": { control: "text" },
  },
  args: {
    icon: "check-circle",
    tone: "neutral",
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
/*  Tonal variants                                                             */
/* -------------------------------------------------------------------------- */

export const SuccessCompleted: Story = {
  name: "Tone: success (completed)",
  args: { icon: "check-circle", tone: "success", "aria-label": "Completed" },
  parameters: {
    docs: {
      description: {
        story:
          "Green tile background with white glyph — used for completed transactions.",
      },
    },
  },
};

export const WarningPending: Story = {
  name: "Tone: warning (pending)",
  args: { icon: "clock-pending", tone: "warning", "aria-label": "Pending" },
  parameters: {
    docs: {
      description: {
        story:
          "Amber/gold tile background with white glyph — used for pending transactions.",
      },
    },
  },
};

export const NeutralExchange: Story = {
  name: "Tone: neutral (exchange)",
  args: { icon: "exchange", tone: "neutral", "aria-label": "Exchange" },
  parameters: {
    docs: {
      description: {
        story:
          "Muted gray tile with dark glyph — default tone for stake/unstake/exchange.",
      },
    },
  },
};

/* -------------------------------------------------------------------------- */
/*  All tones — side-by-side reference                                        */
/* -------------------------------------------------------------------------- */

export const AllTones: Story = {
  name: "All tones (check-circle)",
  parameters: {
    docs: {
      description: {
        story:
          "The same icon rendered in all three tones — success, warning, neutral — " +
          "for a side-by-side tonal reference.",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <ActivityIcon
        icon="check-circle"
        tone="success"
        aria-label="Success tone"
      />
      <ActivityIcon
        icon="check-circle"
        tone="warning"
        aria-label="Warning tone"
      />
      <ActivityIcon
        icon="check-circle"
        tone="neutral"
        aria-label="Neutral tone"
      />
    </div>
  ),
};

/* -------------------------------------------------------------------------- */
/*  All variants together                                                      */
/* -------------------------------------------------------------------------- */

export const AllVariants: Story = {
  name: "All variants (with canonical tones)",
  parameters: {
    docs: {
      description: {
        story:
          "All five icon variants displayed side-by-side with their canonical " +
          "tones matching the Figma frame 1497-94912.",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <ActivityIcon icon="check-circle" tone="success" aria-label="Completed" />
      <ActivityIcon icon="clock-pending" tone="warning" aria-label="Pending" />
      <ActivityIcon icon="arrow-up-circle" tone="neutral" aria-label="Sent" />
      <ActivityIcon
        icon="arrow-down-circle"
        tone="neutral"
        aria-label="Received"
      />
      <ActivityIcon icon="exchange" tone="neutral" aria-label="Exchange" />
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
