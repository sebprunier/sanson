import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @sanson/api dev',
      url: 'http://localhost:3000/health',
      reuseExistingServer: true,
      timeout: 30_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter @sanson/admin dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 15_000,
      cwd: '../..',
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader'],
        },
      },
    },
  ],
})
