export default {
  preset: 'ts-jest/presets/default-esm',
  coverageProvider: 'v8',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '__tests__/sandbox/'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/cli/index.ts',
    '!src/cli.ts',
    '!src/index.ts',
    '!src/adapters/index.ts',
    '!src/mcp/index.ts',
    '!src/server/index.ts',
    '!src/utils/keychain.ts',
    '!src/utils/hsm.ts',
    '!src/utils/prompt.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 90,
      statements: 90,
      branches: 88,
      functions: 89,
    },
  },
  coverageReporters: ['text-summary', 'lcov'],
};
