import type { Meta, StoryObj } from "@storybook/react-vite";
import { QuickAmountChip } from "./QuickAmountChip";

const meta = {
  title: "Components/QuickAmountChip",
  component: QuickAmountChip,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Selectable amount pill used in the conversion card. Renders as a " +
          '`<button type="button">` chip with a subtle border. Supports ' +
          "default, selected, hover, and focus-visible states.",
      },
    },
  },
  argTypes: {
    label: { control: "text" },
    selected: { control: "boolean" },
    disabled: { control: "boolean" },
  },
  args: {
    label: "$5,000",
    selected: false,
    disabled: false,
  },
} satisfies Meta<typeof QuickAmountChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Default (unselected)                                                       */
/* -------------------------------------------------------------------------- */

export const Default: Story = {
  name: "Default — unselected",
};

/* -------------------------------------------------------------------------- */
/*  Selected                                                                   */
/* -------------------------------------------------------------------------- */

export const Selected: Story = {
  name: "Selected",
  args: { selected: true },
};

/* -------------------------------------------------------------------------- */
/*  Minimum amount                                                             */
/* -------------------------------------------------------------------------- */

export const MinimumAmount: Story = {
  name: "Minimum amount",
  args: { label: "$1,000 (Min)" },
};

/* -------------------------------------------------------------------------- */
/*  Maximum (special label)                                                    */
/* -------------------------------------------------------------------------- */

export const MaxAmount: Story = {
  name: "Max (special label)",
  args: { label: "Max" },
};

export const MaxSelected: Story = {
  name: "Max — selected",
  args: { label: "Max", selected: true },
};

/* -------------------------------------------------------------------------- */
/*  All chips side-by-side (conversion card simulation)                       */
/* -------------------------------------------------------------------------- */

export const AllChips: Story = {
  name: "All chips — side-by-side",
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <QuickAmountChip label="$1,000 (Min)" />
      <QuickAmountChip label="$5,000" selected />
      <QuickAmountChip label="$10,000" />
      <QuickAmountChip label="Max" />
    </div>
  ),
};

/* -------------------------------------------------------------------------- */
/*  Disabled                                                                   */
/* -------------------------------------------------------------------------- */

export const Disabled: Story = {
  name: "Disabled",
  args: { disabled: true },
};
