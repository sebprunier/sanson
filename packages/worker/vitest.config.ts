import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolve workspace deps from their src/ during tests so we don't need a
  // build step before running them.
  resolve: {
    conditions: ['development'],
  },
  test: {
    globals: true,
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
})
