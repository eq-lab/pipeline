import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import { ModalDialog } from "./ModalDialog";

const meta = {
  title: "Components/ModalDialog",
  component: ModalDialog,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ModalDialog>;

function InteractiveDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="compact" onClick={() => setOpen(true)}>
        Learn more
      </Button>
      <ModalDialog
        open={open}
        title="Withdrawal queue"
        onClose={() => setOpen(false)}
      >
        Paid in order. Requests are paid first in, first out.
      </ModalDialog>
    </>
  );
}

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    title: "Withdrawal queue",
    onClose: () => {},
    children: "Paid in order. Requests are paid first in, first out.",
  },
};

export const Interactive: Story = {
  args: {
    open: false,
    title: "Withdrawal queue",
    onClose: () => {},
    children: null,
  },
  render: () => <InteractiveDemo />,
};
