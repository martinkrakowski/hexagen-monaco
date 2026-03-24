import next from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config} */
export default [
  {
    ignores: [
      ".next/**",
      "out/**",
      "node_modules/**",
      "dist/**",
      ".turbo/**",
      "src/types/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["app/**/*.ts", "app/**/*.tsx", "*.config.mjs"],
    plugins: {
      "@next": next,
    },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "no-console": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
    },
    settings: {
      next: {
        rootDir: ["app", "components", "lib", "hooks"],
      },
    },
  },
];
