import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextField } from "./TextField";

const meta = {
  title: "Components/TextField",
  component: TextField,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pipeline UI text/email/password input primitive (Figma node 6486:81613, " +
          "issue #1248). The `password` type renders a show/hide eye toggle. `invalid` " +
          "paints the error fill/text tokens and wires `aria-invalid`; `error` renders a " +
          'right-aligned caption below the field via `role="alert"` without shifting layout.',
      },
    },
  },
  argTypes: {
    type: {
      control: "inline-radio",
      options: ["text", "email", "password"],
    },
    invalid: { control: "boolean" },
  },
  args: {
    type: "text",
    placeholder: "Enter corporate email",
    invalid: false,
  },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled(args: React.ComponentProps<typeof TextField>) {
  const [value, setValue] = useState(args.value ?? "");
  return (
    <div style={{ width: 400 }}>
      <TextField {...args} value={value} onChange={setValue} />
    </div>
  );
}

export const Email: Story = {
  args: { type: "email", placeholder: "Enter corporate email" },
  render: (args) => <Controlled {...args} />,
};

export const Password: Story = {
  args: { type: "password", placeholder: "Password" },
  render: (args) => <Controlled {...args} />,
};

export const Invalid: Story = {
  args: {
    type: "email",
    value: "dsfdffs",
    invalid: true,
    error: "Enter the correct email address",
  },
  render: (args) => <Controlled {...args} />,
};
