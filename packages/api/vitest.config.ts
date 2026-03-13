import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    hookTimeout: 120_000, // 2 min — container pull + start on first run
    testTimeout: 30_000,
  },
})
