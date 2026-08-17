import { mergeConfig, defineConfig } from "vitest/config";
import baseConfig from "../../vitest.shared";

// This package is React, so its tests mount components and hooks through
// @testing-library and need a DOM. jsdom is the only override — `packages/ui`
// does exactly the same for its component suites.
//
// No `include` widening and no JSX-runtime override: the suites are `.test.ts`
// using `React.createElement`, which is the convention `packages/ui` follows and
// which the repo-wide `**/*.test.ts` pattern in `vitest.shared.ts` already
// collects. A local `**/*.test.tsx` include would fork this workspace's
// collection pattern away from every other package for no gain.
//
// `url` is not decoration: jsdom's default document origin is `about:blank`,
// which is opaque, and some browser APIs refuse to initialise on an opaque
// origin. `pretendToBeVisual` gives requestAnimationFrame. `apps/web` sets both
// for the same reasons.
//
// The suites run HERE, in this workspace, and not from `apps/web`: the web app
// resolves React 19.2.4 while this package resolves its own 19.2.5, so mounting
// these components from there throws `Invalid hook call` (issue #521), which is
// why `apps/web` mocks `@hexagen/model-settings` at three call sites. Inside this
// workspace `react` and `react-dom` resolve to the same copy, so the components
// run for real rather than as a stand-in.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      environmentOptions: {
        jsdom: { url: "http://localhost", pretendToBeVisual: true },
      },
    },
  }),
);
