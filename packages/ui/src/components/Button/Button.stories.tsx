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
          "Pipeline UI Button primitive. Three variants matching the Figma " +
          "frame 1497-94556: `primary-dark` (ink/CTA), `primary-blue` (brand), " +
          "and `circular-blue` (round brand CTA used for the Stake action). " +
          "All variants consume design tokens from `@pipeline/ui/styles/theme.css`.",
      },
    },
  },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: ["primary-dark", "primary-blue", "circular-blue"],
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
    children: "Convert",
  },
};

export const CircularBlue: Story = {
  name: "circular-blue",
  args: {
    variant: "circular-blue",
    children: "Stake",
  },
};

/* -------------------------------------------------------------------------- */
/*  State stories — hover / focus-visible / disabled                          */
/* -------------------------------------------------------------------------- */

interface StateRowProps {
  variant: "primary-dark" | "primary-blue" | "circular-blue";
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
      `}</style>
      <StateHeader />
      <StateRow variant="primary-dark" label="Connect Wallet" />
      <StateRow variant="primary-blue" label="Convert" />
      <StateRow variant="circular-blue" label="Stake" />
    </div>
  ),
};
