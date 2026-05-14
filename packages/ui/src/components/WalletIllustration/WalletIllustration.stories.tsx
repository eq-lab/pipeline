import type { Meta, StoryObj } from "@storybook/react-vite";
import { WalletIllustration } from "./WalletIllustration";

const meta = {
  title: "Components/WalletIllustration",
  component: WalletIllustration,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Decorative striped-wallet illustration from Figma frame " +
          "1497-94556. Reused inside the Connect Wallet promo card (large, " +
          "primary tone) and the Recent activity empty state (smaller, " +
          "muted tone). The component renders the SVG asset via CSS " +
          "`mask-image` so the `tone` prop swaps the fill between the " +
          "primary-ink and muted-ink theme tokens. The illustration is " +
          'purely decorative — it ships with `aria-hidden="true"` and ' +
          "meaning is conveyed by the surrounding copy.",
      },
    },
  },
  argTypes: {
    width: { control: { type: "number", min: 64, max: 512, step: 8 } },
    tone: { control: "inline-radio", options: ["primary", "muted"] },
  },
  args: {
    width: 314,
    tone: "primary",
  },
} satisfies Meta<typeof WalletIllustration>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Large / primary — Connect Wallet promo card placement                     */
/* -------------------------------------------------------------------------- */

export const LargePrimary: Story = {
  name: "Large / primary (Connect Wallet promo)",
  args: { width: 314, tone: "primary" },
  parameters: {
    docs: {
      description: {
        story:
          "How the illustration appears inside the Connect Wallet promo " +
          "card on the dashboard: at the Figma intrinsic width with the " +
          "dark ink fill. Rendered on the pale-yellow promo surface for " +
          "context.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 32,
          background: "var(--color-pipeline-promo)",
          borderRadius: "var(--radius-pipeline-card, 4px)",
          border: "1px solid var(--color-pipeline-line)",
          minWidth: 380,
        }}
      >
        <Story />
      </div>
    ),
  ],
};

/* -------------------------------------------------------------------------- */
/*  Smaller / muted — Recent activity empty state placement                   */
/* -------------------------------------------------------------------------- */

export const SmallMuted: Story = {
  name: "Small / muted (Recent activity empty state)",
  args: { width: 160, tone: "muted" },
  parameters: {
    docs: {
      description: {
        story:
          "How the illustration appears inside the Recent activity empty " +
          "state: roughly half the intrinsic size, painted in the muted " +
          "ink token so it reads as ambient decoration rather than a " +
          "primary affordance. Rendered on the white card surface used by " +
          "every neutral dashboard card.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 32,
          background: "var(--color-pipeline-surface)",
          borderRadius: "var(--radius-pipeline-card, 4px)",
          border: "1px solid var(--color-pipeline-line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 320,
          minHeight: 180,
        }}
      >
        <Story />
      </div>
    ),
  ],
};
