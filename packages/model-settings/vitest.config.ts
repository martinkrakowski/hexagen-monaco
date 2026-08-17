import { mergeConfig, defineConfig } from "vitest/config";
import baseConfig from "../../vitest.shared";

// This package is React, so its tests mount components and hooks through
// @testing-library and need a DOM (packages/ui does the same).
//
// `include` adds `**/*.test.tsx`: the base contributes `**/*.test.ts` only, and
// a component suite written in TSX would otherwise be collected by nothing and
// report green — the silent-skip failure this arc exists to remove.
//
// The suites run HERE, in this workspace, and not from `apps/web`, because the
// web app resolves React 19.2.4 while this package resolves its own 19.2.5;
// mounting these components from there throws `Invalid hook call` (issue #521),
// which is why `apps/web` mocks `@hexagen/model-settings` at three call sites.
// Inside this workspace `react` and `react-dom` resolve to the same copy, so
// the components run for real rather than as a stand-in.
export default mergeConfig(
  baseConfig,
  defineConfig({
    oxc: { jsx: { runtime: "automatic", importSource: "react" } },
    test: {
      environment: "jsdom",
      environmentOptions: {
        jsdom: { url: "http://localhost", pretendToBeVisual: true },
      },
      include: ["**/*.test.ts", "**/*.test.tsx"],
    },
  }),
);
