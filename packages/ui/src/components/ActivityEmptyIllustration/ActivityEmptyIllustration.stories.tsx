import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActivityEmptyIllustration } from "./ActivityEmptyIllustration";

const meta = {
  title: "Components/ActivityEmptyIllustration",
  component: ActivityEmptyIllustration,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Decorative striped-square illustration from Figma node " +
          "1497:94570. Used inside the Recent activity empty state (width " +
          "240, muted tone). The component renders the SVG asset via CSS " +
          "`mask-image` so the `tone` prop swaps the fill between the " +
          "primary-ink and muted-ink theme tokens. The illustration is " +
          'purely decorative — it ships with `aria-hidden="true"` and ' +
          "meaning is conveyed by the surrounding EmptyState caption. " +
          "Distinct from WalletIllustration (landscape striped wallet with " +
          "coin-slot, Figma node 1497:94556) — this is a 240×240 square " +
          "silhouette of abstract horizontal stripes.",
      },
    },
  },
  argTypes: {
    width: { control: { type: "number", min: 64, max: 512, step: 8 } },
    tone: { control: "inline-radio", options: ["primary", "muted"] },
  },
  args: {
    width: 240,
    tone: "muted",
  },
} satisfies Meta<typeof ActivityEmptyIllustration>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Muted — Recent activity empty state placement                             */
/* -------------------------------------------------------------------------- */

export const Muted: Story = {
  name: "Muted (Recent activity empty state)",
  args: { width: 240, tone: "muted" },
  parameters: {
    docs: {
      description: {
        story:
          "How the illustration appears inside the Recent activity empty " +
          "state on the disconnected dashboard: at the Figma intrinsic " +
          "240×240 size, painted in the muted ink token so it reads as " +
          "ambient decoration rather than a primary affordance. Rendered " +
          "on the white card surface used by every neutral dashboard card.",
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
          minHeight: 320,
        }}
      >
        <Story />
      </div>
    ),
  ],
};

/* -------------------------------------------------------------------------- */
/*  Primary — high-contrast variant                                           */
/* -------------------------------------------------------------------------- */

export const Primary: Story = {
  name: "Primary (high-contrast variant)",
  args: { width: 240, tone: "primary" },
  parameters: {
    docs: {
      description: {
        story:
          "The same striped-square silhouette painted in the primary ink " +
          "token. Not currently used in production, but available for " +
          "future surfaces that need the high-contrast variant. Rendered " +
          "on the pale-yellow promo surface for contrast context.",
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
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 320,
          minHeight: 320,
        }}
      >
        <Story />
      </div>
    ),
  ],
};
