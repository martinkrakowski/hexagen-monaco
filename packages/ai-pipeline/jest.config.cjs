module.exports = {
  displayName: "@hexagen/ai-pipeline",
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "./",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: {
        module: "esnext",
      },
    }],
  },
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  moduleNameMapper: {
    "@hexagen/(.*)": "<rootDir>/../$1/src",
  },
};
