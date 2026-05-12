import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stat } from "./Stat";
import arrowUpRight from "../../assets/icons/arrow-up-right.svg";

/**
 * Render an icon asset (a URL imported via Vite) as an inline mask so the
 * SVG picks up the surrounding `currentColor`. Mirrors the approach used in
 * `IconButton.stories.tsx` so the trailing icon tracks the Stat's ink token.
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
  title: "Components/Stat",
  component: Stat,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pipeline UI Stat primitive. Small 'label above value' readout " +
          "used in the dashboard header strip (Figma frame 1497-94556 — " +
          "Exchange rate, Total Value Locked, Current APY). The optional " +
          "`trailingIcon` slot covers the external-link affordance paired " +
          "with the APY stat. The Stat is pure typography; no surface fill, " +
          "border, or padding. All values come from " +
          "`@pipeline/ui/styles/theme.css`.",
      },
    },
  },
  argTypes: {
    label: { control: "text" },
    value: { control: "text" },
    trailingIcon: { control: false },
  },
  args: {
    label: "Exchange rate",
    value: "1 sPLUSD = 1.0234 PLUSD",
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 32,
          background: "var(--color-pipeline-paper)",
          minWidth: 320,
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Stat>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Per-stat stories — cover the three readouts from Figma node 1497:94560    */
/* -------------------------------------------------------------------------- */

export const ExchangeRate: Story = {
  name: "Exchange rate",
  args: {
    label: "Exchange rate",
    value: "1 sPLUSD = 1.0234 PLUSD",
  },
};

export const TotalValueLocked: Story = {
  name: "Total Value Locked",
  args: {
    label: "Total Value Locked",
    value: "$28,812,044.93",
  },
};

export const CurrentAPY: Story = {
  name: "Current APY",
  args: {
    label: "Current APY",
    value: "8.42%",
  },
};

/* -------------------------------------------------------------------------- */
/*  Trailing-icon story — covers the external-link pairing from the strip     */
/* -------------------------------------------------------------------------- */

export const WithTrailingIcon: Story = {
  name: "With trailing icon",
  args: {
    label: "Current APY",
    value: "8.42%",
    trailingIcon: <MaskIcon src={arrowUpRight} title="Open details" />,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates the optional `trailingIcon` slot — supply any 24×24 " +
          "icon and it renders to the right of the value with a 4px gap. The " +
          "icon paints with `currentColor` so it inherits the value's ink " +
          "token. Maps to the external-link affordance shown in the Figma " +
          "header strip (node 1497:94564).",
      },
    },
  },
};

/* -------------------------------------------------------------------------- */
/*  Strip story — all three stats side-by-side as they render in the header   */
/* -------------------------------------------------------------------------- */

export const Strip: Story = {
  name: "Header strip",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "The three Stat readouts as they appear in the dashboard header " +
          "strip (Figma node 1497:94560), separated by the hairline left " +
          "borders inherited from the strip itself.",
      },
    },
  },
  render: () => (
    <div
      style={{
        display: "flex",
        gap: 16,
        alignItems: "center",
        justifyContent: "flex-end",
        padding: 32,
        background: "var(--color-pipeline-paper)",
        minHeight: "100vh",
      }}
    >
      <Stat label="Exchange rate" value="1 sPLUSD = 1.0234 PLUSD" />
      <div
        style={{
          paddingLeft: 12,
          borderLeft: "1px solid var(--color-pipeline-line)",
        }}
      >
        <Stat label="Total Value Locked" value="$28,812,044.93" />
      </div>
      <div
        style={{
          paddingLeft: 12,
          borderLeft: "1px solid var(--color-pipeline-line)",
        }}
      >
        <Stat
          label="Current APY"
          value="8.42%"
          trailingIcon={<MaskIcon src={arrowUpRight} title="Open details" />}
        />
      </div>
    </div>
  ),
};
