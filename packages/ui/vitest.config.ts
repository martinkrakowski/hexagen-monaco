import { mergeConfig, defineConfig } from "vitest/config";
import baseConfig from "../../vitest.shared";

// UI component tests render React via @testing-library, so they need a DOM. Use
// Vitest's jsdom environment (window/document/navigator are globals) instead of
// each test instantiating its own `new JSDOM(...)`.
export default mergeConfig(
  baseConfig,
  defineConfig({ test: { environment: "jsdom" } }),
);
