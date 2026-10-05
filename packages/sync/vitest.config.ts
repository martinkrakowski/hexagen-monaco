import { mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.shared";

// ADR-0044 base config. The contract suites are excluded from the default `test`
// task: they run under their own runner (vitest.contract.config.ts, turbo
// `test:contract`) with an elevated, explicit timeout, so the spawn-heavy suites
// stop starving the unit/command suites on a shared CI runner.
export default mergeConfig(baseConfig, {
  test: {
    exclude: ["__tests__/contract/**"],
  },
});
