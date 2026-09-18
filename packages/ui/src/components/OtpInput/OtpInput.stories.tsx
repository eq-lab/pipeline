import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { OtpInput } from "./OtpInput";

const meta = {
  title: "Components/OtpInput",
  component: OtpInput,
  parameters: {
    layout: "centered",
  },
  args: {
    length: 6,
    invalid: false,
    value: "",
    onChange: () => {},
  },
} satisfies Meta<typeof OtpInput>;

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled(args: React.ComponentProps<typeof OtpInput>) {
  const [value, setValue] = useState(args.value ?? "");
  return (
    <div style={{ width: 400 }}>
      <OtpInput {...args} value={value} onChange={setValue} />
    </div>
  );
}

export const Empty: Story = {
  args: { value: "" },
  render: (args) => <Controlled {...args} />,
};

export const Partial: Story = {
  args: { value: "12" },
  render: (args) => <Controlled {...args} />,
};

export const Complete: Story = {
  args: { value: "123456" },
  render: (args) => <Controlled {...args} />,
};

export const Invalid: Story = {
  args: { value: "123456", invalid: true },
  render: (args) => <Controlled {...args} />,
};
