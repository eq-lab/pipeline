import type { Meta, StoryObj } from "@storybook/react-vite";
import { LinkCard } from "./LinkCard";

const meta = {
  title: "Components/LinkCard",
  component: LinkCard,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pipeline UI LinkCard primitive. Row used in the QUESTIONS & ANSWERS " +
          "section (Figma frame 1497-94556, nodes 1497:94669–1497:94673). " +
          "A `label` on the left and an arrow-up-right icon on the right; " +
          "the whole row is a focusable `<a>` anchor. Hover and focus states " +
          "transition the text from muted ink to full ink. All values come " +
          "from `@pipeline/ui/styles/theme.css`.",
      },
    },
  },
  argTypes: {
    label: { control: "text" },
    href: { control: "text" },
  },
  args: {
    label: "How it works?",
    href: "#",
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 32,
          background: "var(--color-pipeline-paper)",
          minWidth: 360,
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LinkCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Single card                                                               */
/* -------------------------------------------------------------------------- */

export const Default: Story = {
  name: "Default",
  args: {
    label: "How it works?",
    href: "#",
  },
};

/* -------------------------------------------------------------------------- */
/*  Three stacked cards — mirrors the home page QUESTIONS & ANSWERS row      */
/* -------------------------------------------------------------------------- */

export const HomePageRow: Story = {
  name: "Home page row (3 stacked)",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "Three stacked LinkCards matching the QUESTIONS & ANSWERS section " +
          "on the home page (Figma nodes 1497:94669, 1497:94671, 1497:94673). " +
          "Each row has a top-border separator; rows share the full width of " +
          "their container.",
      },
    },
  },
  render: () => (
    <div
      style={{
        padding: 32,
        background: "var(--color-pipeline-paper)",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          maxWidth: 360,
        }}
      >
        <LinkCard label="How it works?" href="#" />
        <LinkCard label="What is PLUSD?" href="#" />
        <LinkCard label="What is sPLUSD?" href="#" />
      </div>
    </div>
  ),
};
