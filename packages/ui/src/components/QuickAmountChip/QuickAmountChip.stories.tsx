import type { Meta, StoryObj } from "@storybook/react-vite";
import { QuickAmountChip } from "./QuickAmountChip";

const meta = {
  title: "Components/QuickAmountChip",
  component: QuickAmountChip,
  parameters: {
    layout: "centered",
    // Gray background matches the `--color-pipeline-fill-muted` container so
    // the hairline-bordered white chips are visible in the canvas.
    backgrounds: { default: "gray" },
    docs: {
      description: {
        component:
          "Selectable amount chip used in the conversion card. Renders as a " +
          '`<button type="button">` white rounded-rectangle with a 1px hairline ' +
          "border (not a pill). Matches the Figma suggestion-bar design. " +
          "Supports default, selected, hover, and focus-visible states.",
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
    // Simulate the gray container background (hairline-bordered chips on muted fill)
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: 8,
        borderRadius: 8,
        background: "var(--color-pipeline-fill-muted, #f0f0f0)",
        width: 320,
      }}
    >
      <QuickAmountChip label="$1,000 (Min)" className="flex-1" />
      <QuickAmountChip label="$5,000" selected className="flex-1" />
      <QuickAmountChip label="$10,000" className="flex-1" />
      <QuickAmountChip label="Max" className="flex-1" />
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
