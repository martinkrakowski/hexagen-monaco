import type { Preview } from "@storybook/react";

// Load the design tokens + globals so stories render with the real theme.
import "../src/styles/tokens.css";
import "../src/styles/globals.css";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i } },
  },
};

export default preview;
