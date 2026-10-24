module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  clearMocks: true,
  collectCoverageFrom: [
    'src/domain/**/*.js',
    'src/application/**/*.js',
    '!src/application/ports/**/*.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover', 'json-summary'],
  coverageThreshold: {
    global: {
      lines: 90,
      functions: 90,
      statements: 90,
      branches: 85,
    },
  },
  moduleNameMapper: {},
  testTimeout: 15000,
};
