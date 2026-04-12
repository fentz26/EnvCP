export default {
  preset: 'ts-jest/presets/default-esm',
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
    '!src/index.ts',
    '!src/utils/keychain.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 95,
      statements: 95,
    },
  },
  coverageReporters: ['text-summary', 'lcov'],
};
