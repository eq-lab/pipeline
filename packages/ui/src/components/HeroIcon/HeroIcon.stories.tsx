import type { Meta, StoryObj } from "@storybook/react-vite";
import { HeroIcon } from "./HeroIcon";

const meta = {
  title: "Components/HeroIcon",
  component: HeroIcon,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pipeline UI HeroIcon primitive. A 72×72 muted-fill circle with a " +
          "36px ink-tinted icon centered inside. Used as the page-hero badge " +
          "above the heading — the Activity page is the canonical example " +
          "(Figma node 1497-94912). Built as a generic primitive; extend the " +
          "`HeroIconName` union as new page heroes are introduced.",
      },
    },
  },
  argTypes: {
    icon: { control: "select", options: ["arrow-clock", "chart"] },
    "aria-label": { control: "text" },
  },
  args: {
    icon: "arrow-clock",
  },
} satisfies Meta<typeof HeroIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Default — arrow-clock, decorative                                         */
/* -------------------------------------------------------------------------- */

export const Default: Story = {
  name: "Default (arrow-clock)",
  parameters: {
    docs: {
      description: {
        story:
          "The canonical HeroIcon usage: `arrow-clock` glyph inside the 72px " +
          'muted-fill circle. Decorative by default (`aria-hidden="true"`).',
      },
    },
  },
};

/* -------------------------------------------------------------------------- */
/*  With aria-label — meaningful to assistive tech                            */
/* -------------------------------------------------------------------------- */

export const WithAriaLabel: Story = {
  name: "With aria-label",
  args: {
    icon: "arrow-clock",
    "aria-label": "Activity",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Pass `aria-label` when the HeroIcon is the primary heading " +
          "landmark for a page and needs to be announced by screen readers.",
      },
    },
  },
};

/* -------------------------------------------------------------------------- */
/*  Chart — stake-page hero glyph (Figma node 1497:95314)                   */
/* -------------------------------------------------------------------------- */

export const Chart: Story = {
  name: "Chart",
  args: {
    icon: "chart",
  },
  parameters: {
    docs: {
      description: {
        story:
          "The `chart` variant maps to `nav-stats.svg` — used as the hero " +
          "glyph on the stake page (Figma node 1497:95314). Renders a 72×72 " +
          "muted-fill circle with a 36px ink-tinted chart icon centered inside.",
      },
    },
  },
};

/* -------------------------------------------------------------------------- */
/*  On paper background — mirrors the Activity page hero slot                */
/* -------------------------------------------------------------------------- */

export const OnPaper: Story = {
  name: "On paper background",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "HeroIcon rendered on the paper background that the Activity page " +
          "uses, matching the Figma composition (node 1497-94912).",
      },
    },
  },
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        padding: 48,
        background: "var(--color-pipeline-paper)",
        minHeight: "100vh",
      }}
    >
      <HeroIcon icon="arrow-clock" aria-label="Activity" />
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-pipeline-heading-m)",
          lineHeight: "var(--text-pipeline-heading-m--line-height)",
          fontWeight: "var(--font-weight-bold)",
          color: "var(--color-pipeline-ink)",
        }}
      >
        Activity
      </div>
    </div>
  ),
};
