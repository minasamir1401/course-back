module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/quality/**/*.test.cjs'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testTimeout: 30_000,
  clearMocks: true,
  reporters: ['default'],
};
