/** @type {import('jest').Config} */
const tsJest = { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] };

module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      transform: tsJest,
      roots: ['<rootDir>/src'],
      testMatch: ['**/*.spec.ts'],
    },
    {
      // Mongo (replica set) e Redis reais, via Testcontainers (precisa de Docker).
      displayName: 'integration',
      testEnvironment: 'node',
      transform: tsJest,
      roots: ['<rootDir>/test'],
      testMatch: ['**/*.e2e-spec.ts'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
      globalTeardown: '<rootDir>/test/support/global-teardown.ts',
      setupFilesAfterEnv: ['<rootDir>/test/support/jest-setup.ts'],
    },
  ],
};
