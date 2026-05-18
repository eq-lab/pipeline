import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";

const meta = {
  title: "Components/Button",
  component: Button,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pipeline UI Button primitive. Five variants: `primary-dark` (ink/CTA), `primary-blue` (brand), " +
          "`secondary` (borderless ghost — transparent background, no border, ink text, " +
          "opacity-32 when disabled), `circular-blue` (round brand CTA used for " +
          "the Stake action), and `toast-action` (compact white pill for right-aligned " +
          "actions inside Toast notifications — Figma node 1497:95109). All variants " +
          "consume design tokens from `@pipeline/ui/styles/theme.css`.",
      },
    },
  },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: [
        "primary-dark",
        "primary-blue",
        "secondary",
        "circular-blue",
        "toast-action",
      ],
    },
    disabled: { control: "boolean" },
    children: { control: "text" },
  },
  args: {
    children: "Connect",
    variant: "primary-blue",
    disabled: false,
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Variant stories                                                           */
/* -------------------------------------------------------------------------- */

export const PrimaryDark: Story = {
  name: "primary-dark",
  args: {
    variant: "primary-dark",
    children: "Connect Wallet",
  },
};

export const PrimaryBlue: Story = {
  name: "primary-blue",
  args: {
    variant: "primary-blue",
    children: "Buy",
  },
};

export const Secondary: Story = {
  name: "secondary",
  args: {
    variant: "secondary",
    children: "Sell",
  },
};

export const SecondaryDisabled: Story = {
  name: "secondary (disabled)",
  args: {
    variant: "secondary",
    children: "Sell",
    disabled: true,
  },
};

export const CircularBlue: Story = {
  name: "circular-blue",
  args: {
    variant: "circular-blue",
    children: "Stake",
  },
};

export const ToastAction: Story = {
  name: "toast-action",
  parameters: {
    backgrounds: { default: "dark" },
    docs: {
      description: {
        story:
          "Compact white pill button used inside Toast notifications for right-aligned follow-up " +
          "actions (Figma node 1497:95109). Shown here on a dark background to match its " +
          "typical context inside a success/danger/neutral toast pill.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 16,
          borderRadius: 9999,
          background: "var(--color-pipeline-success)",
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span
          style={{
            color: "white",
            fontFamily: "var(--font-body)",
            fontSize: 16,
          }}
        >
          +1,000.00 PLUSD
        </span>
        <Story />
      </div>
    ),
  ],
  args: {
    variant: "toast-action",
    children: "Stake",
  },
};

/* -------------------------------------------------------------------------- */
/*  State stories — hover / focus-visible / disabled                          */
/* -------------------------------------------------------------------------- */

interface StateRowProps {
  variant: "primary-dark" | "primary-blue" | "secondary" | "circular-blue";
  label: string;
}

function StateRow({ variant, label }: StateRowProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px repeat(4, max-content)",
        alignItems: "center",
        gap: 24,
        padding: "12px 0",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "var(--color-pipeline-ink-muted)",
        }}
      >
        {variant}
      </span>
      <Button variant={variant}>{label}</Button>
      <Button variant={variant} className="hover-preview">
        {label}
      </Button>
      <Button variant={variant} autoFocus>
        {label}
      </Button>
      <Button variant={variant} disabled>
        {label}
      </Button>
    </div>
  );
}

function StateHeader() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px repeat(4, max-content)",
        alignItems: "center",
        gap: 24,
        paddingBottom: 8,
        borderBottom: "1px solid var(--color-pipeline-line)",
      }}
    >
      <span />
      {["Default", "Hover (sim)", "Focus-visible", "Disabled"].map((h) => (
        <span
          key={h}
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: "var(--color-pipeline-ink-muted)",
          }}
        >
          {h}
        </span>
      ))}
    </div>
  );
}

export const States: Story = {
  name: "States",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "Matrix of all three variants in default / hover / focus-visible / disabled states. " +
          "The `Hover (sim)` column uses a `.hover-preview` style hook to pin the hover " +
          "background for visual inspection. Real hover only fires on pointer-over.",
      },
    },
  },
  render: () => (
    <div
      style={{
        padding: 32,
        background: "var(--color-pipeline-paper)",
        minHeight: "100vh",
      }}
    >
      <style>{`
        /* Pin the hover-state background for the preview column so reviewers
           can compare the resting and hover fills side by side. */
        .hover-preview[data-variant="primary-dark"] {
          background-color: color-mix(in oklab, var(--color-pipeline-cta) 88%, white);
        }
        .hover-preview[data-variant="primary-blue"],
        .hover-preview[data-variant="circular-blue"] {
          background-color: color-mix(in oklab, var(--color-pipeline-brand) 85%, white);
        }
        /* secondary variant is a borderless ghost — no hover surface to preview */
      `}</style>
      <StateHeader />
      <StateRow variant="primary-dark" label="Connect Wallet" />
      <StateRow variant="primary-blue" label="Buy" />
      <StateRow variant="secondary" label="Sell" />
      <StateRow variant="circular-blue" label="Stake" />
    </div>
  ),
};
