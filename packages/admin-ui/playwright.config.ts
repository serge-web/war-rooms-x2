import { defineConfig, devices } from '@playwright/test'

const port = 4393

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${port}/`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'pnpm exec vite build -c dev/vite.config.ts && pnpm exec vite preview -c dev/vite.config.ts',
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
