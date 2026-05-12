import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton";
import navHome from "../../assets/icons/nav-home.svg";
import navDollar from "../../assets/icons/nav-dollar.svg";
import navStats from "../../assets/icons/nav-stats.svg";
import navHistory from "../../assets/icons/nav-history.svg";

/**
 * Render an icon asset (a URL imported via Vite) as an inline SVG-coloured
 * image. The nav icons in `assets/icons/` use `currentColor`, so when loaded
 * via a CSS mask the icon picks up the IconButton's text colour and tracks
 * the active/inactive state.
 */
function MaskIcon({ src, title }: { src: string; title: string }) {
  return (
    <span
      role="img"
      aria-label={title}
      style={{
        display: "inline-block",
        width: 24,
        height: 24,
        backgroundColor: "currentColor",
        WebkitMask: `url(${src}) center / contain no-repeat`,
        mask: `url(${src}) center / contain no-repeat`,
      }}
    />
  );
}

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
          "preferably paint with `currentColor` so they inherit the active " +
          "state automatically.",
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
    icon: <MaskIcon src={navHome} title="Home" />,
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
    icon: <MaskIcon src={navHome} title="Home" />,
  },
};

export const Inactive: Story = {
  name: "Inactive",
  args: {
    active: false,
    label: "Markets",
    icon: <MaskIcon src={navStats} title="Markets" />,
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
      <IconButton
        active
        label="Home"
        icon={<MaskIcon src={navHome} title="Home" />}
      />
      <IconButton
        label="Convert"
        icon={<MaskIcon src={navDollar} title="Convert" />}
      />
      <IconButton
        label="Markets"
        icon={<MaskIcon src={navStats} title="Markets" />}
      />
      <IconButton
        label="History"
        icon={<MaskIcon src={navHistory} title="History" />}
      />
    </div>
  ),
};
