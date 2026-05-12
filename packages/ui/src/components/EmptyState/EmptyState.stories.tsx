import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState } from "./EmptyState";
import { Card } from "../Card";

/**
 * Placeholder illustration used until the real `WalletIllustration` from
 * Issue #48 lands on this branch. Renders a 240×240 wallet glyph in the
 * muted ink token so it shows the illustration slot's intended size without
 * dragging in an extra asset. Once `WalletIllustration` is exported from
 * `@pipeline/ui`, swap this for the real component.
 */
function WalletIllustrationPlaceholder() {
  return (
    <svg
      width={240}
      height={240}
      viewBox="0 0 240 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Wallet illustration placeholder"
      style={{ color: "var(--color-pipeline-ink-subtle)" }}
    >
      <rect
        x={32}
        y={72}
        width={176}
        height={120}
        rx={12}
        stroke="currentColor"
        strokeWidth={2}
        fill="none"
      />
      <rect
        x={32}
        y={96}
        width={176}
        height={16}
        fill="currentColor"
        opacity={0.5}
      />
      <circle cx={168} cy={148} r={12} fill="currentColor" />
      {[120, 130, 140, 150, 160].map((y) => (
        <line
          key={y}
          x1={48}
          x2={144}
          y1={y}
          y2={y}
          stroke="currentColor"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}

const meta = {
  title: "Components/EmptyState",
  component: EmptyState,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Pipeline UI EmptyState primitive. Generic 'no data yet' centred " +
          "block: illustration on top, muted caption below. Used by the " +
          "dashboard's Recent activity card (Figma frame 1497-94556 → node " +
          "1497:94569 `Placeholder`). Pure composition — the parent " +
          "container (typically `Card`) supplies surface chrome and the " +
          "height that EmptyState centres into.",
      },
    },
  },
  argTypes: {
    illustration: { control: false },
    caption: { control: false },
  },
  args: {
    illustration: <WalletIllustrationPlaceholder />,
    caption: (
      <>
        <p style={{ margin: 0 }}>You will see all</p>
        <p style={{ margin: 0 }}>transactions here</p>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: 32,
          background: "var(--color-pipeline-paper)",
          minWidth: 360,
          minHeight: 480,
          display: "flex",
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------- */
/*  Default — illustration + caption                                          */
/* -------------------------------------------------------------------------- */

export const Default: Story = {
  name: "Default",
  parameters: {
    docs: {
      description: {
        story:
          "Default EmptyState — WalletIllustration placeholder on top, the " +
          "Recent activity caption below. Mirrors the Figma node 1497:94569.",
      },
    },
  },
};

/* -------------------------------------------------------------------------- */
/*  Inside a Card — matches the dashboard's Recent activity usage             */
/* -------------------------------------------------------------------------- */

export const InRecentActivityCard: Story = {
  name: "Inside Recent activity card",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "EmptyState rendered inside the dashboard's Recent activity card " +
          "(Figma node 1497:94567). Demonstrates the contract: the Card " +
          "supplies the height and the EmptyState centres into the space " +
          "below the heading.",
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
      <Card
        variant="white"
        style={{
          width: 432,
          height: 564,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-pipeline-heading-m)",
            lineHeight: "var(--text-pipeline-heading-m--line-height)",
            color: "var(--color-pipeline-ink)",
          }}
        >
          Recent activity
        </div>
        <div style={{ flex: "1 0 0", minHeight: 0 }}>
          <EmptyState
            illustration={<WalletIllustrationPlaceholder />}
            caption={
              <>
                <p style={{ margin: 0 }}>You will see all</p>
                <p style={{ margin: 0 }}>transactions here</p>
              </>
            }
          />
        </div>
      </Card>
    </div>
  ),
};

/* -------------------------------------------------------------------------- */
/*  Caption only — covers the optional-illustration path                      */
/* -------------------------------------------------------------------------- */

export const CaptionOnly: Story = {
  name: "Caption only",
  args: {
    illustration: undefined,
    caption: "Nothing here yet",
  },
  parameters: {
    docs: {
      description: {
        story:
          "EmptyState renders the caption alone when no illustration is " +
          "supplied — useful for tighter surfaces where the 240×240 " +
          "illustration would overwhelm the layout.",
      },
    },
  },
};
