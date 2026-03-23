import next from "@next/eslint-plugin-next";

/** @type {import('eslint').Linter.Config} */
export default [
  {
    ignores: [".next", "out"],
  },
  {
    files: ["**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"],
    extends: ["eslint:recommended", "@next/next/recommended"],
    plugins: ["@next"],
    settings: {
      next: {
        rootDir: ["app", "components", "lib", "hooks"],
      },
    },
  },
];
