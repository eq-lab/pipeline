import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "./Card";

const meta = {
  title: "Components/Card",
  component: Card,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pipeline UI Card surface primitive. Two variants matching the Figma " +
          "frame 1497-94556: `white` (paper-white surface used for the dashboard " +
          "cards and outer container) and `yellow` (pale yellow promo surface " +
          "used for the Connect Wallet card). The Card is a surface only — it " +
          "owns fill, border, radius, and inner padding. Children render " +
          "unstyled. All values come from `@pipeline/ui/styles/theme.css`.",
      },
    },
  },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: ["white", "yellow"],
    },
    children: { control: false },
  },
  args: {
    variant: "white",
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
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Sample content                                                            */
/* -------------------------------------------------------------------------- */

// Lightweight, token-only content used inside the variant stories. Kept here
// (rather than in the component) so the Card itself stays a pure surface.
function SampleContent({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 320 }}>
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-pipeline-heading-s)",
          lineHeight: "var(--text-pipeline-heading-s--line-height)",
          fontWeight: "var(--font-weight-emphasized)",
          color: "var(--color-pipeline-ink)",
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-pipeline-body)",
          lineHeight: "var(--text-pipeline-body--line-height)",
          color: "var(--color-pipeline-ink-muted)",
        }}
      >
        {body}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Variant stories                                                           */
/* -------------------------------------------------------------------------- */

export const White: Story = {
  name: "white",
  args: {
    variant: "white",
    children: (
      <SampleContent
        title="Get PLUSD"
        body="Mint PLUSD with collateral and start earning yield."
      />
    ),
  },
};

export const Yellow: Story = {
  name: "yellow",
  args: {
    variant: "yellow",
    children: (
      <SampleContent
        title="Connect Wallet"
        body="Link a wallet to view balances and start staking."
      />
    ),
  },
};
