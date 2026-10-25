import { defineConfig, devices } from '@playwright/test'

const port = 4392

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${port}/`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec vite build -c e2e/vite.config.ts && node e2e/serve.ts e2e/dist ${port}`,
    url: `http://localhost:${port}/dep-a/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
