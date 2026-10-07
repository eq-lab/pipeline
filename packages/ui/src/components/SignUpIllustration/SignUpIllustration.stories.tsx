// spec: docs/frontend/ui-components.md#signupillustration
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SignUpIllustration } from "./SignUpIllustration";

const meta = {
  title: "Components/SignUpIllustration",
  component: SignUpIllustration,
  parameters: {
    layout: "centered",
  },
  argTypes: {
    width: { control: { type: "number", min: 64, max: 512, step: 8 } },
    tone: { control: "inline-radio", options: ["primary", "muted"] },
  },
  args: {
    width: 288,
    tone: "primary",
  },
} satisfies Meta<typeof SignUpIllustration>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  name: "Primary (ConnectWalletPromoCard get-started)",
  args: { width: 288, tone: "primary" },
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
          minHeight: 300,
        }}
      >
        <Story />
      </div>
    ),
  ],
};
