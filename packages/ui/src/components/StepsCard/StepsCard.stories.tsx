import type { Meta, StoryObj } from "@storybook/react-vite";
import { StepsCard } from "./StepsCard";

const meta = {
  title: "Components/StepsCard",
  component: StepsCard,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A thin wrapper that renders a list of `StepRow` items inside a " +
          "`muted` `Card` surface. Used on the deposit/conversion screen to " +
          "guide the user through a numbered sequence of on-chain actions " +
          "(e.g. Approve token spend, then Convert). Figma node 1498-100130.",
      },
    },
  },
  argTypes: {
    steps: { control: false },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 32,
          background: "var(--color-pipeline-surface)",
          minWidth: 360,
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StepsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Figma default — both steps disabled                                       */
/* -------------------------------------------------------------------------- */

/**
 * The canonical Figma state: both Approve and Convert step rows are disabled
 * (Figma nodes I1498:100694;8980:3384;1498:100676 and
 * I1498:100694;8980:3384;1498:100685).
 */
export const FigmaDefault: Story = {
  name: "Figma default (both disabled)",
  args: {
    steps: [
      {
        label: "Allow contract to use USDC",
        actionLabel: "Approve",
        disabled: true,
      },
      {
        label: "Confirm and receive PLUSD",
        actionLabel: "Convert",
        disabled: true,
      },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/*  Step 1 active, Step 2 disabled                                            */
/* -------------------------------------------------------------------------- */

export const Step1Active: Story = {
  name: "Step 1 active, Step 2 disabled",
  args: {
    steps: [
      {
        label: "Allow contract to use USDC",
        actionLabel: "Approve",
        disabled: false,
      },
      {
        label: "Confirm and receive PLUSD",
        actionLabel: "Convert",
        disabled: true,
      },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/*  Both steps enabled                                                        */
/* -------------------------------------------------------------------------- */

export const AllEnabled: Story = {
  name: "All steps enabled",
  args: {
    steps: [
      {
        label: "Allow contract to use USDC",
        actionLabel: "Approve",
        disabled: false,
      },
      {
        label: "Confirm and receive PLUSD",
        actionLabel: "Convert",
        disabled: false,
      },
    ],
  },
};
