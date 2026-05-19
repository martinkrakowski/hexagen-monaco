module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  resolver: '<rootDir>/jest.resolver.cjs',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.json'
    }]
  },
  moduleNameMapper: {
    '^@hexagen/shared': '<rootDir>/../../packages/shared/src/index.ts',
    '^@hexagen/local-llm$': '<rootDir>/../../packages/local-llm/src/index.ts',
    '^@hexagen/local-llm/(.+)$': '<rootDir>/../../packages/local-llm/src/$1/index.ts',
    '^@hexagen/transaction-system': '<rootDir>/../../packages/transaction-system/src/index.ts',
    '^@hexagen/ai-pipeline': '<rootDir>/../../packages/ai-pipeline/src/index.ts',
  },
  testMatch: ['**/__tests__/**/*.{js,jsx,ts,tsx}', '**/?(*.)+(spec|test).{js,jsx,ts,tsx}'],
  testPathIgnorePatterns: ['/doubles/', '/fake\\.ts$', '/e2e/']
};
