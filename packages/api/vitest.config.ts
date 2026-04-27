import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolve workspace deps from their src/ during tests so we don't need a
  // build step before running them. Matches the `development` condition in
  // their package.json `exports` field.
  resolve: {
    conditions: ['development'],
  },
  test: {
    globals: true,
    hookTimeout: 120_000, // 2 min — container pull + start on first run
    testTimeout: 30_000,
  },
})
