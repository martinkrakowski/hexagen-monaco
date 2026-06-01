// ESLint flat-config fragment: ban console.* so logging goes through the structured
// logger, not console.log technical debt (no level, no correlation id, no redaction).
//
// Spread it into your eslint.config.mjs AFTER your base config:
//
//   import { noConsoleConfig } from "./eslint.no-console.mjs";
//   export default [ ...baseConfig, ...noConsoleConfig ];
//
export const noConsoleConfig = [
  {
    rules: {
      // Route logging through the logger (e.g. the observability template's
      // src/infrastructure/logging/logger.ts). For a deliberate one-off, add a
      // `// eslint-disable-next-line no-console` on that line.
      "no-console": "{console_level}",
    },
  },
  {
    // The sanctioned console sites: the logger's own transport, process startup,
    // CLI scripts, config files, and smoke-test diagnostics. These legitimately
    // write to the console.
    files: [
      "**/infrastructure/logging/**",
      "**/server/startup/**",
      "scripts/**",
      "**/*.config.*",
      "**/smoke-*.{ts,tsx,js,mjs}",
    ],
    rules: {
      "no-console": "off",
    },
  },
];

export default noConsoleConfig;
