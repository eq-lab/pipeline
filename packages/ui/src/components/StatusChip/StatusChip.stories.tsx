import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusChip } from "./StatusChip";

const meta = {
  title: "Components/StatusChip",
  component: StatusChip,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Inline status pill with a leading icon. Tones: `positive` (check), " +
          "`pending` (clock), `neutral` (dash, unknown).",
      },
    },
  },
  argTypes: {
    tone: {
      control: "inline-radio",
      options: ["positive", "pending", "neutral"],
    },
    label: { control: "text" },
  },
  args: { tone: "positive", label: "Payable now" },
} satisfies Meta<typeof StatusChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Positive: Story = {};

export const Pending: Story = {
  args: { tone: "pending", label: "Not payable yet" },
};

export const Neutral: Story = { args: { tone: "neutral", label: "—" } };
