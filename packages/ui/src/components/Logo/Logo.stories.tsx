import type { Meta, StoryObj } from "@storybook/react-vite";
import { Logo } from "./Logo";

const meta = {
  title: "Components/Logo",
  component: Logo,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pipeline wordmark used in the top-left of every dashboard page " +
          "(Figma frame 1497-94556). Renders as inline SVG so it can be " +
          "themed via `currentColor` and scaled by setting `width`. The " +
          "default color is the brand navy token; the component exposes a " +
          '`role="img"` element with `aria-label="Pipeline"` for assistive ' +
          "tech.",
      },
    },
  },
  argTypes: {
    width: { control: { type: "number", min: 48, max: 512, step: 4 } },
    "aria-label": { control: "text" },
  },
  args: {
    width: 116,
  },
} satisfies Meta<typeof Logo>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Default — intrinsic size on the paper background                          */
/* -------------------------------------------------------------------------- */

export const Default: Story = {
  name: "Default (116×32)",
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 32,
          background: "var(--color-pipeline-paper)",
          minWidth: 240,
        }}
      >
        <Story />
      </div>
    ),
  ],
};

/* -------------------------------------------------------------------------- */
/*  Width override — wider rendering keeps proportions                        */
/* -------------------------------------------------------------------------- */

export const Large: Story = {
  name: "Width 256",
  args: { width: 256 },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 32,
          background: "var(--color-pipeline-paper)",
          minWidth: 320,
        }}
      >
        <Story />
      </div>
    ),
  ],
};

/* -------------------------------------------------------------------------- */
/*  Light backgrounds — Acceptance: shown on both light backgrounds           */
/* -------------------------------------------------------------------------- */

export const OnLightBackgrounds: Story = {
  name: "On light backgrounds",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "The wordmark on the two light surface tokens used in the " +
          "dashboard: the paper background that wraps the app and the " +
          "white card surface used by every dashboard card. The default " +
          "brand-navy fill has sufficient contrast on both.",
      },
    },
  },
  render: () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 0,
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          background: "var(--color-pipeline-paper)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <Logo />
      </div>
      <div
        style={{
          background: "var(--color-pipeline-surface)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <Logo />
      </div>
    </div>
  ),
};
