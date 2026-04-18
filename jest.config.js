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
    '!src/utils/hsm.ts',
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
