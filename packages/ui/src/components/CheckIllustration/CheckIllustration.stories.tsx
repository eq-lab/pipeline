// spec: docs/frontend/ui-components.md#checkillustration
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CheckIllustration } from "./CheckIllustration";

const meta = {
  title: "Components/CheckIllustration",
  component: CheckIllustration,
  parameters: {
    layout: "centered",
  },
  argTypes: {
    width: { control: { type: "number", min: 64, max: 512, step: 8 } },
    tone: { control: "inline-radio", options: ["primary", "muted"] },
  },
  args: {
    width: 291,
    tone: "muted",
  },
} satisfies Meta<typeof CheckIllustration>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Muted: Story = {
  name: "Muted (AddUsdCard verify/verifying)",
  args: { width: 291, tone: "muted" },
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
          minWidth: 360,
          minHeight: 240,
        }}
      >
        <Story />
      </div>
    ),
  ],
};

export const Primary: Story = {
  name: "Primary (high-contrast variant)",
  args: { width: 291, tone: "primary" },
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
          minWidth: 360,
          minHeight: 240,
        }}
      >
        <Story />
      </div>
    ),
  ],
};
