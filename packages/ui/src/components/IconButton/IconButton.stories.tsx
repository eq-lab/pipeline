import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton";
import { NavIcon } from "../NavIcon/NavIcon";

const meta = {
  title: "Components/IconButton",
  component: IconButton,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pipeline UI IconButton primitive. 40×40 square button used for the " +
          "four navigation icons in the top bar (Figma frame 1497-94556). The " +
          "`active` state paints the icon in the brand navy token; the inactive " +
          "state uses the neutral muted ink token. Icons should be 24×24 and " +
          'paint with `fill="currentColor"` so they inherit the active ' +
          "state automatically. Use the `NavIcon` component for nav glyphs.",
      },
    },
  },
  argTypes: {
    label: { control: "text" },
    active: { control: "boolean" },
    disabled: { control: "boolean" },
  },
  args: {
    label: "Home",
    active: true,
    disabled: false,
    icon: <NavIcon name="home" />,
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Single-state stories                                                      */
/* -------------------------------------------------------------------------- */

export const Active: Story = {
  name: "Active",
  args: {
    active: true,
    label: "Home",
    icon: <NavIcon name="home" />,
  },
};

export const Inactive: Story = {
  name: "Inactive",
  args: {
    active: false,
    label: "Markets",
    icon: <NavIcon name="stats" />,
  },
};

/* -------------------------------------------------------------------------- */
/*  Side-by-side — required by the Issue acceptance criteria                  */
/* -------------------------------------------------------------------------- */

export const ActiveAndInactive: Story = {
  name: "Active & Inactive",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "The four top-bar nav icons. The first (Home) is the active route and " +
          "renders in brand navy; the remaining three render in muted ink to " +
          "indicate they are inactive. Mirrors the Figma top bar exactly.",
      },
    },
  },
  render: () => (
    <div
      style={{
        display: "flex",
        gap: 32,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        background: "var(--color-pipeline-paper)",
        minHeight: "100vh",
      }}
    >
      <IconButton active label="Home" icon={<NavIcon name="home" />} />
      <IconButton label="Deposit" icon={<NavIcon name="deposit" />} />
      <IconButton label="Stats" icon={<NavIcon name="stats" />} />
      <IconButton label="History" icon={<NavIcon name="history" />} />
    </div>
  ),
};
