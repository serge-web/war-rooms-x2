import { defineConfig, devices } from '@playwright/test'

// WRX_MOCK_HOST_E2E_PORT moves the server, e.g. for two checkouts on one machine; the screenshot
// runs (tools/screenshots) use the same default, so set one of them when both run at once.
const port = Number(process.env.WRX_MOCK_HOST_E2E_PORT ?? 4392)

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
