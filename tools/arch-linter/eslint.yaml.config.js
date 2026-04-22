import pluginYml from "eslint-plugin-yml";
import { parseForESLint } from "yaml-eslint-parser";

const yamlParser = {
  parseForESLint,
  parse(text) {
    return parseForESLint(text).ast;
  },
};

export default [
  {
    files: ["**/*.yaml", "**/*.yml"],
    languageOptions: {
      parser: yamlParser,
    },
    plugins: {
      yml: pluginYml,
    },
    rules: {
      "yml/indent": ["error", 2],
      "yml/block-mapping": "error",
      "yml/block-sequence": "error",
      "yml/no-irregular-whitespace": "error",
      "yml/plain-scalar": "off",
      "yml/quotes": "off",
      "yml/key-name-casing": "off",
    },
  },
];
