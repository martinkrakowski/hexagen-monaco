module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  testMatch: ["**/__tests__/**/*.test.(ts|tsx|js)"],
  moduleNameMapper: {
    "^(\\.{1,2}/.+)\\.js$": "$1",
    "^@hexagen/core-domain$":
      "<rootDir>/../../packages/core-domain/src/index.ts",
    "^@hexagen/layout-engine$":
      "<rootDir>/../../packages/layout-engine/src/index.ts",
    "^@hexagen/shared$": "<rootDir>/../../packages/shared/src/index.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
};
