export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
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
  ],
  coverageThreshold: {
    global: {
      lines: 70,
      statements: 70,
    },
  },
  coverageReporters: ['text-summary', 'lcov'],
};
