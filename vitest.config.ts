import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    setupFiles: ['reflect-metadata'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/database/migrate.ts'],
      // Unit floor only: modules, queries and controllers are covered by e2e.
      thresholds: { lines: 55, statements: 55, branches: 50, functions: 35 },
    },
  },
});
