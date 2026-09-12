process.env.NODE_ENV = process.env.NODE_ENV || 'test';

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  collectCoverageFrom: ['src/common/**/*.ts'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/e2e/global-setup.ts'
};
