import type { Meta, StoryObj } from "@storybook/react-vite";
import { Toast } from "./Toast";

const meta = {
  title: "Components/Toast",
  component: Toast,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pipeline UI Toast notification — a 4px-radius surface with a 20px " +
          "leading icon and Body-weight title. Two visual shapes: " +
          "**Informational** (icon + title, auto-dismissed) and " +
          "**Actionable** (icon + title + right-aligned action button). " +
          "Four tones: `neutral` (dark), `success` (green #208000), `danger` (red), `pending` (muted). " +
          "Figma: success/actionable node 1497:95175, success/informational node 1497:95270.",
      },
    },
  },
  argTypes: {
    tone: {
      control: "inline-radio",
      options: ["neutral", "success", "danger", "pending"],
    },
    title: { control: "text" },
  },
  args: {
    tone: "neutral",
    title: "Notification",
  },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Informational variants (no action button)                                 */
/* -------------------------------------------------------------------------- */

export const NeutralInformational: Story = {
  name: "neutral — informational",
  args: {
    tone: "neutral",
    title: "You staked 1,000.00 PLUSD",
  },
};

export const SuccessInformational: Story = {
  name: "success — informational",
  args: {
    tone: "success",
    title: "Deposit confirmed",
  },
};

export const DangerInformational: Story = {
  name: "danger — informational",
  args: {
    tone: "danger",
    title: "Deposit failed",
  },
};

export const PendingInformational: Story = {
  name: "pending — informational",
  args: {
    tone: "pending",
    title: "Sending…",
  },
};

/* -------------------------------------------------------------------------- */
/*  Actionable variants (with action button)                                  */
/* -------------------------------------------------------------------------- */

export const SuccessActionable: Story = {
  name: "success — actionable",
  args: {
    tone: "success",
    title: "+1,000.00 PLUSD",
    action: { label: "Stake", onClick: () => {} },
  },
};

export const NeutralActionable: Story = {
  name: "neutral — actionable",
  args: {
    tone: "neutral",
    title: "Deposit submitted",
    action: { label: "View", onClick: () => {} },
  },
};

/* -------------------------------------------------------------------------- */
/*  Icon override                                                              */
/* -------------------------------------------------------------------------- */

export const CustomIcon: Story = {
  name: "custom icon override",
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates the `icon` prop override — any ReactNode replaces the default per-tone icon.",
      },
    },
  },
  args: {
    tone: "neutral",
    title: "Custom icon",
    icon: (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ width: 16, height: 16, flexShrink: 0 }}
      >
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="2" />
        <path
          d="M8 5v3l2 2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
};

/* -------------------------------------------------------------------------- */
/*  Full tone × action matrix                                                 */
/* -------------------------------------------------------------------------- */

export const AllVariants: Story = {
  name: "All variants",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "Matrix showing all four tones × informational and actionable variants.",
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
        gap: 12,
      }}
    >
      <Toast tone="neutral" title="You staked 1,000.00 PLUSD" />
      <Toast
        tone="neutral"
        title="Deposit submitted"
        action={{ label: "View", onClick: () => {} }}
      />
      <Toast tone="success" title="Deposit confirmed" />
      <Toast
        tone="success"
        title="+1,000.00 PLUSD"
        action={{ label: "Stake", onClick: () => {} }}
      />
      <Toast tone="danger" title="Deposit failed" />
      <Toast tone="danger" title="Claim failed" />
      <Toast tone="pending" title="Sending…" />
      <Toast tone="pending" title="Claiming…" />
    </div>
  ),
};
