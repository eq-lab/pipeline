import type { Meta, StoryObj } from "@storybook/react-vite";
import { StepRow } from "./StepRow";

const meta = {
  title: "Components/StepRow",
  component: StepRow,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Numbered step row used inside `StepsCard`. Renders a numbered square " +
          "(e.g. `1`), a label (e.g. `Allow contract to use USDC`), and a trailing " +
          "action `Button` (`Approve` / `Convert`). Matches the Figma `card-horizontal` " +
          "list items at node 1498-100694. Disabled state renders the whole row at 30% " +
          "opacity — matching the greyed-out appearance in the Figma design.",
      },
    },
  },
  argTypes: {
    step: { control: { type: "number", min: 1, max: 9 } },
    label: { control: "text" },
    actionLabel: { control: "text" },
    disabled: { control: "boolean" },
  },
  args: {
    step: 1,
    label: "Allow contract to use USDC",
    actionLabel: "Approve",
    disabled: false,
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 16,
          background: "var(--color-pipeline-paper)",
          width: 400,
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StepRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Figma steps — disabled (default) state                                    */
/* -------------------------------------------------------------------------- */

export const Step1Disabled: Story = {
  name: "Step 1 — disabled (Figma default)",
  args: {
    step: 1,
    label: "Allow contract to use USDC",
    actionLabel: "Approve",
    disabled: true,
  },
};

export const Step2Disabled: Story = {
  name: "Step 2 — disabled (Figma default)",
  args: {
    step: 2,
    label: "Confirm and receive PLUSD",
    actionLabel: "Convert",
    disabled: true,
  },
};

/* -------------------------------------------------------------------------- */
/*  Enabled state (for completeness)                                          */
/* -------------------------------------------------------------------------- */

export const Step1Enabled: Story = {
  name: "Step 1 — enabled",
  args: {
    step: 1,
    label: "Allow contract to use USDC",
    actionLabel: "Approve",
    disabled: false,
  },
};

export const Step2Enabled: Story = {
  name: "Step 2 — enabled",
  args: {
    step: 2,
    label: "Confirm and receive PLUSD",
    actionLabel: "Convert",
    disabled: false,
  },
};

/* -------------------------------------------------------------------------- */
/*  Success state — step done (green pill check affordance)                   */
/* -------------------------------------------------------------------------- */

export const Step1Success: Story = {
  name: "Step 1 — success (Figma node 1497-95272)",
  args: {
    step: 1,
    label: "Allow contract to use USDC",
    actionLabel: "Approve",
    state: "success",
  },
};

/* -------------------------------------------------------------------------- */
/*  Pair — mirrors the StepsCard layout from the Figma deposit screen         */
/* -------------------------------------------------------------------------- */

export const Pair: Story = {
  name: "Step 1 + Step 2 (StepsCard preview)",
  parameters: {
    docs: {
      description: {
        story:
          "Both steps stacked as they appear inside the `StepsCard` on the " +
          "deposit/conversion screen (Figma node 1498-100694).",
      },
    },
  },
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 16,
        background: "var(--color-pipeline-paper)",
        width: 400,
      }}
    >
      <StepRow
        step={1}
        label="Allow contract to use USDC"
        actionLabel="Approve"
        disabled
      />
      <StepRow
        step={2}
        label="Confirm and receive PLUSD"
        actionLabel="Convert"
        disabled
      />
    </div>
  ),
};
