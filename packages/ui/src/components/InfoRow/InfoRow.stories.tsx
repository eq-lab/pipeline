import type { Meta, StoryObj } from "@storybook/react-vite";
import { InfoRow } from "./InfoRow";

const meta = {
  title: "Components/InfoRow",
  component: InfoRow,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Label-on-left, value-on-right row used for `Exchange rate` and " +
          "`Network fee` lines at the bottom of the conversion card " +
          "(Figma node 1498-100130). Label uses the muted ink token; " +
          "value uses the primary ink token.",
      },
    },
  },
  argTypes: {
    label: { control: "text" },
    value: { control: "text" },
  },
  args: {
    label: "Exchange rate",
    value: "1 USDC = 1 PLUSD",
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 24,
          background: "var(--color-pipeline-paper)",
          width: 320,
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InfoRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExchangeRate: Story = {
  name: "Exchange rate",
  args: {
    label: "Exchange rate",
    value: "1 USDC = 1 PLUSD",
  },
};

export const NetworkFee: Story = {
  name: "Network fee",
  args: {
    label: "Network fee",
    value: "~$1.20",
  },
};

export const Pair: Story = {
  name: "Exchange rate + Network fee (pair)",
  parameters: {
    docs: {
      description: {
        story:
          "The two InfoRow instances stacked as they appear in the conversion " +
          "card footer (Figma node 1498-100130).",
      },
    },
  },
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 24,
        background: "var(--color-pipeline-paper)",
        width: 320,
      }}
    >
      <InfoRow label="Exchange rate" value="1 USDC = 1 PLUSD" />
      <InfoRow label="Network fee" value="~$1.20" />
    </div>
  ),
};
