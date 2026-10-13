// spec: docs/frontend/ui-components.md#warningillustration
import type { Meta, StoryObj } from "@storybook/react-vite";
import { WarningIllustration } from "./WarningIllustration";

const meta = {
  title: "Components/WarningIllustration",
  component: WarningIllustration,
  parameters: {
    layout: "centered",
  },
  argTypes: {
    width: { control: { type: "number", min: 64, max: 512, step: 8 } },
    tone: { control: "inline-radio", options: ["primary", "muted"] },
  },
  args: {
    width: 236,
    tone: "muted",
  },
} satisfies Meta<typeof WarningIllustration>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Muted: Story = {
  name: "Muted (AddUsdCard declined)",
  args: { width: 236, tone: "muted" },
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
          minWidth: 300,
          minHeight: 280,
        }}
      >
        <Story />
      </div>
    ),
  ],
};

export const Primary: Story = {
  name: "Primary (high-contrast variant)",
  args: { width: 236, tone: "primary" },
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
          minWidth: 300,
          minHeight: 280,
        }}
      >
        <Story />
      </div>
    ),
  ],
};
