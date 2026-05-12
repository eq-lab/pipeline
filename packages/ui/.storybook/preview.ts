import type { Preview } from "@storybook/react-vite";

// TODO(#future-theme-issue): enable once src/styles/theme.css lands
// import "../src/styles/theme.css";

const preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: "centered",
  },
} satisfies Preview;

export default preview;
