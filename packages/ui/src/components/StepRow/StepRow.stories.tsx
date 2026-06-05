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
/*  Step 1 success + Step 2 idle — "Approved" state                           */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors the PendingClaim deposit scenario: step 1 shows the Done pill
 * (green check) and step 2 shows the live "Claim" button, both at the same
 * 88 px column width. Acceptance criterion for Issue #301 — the pill and
 * button must be visually flush.
 */
export const Step1SuccessStep2Idle: Story = {
  name: "Step 1 success / Step 2 idle (Approved)",
  parameters: {
    docs: {
      description: {
        story:
          "PendingClaim scenario: step 1 shows the Done green-check pill and " +
          "step 2 shows the live action button. Verifies that the pill width " +
          "aligns with the button width (both 88 px — Figma node 1980-49513).",
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
        state="success"
      />
      <StepRow
        step={2}
        label="Confirm and receive PLUSD"
        actionLabel="Claim"
        disabled={false}
      />
    </div>
  ),
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

/* -------------------------------------------------------------------------- */
/*  Mobile — 402px viewport with long labels that wrap (Issue #505)           */
/* -------------------------------------------------------------------------- */

/**
 * Verifies fix for Issue #505: long step labels must wrap to two lines at
 * 402px mobile width instead of truncating with ellipsis.
 * Action buttons must render at 32px (h-8) not 48px.
 */
export const MobileLongLabels: Story = {
  name: "Mobile 402px — long labels wrap (Issue #505)",
  parameters: {
    docs: {
      description: {
        story:
          "Fix #505 regression test: at 402 px mobile width, " +
          '"Allow Pipeline to use USDC" and "Confirm USDC transaction" must ' +
          "wrap to two lines (no ellipsis). Action buttons must be 32 px tall.",
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
        width: 370, // card interior at 402px viewport with 8px page margins × 2
      }}
    >
      <StepRow
        step={1}
        label="Allow Pipeline to use USDC"
        actionLabel="Approve"
        disabled
      />
      <StepRow
        step={2}
        label="Confirm USDC transaction"
        actionLabel="Confirm"
        disabled
      />
    </div>
  ),
};
